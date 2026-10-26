import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { RingPreviewImage } from "../../utils/ringPreview";

type ImageTransform = { scale: number; x: number; y: number };
type Point = { x: number; y: number };
const FIT: ImageTransform = { scale: 1, x: 0, y: 0 };
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const midpoint = (points: Point[]) => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
const distance = (points: Point[]) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);

export const ImageLightbox = ({ image, enhancing = false, onClose }: { image: RingPreviewImage; enhancing?: boolean; onClose: () => void }) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const transformRef = useRef(FIT);
  const pointers = useRef(new Map<number, Point>());
  const [transform, setTransform] = useState(FIT);
  const [dragging, setDragging] = useState(false);

  const update = (next: ImageTransform) => {
    const bounds = viewportRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const ratio = imageRef.current?.naturalWidth && imageRef.current?.naturalHeight ? imageRef.current.naturalWidth / imageRef.current.naturalHeight : 1;
    const fitHeight = Math.min(bounds.height, bounds.width / ratio);
    const scale = clamp(next.scale, 1, 3);
    const maxX = Math.max(0, (fitHeight * ratio * scale - bounds.width) / 2);
    const maxY = Math.max(0, (fitHeight * scale - bounds.height) / 2);
    const constrained = { scale, x: clamp(next.x, -maxX, maxX), y: clamp(next.y, -maxY, maxY) };
    transformRef.current = constrained;
    setTransform(constrained);
  };
  const zoomAt = (scale: number, anchor: Point = { x: 0, y: 0 }) => {
    const current = transformRef.current;
    const nextScale = clamp(scale, 1, 3), factor = nextScale / current.scale;
    update({ scale: nextScale, x: anchor.x - (anchor.x - current.x) * factor, y: anchor.y - (anchor.y - current.y) * factor });
  };

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = viewport.getBoundingClientRect();
      zoomAt(transformRef.current.scale * Math.exp(-clamp(event.deltaY, -120, 120) * 0.0025), { x: event.clientX - bounds.left - bounds.width / 2, y: event.clientY - bounds.top - bounds.height / 2 });
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    const observer = new ResizeObserver(() => update(transformRef.current));
    observer.observe(viewport);
    return () => { viewport.removeEventListener("wheel", wheel); observer.disconnect(); };
  }, []);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow, htmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = document.documentElement.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (["+", "=", "-", "_", "0"].includes(event.key)) {
        event.preventDefault();
        zoomAt(event.key === "0" ? 1 : transformRef.current.scale + (["-", "_"].includes(event.key) ? -0.25 : 0.25));
      }
      if (event.key === "Tab") {
        const buttons = Array.from(frameRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", keyDown);
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
      document.removeEventListener("keydown", keyDown);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [onClose]);

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || pointers.current.size >= 2) return;
    event.preventDefault();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const before = Array.from(pointers.current.values());
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = transformRef.current;
    if (pointers.current.size === 2) {
      const after = Array.from(pointers.current.values());
      const bounds = event.currentTarget.getBoundingClientRect();
      const from = midpoint(before), to = midpoint(after);
      const scale = clamp(current.scale * distance(after) / Math.max(1, distance(before)), 1, 3), factor = scale / current.scale;
      update({ scale, x: to.x - bounds.left - bounds.width / 2 - (from.x - bounds.left - bounds.width / 2 - current.x) * factor, y: to.y - bounds.top - bounds.height / 2 - (from.y - bounds.top - bounds.height / 2 - current.y) * factor });
    } else if (current.scale > 1) update({ ...current, x: current.x + event.clientX - previous.x, y: current.y + event.clientY - previous.y });
  };
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(pointers.current.size > 0);
  };

  return <div className="product-image-lightbox" role="dialog" aria-modal="true" aria-label={image.label} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={frameRef} className="product-image-frame">
      <div ref={viewportRef} className={`product-image-viewport ${transform.scale > 1 ? "is-zoomed" : ""} ${dragging ? "is-dragging" : ""}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={pointerUp}
        onDoubleClick={event => { const bounds = event.currentTarget.getBoundingClientRect(); zoomAt(transformRef.current.scale > 1 ? 1 : 2, { x: event.clientX - bounds.left - bounds.width / 2, y: event.clientY - bounds.top - bounds.height / 2 }); }}>
        <img ref={imageRef} src={image.url} alt={image.label} draggable={false} onLoad={() => update(transformRef.current)} style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }} />
      </div>
      <span className="product-image-zoom-hint">Scroll or pinch to zoom · Drag to explore</span>
      {enhancing && <span className="product-image-detail-status" role="status">Enhancing detail…</span>}
      <button ref={closeRef} type="button" aria-label="Close enlarged image" title="Close enlarged image" onClick={onClose}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
      <div className="viewer-icon-controls product-image-zoom-controls" role="toolbar" aria-label="Image zoom controls">
        <button type="button" aria-label="Zoom out" title="Zoom out" disabled={transform.scale <= 1} onClick={() => zoomAt(transformRef.current.scale - 0.25)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg></button>
        <output aria-label="Image zoom" aria-live="polite">{Math.round(transform.scale * 100)}%</output>
        <button type="button" aria-label="Zoom in" title="Zoom in" disabled={transform.scale >= 3} onClick={() => zoomAt(transformRef.current.scale + 0.25)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg></button>
        <span className="viewer-control-divider" aria-hidden="true" />
        <button type="button" aria-label="Reset image zoom" title="Fit image" onClick={() => update(FIT)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" /></svg></button>
      </div>
    </div>
  </div>;
};

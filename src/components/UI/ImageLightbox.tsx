import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { RingPreviewImage } from "../../utils/ringPreview";

type ImageTransform = { scale: number; x: number; y: number };
type Point = { x: number; y: number };
export type ImageOrigin = { left: number; top: number; width: number; height: number };
const FIT: ImageTransform = { scale: 1, x: 0, y: 0 };
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const midpoint = (points: Point[]) => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
const distance = (points: Point[]) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
const originTransform = (origin: ImageOrigin, frame: DOMRect) => `translate3d(${origin.left + origin.width / 2 - frame.left - frame.width / 2}px, ${origin.top + origin.height / 2 - frame.top - frame.height / 2}px, 0) scale(${origin.width / frame.width}, ${origin.height / frame.height})`;
const imageMotionFrames = (origin: ImageOrigin, frame: DOMRect, reverse = false, fillWidth = false): Keyframe[] => {
  const initialX = origin.width / frame.width, initialY = origin.height / frame.height;
  const fit = fillWidth ? frame.width : Math.min(frame.width, frame.height);
  return Array.from({ length: 21 }, (_, index) => {
    const progress = reverse ? 1 - index / 20 : index / 20;
    const x = initialX + (1 - initialX) * progress, y = initialY + (1 - initialY) * progress;
    const size = fillWidth ? frame.width * x : Math.min(frame.width * x, frame.height * y);
    return { transform: `scale(${size / (fit * x)}, ${size / (fit * y)})`, offset: index / 20 };
  });
};

export const ImageLightbox = ({ image, origin, enhancing = false, onClose, onOpened, onClosing }: { image: RingPreviewImage; origin: ImageOrigin; enhancing?: boolean; onClose: () => void; onOpened: () => void; onClosing: () => void }) => {
  const fillWidth = image.id === "engraving";
  const overlayRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const transformRef = useRef(FIT);
  const pointers = useRef(new Map<number, Point>());
  const motionRef = useRef<Animation | null>(null);
  const imageMotionRef = useRef<Animation | null>(null);
  const finalBoundsRef = useRef<DOMRect | null>(null);
  const closingRef = useRef(false);
  const touchStart = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastTap = useRef<{ x: number; y: number; time: number } | null>(null);
  const [transform, setTransform] = useState(FIT);
  const [dragging, setDragging] = useState(false);
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    onClosing();
    const frame = frameRef.current, overlay = overlayRef.current;
    if (!frame || !overlay || !frame.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { onClose(); return; }
    const bounds = motionRef.current?.playState === "running" ? finalBoundsRef.current! : frame.getBoundingClientRect();
    const current = getComputedStyle(frame).transform;
    const currentImage = imageRef.current && getComputedStyle(imageRef.current).transform;
    motionRef.current?.cancel(); imageMotionRef.current?.cancel();
    const motion = frame.animate([{ transform: current }, { transform: originTransform(origin, bounds), borderRadius: "5px" }], { duration: 260, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" });
    motionRef.current = motion;
    if (imageRef.current) {
      const frames = imageMotionFrames(origin, bounds, true, fillWidth);
      if (currentImage) frames[0] = { ...frames[0], transform: currentImage };
      imageMotionRef.current = imageRef.current.animate(frames, { duration: 260, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" });
    }
    overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: "ease-in", fill: "forwards" });
    void motion.finished.then(onClose).catch(() => {});
  }, [origin, onClose, onClosing, fillWidth]);

  const update = (next: ImageTransform) => {
    const bounds = viewportRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const ratio = imageRef.current?.naturalWidth && imageRef.current?.naturalHeight ? imageRef.current.naturalWidth / imageRef.current.naturalHeight : 1;
    const fitHeight = fillWidth ? bounds.width / ratio : Math.min(bounds.height, bounds.width / ratio);
    const scale = clamp(next.scale, 1, 3);
    const maxX = Math.max(0, (fitHeight * ratio * scale - bounds.width) / 2);
    const maxY = Math.max(0, (fitHeight * scale - bounds.height) / 2);
    const constrained = { scale, x: clamp(next.x, -maxX, maxX), y: clamp(next.y, -maxY, maxY) };
    transformRef.current = constrained;
    setTransform(constrained);
  };
  const zoomAt = (scale: number, anchor: Point = { x: 0, y: 0 }) => {
    if (closingRef.current) return;
    if (motionRef.current?.playState === "running") { motionRef.current.finish(); imageMotionRef.current?.finish(); }
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

  useLayoutEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow, htmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = document.documentElement.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); requestClose(); return; }
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
  }, [requestClose]);

  useLayoutEffect(() => {
    const frame = frameRef.current, overlay = overlayRef.current;
    if (!frame || !overlay || !frame.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { onOpened(); return; }
    const bounds = frame.getBoundingClientRect();
    finalBoundsRef.current = bounds;
    const motion = frame.animate([{ transform: originTransform(origin, bounds), borderRadius: "5px" }, { transform: "translate3d(0,0,0) scale(1)", borderRadius: getComputedStyle(frame).borderRadius }], { duration: 360, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" });
    motionRef.current = motion;
    imageMotionRef.current = imageRef.current?.animate(imageMotionFrames(origin, bounds, false, fillWidth), { duration: 360, easing: "cubic-bezier(.2,.8,.2,1)" }) ?? null;
    const fade = overlay.animate([{ opacity: .1 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
    void motion.finished.then(() => { if (!closingRef.current) onOpened(); }).catch(() => {});
    return () => { motion.cancel(); imageMotionRef.current?.cancel(); fade.cancel(); };
  }, [origin, onOpened, fillWidth]);

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (closingRef.current || event.button !== 0 || pointers.current.size >= 2) return;
    if (motionRef.current?.playState === "running") { motionRef.current.finish(); imageMotionRef.current?.finish(); }
    event.preventDefault();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    touchStart.current = pointers.current.size === 1 ? { x: event.clientX, y: event.clientY, time: performance.now() } : null;
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
    if (!pointers.current.has(event.pointerId)) return;
    const start = touchStart.current;
    if (event.type === "pointerup" && event.pointerType === "touch" && pointers.current.size === 1 && start && performance.now() - start.time < 280 && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 8) {
      const now = performance.now(), previous = lastTap.current;
      if (previous && now - previous.time < 320 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 30) {
        const bounds = event.currentTarget.getBoundingClientRect();
        zoomAt(transformRef.current.scale > 1 ? 1 : 2, { x: event.clientX - bounds.left - bounds.width / 2, y: event.clientY - bounds.top - bounds.height / 2 });
        lastTap.current = null;
      } else lastTap.current = { x: event.clientX, y: event.clientY, time: now };
    }
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(pointers.current.size > 0);
    touchStart.current = null;
  };

  return <div ref={overlayRef} className="product-image-lightbox" role="dialog" aria-modal="true" aria-label={image.label} onClick={event => { if (event.target === event.currentTarget) requestClose(); }}>
    <div ref={frameRef} className="product-image-frame">
      <div ref={viewportRef} className={`product-image-viewport ${fillWidth ? "is-engraving" : ""} ${transform.scale > 1 ? "is-zoomed" : ""} ${dragging ? "is-dragging" : ""}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={pointerUp}
        onDoubleClick={event => { const bounds = event.currentTarget.getBoundingClientRect(); zoomAt(transformRef.current.scale > 1 ? 1 : 2, { x: event.clientX - bounds.left - bounds.width / 2, y: event.clientY - bounds.top - bounds.height / 2 }); }}>
        <img ref={imageRef} src={image.url} alt={image.label} draggable={false} onLoad={() => update(transformRef.current)} style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }} />
      </div>
      <span className="product-image-zoom-hint">Scroll or pinch to zoom · Drag to explore</span>
      {enhancing && <span className="product-image-detail-status" role="status">Enhancing detail…</span>}
      <button ref={closeRef} type="button" aria-label="Close enlarged image" title="Close enlarged image" onClick={requestClose}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
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

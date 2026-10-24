import { useEffect, useRef, useState, type ReactNode } from "react";
import { CameraControls } from "./CameraControls";

interface ViewerStageProps {
  children: ReactNode;
  currentView: string;
  isAutoRotating: boolean;
  onSelectView: (view: "front" | "top" | "side") => void;
  onToggleAutoRotate: () => void;
}

export const ViewerStage = ({ children, ...controls }: ViewerStageProps) => {
  const [expanded, setExpanded] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setExpanded(false); }
      if (event.key !== "Tab") return;
      const buttons = Array.from(stageRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [expanded]);

  return <>
    {expanded && <div className="product-viewer-backdrop" aria-hidden="true" onClick={() => setExpanded(false)} />}
    <div ref={stageRef} className={`product-viewer-stage ${expanded ? "is-expanded" : ""}`} role={expanded ? "dialog" : undefined} aria-modal={expanded ? true : undefined} aria-label="Interactive 3D ring viewer">
      {children}
      {expanded && <button ref={closeRef} type="button" className="viewer-close-expanded" aria-label="Close expanded viewer" title="Close expanded viewer" onClick={() => setExpanded(false)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>}
      <div className="product-live-caption"><span className="product-live-dot" />Interactive 3D</div>
      <CameraControls {...controls} isExpanded={expanded} onToggleExpanded={() => setExpanded(value => !value)} />
    </div>
  </>;
};

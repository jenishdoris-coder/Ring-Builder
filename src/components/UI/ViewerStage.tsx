import { useEffect, useRef, useState, type ReactNode } from "react";
import { CameraControls } from "./CameraControls";
import type { RingCameraView } from "../../utils/ringCameraViews";
import { HandToneControl } from "./HandToneControl";
import { EngravingPositionSwitch } from "./EngravingPositionSwitch";
import type { EngravingPosition } from "../../config/engraving";

interface ViewerStageProps {
  children: ReactNode;
  currentView: string;
  onSelectView: (view: RingCameraView) => void;
  onHoverChange: (hovered: boolean) => void;
  handSkinTone: number;
  onChangeHandSkinTone: (value: number) => void;
  hasEngraving: boolean;
  engravingPositions: EngravingPosition[];
  engravingPosition: EngravingPosition;
  onSelectEngraving: (position: EngravingPosition) => void;
}

export const ViewerStage = ({ children, onHoverChange, handSkinTone, onChangeHandSkinTone, engravingPositions, engravingPosition, onSelectEngraving, ...controls }: ViewerStageProps) => {
  const [expanded, setExpanded] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const touches = useRef(new Set<number>());
  const resumeRotation = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(resumeRotation.current), []);
  const finishTouch = (pointerId: number) => {
    touches.current.delete(pointerId);
    clearTimeout(resumeRotation.current);
    if (touches.current.size === 0) resumeRotation.current = setTimeout(() => onHoverChange(false), 2500);
  };

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
      const buttons = Array.from(stageRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), a[href], [tabindex='0']") ?? []);
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
    <div ref={stageRef} className={`product-viewer-stage ${expanded ? "is-expanded" : ""} ${controls.currentView === "hand" ? "is-hand-preview" : ""}`} role={expanded ? "dialog" : undefined} aria-modal={expanded ? true : undefined} aria-label="Interactive 3D ring viewer"
      onPointerEnter={event => { if (event.pointerType !== "touch") onHoverChange(true); }} onPointerLeave={event => { if (event.pointerType !== "touch") onHoverChange(false); }}
      onPointerDownCapture={event => { if (event.pointerType === "touch") { touches.current.add(event.pointerId); clearTimeout(resumeRotation.current); onHoverChange(true); } }}
      onPointerUpCapture={event => { if (event.pointerType === "touch") finishTouch(event.pointerId); }} onPointerCancelCapture={event => { if (event.pointerType === "touch") finishTouch(event.pointerId); }}>
      {children}
      {expanded && <button ref={closeRef} type="button" className="viewer-close-expanded" aria-label="Close expanded viewer" title="Close expanded viewer" onClick={() => setExpanded(false)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>}
      <div className="product-live-caption"><span className="product-live-dot" />{controls.currentView === "hand" ? "On-hand preview" : controls.currentView === "engraving" ? "Engraving detail" : "Interactive 3D"}</div>
      <CameraControls {...controls} isExpanded={expanded} onToggleExpanded={() => setExpanded(value => !value)} />
      <span className="viewer-touch-hint">Drag to rotate · Pinch to zoom</span>
      <EngravingPositionSwitch positions={engravingPositions} selected={engravingPosition} onSelect={onSelectEngraving} location="viewer" />
      <aside className="viewer-right-rail" aria-label={controls.currentView === "hand" ? "Hand appearance" : undefined}>
        {controls.currentView === "hand" && <HandToneControl value={handSkinTone} onChange={onChangeHandSkinTone} />}
      </aside>
    </div>
  </>;
};

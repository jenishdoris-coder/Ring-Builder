import type { ReactNode } from "react";
import type { RingCameraView } from "../../utils/ringCameraViews";

interface CameraControlsProps {
  currentView: string;
  isExpanded: boolean;
  onSelectView: (view: RingCameraView) => void;
  onToggleExpanded: () => void;
  hasEngraving: boolean;
  onTryAR?: () => void;
  arDisabled?: boolean;
}

const Icon = ({ children }: { children: ReactNode }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;

export const CameraControls = ({ currentView, isExpanded, onSelectView, onToggleExpanded, hasEngraving, onTryAR, arDisabled }: CameraControlsProps) => <div className="viewer-icon-controls" role="toolbar" aria-label="3D viewer controls">
  <button type="button" aria-label="Three-quarter view" title="Three-quarter view" aria-pressed={currentView === "front"} onClick={() => onSelectView("front")}>
    <Icon><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9m-4-16.5 8 4.5" /></Icon>
  </button>
  <button type="button" aria-label="Top view" title="Top view" aria-pressed={currentView === "top"} onClick={() => onSelectView("top")}>
    <Icon><path d="m7 4 10 0 4 5-9 12L3 9l4-5ZM3 9h18M7 4l5 17 5-17" /></Icon>
  </button>
  <button type="button" aria-label="Head and prongs close-up" title="Head and prongs close-up" aria-pressed={currentView === "head"} onClick={() => onSelectView("head")}>
    <Icon><path d="M7 3H3v4m14-4h4v4M3 17v4h4m14-4v4h-4M7 10l3-3h4l3 3-5 7-5-7Zm0 0h10" /></Icon>
  </button>
  <button type="button" aria-label="Shank diamond close-up" title="Shank diamond close-up" aria-pressed={currentView === "shank"} onClick={() => onSelectView("shank")}>
    <Icon><path d="M4 21a8 8 0 0 1 16 0M3 10l3-3 3 3-3 4-3-4Zm6-5 3-3 3 3-3 4-3-4Zm6 5 3-3 3 3-3 4-3-4Z" /></Icon>
  </button>
  <button type="button" aria-label="View on hand" title={currentView === "hand" ? "Return to ring view" : "View on hand"} aria-pressed={currentView === "hand"} onClick={() => onSelectView(currentView === "hand" ? "front" : "hand")}>
    <Icon><path d="M8 13V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v6-3a1.5 1.5 0 0 1 3 0v7c0 4-2 6-6 6h-1c-2 0-3-1-4-2l-5-6a1.5 1.5 0 0 1 2-2l2 2Z" /></Icon>
  </button>
  {hasEngraving && <button type="button" aria-label="Focus engraving" title="Focus engraving" aria-pressed={currentView === "engraving"} onClick={() => onSelectView("engraving")}>
    <Icon><path d="M4 19h16M7 16l4-11h2l4 11M9 12h6m4-8 2 2m-3 1 2 2" /></Icon>
  </button>}
  <span className="viewer-control-divider" aria-hidden="true" />
  {onTryAR && <button type="button" className="viewer-ar-control" aria-label="Try your ring in AR" title="Try your ring in AR" onClick={onTryAR} disabled={arDisabled}>
    <Icon><path d="M7 7l1.5-2h7L17 7h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h3Z" /><path d="m9 10 1-1h4l1 1-3 3-3-3Zm1 3a3 3 0 1 0 4 0M18 10h.01" /></Icon>
  </button>}
  <button type="button" data-expand-viewer aria-label={isExpanded ? "Exit expanded view" : "Expand 3D viewer"} title={isExpanded ? "Exit expanded view" : "Expand 3D viewer"} aria-expanded={isExpanded} onClick={onToggleExpanded}>
    <Icon>{isExpanded ? <path d="M9 3v6H3m12-6v6h6M9 21v-6H3m12 6v-6h6" /> : <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" />}</Icon>
  </button>
</div>;

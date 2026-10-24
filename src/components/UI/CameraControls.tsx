import type { ReactNode } from "react";

interface CameraControlsProps {
  currentView: string;
  isAutoRotating: boolean;
  isExpanded: boolean;
  onSelectView: (view: "front" | "top" | "side") => void;
  onToggleAutoRotate: () => void;
  onToggleExpanded: () => void;
}

const Icon = ({ children }: { children: ReactNode }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;

export const CameraControls = ({ currentView, isAutoRotating, isExpanded, onSelectView, onToggleAutoRotate, onToggleExpanded }: CameraControlsProps) => <div className="viewer-icon-controls" role="toolbar" aria-label="3D viewer controls">
  <button type="button" aria-label="Three-quarter view" title="Three-quarter view" aria-pressed={currentView === "front"} onClick={() => onSelectView("front")}>
    <Icon><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9m-4-16.5 8 4.5" /></Icon>
  </button>
  <button type="button" aria-label="Top view" title="Top view" aria-pressed={currentView === "top"} onClick={() => onSelectView("top")}>
    <Icon><path d="m8 3 8 0 5 5v8l-5 5H8l-5-5V8l5-5Z" /><path d="m8 8 8 0v8H8V8Zm0-5v5L3 8m13-5v5l5 0m0 8h-5v5M8 21v-5H3" /></Icon>
  </button>
  <button type="button" aria-label="Side profile" title="Side profile" aria-pressed={currentView === "side"} onClick={() => onSelectView("side")}>
    <Icon><path d="m8 3 8 0 2 3-6 5-6-5 2-3Zm-2 3h12M9 9a7 7 0 1 0 6 0" /></Icon>
  </button>
  <button type="button" aria-label={isAutoRotating ? "Pause rotation" : "Start rotation"} title={isAutoRotating ? "Pause rotation" : "Start rotation"} aria-pressed={isAutoRotating} onClick={onToggleAutoRotate}>
    <Icon><path d="M20 8a8.5 8.5 0 0 0-14-3L3 8m0-5v5h5M4 16a8.5 8.5 0 0 0 14 3l3-3m0 5v-5h-5" /></Icon>
  </button>
  <span className="viewer-control-divider" aria-hidden="true" />
  <button type="button" data-expand-viewer aria-label={isExpanded ? "Exit expanded view" : "Expand 3D viewer"} title={isExpanded ? "Exit expanded view" : "Expand 3D viewer"} aria-expanded={isExpanded} onClick={onToggleExpanded}>
    <Icon>{isExpanded ? <path d="M9 3v6H3m12-6v6h6M9 21v-6H3m12 6v-6h6" /> : <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" />}</Icon>
  </button>
</div>;

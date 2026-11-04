import type { ReactNode } from "react";
import type { RingCameraView } from "../../utils/ringCameraViews";
import {preloadARTryOn} from './ARTryOn';

interface CameraControlsProps {
  currentView: string;
  isExpanded: boolean;
  onSelectView: (view: RingCameraView) => void;
  onToggleExpanded: () => void;
  hasEngraving: boolean;
  onTryAR?: () => void;
  arDisabled?: boolean;
}

const Icon = ({ children }: { children: ReactNode }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>;

export const CameraControls = ({ currentView, isExpanded, onSelectView, onToggleExpanded, hasEngraving, onTryAR, arDisabled }: CameraControlsProps) => <div className="viewer-icon-controls" role="toolbar" aria-label="3D viewer controls">
  <button type="button" aria-label="Three-quarter view" title="Three-quarter view" aria-pressed={currentView === "front"} onClick={() => onSelectView("front")}>
    <Icon><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></Icon>
  </button>
  <button type="button" aria-label="Top view" title="Top view" aria-pressed={currentView === "top"} onClick={() => onSelectView("top")}>
    <Icon><path d="M7 4h10l4 5-9 12L3 9l4-5ZM3 9h18M8 4l4 17 4-17" /></Icon>
  </button>
  <button type="button" aria-label="Head and prongs close-up" title="Head and prongs close-up" aria-pressed={currentView === "head"} onClick={() => onSelectView("head")}>
    <Icon><circle cx="10.5" cy="10.5" r="7.5" /><path d="m16 16 5 5M7 8h7l1.5 2-5 5-5-5L7 8Zm-1.5 2h10" /></Icon>
  </button>
  <button type="button" aria-label="Shank diamond close-up" title="Shank diamond close-up" aria-pressed={currentView === "shank"} onClick={() => onSelectView("shank")}>
    <Icon><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="5" /><path d="M12 3.5V7M7.8 4.6l1.7 3.1m6.7-3.1-1.7 3.1" /></Icon>
  </button>
  <button type="button" aria-label="View on hand" title={currentView === "hand" ? "Return to ring view" : "View on hand"} aria-pressed={currentView === "hand"} onClick={() => onSelectView(currentView === "hand" ? "front" : "hand")}>
    <Icon><path d="M8 13V6a1.5 1.5 0 0 1 3 0v5M11 6V4a1.5 1.5 0 0 1 3 0v7m0-5a1.5 1.5 0 0 1 3 0v6m0-3a1.5 1.5 0 0 1 3 0v6a7 7 0 0 1-7 7h-1a5 5 0 0 1-4-2l-5-6a1.5 1.5 0 0 1 2-2l3 3" /></Icon>
  </button>
  {hasEngraving && <button type="button" aria-label="Focus engraving" title="Focus engraving" aria-pressed={currentView === "engraving"} onClick={() => onSelectView("engraving")}>
    <Icon><path d="m6 17 5-13h2l5 13M8 12h8M5 21h14" /></Icon>
  </button>}
  <span className="viewer-control-divider" aria-hidden="true" />
  {onTryAR && <button type="button" className="viewer-ar-control" aria-label="Try your ring in AR" title="Try your ring in AR" onPointerEnter={()=>{if(!arDisabled)void preloadARTryOn().catch(()=>{});}} onFocus={()=>{void preloadARTryOn().catch(()=>{});}} onPointerDown={()=>{void preloadARTryOn().catch(()=>{});}} onClick={onTryAR} disabled={arDisabled}>
    <Icon><path d="M7 3H3v4m14-4h4v4M3 17v4h4m14-4v4h-4" /><path d="m12 7 5 2.8v5.4L12 18l-5-2.8V9.8L12 7Zm-5 2.8 5 2.8 5-2.8M12 12.6V18" /></Icon>
  </button>}
  <button type="button" data-expand-viewer aria-label={isExpanded ? "Exit expanded view" : "Expand 3D viewer"} title={isExpanded ? "Exit expanded view" : "Expand 3D viewer"} aria-expanded={isExpanded} onClick={onToggleExpanded}>
    <Icon>{isExpanded ? <path d="M3 8h5V3m8 0v5h5M3 16h5v5m8 0v-5h5" /> : <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />}</Icon>
  </button>
</div>;

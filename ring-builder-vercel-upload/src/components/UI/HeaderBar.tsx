import React from "react";

interface HeaderBarProps {
  shapeName: string;
  carat: number;
  shankName: string;
  metalName: string;
  isPanelOpen: boolean;
  onTogglePanel: () => void;
  onResetView: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  shapeName,
  carat,
  shankName,
  metalName,
  isPanelOpen,
  onTogglePanel,
  onResetView,
}) => {
  return (
    <header className="atelier-header">
      {/* Brand Card */}
      <div className="atelier-brand-card atelier-interactive">
        <div className="atelier-logo-icon">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="6,3 18,3 22,9 12,22 2,9" />
            <polyline points="2,9 12,9 22,9" />
            <polyline points="6,3 12,9 18,3" />
            <polyline points="12,9 12,22" />
          </svg>
        </div>
        <div className="atelier-brand-meta">
          <span className="atelier-title">Saanvi Atelier</span>
          <span className="atelier-subtitle">Ring Studio 3D</span>
        </div>
      </div>

      {/* Middle Specs Pill */}
      <div className="atelier-specs-pill atelier-interactive">
        <div className="specs-dot" />
        <span className="specs-text">
          {shapeName} • {shankName} • {metalName}
        </span>
        <span className="specs-carat-badge">{carat.toFixed(1)} CT</span>
      </div>

      {/* Header Actions */}
      <div className="atelier-header-actions atelier-interactive">
        <button
          type="button"
          className="header-action-btn"
          onClick={onResetView}
          title="Reset Camera Angle"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          <span>Reset</span>
        </button>

        <button
          type="button"
          className={`header-action-btn ${isPanelOpen ? "active" : ""}`}
          onClick={onTogglePanel}
          title={isPanelOpen ? "Minimize Customizer" : "Customize Ring"}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span>{isPanelOpen ? "Close" : "Customize"}</span>
        </button>
      </div>
    </header>
  );
};

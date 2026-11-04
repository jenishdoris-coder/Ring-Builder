import "../../styles/studioStartup.css";

/** Lightweight layout shown while the application chunk downloads. */
export function StudioStartup() {
  return <div className="studio-startup" role="status" aria-label="Loading ring builder" aria-busy="true">
    <div className="studio-startup-gallery" aria-hidden="true">
      <div className="studio-startup-tile"><svg viewBox="0 0 64 72"><circle cx="32" cy="43" r="23" /><path d="m20 14 6-7h12l6 7-12 13Zm0 0h24M26 7l6 20L38 7" /></svg></div>
      {[0, 1, 2].map(index => <div key={index} className="studio-startup-tile"><span /></div>)}
    </div>
    <div className="studio-startup-panel" aria-hidden="true">
      <div className="studio-startup-line is-short" /><div className="studio-startup-line is-title" /><div className="studio-startup-line is-title is-medium" /><div className="studio-startup-line is-short" />
      <div className="studio-startup-line is-price" /><hr /><div className="studio-startup-line is-medium" />
      <div className="studio-startup-options">{Array.from({ length: 8 }, (_, index) => <div key={index} />)}</div>
    </div>
  </div>;
}

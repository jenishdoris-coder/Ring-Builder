import { ENGRAVING_MAX_CHARACTERS, ENGRAVING_POSITIONS, engravingTextError, type EngravingPosition, type EngravingStatus, type RingEngravingConfig } from "../../config/engraving";

export interface EngravingSectionProps {
  texts: Record<EngravingPosition, string>;
  positions: EngravingPosition[];
  multiple: boolean;
  applied: RingEngravingConfig[];
  status: EngravingStatus;
  busy: boolean;
  onTextChange: (position: EngravingPosition, text: string) => void;
  onPositionChange: (position: EngravingPosition) => void;
  onMultipleChange: (enabled: boolean) => void;
  onApply: (position: EngravingPosition) => void;
  onRemove: (position: EngravingPosition) => void;
}

const PositionExample = ({ position }: { position: EngravingPosition }) => {
  const id = `engraving-example-${position}`;
  const arc = position === "bottom" ? "M53 94Q80 109 107 94" : position === "right" ? "M110 48Q125 68 110 88" : "M50 88Q35 68 50 48";
  return <svg className="engraving-position-example" viewBox="0 0 160 122" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2=".8"><stop stopColor="#a7aab0" /><stop offset=".22" stopColor="#f8f9fa" /><stop offset=".48" stopColor="#b7bac1" /><stop offset=".72" stopColor="#fff" /><stop offset="1" stopColor="#979ba4" /></linearGradient>
      <linearGradient id={`${id}-inside`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#bec2c9" /><stop offset=".5" stopColor="#f4f5f7" /><stop offset="1" stopColor="#d3d6db" /></linearGradient>
      <path id={`${id}-text`} d={arc} />
    </defs>
    <path d="M31 65a49 43 0 1 0 98 0 49 43 0 1 0-98 0Zm13 0a36 33 0 1 1 72 0 36 33 0 1 1-72 0Z" fill={`url(#${id}-metal)`} fillRule="evenodd" stroke="#b3b7bf" strokeWidth=".6" />
    <path d="M43 64c0 20 16 34 37 34s37-14 37-34v7c0 22-16 37-37 37S43 93 43 71Z" fill={`url(#${id}-inside)`} />
    <path d="M44 66c0 19 16 33 36 33s36-14 36-33" fill="none" stroke="#9298a2" strokeWidth=".7" />
    <path d="m62 22 7-12h22l7 12-18 18-18-18Zm0 0h36M69 10l11 30 11-30M65 29l6 12m24-12-6 12" fill="#f8fbff" stroke="#8c95a4" strokeWidth="1.2" strokeLinejoin="round" />
    <path d={arc} fill="none" stroke="#c6a66a" strokeWidth="12" strokeLinecap="round" opacity=".27" />
    <text fill="#785824" fontSize="7.8" fontFamily="Georgia, serif" letterSpacing=".45"><textPath href={`#${id}-text`} startOffset="50%" textAnchor="middle">YOUR TEXT</textPath></text>
  </svg>;
};

export const EngravingSection = (props: EngravingSectionProps) => <section className="product-option-section product-engraving" aria-labelledby="engraving-heading">
  <h2 id="engraving-heading">Make it yours</h2>
  <label className="engraving-multiple-option"><span><strong>Multiple positions</strong><small>Add a separate inscription to each position</small></span><input type="checkbox" role="switch" aria-label="Enable multiple position engraving" checked={props.multiple} onChange={event => props.onMultipleChange(event.target.checked)} /><span className="engraving-toggle" aria-hidden="true" /></label>
  <p className="product-selection-label">{props.multiple ? "Select engraving positions" : "Choose your engraving position"}</p>
  <div className="engraving-position-options" role="group" aria-label="Inside-band engraving position">
    {ENGRAVING_POSITIONS.map(item => <button type="button" key={item.id} className={`engraving-position-option ${props.positions.includes(item.id) ? "selected" : ""}`} aria-label={`${item.label} inside engraving`} aria-pressed={props.positions.includes(item.id)} onClick={() => props.onPositionChange(item.id)}>
      <PositionExample position={item.id} /><span>{item.label}</span><small>Inside band</small>{props.multiple && <span className="engraving-position-check" aria-hidden="true">{props.positions.includes(item.id) ? "✓" : "+"}</span>}
    </button>)}
  </div>
  {props.positions.length === 0 && <p className="engraving-empty">Select a position above to add its inscription.</p>}
  <div className="engraving-inputs">{props.positions.map(position => {
    const text = props.texts[position], error = engravingTextError(text);
    const label = ENGRAVING_POSITIONS.find(item => item.id === position)!.label;
    const applied = props.applied.find(item => item.position === position);
    const tooLong = Array.from(text).length > ENGRAVING_MAX_CHARACTERS;
    return <div className="engraving-input-row" key={position}>
      <form onSubmit={event => { event.preventDefault(); if (!error && !props.busy) props.onApply(position); }}>
        <label className="engraving-input-label" htmlFor={`ring-engraving-${position}`}>{label} inscription</label>
        <div className="engraving-input-box">
          <input id={`ring-engraving-${position}`} type="text" value={text} onChange={event => props.onTextChange(position, event.target.value)} maxLength={48} placeholder="A name, a date, a little promise" autoComplete="off" aria-describedby={`engraving-help-${position}`} aria-invalid={tooLong || undefined} />
          <button type="submit" aria-label={`Engrave ${position}`} disabled={Boolean(error) || props.busy || props.status === "applying"}>Engrave</button>
        </div>
        <div id={`engraving-help-${position}`} className={`engraving-input-help ${tooLong ? "has-error" : ""}`}><span>{tooLong ? error : "Letters, numbers and symbols"}</span><span>{Array.from(text).length}/{ENGRAVING_MAX_CHARACTERS}</span></div>
      </form>
      {applied && <div className="engraving-applied" role="status"><span>{props.status === "unavailable" ? "No continuous inner surface here. Try another position." : <>“{applied.text}” · {label} inside</>}</span><button type="button" aria-label={`Remove ${position} engraving`} disabled={props.busy} onClick={() => props.onRemove(position)}>Remove</button></div>}
    </div>;
  })}</div>
</section>;

import { ENGRAVING_MAX_CHARACTERS, ENGRAVING_POSITIONS, engravingTextError, type EngravingPosition, type EngravingStatus, type RingEngravingConfig } from "../../config/engraving";
import bottomExample from "../../assets/engraving/bottom.webp";
import rightExample from "../../assets/engraving/right.webp";
import leftExample from "../../assets/engraving/left.webp";

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
  const example = { bottom: bottomExample, right: rightExample, left: leftExample }[position];
  const marker = { bottom: [220, 183], right: [199, 197], left: [241, 197] }[position];
  return <svg className="engraving-position-example" viewBox="30 140 380 280" aria-hidden="true">
    <image href={example} width="440" height="440" />
    <ellipse cx={marker[0]} cy={marker[1]} rx="35" ry="18" fill="#b4955920" stroke="#a48348" strokeWidth="3" />
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

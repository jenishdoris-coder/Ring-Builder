import { useId, type CSSProperties } from "react";
import { getSkinToneHex, SKIN_TONE_GRADIENT } from "../../config/skinTones";

export const HandToneControl = ({ value, onChange }: { value: number; onChange: (value: number) => void }) => {
  const id = useId();
  const hex = getSkinToneHex(value);
  return <div className="hand-tone-control" style={{ "--hand-tone-color": hex, "--hand-tone-gradient": SKIN_TONE_GRADIENT, "--hand-tone-progress": value / 100 } as CSSProperties}>
    <div className="hand-tone-heading">
      <label htmlFor={id}>Skin tone</label>
      <output className="hand-tone-swatch" htmlFor={id} title={hex}><span className="hand-tone-accessible">{hex}</span></output>
    </div>
    <div className="hand-tone-range">
      <span className="hand-tone-track" aria-hidden="true" />
      <span className="hand-tone-thumb" aria-hidden="true" />
      <input id={id} type="range" className="hand-tone-slider" min="0" max="100" step="1" value={value}
        aria-label="Hand skin tone" aria-valuetext={hex} title={`Skin tone ${hex}`}
        onChange={event => onChange(Number(event.target.value))} />
    </div>
  </div>;
};

import { ENGRAVING_POSITIONS, type EngravingPosition } from "../../config/engraving";

export const EngravingPositionSwitch = ({ positions, selected, onSelect, location }: { positions: EngravingPosition[]; selected: EngravingPosition; onSelect: (position: EngravingPosition) => void; location: "viewer" | "photo" }) => positions.length > 1 ? <div className={`engraving-view-switch engraving-${location}-switch`} role="group" aria-label={`${location === "viewer" ? "3D" : "Photo"} engraving position`}>
  <span>Engraving</span><div>{positions.map(position => <button type="button" key={position} aria-label={`${location === "viewer" ? "View" : "Photo"}: ${position} engraving`} aria-pressed={selected === position} onClick={() => onSelect(position)}>{ENGRAVING_POSITIONS.find(item => item.id === position)!.label}</button>)}</div>
</div> : null;

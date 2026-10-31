import { useEffect, useState } from "react";
import RingViewer from "./RingViewer";
import { useCatalog } from "../hooks/useCatalog";
import { DEFAULT_HAND_FIT, type HandFitAdjustments } from "../config/handFit";
import { DEFAULT_SKIN_TONE, getSkinToneHex } from "../config/skinTones";
import { FIXED_RING_TRANSFORM } from "../config/ringConfig";
import calibration from "../config/handPreview.json";
import { headStyleId } from "../utils/ringPricing";
import "../styles/handFit.css";

export default function HandFitPage() {
  const catalog = useCatalog();
  const params = new URLSearchParams(location.search);
  const [shapeId, setShapeId] = useState(params.get("shape") ?? catalog.defaults.shapeId);
  const [shankId, setShankId] = useState(params.get("band") ?? catalog.defaults.shankId);
  const [fit, setFit] = useState<HandFitAdjustments>({ ...DEFAULT_HAND_FIT });
  const [tone, setTone] = useState(DEFAULT_SKIN_TONE);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState("");
  useEffect(() => { setFit({ ...DEFAULT_HAND_FIT }); }, [calibration.ringFinger.rollDegrees, calibration.ringFinger.seatOffset]);
  const shape = catalog.shapes.find(item => item.id === shapeId) ?? catalog.shapes[0];
  const head = shape.carats.find(item => item.carat === Number(params.get("carat") ?? catalog.defaults.carat) && (!params.get("style") || headStyleId(item) === params.get("style"))) ?? shape.carats[0];
  const band = catalog.shanks.find(item => item.id === shankId) ?? catalog.shanks[0];
  const headMetal = catalog.metals.find(item => item.id === params.get("headMetal")) ?? catalog.metals[0];
  const bandMetal = catalog.metals.find(item => item.id === params.get("bandMetal")) ?? catalog.metals[0];
  const values = JSON.stringify({ ...fit, absoluteRollDegrees: calibration.ringFinger.rollDegrees + fit.roll, absoluteSeatOffset: calibration.ringFinger.seatOffset + fit.seat, skinTone: tone }, null, 2);
  const copy = async () => {
    try { await navigator.clipboard.writeText(values); setMessage("Values copied. Send these in the chat."); }
    catch { setMessage("Select and copy the values below."); }
  };
  return <main className="hand-fit-page">
    <section className="hand-fit-canvas product-viewer-stage" aria-label="Hand fitting preview">
      <RingViewer headFile={head.file} shankFile={band.file} headScale={catalog.defaults.headScale} shankScale={catalog.defaults.shankScale}
        headMetalHex={headMetal.hexCode} shankMetalHex={bandMetal.hexCode} cameraView="hand" cameraViewRevision={revision}
        handSkinTone={tone} handFitAdjustments={fit} ringTransform={FIXED_RING_TRANSFORM} isAutoRotating={false} />
      <span className="hand-fit-hint">Drag to inspect · Scroll or pinch to zoom</span>
      <button className="hand-fit-reframe" onClick={() => setRevision(value => value + 1)}>Reset camera</button>
    </section>
    <aside className="hand-fit-panel">
      <a href="/" target="_blank" rel="noopener">Open ring builder ↗</a>
      <a className="hand-fit-photo-link" href={`/photo-fit${location.search}`} target="_blank" rel="noopener">Photo controls ↗</a>
      <h1>Hand fitting</h1>
      <p>Adjust the ring against the finger, inspect from several angles, then copy the values for me to fix in code. These controls only affect this tab.</p>
      <p>Saved fit: {calibration.ringFinger.rollDegrees}° roll · {calibration.ringFinger.seatOffset} seat offset. Controls below are additional offsets.</p>
      <label>Diamond shape<select value={shape.id} onChange={event => setShapeId(event.target.value)}>{catalog.shapes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Band<select value={band.id} onChange={event => setShankId(event.target.value)}>{catalog.shanks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {([ ["roll", "Left / right tilt", 35, .5], ["pitch", "Forward / backward tilt", 25, .5], ["yaw", "Turn on finger", 25, .5], ["seat", "Move along finger", 1, .01] ] as const).map(([key, label, limit, step]) =>
        <label className="hand-fit-range" key={key}><span>{label}<output>{fit[key].toFixed(key === "seat" ? 2 : 1)}{key === "seat" ? "" : "°"}</output></span>
          <input type="range" min={-limit} max={limit} step={step} value={fit[key]} onChange={event => setFit(current => ({ ...current, [key]: Number(event.target.value) }))} />
          <input aria-label={`${label} value`} type="number" min={-limit} max={limit} step={step} value={fit[key]} onChange={event => setFit(current => ({ ...current, [key]: Math.max(-limit, Math.min(limit, Number(event.target.value))) }))} onWheel={event => event.currentTarget.blur()} />
        </label>)}
      <label className="hand-fit-range"><span>Skin tone<output style={{ color: getSkinToneHex(tone) }}>{getSkinToneHex(tone)}</output></span><input type="range" min="0" max="100" value={tone} onChange={event => setTone(Number(event.target.value))} /></label>
      <div className="hand-fit-actions"><button onClick={() => { setFit({ ...DEFAULT_HAND_FIT }); setTone(DEFAULT_SKIN_TONE); }}>Reset fit</button><button onClick={copy}>Copy fit values</button></div>
      <textarea aria-label="Hand fitting values" value={values} readOnly rows={8} onFocus={event => event.currentTarget.select()} />
      <p role="status">{message}</p>
    </aside>
  </main>;
}

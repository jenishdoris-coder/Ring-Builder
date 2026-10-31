import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RingViewer from "./RingViewer";
import { useCatalog } from "../hooks/useCatalog";
import { LIFESTYLE_PHOTOS, LIFESTYLE_PREVIEW_RESOLUTION } from "../config/lifestylePhotos";
import type { PortraitFit } from "../config/portraitFit";
import { FIXED_RING_TRANSFORM } from "../config/ringConfig";
import { getHeadStyles, headStyleId, LEGACY_HEAD_STYLE } from "../utils/ringPricing";
import type { RingDetailPreviewRequest, RingPreviewImage } from "../utils/ringPreview";
import "../styles/photoFit.css";
import metalEnvironments from "../config/metalEnvironmentTests.json";
import type { PortraitEnvironment } from "../utils/portraitEnvironment";
import { DEFAULT_PORTRAIT_ENVIRONMENT } from "../config/portraitLighting";
import { getDefaultMetalId } from "../config/staticModels";

const STORAGE = "ringbuilder-photo-fit-chin-variants-v14";
const defaults = (): PortraitFit[] => LIFESTYLE_PHOTOS.map(photo => ({ center: [...photo.center], fingerWidth: photo.fingerWidth, angle: photo.angle, tilt: photo.tilt, roll: photo.roll, zTurn: photo.zTurn, fingerRadiusScale: photo.fingerRadiusScale }));
const readDrafts = () => {
  const fallback = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) || "null");
    return fallback.map((fit, i) => {
      const savedFit = saved?.[i];
      // Preserve existing drafts created before the Z-axis control was added.
      const value = savedFit && { ...savedFit, zTurn: savedFit.zTurn ?? 0 };
      return value && Array.isArray(value.center) && value.center.length === 2 && [...value.center, value.fingerWidth, value.angle, value.tilt, value.roll, value.zTurn, value.fingerRadiusScale].every(Number.isFinite) && value.fingerWidth >= .02 && value.fingerWidth <= .3 && value.fingerRadiusScale >= .7 && value.fingerRadiusScale <= 1.1 ? value as PortraitFit : fit;
    });
  } catch { return fallback; }
};
type Field = "x" | "y" | "fingerWidth" | "angle" | "tilt" | "roll" | "zTurn" | "fingerRadiusScale";
const fields: { key: Field; label: string; min: number; max: number; step: number; unit: string }[] = [
  { key: "x", label: "Horizontal position", min: 0, max: 100, step: .05, unit: "%" },
  { key: "y", label: "Vertical position", min: 0, max: 100, step: .05, unit: "%" },
  { key: "fingerWidth", label: "Ring size in photo", min: 2, max: 30, step: .05, unit: "%" },
  { key: "angle", label: "Rotation on photo", min: -180, max: 180, step: .5, unit: "°" },
  { key: "tilt", label: "Forward / backward tilt", min: -65, max: 65, step: .5, unit: "°" },
  { key: "roll", label: "Left / right head tilt", min: -65, max: 65, step: .5, unit: "°" },
  { key: "zTurn", label: "Z-axis turn", min: -180, max: 180, step: .5, unit: "°" },
  { key: "fingerRadiusScale", label: "Finger occlusion", min: .7, max: 1.1, step: .002, unit: "" },
];
const readField = (fit: PortraitFit, key: Field) => key === "x" ? fit.center[0] * 100 : key === "y" ? fit.center[1] * 100 : key === "fingerWidth" ? fit.fingerWidth * 100 : fit[key];
const signature = (key: string, index: number, fit: PortraitFit) => JSON.stringify([key, LIFESTYLE_PHOTOS[index].id, fit]);

export default function PhotoFitPage() {
  const environmentMode = location.pathname === "/env-test";
  const [environmentDraft, setEnvironmentDraft] = useState<PortraitEnvironment>({ ...DEFAULT_PORTRAIT_ENVIRONMENT });
  const [environment, setEnvironment] = useState(environmentDraft);
  const catalog = useCatalog();
  const params = new URLSearchParams(location.search);
  const [shapeId, setShapeId] = useState(params.get("shape") ?? catalog.defaults.shapeId);
  const [bandId, setBandId] = useState(params.get("band") ?? catalog.defaults.shankId);
  const [styleId, setStyleId] = useState(params.get("style") ?? catalog.defaults.headStyleId ?? LEGACY_HEAD_STYLE);
  const [carat, setCarat] = useState(Number(params.get("carat") ?? catalog.defaults.carat));
  const [headMetalId, setHeadMetalId] = useState(params.get("headMetal") ?? getDefaultMetalId(catalog));
  const [bandMetalId, setBandMetalId] = useState(params.get("bandMetal") ?? getDefaultMetalId(catalog));
  const [active, setActive] = useState(() => Math.max(0, LIFESTYLE_PHOTOS.findIndex(photo => photo.key === params.get("portrait"))));
  const [fits, setFits] = useState<PortraitFit[]>(environmentMode ? defaults : readDrafts);
  const [applied, setApplied] = useState<PortraitFit>(() => fits[active]);
  const [busy, setBusy] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [auto, setAuto] = useState(true);
  const [guides, setGuides] = useState(false);
  const [zoom, setZoom] = useState(1.4);
  const [message, setMessage] = useState("");
  const [images, setImages] = useState<Record<number, { signature: string; image: RingPreviewImage }>>({});
  const fitsRef = useRef(fits), activeRef = useRef(active), imagesRef = useRef(images), keyRef = useRef("");
  const expected = useRef("");
  const dragging = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const outputRef = useRef<HTMLTextAreaElement>(null);
  fitsRef.current = fits; activeRef.current = active; imagesRef.current = images;

  const shape = catalog.shapes.find(item => item.id === shapeId) ?? catalog.shapes[0];
  const styles = getHeadStyles(catalog).filter(style => shape.carats.some(head => headStyleId(head) === style.id));
  const heads = shape.carats.filter(head => headStyleId(head) === styleId);
  const head = heads.find(item => item.carat === carat) ?? heads[0] ?? shape.carats[0];
  const band = catalog.shanks.find(item => item.id === bandId) ?? catalog.shanks[0];
  const headMetal = catalog.metals.find(item => item.id === headMetalId) ?? catalog.metals[0];
  const bandMetal = catalog.metals.find(item => item.id === bandMetalId) ?? catalog.metals[0];
  const designKey = JSON.stringify([head.file, band.file, catalog.defaults.headScale, catalog.defaults.shankScale, headMetal.hexCode, bandMetal.hexCode, environmentMode ? environment : null]);
  keyRef.current = designKey;
  expected.current = signature(designKey, active, applied);
  const previewRequest = useMemo<RingDetailPreviewRequest>(() => ({ key: designKey, viewId: LIFESTYLE_PHOTOS[active].id, resolution: LIFESTYLE_PREVIEW_RESOLUTION, portraitFit: applied, environment: environmentMode ? environment : undefined }), [designKey, active, applied, environmentMode, environment]);
  const applyLighting = (next = environmentDraft) => { setEnvironmentDraft(next); setEnvironment({ ...next }); setBusy(true); };

  const apply = useCallback((index = activeRef.current) => {
    clearTimeout(timer.current);
    const fit = fitsRef.current[index];
    setApplied({ ...fit, center: [...fit.center] });
    setBusy(imagesRef.current[index]?.signature !== signature(keyRef.current, index, fit));
    setMessage("");
    if (!environmentMode) try { localStorage.setItem(STORAGE, JSON.stringify(fitsRef.current)); } catch { /* Drafts remain available in this tab. */ }
  }, [environmentMode]);
  const schedule = (delay = 650) => {
    clearTimeout(timer.current);
    if (auto) timer.current = setTimeout(() => apply(), delay);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { setBusy(true); }, [designKey]);
  const onPreview = useCallback((request: RingDetailPreviewRequest, image: RingPreviewImage | null) => {
    const index = LIFESTYLE_PHOTOS.findIndex(photo => photo.id === request.viewId);
    if (index < 0 || !request.portraitFit || signature(request.key, index, request.portraitFit) !== expected.current) return;
    if (image) setImages(current => ({ ...current, [index]: { signature: signature(request.key, index, request.portraitFit!), image } }));
    else setMessage("Preview could not be rendered. Click Update preview to retry.");
    setBusy(false);
  }, []);
  const update = (key: Field, value: number) => {
    const field = fields.find(item => item.key === key)!;
    value = Math.max(field.min, Math.min(field.max, Number.isFinite(value) ? value : field.min));
    const next = fitsRef.current.map((fit, i) => i !== activeRef.current ? fit : key === "x" ? { ...fit, center: [value / 100, fit.center[1]] as const } : key === "y" ? { ...fit, center: [fit.center[0], value / 100] as const } : { ...fit, [key]: key === "fingerWidth" ? value / 100 : value });
    fitsRef.current = next; setFits(next);
    if (!dragging.current) schedule();
  };
  const selectPhoto = (index: number) => { activeRef.current = index; setActive(index); apply(index); };
  const reset = () => { const next = fitsRef.current.map((fit, i) => i === active ? defaults()[i] : fit); fitsRef.current = next; setFits(next); apply(); };
  const copyValues = JSON.stringify(environmentMode ? { portrait: LIFESTYLE_PHOTOS[active].key, environmentName: metalEnvironments.find(item => item.url === environment.url)?.name ?? (environment.url === DEFAULT_PORTRAIT_ENVIRONMENT.url ? "Metal Env 1" : "Current studio"), ...environment } : Object.fromEntries(LIFESTYLE_PHOTOS.map((photo, i) => [photo.key, { photoId: photo.id, ...fits[i] }])), (_, value) => typeof value === "number" ? Number(value.toFixed(6)) : value, 2);
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(copyValues);
      else { outputRef.current?.focus(); outputRef.current?.select(); if (!document.execCommand("copy")) throw new Error("Select values"); }
      setMessage(environmentMode ? "Lighting choice copied. Send it in the chat." : "All three portraits' values copied. Send them in the chat.");
    } catch { outputRef.current?.focus(); outputRef.current?.select(); setMessage("Values selected. Copy them and send them in the chat."); }
  };
  const photo = LIFESTYLE_PHOTOS[active], fit = fits[active], image = images[active]?.image;
  const previewCenter = environmentMode ? [(applied.center[0] - photo.crop.left) / photo.crop.size, (applied.center[1] - photo.crop.top) / photo.crop.size] : applied.center;
  const axisAngle = fit.angle * Math.PI / 180, nx = Math.cos(axisAngle), ny = -Math.sin(axisAngle);
  const cx = fit.center[0] * 1000, cy = fit.center[1] * 1000, radius = fit.fingerWidth * 500;
  const guide = (x: number, y: number) => `${x},${y}`;

  return <main className="photo-fit-page">
    <section className="photo-fit-preview" aria-label="Photo placement preview">
      <div className="photo-fit-top"><a href="/" target="_blank" rel="noopener">Ring builder ↗</a><span>{photo.label}</span><label>Zoom <input aria-label="Preview zoom" type="range" min="1" max="3" step=".1" value={zoom} onChange={event => setZoom(Number(event.target.value))} /><output>{Math.round(zoom * 100)}%</output></label></div>
      <div className="photo-fit-viewport">
        <div className="photo-fit-sheet" style={{ transform: `scale(${zoom})`, transformOrigin: `${previewCenter[0] * 100}% ${previewCenter[1] * 100}%` }}>
          <img src={image?.url ?? photo.image} alt={`${photo.label} ring placement`} decoding="async" />
          {guides && <svg className="photo-fit-guides" viewBox="0 0 1000 1000" aria-hidden="true"><line x1={cx - ny * 160} y1={cy + nx * 160} x2={cx + ny * 160} y2={cy - nx * 160} /><polyline points={`${guide(cx - nx * radius, cy - ny * radius)} ${guide(cx + nx * radius, cy + ny * radius)}`} /><circle cx={cx} cy={cy} r="5" /></svg>}
        </div>
      </div>
      <p className="photo-fit-preview-status" role="status">{modelsLoading ? "Loading selected ring…" : busy ? "Updating preview…" : "Preview ready · Zooming does not render again"}</p>
      <div className="photo-fit-renderer" aria-hidden="true"><RingViewer headFile={head.file} shankFile={band.file} headScale={catalog.defaults.headScale} shankScale={catalog.defaults.shankScale}
        headMetalHex={headMetal.hexCode} shankMetalHex={bandMetal.hexCode} ringTransform={FIXED_RING_TRANSFORM} cameraView="front" isAutoRotating={false} paused={!busy && !modelsLoading}
        previewKey={designKey} detailPreviewRequest={busy ? previewRequest : undefined} onDetailPreviewChange={onPreview} onLoadingChange={setModelsLoading} /></div>
    </section>
    <aside className="photo-fit-panel">
      <h1>{environmentMode ? "Portrait environment test" : "Photo placement"}</h1><p>{environmentMode ? "Compare metal lighting on your fitted ring. Only the selected environment loads. Preview ring below lets you change metals and designs." : "Adjust each portrait, then copy all fits. Reset restores your accepted placement. The tool shows your cropped photos with their fitting coordinates."}</p>
      <a href={environmentMode ? "/photo-fit" : "/env-test"} target="_blank" rel="noopener">{environmentMode ? "Placement controls ↗" : "Environment test ↗"}</a>
      <div className="photo-fit-tabs" role="tablist" aria-label="Portrait">{LIFESTYLE_PHOTOS.map((item, index) => <button key={item.key} role="tab" aria-selected={active === index} onClick={() => selectPhoto(index)}>{item.label}</button>)}</div>
      {environmentMode && <section className="photo-fit-models" aria-label="Environment controls">
        <label>Metal environment<select value={environmentDraft.url} onChange={event => applyLighting({ ...environmentDraft, url: event.target.value })}><option value={DEFAULT_PORTRAIT_ENVIRONMENT.url}>Metal Env 1 (active)</option><option value="">Current studio environment</option>{metalEnvironments.map(item => <option key={item.url} value={item.url}>{item.name}</option>)}</select></label>
        <label>Rotation (degrees)<input aria-label="Environment rotation" type="range" min="-180" max="180" step="1" value={environmentDraft.rotation} onChange={event => setEnvironmentDraft({ ...environmentDraft, rotation: Number(event.target.value) })} onPointerUp={() => applyLighting()} onKeyUp={() => applyLighting()} /><input aria-label="Environment rotation value" type="number" min="-180" max="180" value={environmentDraft.rotation} onChange={event => setEnvironmentDraft({ ...environmentDraft, rotation: Number(event.target.value) })} onBlur={() => applyLighting()} onWheel={event => event.currentTarget.blur()} /></label>
        <label>Metal intensity<input aria-label="Environment intensity" type="number" min="0" max="5" step=".05" value={environmentDraft.intensity} onChange={event => setEnvironmentDraft({ ...environmentDraft, intensity: Math.max(0, Math.min(5, Number(event.target.value))) })} onBlur={() => applyLighting()} onWheel={event => event.currentTarget.blur()} /></label>
        <label><input type="checkbox" checked={environmentDraft.photoReflections} onChange={event => applyLighting({ ...environmentDraft, photoReflections: event.target.checked })} /> Reflections from the hand photo</label>
        <button onClick={() => applyLighting()}>Update lighting</button>
      </section>}
      {!environmentMode && <>
      <div className="photo-fit-options"><label><input type="checkbox" checked={auto} onChange={event => setAuto(event.target.checked)} /> Auto preview on release</label><label><input type="checkbox" checked={guides} onChange={event => setGuides(event.target.checked)} /> Finger guides</label></div>
      {fields.map(field => { const value = Number(readField(fit, field.key).toFixed(3)); return <label className="photo-fit-field" key={field.key}><span>{field.label}<output>{value}{field.unit}</output></span><div>
        <input aria-label={field.label} type="range" min={field.min} max={field.max} step={field.step} value={value} onPointerDown={() => { dragging.current = true; clearTimeout(timer.current); }} onPointerUp={() => { dragging.current = false; schedule(0); }} onPointerCancel={() => { dragging.current = false; schedule(0); }} onKeyUp={() => schedule(0)} onChange={event => update(field.key, Number(event.target.value))} />
        <input aria-label={`${field.label} value`} type="number" min={field.min} max={field.max} step={field.step} value={value} onChange={event => update(field.key, Number(event.target.value))} onBlur={() => schedule(0)} onWheel={event => event.currentTarget.blur()} />
      </div></label>; })}
      <p>Higher finger occlusion hides more of the rear band. The preview uses the same 512px ring renderer as the storefront.</p>
      <div className="photo-fit-actions"><button onClick={() => apply()}>Update preview</button><button onClick={reset}>Reset this portrait</button><button onClick={copy}>Copy all fits</button></div>
      </>}
      {environmentMode && <div className="photo-fit-actions"><button onClick={copy}>Copy lighting choice</button></div>}
      <details><summary>Preview ring</summary><div className="photo-fit-models">
        <label>Diamond shape<select value={shape.id} onChange={event => { setBusy(true); setShapeId(event.target.value); }}>{catalog.shapes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Head style<select value={headStyleId(head)} onChange={event => { setBusy(true); setStyleId(event.target.value); }}>{styles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Center carat<select value={head.carat} onChange={event => { setBusy(true); setCarat(Number(event.target.value)); }}>{(heads.length ? heads : shape.carats).map(item => <option key={`${headStyleId(item)}:${item.carat}`} value={item.carat}>{item.carat} ct</option>)}</select></label>
        <label>Band<select value={band.id} onChange={event => { setBusy(true); setBandId(event.target.value); }}>{catalog.shanks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Head metal<select value={headMetal.id} onChange={event => { setBusy(true); setHeadMetalId(event.target.value); }}>{catalog.metals.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Band metal<select value={bandMetal.id} onChange={event => { setBusy(true); setBandMetalId(event.target.value); }}>{catalog.metals.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </div></details>
      <label className="photo-fit-json">Values to send<textarea ref={outputRef} aria-label="Photo placement values" value={copyValues} readOnly rows={12} onFocus={event => event.currentTarget.select()} /></label>
      <p className="photo-fit-message" role="status">{message}</p>
    </aside>
  </main>;
}

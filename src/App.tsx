import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RingViewer from "./components/RingViewer";
import { ViewerStage } from "./components/UI/ViewerStage";
import { ConfiguratorPanel } from "./components/UI/ConfiguratorPanel";
import { ImageLightbox, type ImageOrigin } from "./components/UI/ImageLightbox";
import { DEFAULT_RING_CONFIG } from "./config/staticModels";
import { useCatalog } from "./hooks/useCatalog";
import { FIXED_RING_TRANSFORM } from "./config/ringConfig";
import { RING_PREVIEW_VERSION, RING_PREVIEW_RESOLUTION, getRingPreviewViews, getRingDetailResolution, type RingPreviewImage, type RingDetailPreviewRequest } from "./utils/ringPreview";
import { EngravingPositionSwitch } from "./components/UI/EngravingPositionSwitch";
import { normalizeEngravingText, engravingTextError, type EngravingPosition, type EngravingStatus, type RingEngravingConfig } from "./config/engraving";
import type { RingCameraView } from "./utils/ringCameraViews";
import { DEFAULT_SKIN_TONE } from "./config/skinTones";
import { headStyleId, LEGACY_HEAD_STYLE } from "./utils/ringPricing";
import "./styles/configurator.css";
import "./styles/productConfigurator.css";

export const App = () => {
  const [catalogError, setCatalogError] = useState("");
  const catalog = useCatalog(setCatalogError);
  const customized = useRef(false);
  const previewingDraft = new URLSearchParams(location.search).get("preview") === "draft";
  const pricingDemo = import.meta.env.DEV && new URLSearchParams(location.search).get("demo") === "pricing";
  const [selectedShapeId, setSelectedShapeId] = useState(DEFAULT_RING_CONFIG.shapeId);
  const [selectedCarat, setSelectedCarat] = useState(DEFAULT_RING_CONFIG.carat);
  const [selectedHeadStyleId, setSelectedHeadStyleId] = useState<string>(LEGACY_HEAD_STYLE);
  const [selectedShankId, setSelectedShankId] = useState(DEFAULT_RING_CONFIG.shankId);
  const [selectedHeadMetalId, setSelectedHeadMetalId] = useState(DEFAULT_RING_CONFIG.metalId);
  const [selectedShankMetalId, setSelectedShankMetalId] = useState(DEFAULT_RING_CONFIG.metalId);
  useEffect(() => {
    if (customized.current) return;
    setSelectedShapeId(catalog.defaults.shapeId); setSelectedCarat(catalog.defaults.carat);
    setSelectedHeadStyleId(catalog.defaults.headStyleId || LEGACY_HEAD_STYLE);
    setSelectedShankId(catalog.defaults.shankId); setSelectedHeadMetalId(catalog.defaults.metalId); setSelectedShankMetalId(catalog.defaults.metalId);
  }, [catalog]);
  const [isModelLoading, setIsModelLoading] = useState(true);
  const [cameraView, setCameraView] = useState<RingCameraView>("front");
  const [cameraViewRevision, setCameraViewRevision] = useState(0);
  const [isViewerHovered, setIsViewerHovered] = useState(false);
  const [showCustomizationCue, setShowCustomizationCue] = useState(true);
  useEffect(() => {
    const dismiss = () => { if (window.scrollY > 24) setShowCustomizationCue(false); };
    dismiss();
    window.addEventListener("scroll", dismiss, { passive: true });
    return () => window.removeEventListener("scroll", dismiss);
  }, []);
  const [handSkinTone, setHandSkinTone] = useState(DEFAULT_SKIN_TONE);
  const [engravingTexts, setEngravingTexts] = useState<Record<EngravingPosition, string>>({ bottom: "", left: "", right: "" });
  const [engravingPositions, setEngravingPositions] = useState<EngravingPosition[]>(["bottom"]);
  const [multipleEngraving, setMultipleEngraving] = useState(false);
  const [engraving, setEngraving] = useState<RingEngravingConfig[]>([]);
  const [engravingFocusPosition, setEngravingFocusPosition] = useState<EngravingPosition>("bottom");
  const [engravingPhotoPosition, setEngravingPhotoPosition] = useState<EngravingPosition>("bottom");
  const [engravingPhotos, setEngravingPhotos] = useState<Record<string, RingPreviewImage | null>>({});
  const [engravingStatus, setEngravingStatus] = useState<EngravingStatus>("idle");
  const handleEngravingStatus = useCallback((status: EngravingStatus) => {
    setEngravingStatus(status);
    if (status === "unavailable") setCameraView(view => view === "engraving" ? "front" : view);
  }, []);
  const hasEngraving = engravingStatus === "ready" && engraving.length > 0;
  const appliedPositions = engraving.map(item => item.position);
  const focusPosition = appliedPositions.includes(engravingFocusPosition) ? engravingFocusPosition : appliedPositions[0] ?? "bottom";
  const photoPosition = appliedPositions.includes(engravingPhotoPosition) ? engravingPhotoPosition : appliedPositions[0] ?? "bottom";
  const isAutoRotating = cameraView === "front" && !isViewerHovered;
  const [previews, setPreviews] = useState<{ key: string; images: RingPreviewImage[] }>();
  const [enlargedView, setEnlargedView] = useState<{ key: string; image: RingPreviewImage; resolution: number; pending: boolean; detailReady: boolean; closing: boolean; origin: ImageOrigin }>();
  const closeEnlargedView = useCallback(() => setEnlargedView(undefined), []);
  const handleLightboxOpened = useCallback(() => setEnlargedView(current => current && !current.closing ? { ...current, detailReady: true } : current), []);
  const handleLightboxClosing = useCallback(() => setEnlargedView(current => current ? { ...current, detailReady: false, closing: true } : current), []);
  const handleDetailPreview = useCallback((request: RingDetailPreviewRequest, image: RingPreviewImage | null) => {
    if (request.resolution === RING_PREVIEW_RESOLUTION && request.engravingPosition) {
      setEngravingPhotos(current => ({ ...Object.fromEntries(Object.entries(current).slice(-17)), [`${request.key}:${request.engravingPosition}`]: image }));
      return;
    }
    setEnlargedView(current => current?.key === request.key && current.image.id === request.viewId && current.image.engravingPosition === request.engravingPosition ? { ...current, image: image ?? current.image, pending: false } : current);
  }, []);
  const currentShape = catalog.shapes.find(item => item.id === selectedShapeId) ?? catalog.shapes[0];
  const styleHeads = currentShape.carats.filter(item => headStyleId(item) === selectedHeadStyleId);
  const currentHead = styleHeads.find(item => item.carat === selectedCarat) ?? styleHeads[0] ?? currentShape.carats[0];
  const currentShank = catalog.shanks.find(item => item.id === selectedShankId) ?? catalog.shanks[0];
  const headMetal = catalog.metals.find(item => item.id === selectedHeadMetalId) ?? catalog.metals[0];
  const shankMetal = catalog.metals.find(item => item.id === selectedShankMetalId) ?? catalog.metals[0];
  const previewKey = useMemo(() => JSON.stringify([RING_PREVIEW_VERSION, currentHead.file, currentShank.file, headMetal.hexCode, shankMetal.hexCode, engraving]), [currentHead.file, currentShank.file, headMetal.hexCode, shankMetal.hexCode, engraving]);
  const handlePreviews = useCallback((key: string, images: RingPreviewImage[]) => setPreviews({ key, images }), []);
  const handleSelectCameraView = (view: RingCameraView) => { setCameraView(view); setCameraViewRevision(value => value + 1); };
  const handleApplyEngraving = (position: EngravingPosition) => {
    if (engravingTextError(engravingTexts[position])) return;
    const next = { text: normalizeEngravingText(engravingTexts[position]), position };
    const existing = engraving.find(item => item.position === position);
    if (next.text !== existing?.text) { setEngraving(current => [...current.filter(item => item.position !== position), next]); setEngravingStatus("applying"); }
    setEngravingFocusPosition(position); setEngravingPhotoPosition(position);
    handleSelectCameraView("engraving");
  };
  const updateAppliedEngravings = (next: RingEngravingConfig[]) => {
    setEngraving(next);
    if (!next.length) { setEngravingStatus("idle"); if (cameraView === "engraving") handleSelectCameraView("front"); }
  };
  const handleRemoveEngraving = (position: EngravingPosition) => updateAppliedEngravings(engraving.filter(item => item.position !== position));
  const handlePositionsChange = (positions: EngravingPosition[]) => {
    setEngravingPositions(positions);
    if (engraving.some(item => !positions.includes(item.position))) updateAppliedEngravings(engraving.filter(item => positions.includes(item.position)));
  };
  const handlePositionChange = (position: EngravingPosition) => handlePositionsChange(multipleEngraving ? engravingPositions.includes(position) ? engravingPositions.filter(item => item !== position) : [...engravingPositions, position] : [position]);
  const handleMultipleChange = (enabled: boolean) => {
    setMultipleEngraving(enabled);
    if (!enabled) handlePositionsChange([engravingPositions.includes(focusPosition) ? focusPosition : engravingPositions[0] ?? "bottom"]);
  };
  const handleReset = () => {
    customized.current = true;
    setSelectedShapeId(catalog.defaults.shapeId); setSelectedCarat(catalog.defaults.carat); setSelectedShankId(catalog.defaults.shankId);
    setSelectedHeadStyleId(catalog.defaults.headStyleId || LEGACY_HEAD_STYLE);
    setSelectedHeadMetalId(catalog.defaults.metalId); setSelectedShankMetalId(catalog.defaults.metalId); handleSelectCameraView("front");
    setEngraving([]); setEngravingTexts({ bottom: "", left: "", right: "" }); setEngravingPositions(["bottom"]); setMultipleEngraving(false); setEngravingStatus("idle"); setEngravingFocusPosition("bottom"); setEngravingPhotoPosition("bottom");
  };
  const currentPreviews = previews?.key === previewKey;
  const photoCacheKey = `${previewKey}:${photoPosition}`;
  const selectedEngravingPhoto = engravingPhotos[photoCacheKey] ?? (currentPreviews ? previews.images.find(item => item.id === "engraving" && item.engravingPosition === photoPosition) : undefined);
  const photoFailed = engravingPhotos[photoCacheKey] === null;
  const detailRequest: RingDetailPreviewRequest | undefined = enlargedView
    ? enlargedView.detailReady && !enlargedView.closing ? { key: enlargedView.key, viewId: enlargedView.image.id, resolution: enlargedView.resolution, engravingPosition: enlargedView.image.engravingPosition } : undefined
    : hasEngraving && currentPreviews && !isModelLoading && !selectedEngravingPhoto && !photoFailed
      ? { key: previewKey, viewId: "engraving", resolution: RING_PREVIEW_RESOLUTION, engravingPosition: photoPosition } : undefined;
  return <div className="atelier-app-root product-page">
    {pricingDemo && <div className="product-draft-banner product-pricing-demo-banner" role="status"><span>Pricing demo · Sample USD rates and weights, not a real quotation. Change the diamond, band, metals or ring size to try it.</span><a href="/">Exit demo</a></div>}
    {previewingDraft && <div className={`product-draft-banner ${catalogError ? "has-error" : ""}`} role="status"><span>{catalogError || "Saved draft preview · These changes are not published"}</span><a href="/admin#publish">Back to admin</a></div>}
    <main className="product-layout">
      <section className="product-gallery-column" aria-label="Your ring gallery">
        <div className="product-gallery-grid">
          <figure className="product-gallery-tile product-live-tile">
            <ViewerStage currentView={cameraView} onSelectView={handleSelectCameraView} onHoverChange={setIsViewerHovered} handSkinTone={handSkinTone} onChangeHandSkinTone={setHandSkinTone} hasEngraving={hasEngraving}
              engravingPositions={appliedPositions} engravingPosition={focusPosition} onSelectEngraving={position => { setEngravingFocusPosition(position); handleSelectCameraView("engraving"); }}>
            <RingViewer headFile={currentHead.file} shankFile={currentShank.file} headScale={catalog.defaults.headScale} shankScale={catalog.defaults.shankScale}
              headMetalHex={headMetal.hexCode} shankMetalHex={shankMetal.hexCode} cameraView={cameraView} cameraViewRevision={cameraViewRevision}
              isAutoRotating={isAutoRotating} handSkinTone={handSkinTone} ringTransform={FIXED_RING_TRANSFORM} onLoadingChange={setIsModelLoading} previewKey={previewKey} onPreviewImagesChange={handlePreviews}
              engraving={engraving} engravingFocusPosition={focusPosition} engravingPhotoPosition={photoPosition} onEngravingStatusChange={handleEngravingStatus}
              detailPreviewRequest={detailRequest} onDetailPreviewChange={handleDetailPreview} />
            </ViewerStage>
          </figure>
          {getRingPreviewViews(engraving.length > 0 && engravingStatus !== "unavailable").map(view => {
            const image = view.id === "engraving" ? selectedEngravingPhoto : previews?.images.find(item => item.id === view.id);
            return <figure key={view.id} className={`product-gallery-tile product-photo-tile ${view.id === "engraving" ? "is-engraving" : ""} ${currentPreviews ? "" : "is-refreshing"}`} aria-busy={!currentPreviews || isModelLoading || (view.id === "engraving" && !image && !photoFailed)}>
              {image ? <button type="button" className="product-photo-button" disabled={!currentPreviews || isModelLoading} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setEnlargedView({ key: previewKey, image, resolution: getRingDetailResolution(), pending: true, detailReady: false, closing: false, origin: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } }); }} aria-label={`Enlarge ${view.label.toLowerCase()}`}><img src={image.url} alt={`${currentShape.name} diamond ring, ${view.label.toLowerCase()}`} /><span className="product-expand-icon" aria-hidden="true">⤢</span></button>
                : <div className="product-photo-placeholder">{view.id === "engraving" && photoFailed ? <button type="button" onClick={() => setEngravingPhotos(current => { const next = { ...current }; delete next[photoCacheKey]; return next; })}>Retry engraving photo</button> : <div className="product-photo-loading" role="status" aria-label={`Preparing ${view.label.toLowerCase()}`}><svg viewBox="0 0 64 72" aria-hidden="true"><circle cx="32" cy="43" r="23" /><circle cx="32" cy="43" r="18" /><path d="m20 14 6-7h12l6 7-12 13Zm0 0h24M26 7l6 20L38 7" /></svg><span>Preparing view</span></div>}</div>}
              {view.id === "engraving" && <EngravingPositionSwitch positions={appliedPositions} selected={photoPosition} onSelect={setEngravingPhotoPosition} location="photo" />}
              <figcaption>{view.label}</figcaption>
            </figure>;
          })}
        </div>
      </section>
      <ConfiguratorPanel catalog={catalog} selectedHeadStyleId={headStyleId(currentHead)} onSelectHeadStyle={id => { customized.current = true; setSelectedHeadStyleId(id); }} selectedShapeId={currentShape.id} onSelectShape={id => { customized.current = true; setSelectedShapeId(id); }} selectedCarat={currentHead.carat} onSelectCarat={carat => { customized.current = true; setSelectedCarat(carat); }} selectedShankId={currentShank.id} onSelectShank={id => { customized.current = true; setSelectedShankId(id); }}
        selectedHeadMetalId={headMetal.id} onSelectHeadMetal={id => { customized.current = true; setSelectedHeadMetalId(id); }} selectedShankMetalId={shankMetal.id} onSelectShankMetal={id => { customized.current = true; setSelectedShankMetalId(id); }} onReset={handleReset}
        engraving={{ texts: engravingTexts, positions: engravingPositions, multiple: multipleEngraving, applied: engraving, status: engravingStatus, busy: isModelLoading, onTextChange: (position, text) => setEngravingTexts(current => ({ ...current, [position]: text })), onPositionChange: handlePositionChange, onMultipleChange: handleMultipleChange, onApply: handleApplyEngraving, onRemove: handleRemoveEngraving }} />
    </main>
    {!enlargedView && <button type="button" className={`product-customization-scroll ${showCustomizationCue ? "" : "is-dismissed"}`} aria-hidden={!showCustomizationCue} tabIndex={showCustomizationCue ? 0 : -1} aria-controls="ring-customization" onClick={() => { setShowCustomizationCue(false); document.getElementById("ring-customization")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); }}>
      <span>Scroll to explore Customizations</span><span className="product-customization-scroll-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5" /></svg></span>
    </button>}
    {enlargedView && <ImageLightbox image={enlargedView.image} origin={enlargedView.origin} enhancing={enlargedView.pending && enlargedView.detailReady && !enlargedView.closing} onOpened={handleLightboxOpened} onClosing={handleLightboxClosing} onClose={closeEnlargedView} />}
  </div>;
};
export default App;

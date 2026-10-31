import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RingViewer from "./components/RingViewer";
import { ViewerStage } from "./components/UI/ViewerStage";
import { ViewRingButton } from "./components/UI/ViewRingButton";
import { LifestyleGallery } from "./components/UI/LifestyleGallery";
import { MobileGallerySlider } from "./components/UI/MobileGallerySlider";
import { LIFESTYLE_PHOTOS, LIFESTYLE_PREVIEW_RESOLUTION, isLifestyleView } from "./config/lifestylePhotos";
import { ConfiguratorPanel } from "./components/UI/ConfiguratorPanel";
import { ImageLightbox, type ImageOrigin } from "./components/UI/ImageLightbox";
import { DEFAULT_RING_CONFIG, getDefaultMetalId } from "./config/staticModels";
import { useCatalog } from "./hooks/useCatalog";
import { useMobileRingPreview } from "./hooks/useMobileRingPreview";
import { useGalleryWorkBudget } from "./hooks/useGalleryWorkBudget";
import { FIXED_RING_TRANSFORM } from "./config/ringConfig";
import { RING_PREVIEW_VERSION, RING_PREVIEW_RESOLUTION, getRingPreviewViews, getRingDetailResolution, type RingPreviewImage, type RingDetailPreviewRequest } from "./utils/ringPreview";
import { EngravingPositionSwitch } from "./components/UI/EngravingPositionSwitch";
import { normalizeEngravingText, engravingTextError, type EngravingPosition, type EngravingStatus, type RingEngravingConfig } from "./config/engraving";
import type { RingCameraView } from "./utils/ringCameraViews";
import { DEFAULT_SKIN_TONE } from "./config/skinTones";
import { ARTryOn } from "./components/UI/ARTryOn";
import { assetUrl } from "./config/assets";
import { headStyleId, LEGACY_HEAD_STYLE } from "./utils/ringPricing";
import "./styles/configurator.css";
import "./styles/productConfigurator.css";

export const App = () => {
  const galleryBudget = useGalleryWorkBudget();
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
    setSelectedShankId(catalog.defaults.shankId); setSelectedHeadMetalId(getDefaultMetalId(catalog)); setSelectedShankMetalId(getDefaultMetalId(catalog));
  }, [catalog]);
  const [isModelLoading, setIsModelLoading] = useState(true);
  const [cameraView, setCameraView] = useState<RingCameraView>("front");
  const [cameraViewRevision, setCameraViewRevision] = useState(0);
  const [isViewerHovered, setIsViewerHovered] = useState(false);
  const [arOpen, setArOpen] = useState(false);
  const closeAR = useCallback(() => { if (history.state?.ringTryOn) history.back(); setArOpen(false); }, []);
  const openAR = useCallback(() => { history.pushState({ ...history.state, ringTryOn: true }, ''); setArOpen(true); }, []);
  useEffect(() => {
    const onBack = () => setArOpen(false);
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, []);
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
  const [lifestylePhotos, setLifestylePhotos] = useState<Record<string, RingPreviewImage | null>>({});
  const [lifestyleVisible, setLifestyleVisible] = useState(false);
  const [engravingStatus, setEngravingStatus] = useState<EngravingStatus>("idle");
  const handleEngravingStatus = useCallback((status: EngravingStatus) => {
    setEngravingStatus(status);
    if (status === "unavailable") setCameraView(view => view === "engraving" ? "front" : view);
  }, []);
  const [previews, setPreviews] = useState<{ key: string; images: RingPreviewImage[] }>();
  const [enlargedView, setEnlargedView] = useState<{ key: string; image: RingPreviewImage; resolution: number; pending: boolean; detailReady: boolean; closing: boolean; origin: ImageOrigin }>();
  const [detailInteracting, setDetailInteracting] = useState(false);
  const closeEnlargedView = useCallback(() => setEnlargedView(undefined), []);
  const handleLightboxOpened = useCallback(() => setEnlargedView(current => current && !current.closing ? { ...current, detailReady: true } : current), []);
  const handleLightboxClosing = useCallback(() => setEnlargedView(current => current ? { ...current, detailReady: false, closing: true } : current), []);
  const handleDetailPreview = useCallback(async (request: RingDetailPreviewRequest, image: RingPreviewImage | null) => {
    if (isLifestyleView(request.viewId) && request.resolution === LIFESTYLE_PREVIEW_RESOLUTION) {
      setLifestylePhotos(current => ({ ...Object.fromEntries(Object.entries(current).slice(-11)), [`${request.key}:${request.viewId}`]: image }));
      return;
    }
    if (request.resolution === RING_PREVIEW_RESOLUTION && request.engravingPosition) {
      setEngravingPhotos(current => ({ ...Object.fromEntries(Object.entries(current).slice(-17)), [`${request.key}:${request.engravingPosition}`]: image }));
      return;
    }
    // Decode before replacing the displayed photo so enhancement never shows
    // an empty frame or stalls the next pinch on a synchronous decode.
    if (image) { const decoded = new Image(); decoded.src = image.url; try { await decoded.decode(); } catch { /* Keep the existing preview on decode failure. */ } }
    setEnlargedView(current => current?.key === request.key && current.image.id === request.viewId && current.image.engravingPosition === request.engravingPosition ? { ...current, image: image ?? current.image, pending: false } : current);
  }, []);
  const currentShape = catalog.shapes.find(item => item.id === selectedShapeId) ?? catalog.shapes[0];
  const styleHeads = currentShape.carats.filter(item => headStyleId(item) === selectedHeadStyleId);
  const currentHead = styleHeads.find(item => item.carat === selectedCarat) ?? styleHeads[0] ?? currentShape.carats[0];
  const currentShank = catalog.shanks.find(item => item.id === selectedShankId) ?? catalog.shanks[0];
  const headMetal = catalog.metals.find(item => item.id === selectedHeadMetalId) ?? catalog.metals[0];
  const shankMetal = catalog.metals.find(item => item.id === selectedShankMetalId) ?? catalog.metals[0];
  const handleSelectCameraView = useCallback((view: RingCameraView) => { setCameraView(view); setCameraViewRevision(value => value + 1); }, []);
  const queuedCameraView = useRef<RingCameraView | null>(null);
  const queuedEngravingPosition = useRef<EngravingPosition | null>(null);
  const draftDesign = useMemo(() => ({
    key: JSON.stringify([RING_PREVIEW_VERSION, currentHead.file, currentShank.file, catalog.defaults.headScale, catalog.defaults.shankScale, headMetal.hexCode, shankMetal.hexCode, engraving]),
    headFile: currentHead.file, shankFile: currentShank.file,
    headScale: catalog.defaults.headScale, shankScale: catalog.defaults.shankScale,
    headMetalHex: headMetal.hexCode, shankMetalHex: shankMetal.hexCode,
    shapeName: currentShape.name, label: `${currentShape.name} ${currentHead.carat} ct · ${currentShank.name}`, engraving,
  }), [currentHead.file, currentHead.carat, currentShank.file, currentShank.name, currentShape.name, catalog.defaults.headScale, catalog.defaults.shankScale, headMetal.hexCode, shankMetal.hexCode, engraving]);
  const mobilePreview = useMobileRingPreview(draftDesign, !customized.current, () => {
    if (queuedEngravingPosition.current) { setEngravingFocusPosition(queuedEngravingPosition.current); setEngravingPhotoPosition(queuedEngravingPosition.current); queuedEngravingPosition.current = null; }
    if (queuedCameraView.current) { handleSelectCameraView(queuedCameraView.current); queuedCameraView.current = null; }
  });
  const design = mobilePreview.rendered;
  const previewKey = design.key;
  const hasEngraving = engravingStatus === "ready" && design.engraving.length > 0;
  const appliedPositions = design.engraving.map(item => item.position);
  const focusPosition = appliedPositions.includes(engravingFocusPosition) ? engravingFocusPosition : appliedPositions[0] ?? "bottom";
  const photoPosition = appliedPositions.includes(engravingPhotoPosition) ? engravingPhotoPosition : appliedPositions[0] ?? "bottom";
  const handlePreviews = useCallback((key: string, images: RingPreviewImage[]) => setPreviews({ key, images }), []);
  const handleApplyEngraving = (position: EngravingPosition) => {
    if (engravingTextError(engravingTexts[position])) return;
    customized.current = true;
    const next = { text: normalizeEngravingText(engravingTexts[position]), position };
    const existing = engraving.find(item => item.position === position);
    if (next.text !== existing?.text) { setEngraving(current => [...current.filter(item => item.position !== position), next]); if (!mobilePreview.mobile) setEngravingStatus("applying"); }
    if (mobilePreview.mobile) { queuedEngravingPosition.current = position; queuedCameraView.current = "engraving"; }
    else { setEngravingFocusPosition(position); setEngravingPhotoPosition(position); handleSelectCameraView("engraving"); }
  };
  const updateAppliedEngravings = (next: RingEngravingConfig[]) => {
    customized.current = true;
    setEngraving(next);
    if (!next.length) {
      queuedEngravingPosition.current = null;
      if (queuedCameraView.current === "engraving") queuedCameraView.current = "front";
      if (!mobilePreview.mobile) setEngravingStatus("idle");
      if (cameraView === "engraving") { if (mobilePreview.mobile) queuedCameraView.current = "front"; else handleSelectCameraView("front"); }
    }
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
    setSelectedHeadMetalId(getDefaultMetalId(catalog)); setSelectedShankMetalId(getDefaultMetalId(catalog));
    if (mobilePreview.mobile) queuedCameraView.current = "front"; else handleSelectCameraView("front");
    queuedEngravingPosition.current = null;
    setEngraving([]); setEngravingTexts({ bottom: "", left: "", right: "" }); setEngravingPositions(["bottom"]); setMultipleEngraving(false); setEngravingStatus("idle"); setEngravingFocusPosition("bottom"); setEngravingPhotoPosition("bottom");
  };
  const currentPreviews = previews?.key === previewKey;
  const nextPortrait = lifestyleVisible && !galleryBudget.scrolling && !mobilePreview.pending && LIFESTYLE_PHOTOS.find(photo => lifestylePhotos[`${previewKey}:${photo.id}`] === undefined);
  const canRest = !isModelLoading && currentPreviews;
  const pauseViewer = arOpen || Boolean(canRest && (enlargedView && !enlargedView.pending || !enlargedView && (galleryBudget.scrolling || !galleryBudget.viewerVisible && !nextPortrait)));
  const isAutoRotating = cameraView === "front" && !isViewerHovered && !pauseViewer && galleryBudget.viewerVisible && !galleryBudget.scrolling;
  const viewYourRing = () => {
    mobilePreview.commit();
    document.getElementById("ring-gallery")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };
  const photoCacheKey = `${previewKey}:${photoPosition}`;
  const selectedEngravingPhoto = engravingPhotos[photoCacheKey] ?? (currentPreviews ? previews.images.find(item => item.id === "engraving" && item.engravingPosition === photoPosition) : undefined);
  const photoFailed = engravingPhotos[photoCacheKey] === null;
  const detailRequest: RingDetailPreviewRequest | undefined = enlargedView?.pending
    ? enlargedView.detailReady && !enlargedView.closing && !detailInteracting && !galleryBudget.scrolling ? { key: enlargedView.key, viewId: enlargedView.image.id, resolution: enlargedView.resolution, engravingPosition: enlargedView.image.engravingPosition } : undefined
    : hasEngraving && currentPreviews && !isModelLoading && !selectedEngravingPhoto && !photoFailed
      ? !galleryBudget.scrolling ? { key: previewKey, viewId: "engraving", resolution: RING_PREVIEW_RESOLUTION, engravingPosition: photoPosition } : undefined
      : nextPortrait && currentPreviews && !isModelLoading && !mobilePreview.pending && !arOpen
        ? { key: previewKey, viewId: nextPortrait.id, resolution: LIFESTYLE_PREVIEW_RESOLUTION } : undefined;
  const studioPhotos = getRingPreviewViews(design.engraving.length > 0 && engravingStatus !== "unavailable").map(view => {
            const image = view.id === "engraving" ? selectedEngravingPhoto : previews?.images.find(item => item.id === view.id);
            return <figure key={view.id} className={`product-gallery-tile product-photo-tile ${view.id === "engraving" ? "is-engraving" : ""} ${currentPreviews ? "" : "is-refreshing"}`} aria-busy={!currentPreviews || isModelLoading || (view.id === "engraving" && !image && !photoFailed)}>
              {image ? <button type="button" className="product-photo-button" disabled={!currentPreviews || isModelLoading || mobilePreview.pending} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setEnlargedView({ key: previewKey, image, resolution: getRingDetailResolution(), pending: true, detailReady: false, closing: false, origin: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } }); }} aria-label={`Enlarge ${view.label.toLowerCase()}`}><img src={image.url} decoding="async" alt={`${design.shapeName} diamond ring, ${view.label.toLowerCase()}`} /><span className="product-expand-icon" aria-hidden="true">⤢</span></button>
                : <div className="product-photo-placeholder">{view.id === "engraving" && photoFailed ? <button type="button" onClick={() => setEngravingPhotos(current => { const next = { ...current }; delete next[photoCacheKey]; return next; })}>Retry engraving photo</button> : <div className="product-photo-loading" role="status" aria-label={`Preparing ${view.label.toLowerCase()}`}><svg viewBox="0 0 64 72" aria-hidden="true"><circle cx="32" cy="43" r="23" /><circle cx="32" cy="43" r="18" /><path d="m20 14 6-7h12l6 7-12 13Zm0 0h24M26 7l6 20L38 7" /></svg><span>Preparing view</span></div>}</div>}
              {view.id === "engraving" && <EngravingPositionSwitch positions={appliedPositions} selected={photoPosition} onSelect={setEngravingPhotoPosition} location="photo" />}
              <figcaption>{view.label}</figcaption>
            </figure>;
          });
  const modelPhotos = <LifestyleGallery designKey={previewKey} images={lifestylePhotos} pending={mobilePreview.pending || isModelLoading} embedded={mobilePreview.mobile} onVisibleChange={setLifestyleVisible}
          onOpen={(image, origin) => setEnlargedView({ key: previewKey, image, resolution: LIFESTYLE_PREVIEW_RESOLUTION, pending: false, detailReady: false, closing: false, origin })}
          onRetry={id => setLifestylePhotos(current => { const next = { ...current }; delete next[`${previewKey}:${id}`]; return next; })} />;
  return <div className="atelier-app-root product-page">
    {pricingDemo && <div className="product-draft-banner product-pricing-demo-banner" role="status"><span>Pricing demo · Sample USD rates and weights, not a real quotation. Change the diamond, band, metals or ring size to try it.</span><a href="/">Exit demo</a></div>}
    {previewingDraft && <div className={`product-draft-banner ${catalogError ? "has-error" : ""}`} role="status"><span>{catalogError || "Saved draft preview · These changes are not published"}</span><a href="/admin#publish">Back to admin</a></div>}
    <main className="product-layout">
      <section id="ring-gallery" className="product-gallery-column" aria-label="Your ring gallery" data-preview-pending={mobilePreview.pending}>
        <div className="product-gallery-grid">
          <figure className="product-gallery-tile product-live-tile">
            <ViewerStage currentView={cameraView} onSelectView={handleSelectCameraView} onHoverChange={setIsViewerHovered} handSkinTone={handSkinTone} onChangeHandSkinTone={setHandSkinTone} hasEngraving={hasEngraving} onTryAR={openAR} arDisabled={isModelLoading || mobilePreview.pending} preparing={isModelLoading && Boolean(previews)}
              engravingPositions={appliedPositions} engravingPosition={focusPosition} onSelectEngraving={position => { setEngravingFocusPosition(position); handleSelectCameraView("engraving"); }}>
            <RingViewer headFile={design.headFile} shankFile={design.shankFile} headScale={design.headScale} shankScale={design.shankScale}
              headMetalHex={design.headMetalHex} shankMetalHex={design.shankMetalHex} cameraView={cameraView} cameraViewRevision={cameraViewRevision}
              isAutoRotating={isAutoRotating} paused={pauseViewer} handSkinTone={handSkinTone} ringTransform={FIXED_RING_TRANSFORM} onLoadingChange={setIsModelLoading} previewKey={previewKey} onPreviewImagesChange={handlePreviews}
              engraving={design.engraving} engravingFocusPosition={focusPosition} engravingPhotoPosition={photoPosition} onEngravingStatusChange={handleEngravingStatus}
              detailPreviewRequest={detailRequest} onDetailPreviewChange={handleDetailPreview} />
            </ViewerStage>
          </figure>
          {!mobilePreview.mobile && studioPhotos}
        </div>
        {mobilePreview.mobile ? <MobileGallerySlider>{studioPhotos}{modelPhotos}</MobileGallerySlider> : modelPhotos}
      </section>
      <ConfiguratorPanel catalog={catalog} selectedHeadStyleId={headStyleId(currentHead)} onSelectHeadStyle={id => { customized.current = true; setSelectedHeadStyleId(id); }} selectedShapeId={currentShape.id} onSelectShape={id => { customized.current = true; setSelectedShapeId(id); }} selectedCarat={currentHead.carat} onSelectCarat={carat => { customized.current = true; setSelectedCarat(carat); }} selectedShankId={currentShank.id} onSelectShank={id => { customized.current = true; setSelectedShankId(id); }}
        selectedHeadMetalId={headMetal.id} onSelectHeadMetal={id => { customized.current = true; setSelectedHeadMetalId(id); }} selectedShankMetalId={shankMetal.id} onSelectShankMetal={id => { customized.current = true; setSelectedShankMetalId(id); }} onReset={handleReset}
        engraving={{ texts: engravingTexts, positions: engravingPositions, multiple: multipleEngraving, applied: engraving, status: mobilePreview.pending ? "idle" : engravingStatus, queued: mobilePreview.pending, busy: !mobilePreview.mobile && isModelLoading, onTextChange: (position, text) => setEngravingTexts(current => ({ ...current, [position]: text })), onPositionChange: handlePositionChange, onMultipleChange: handleMultipleChange, onApply: handleApplyEngraving, onRemove: handleRemoveEngraving }} />
    </main>
    {!enlargedView && !arOpen && <button type="button" className={`product-customization-scroll ${showCustomizationCue ? "" : "is-dismissed"}`} aria-hidden={!showCustomizationCue} tabIndex={showCustomizationCue ? 0 : -1} aria-controls="ring-customization" onClick={() => { setShowCustomizationCue(false); document.getElementById("ring-customization")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); }}>
      <span>Scroll to explore Customizations</span><span className="product-customization-scroll-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5" /></svg></span>
    </button>}
    {!enlargedView && !arOpen && <ViewRingButton visible={mobilePreview.showButton} onClick={viewYourRing} />}
    {enlargedView && <ImageLightbox image={enlargedView.image} origin={enlargedView.origin} enhancing={enlargedView.pending && enlargedView.detailReady && !enlargedView.closing} onInteractionChange={setDetailInteracting} onOpened={handleLightboxOpened} onClosing={handleLightboxClosing} onClose={closeEnlargedView} />}
    {arOpen && <ARTryOn onClose={closeAR} engraving={design.engraving} selection={{
      head: assetUrl(design.headFile), band: assetUrl(design.shankFile), headScale: design.headScale, bandScale: design.shankScale,
      headMetal: design.headMetalHex, bandMetal: design.shankMetalHex, label: design.label,
    }} />}
  </div>;
};
export default App;

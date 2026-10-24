import { useCallback, useMemo, useState } from "react";
import RingViewer from "./components/RingViewer";
import { ViewerStage } from "./components/UI/ViewerStage";
import { ConfiguratorPanel } from "./components/UI/ConfiguratorPanel";
import { ImageLightbox } from "./components/UI/ImageLightbox";
import { DEFAULT_RING_CONFIG } from "./config/staticModels";
import { useCatalog } from "./hooks/useCatalog";
import { FIXED_RING_TRANSFORM } from "./config/ringConfig";
import { RING_PREVIEW_VERSION, RING_PREVIEW_VIEWS, type RingPreviewImage } from "./utils/ringPreview";
import "./styles/configurator.css";
import "./styles/productConfigurator.css";

export const App = () => {
  const catalog = useCatalog();
  const [selectedShapeId, setSelectedShapeId] = useState(DEFAULT_RING_CONFIG.shapeId);
  const [selectedCarat, setSelectedCarat] = useState(DEFAULT_RING_CONFIG.carat);
  const [selectedShankId, setSelectedShankId] = useState(DEFAULT_RING_CONFIG.shankId);
  const [selectedHeadMetalId, setSelectedHeadMetalId] = useState(DEFAULT_RING_CONFIG.metalId);
  const [selectedShankMetalId, setSelectedShankMetalId] = useState(DEFAULT_RING_CONFIG.metalId);
  const [isModelLoading, setIsModelLoading] = useState(true);
  const [cameraView, setCameraView] = useState<"front" | "top" | "side">("front");
  const [cameraViewRevision, setCameraViewRevision] = useState(0);
  const [isAutoRotating, setIsAutoRotating] = useState(true);
  const [previews, setPreviews] = useState<{ key: string; images: RingPreviewImage[] }>();
  const [enlargedView, setEnlargedView] = useState<RingPreviewImage>();
  const closeEnlargedView = useCallback(() => setEnlargedView(undefined), []);
  const currentShape = catalog.shapes.find(item => item.id === selectedShapeId) ?? catalog.shapes[0];
  const currentHead = currentShape.carats.find(item => item.carat === selectedCarat) ?? currentShape.carats[0];
  const currentShank = catalog.shanks.find(item => item.id === selectedShankId) ?? catalog.shanks[0];
  const headMetal = catalog.metals.find(item => item.id === selectedHeadMetalId) ?? catalog.metals[0];
  const shankMetal = catalog.metals.find(item => item.id === selectedShankMetalId) ?? catalog.metals[0];
  const previewKey = useMemo(() => JSON.stringify([RING_PREVIEW_VERSION, currentHead.file, currentShank.file, headMetal.hexCode, shankMetal.hexCode]), [currentHead.file, currentShank.file, headMetal.hexCode, shankMetal.hexCode]);
  const handlePreviews = useCallback((key: string, images: RingPreviewImage[]) => setPreviews({ key, images }), []);
  const handleSelectCameraView = (view: "front" | "top" | "side") => { setCameraView(view); setCameraViewRevision(value => value + 1); setIsAutoRotating(view === "front"); };
  const handleReset = () => {
    setSelectedShapeId(catalog.defaults.shapeId); setSelectedCarat(catalog.defaults.carat); setSelectedShankId(catalog.defaults.shankId);
    setSelectedHeadMetalId(catalog.defaults.metalId); setSelectedShankMetalId(catalog.defaults.metalId); handleSelectCameraView("front");
  };
  const currentPreviews = previews?.key === previewKey;
  return <div className="atelier-app-root product-page">
    <header className="product-site-header"><div className="product-brand"><svg viewBox="0 0 32 28" width="29" height="27" fill="none" stroke="currentColor" strokeWidth="1"><path d="M8 2h16l7 8-15 16L1 10 8 2Z" /><path d="m8 2 8 24 8-24M1 10h30M8 2l8 8 8-8" /></svg><span>SAANVI <small>ATELIER</small></span></div><span className="product-header-note">THE CUSTOM RING STUDIO</span></header>
    <main className="product-layout">
      <section className="product-gallery-column" aria-label="Your ring gallery">
        <div className="product-gallery-grid">
          <figure className="product-gallery-tile product-live-tile">
            <ViewerStage currentView={cameraView} isAutoRotating={isAutoRotating} onSelectView={handleSelectCameraView} onToggleAutoRotate={() => setIsAutoRotating(value => !value)}>
            <RingViewer headFile={currentHead.file} shankFile={currentShank.file} headScale={catalog.defaults.headScale} shankScale={catalog.defaults.shankScale}
              headMetalHex={headMetal.hexCode} shankMetalHex={shankMetal.hexCode} cameraView={cameraView} cameraViewRevision={cameraViewRevision}
              isAutoRotating={isAutoRotating} ringTransform={FIXED_RING_TRANSFORM} onLoadingChange={setIsModelLoading} previewKey={previewKey} onPreviewImagesChange={handlePreviews} />
            </ViewerStage>
          </figure>
          {RING_PREVIEW_VIEWS.map((view, index) => {
            const image = previews?.images.find(item => item.id === view.id);
            return <figure key={view.id} className={`product-gallery-tile product-photo-tile ${currentPreviews ? "" : "is-refreshing"}`} aria-busy={!currentPreviews || isModelLoading}>
              {image ? <button type="button" className="product-photo-button" onClick={() => setEnlargedView(image)} aria-label={`Enlarge ${view.label.toLowerCase()}`}><img src={image.url} alt={`${currentShape.name} diamond ring, ${view.label.toLowerCase()}`} /><span className="product-expand-icon" aria-hidden="true">⤢</span></button>
                : <div className="product-photo-placeholder"><span aria-hidden="true">0{index + 2}</span></div>}
              <figcaption>{view.label}</figcaption>
            </figure>;
          })}
        </div>
      </section>
      <ConfiguratorPanel catalog={catalog} selectedShapeId={currentShape.id} onSelectShape={setSelectedShapeId} selectedCarat={currentHead.carat} onSelectCarat={setSelectedCarat} selectedShankId={currentShank.id} onSelectShank={setSelectedShankId}
        selectedHeadMetalId={headMetal.id} onSelectHeadMetal={setSelectedHeadMetalId} selectedShankMetalId={shankMetal.id} onSelectShankMetal={setSelectedShankMetalId} onReset={handleReset} />
    </main>
    {enlargedView && <ImageLightbox image={enlargedView} onClose={closeEnlargedView} />}
  </div>;
};
export default App;

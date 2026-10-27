import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { ModelThumbnail } from "./ModelThumbnail";
import { assetUrl } from "../../config/assets";
import type { RingCatalog } from "../../types/catalog";
import { EngravingSection, type EngravingSectionProps } from "./EngravingSection";

export interface ConfiguratorPanelProps {
  catalog: RingCatalog;
  selectedShapeId: string; onSelectShape: (id: string) => void;
  selectedCarat: number; onSelectCarat: (carat: number) => void;
  selectedShankId: string; onSelectShank: (id: string) => void;
  selectedHeadMetalId: string; onSelectHeadMetal: (id: string) => void;
  selectedShankMetalId: string; onSelectShankMetal: (id: string) => void;
  onReset: () => void;
  engraving: EngravingSectionProps;
}
const shapeOrder = ["round", "princess", "cushion", "emerald", "pear", "oval", "radiant", "asscher", "marquise", "heart"];
const customizationTabs = [
  { id: "diamond", label: "Diamond" },
  { id: "head", label: "Head" },
  { id: "band", label: "Band" },
  { id: "engraving", label: "Engraving" },
] as const;
type CustomizationTab = typeof customizationTabs[number]["id"];
const MOBILE_BAND_PAGE_SIZE = 8;
const MetalSelector = ({ part, selected, onSelect, metals }: { part: string; selected: string; onSelect: (id: string) => void; metals: RingCatalog["metals"] }) => {
  const current = metals.find(metal => metal.id === selected)!;
  return <fieldset className="product-metal-selector">
    <legend>Select {part.toLowerCase()} metal: <strong>{current.name}</strong></legend>
    <div className="product-metal-options">{metals.map(metal => <button key={metal.id} type="button"
      className={`product-metal-option ${selected === metal.id ? "selected" : ""}`} aria-label={`${part} metal: ${metal.name}`}
      aria-pressed={selected === metal.id} title={metal.name} onClick={() => onSelect(metal.id)}>
      <span className="metal-karat-ring" style={{ borderColor: metal.previewColor }}>{metal.name.split(" ")[0]}</span>
      <span>{metal.name.replace(/^\S+\s/, "")}</span>
    </button>)}</div>
  </fieldset>;
};
export const ConfiguratorPanel = (props: ConfiguratorPanelProps) => {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All styles");
  const [activeTab, setActiveTab] = useState<CustomizationTab>("diamond");
  const [mobileLayout, setMobileLayout] = useState(() => window.matchMedia("(max-width: 850px)").matches);
  const [bandPage, setBandPage] = useState(() => Math.max(0, Math.floor(props.catalog.shanks.findIndex(item => item.id === props.selectedShankId) / MOBILE_BAND_PAGE_SIZE)));
  useEffect(() => {
    const media = window.matchMedia("(max-width: 850px)");
    const update = () => setMobileLayout(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);
  const { shapes, shanks, metals } = props.catalog;
  const shape = shapes.find(item => item.id === props.selectedShapeId)!;
  const shank = shanks.find(item => item.id === props.selectedShankId)!;
  const headMetal = metals.find(item => item.id === props.selectedHeadMetalId)!;
  const shankMetal = metals.find(item => item.id === props.selectedShankMetalId)!;
  const head = shape.carats.find(item => item.carat === props.selectedCarat) ?? shape.carats[0];
  const categories = useMemo(() => ["All styles", ...new Set(shanks.map(item => item.category))], [shanks]);
  const bands = shanks.filter(item => (category === "All styles" || item.category === category) && `${item.name} ${item.category}`.toLowerCase().includes(search.toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(bands.length / MOBILE_BAND_PAGE_SIZE));
  const currentPage = Math.min(bandPage, pageCount - 1);
  const firstBand = currentPage * MOBILE_BAND_PAGE_SIZE;
  const visibleBands = mobileLayout ? bands.slice(firstBand, firstBand + MOBILE_BAND_PAGE_SIZE) : bands;
  const panelProps = (id: CustomizationTab) => ({
    id: `customization-panel-${id}`,
    role: mobileLayout ? "tabpanel" : undefined,
    "aria-labelledby": mobileLayout ? `customization-tab-${id}` : `${id}-heading`,
    hidden: mobileLayout && activeTab !== id,
    tabIndex: mobileLayout ? 0 : undefined,
  });
  const selectTabWithKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = customizationTabs.findIndex(tab => tab.id === activeTab);
    const next = event.key === "ArrowRight" ? (index + 1) % customizationTabs.length
      : event.key === "ArrowLeft" ? (index + customizationTabs.length - 1) % customizationTabs.length
        : event.key === "Home" ? 0 : event.key === "End" ? customizationTabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setActiveTab(customizationTabs[next].id);
    document.getElementById(`customization-tab-${customizationTabs[next].id}`)?.focus();
  };
  return <aside id="ring-customization" className="product-configurator" aria-label="Ring Customizer">
    <div className="product-heading">
      <div className="product-eyebrow">Made personal. Made yours.</div>
      <h1>{shank.name}<br /><span>4-Prong Talon Engagement Ring</span></h1>
      <p className="product-current-selection">{shape.name} · {props.selectedCarat} ct · {headMetal.id === shankMetal.id ? headMetal.name : "Two-tone gold"}</p>
      <p className="product-intro">Build your setting. Explore every detail.</p>
    </div>
    <div className="product-customization-tabs" role="tablist" aria-label="Customize your ring">
      {customizationTabs.map(tab => <button key={tab.id} id={`customization-tab-${tab.id}`} type="button" role="tab"
        aria-selected={activeTab === tab.id} aria-controls={`customization-panel-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1}
        onClick={() => setActiveTab(tab.id)} onKeyDown={selectTabWithKey}>{tab.label}</button>)}
    </div>
    <section className="product-option-section product-customization-panel" {...panelProps("diamond")}>
      <h2 id="diamond-heading">Diamond preview <span className="section-information" title="Preview the available diamond shapes and sizes.">i</span></h2>
      <p className="product-selection-label">Preview shape: <strong>{shape.name}</strong></p>
      <div className="product-option-grid product-shapes">{[...shapes].sort((a, b) => shapeOrder.indexOf(a.id) - shapeOrder.indexOf(b.id)).map(item => <button key={item.id}
        type="button" className={`product-option-tile ${item.id === shape.id ? "selected" : ""}`} onClick={() => props.onSelectShape(item.id)} aria-pressed={item.id === shape.id} aria-label={item.name}>
        <img className="diamond-shape-image" src={assetUrl(`/images/diamond-shapes/${item.id}.webp`)} alt="" /><span>{item.name}</span>
      </button>)}</div>
      <fieldset className="product-size-selector"><legend>Preview size: <strong>{props.selectedCarat} ct.</strong></legend>
        <div className="product-carat-options">{shape.carats.map(item => <button type="button" key={item.carat} className={item.carat === props.selectedCarat ? "selected" : ""}
          aria-label={`${item.carat} CT`} aria-pressed={item.carat === props.selectedCarat} onClick={() => props.onSelectCarat(item.carat)}>{item.carat}</button>)}</div>
      </fieldset>
    </section>
    <section className="product-option-section product-customization-panel" {...panelProps("head")}>
      <h2 id="head-heading">Head <span className="section-information" title="The 4-prong talon head is the setting available in this collection.">i</span></h2>
      <p className="product-selection-label">Select style: <strong>4-Prong Talon</strong></p>
      <div className="product-option-grid"><div className="product-option-tile product-head-tile selected" aria-label="Selected head: 4-Prong Talon">
        <ModelThumbnail file={head.file} kind="head" label="4-Prong Talon head" /><span>4-Prong<br />Talon</span>
      </div></div>
      <MetalSelector part="Head" selected={props.selectedHeadMetalId} onSelect={props.onSelectHeadMetal} metals={metals} />
    </section>
    <section className="product-option-section product-customization-panel" {...panelProps("band")}>
      <h2 id="band-heading">Band <span className="section-information" title="Choose from the shank models in the Saanvi collection.">i</span></h2>
      <p className="product-selection-label">Select style: <strong>{shank.name}</strong></p>
      <div className="product-band-filters"><input type="search" aria-label="Find a band style" placeholder="Find a band style" value={search} onChange={event => { setSearch(event.target.value); setBandPage(0); }} />
        <select aria-label="Band collection" value={category} onChange={event => { setCategory(event.target.value); setBandPage(0); }}>{categories.map(item => <option key={item}>{item}</option>)}</select></div>
      <div className="product-option-grid product-bands">{visibleBands.map(item => <button key={item.id} type="button" aria-label={item.name} aria-pressed={item.id === shank.id}
        className={`product-option-tile ${item.id === shank.id ? "selected" : ""}`} onClick={() => props.onSelectShank(item.id)}>
        <ModelThumbnail file={item.file} kind="shank" label={`${item.name} shank`} /><span>{item.name}</span>
      </button>)}</div>
      {mobileLayout && pageCount > 1 && <nav className="product-band-pagination" aria-label="Band style pages">
        <button type="button" aria-label="Previous band styles" disabled={currentPage === 0} onClick={() => setBandPage(currentPage - 1)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5-5 5 5 5" /></svg></button>
        <span aria-live="polite">{firstBand + 1}–{Math.min(firstBand + MOBILE_BAND_PAGE_SIZE, bands.length)} of {bands.length} styles</span>
        <button type="button" aria-label="Next band styles" disabled={currentPage === pageCount - 1} onClick={() => setBandPage(currentPage + 1)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg></button>
      </nav>}
      {bands.length === 0 && <p className="product-empty-result">No styles match your search. <button onClick={() => { setSearch(""); setCategory("All styles"); }}>Show all styles</button></p>}
      <MetalSelector part="Band" selected={props.selectedShankMetalId} onSelect={props.onSelectShankMetal} metals={metals} />
    </section>
    <div className="product-customization-panel" {...panelProps("engraving")}><EngravingSection {...props.engraving} /></div>
    <details className="product-details"><summary>Your ring details</summary><dl>
      <div><dt>Diamond preview</dt><dd>{shape.name}, {props.selectedCarat} ct</dd></div><div><dt>Head</dt><dd>4-Prong Talon</dd></div>
      <div><dt>Head metal</dt><dd>{headMetal.name}</dd></div><div><dt>Band</dt><dd>{shank.name}</dd></div>
      <div><dt>Band metal</dt><dd>{shankMetal.name}</dd></div><div><dt>Collection</dt><dd>{shank.category}</dd></div>
      {props.engraving.status === "ready" && props.engraving.applied.map(item => <div key={item.position}><dt>{item.position} engraving</dt><dd>{item.text}</dd></div>)}
    </dl></details>
    <button type="button" className="product-reset-design" onClick={() => { props.onReset(); setSearch(""); setCategory("All styles"); setBandPage(Math.max(0, Math.floor(shanks.findIndex(item => item.id === props.catalog.defaults.shankId) / MOBILE_BAND_PAGE_SIZE))); }}>Reset design</button>
  </aside>;
};

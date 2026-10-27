import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { CaratOption, DiamondShape, HeadStyle, MetalOption, RingCatalog, ShankOption } from "../types/catalog";
import { getHeadStyles, headStyleId, LEGACY_HEAD_STYLE } from "../utils/ringPricing";
import { slug } from "./catalog";
import { Icon } from "./Icons";
import { ModelThumbnail } from "../components/UI/ModelThumbnail";
import { uploadAsset, type AdminSession } from "./api";

export const Sheet = ({ title, subtitle, children, onClose, onSubmit, busy = false, onDelete, confirmLabel = "Apply to draft", danger = false, confirmDisabled = false, className = "" }: { title: string; subtitle: string; children: ReactNode; onClose: () => void; onSubmit: (event: FormEvent) => void; busy?: boolean; onDelete?: () => void; confirmLabel?: string; danger?: boolean; confirmDisabled?: boolean; className?: string }) => {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("input, button")?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <div className={`admin-sheet-backdrop ${className}`} onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><div className="admin-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} onKeyDown={event => {
    if (event.key === "Escape" && !busy) onClose();
    if (event.key !== "Tab") return;
    const items = [...ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')].filter(item => item.getClientRects().length);
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <header><div><p className="admin-kicker">CATALOG EDITOR</p><h2 id={titleId}>{title}</h2><p>{subtitle}</p></div><button className="admin-icon-button" type="button" aria-label="Close editor" disabled={busy} onClick={onClose}><Icon name="close" /></button></header>
    <form onSubmit={onSubmit}><div className="admin-sheet-content">{children}</div><footer>{onDelete ? <button type="button" className="admin-button danger-quiet" disabled={busy} onClick={onDelete}><Icon name="trash" size={15} />Delete</button> : <span>Changes go to your draft first.</span>}<button type="button" className="admin-button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className={`admin-button ${danger ? "danger" : "primary"}`} disabled={busy || confirmDisabled}>{busy ? "Processing…" : confirmLabel}</button></footer></form>
  </div></div>;
};
export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => <label className="admin-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
export const Visibility = ({ enabled, onChange, title = "Available in the builder", detail = "Hide without removing the model or its files." }: { enabled: boolean; onChange: (enabled: boolean) => void; title?: string; detail?: string }) => <label className="admin-visibility"><span><strong>{title}</strong><small>{detail}</small></span><input type="checkbox" role="switch" checked={enabled} onChange={event => onChange(event.target.checked)} /><span className="admin-switch" /></label>;

export const AssetUpload = ({ value, session, kind, modelKind = "shank", onChange, onBusy }: { value: string; session: AdminSession; kind: "model" | "image"; modelKind?: "head" | "shank"; onChange: (value: { url: string; filename: string; thumbnail?: string }) => void; onBusy: (busy: boolean) => void }) => {
  const [status, setStatus] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const choose = async (file?: File) => {
    if (!file) return;
    setError(""); setBusy(true); onBusy(true);
    try {
      if (file.size > (kind === "model" ? 100 : 10) * 1024 * 1024) throw new Error(`Keep this file below ${kind === "model" ? "100" : "10"} MB.`);
      setStatus("Uploading…");
      const asset = await uploadAsset(file, kind, session, percent => setStatus(`Uploading ${percent}%`));
      let thumbnail: string | undefined;
      if (kind === "model") {
        try {
          setStatus("Creating thumbnail…");
          const { generateThumbnail } = await import("./thumbnail");
          const image = await generateThumbnail(file, modelKind);
          setStatus("Saving thumbnail…");
          thumbnail = (await uploadAsset(image, "image", session, () => {})).url;
        } catch { setError("The model was uploaded. Add a thumbnail below if the automatic preview could not be generated."); }
      }
      onChange({ ...asset, thumbnail }); setStatus("Uploaded to your library");
    } catch (error) { setError(error instanceof Error ? error.message : "Upload failed."); setStatus(""); }
    finally { setBusy(false); onBusy(false); if (input.current) input.current.value = ""; }
  };
  return <div className="admin-upload"><input ref={input} hidden type="file" accept={kind === "model" ? ".glb" : ".webp,.png,.jpg,.jpeg"} onChange={event => { void choose(event.target.files?.[0]); }} />
    <div className="admin-upload-target" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) void choose(event.dataTransfer.files[0]); }}>
      <Icon name={kind === "model" ? "band" : "assets"} size={26} /><strong>{value ? decodeURIComponent(value.split("/").pop() || "Uploaded file") : kind === "model" ? "Drop your GLB here" : "Add an image"}</strong>
      <span>{kind === "model" ? "GLB 2.0 · Up to 100 MB · Automatic thumbnail" : "WebP, PNG or JPG · Up to 10 MB"}</span>
      <button type="button" className="admin-button" disabled={busy} onClick={() => input.current?.click()}><Icon name="upload" size={16} />{busy ? status : value ? "Replace file" : "Choose file"}</button>
    </div>{status && !busy && <p className="admin-upload-success"><Icon name="check" size={14} />{status}</p>}{error && <p className="admin-inline-error" role="alert">{error}</p>}
  </div>;
};
export type EditorTarget = { kind: "band"; item?: ShankOption } | { kind: "head"; shapeId?: string; item?: CaratOption } | { kind: "metal"; item?: MetalOption } | { kind: "shape"; item?: DiamondShape } | { kind: "style"; item?: HeadStyle };
export const CatalogEditor = ({ target, catalog, session, onClose, onApply, onDelete }: { target: EditorTarget; catalog: RingCatalog; session: AdminSession; onClose: () => void; onApply: (catalog: RingCatalog) => void; onDelete?: () => void }) => {
  const [value, setValue] = useState<any>(() => target.kind === "band" ? target.item || { id: "", name: "", category: "Solitaire", file: "", thumbnail: "", enabled: true }
    : target.kind === "head" ? { ...(target.item || { carat: 1, label: "1 CT", file: "", filename: "", thumbnail: "", enabled: true }), styleId: target.item?.styleId || LEGACY_HEAD_STYLE, shapeId: target.shapeId || catalog.shapes[0].id }
      : target.kind === "shape" ? target.item || { id: "", name: "", folder: "", carats: [], image: "", enabled: false }
        : target.kind === "style" ? target.item || { id: "", name: "", enabled: true }
          : target.item || { id: "", name: "", hexCode: "#D8D8D8", previewColor: "#D8D8D8", description: "", enabled: true });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const update = (patch: any) => setValue((current: any) => ({ ...current, ...patch }));
  const submit = (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    const next = structuredClone(catalog);
    if (target.kind === "band") {
      if (!value.file || !value.name.trim() || !value.category.trim()) return setError("Add a name, collection and GLB file.");
      if (value.file.includes("/ring-builder/admin/") && !value.thumbnail) return setError("Add a selector thumbnail before applying this model.");
      if (next.shanks.some(item => item.id === value.id && item.id !== target.item?.id)) return setError("A band already uses this name. Choose a different name.");
      const item = { ...value, rawName: value.name };
      next.shanks = target.item ? next.shanks.map(band => band.id === target.item!.id ? item : band) : [...next.shanks, item];
    } else if (target.kind === "head") {
      if (!value.file || !value.label || value.carat <= 0 || value.carat > 25) return setError("Add a GLB, label and carat size between 0 and 25.");
      if (value.file.includes("/ring-builder/admin/") && !value.thumbnail) return setError("Add a selector thumbnail before applying this model.");
      const shape = next.shapes.find(item => item.id === value.shapeId)!;
      if (shape.carats.some(item => item.carat === Number(value.carat) && headStyleId(item) === value.styleId && !(target.item && target.shapeId === value.shapeId && item.carat === target.item.carat && headStyleId(item) === headStyleId(target.item)))) return setError("That setting and shape already have this carat size.");
      if (target.item) next.shapes.find(item => item.id === target.shapeId)!.carats = next.shapes.find(item => item.id === target.shapeId)!.carats.filter(item => !(item.carat === target.item!.carat && headStyleId(item) === headStyleId(target.item!)));
      const { shapeId, ...head } = value;
      shape.carats.push({ ...head, carat: Number(head.carat) }); shape.carats.sort((a, b) => a.carat - b.carat);
    } else if (target.kind === "shape") {
      if (!value.name.trim() || !value.id) return setError("Add a shape name.");
      if (next.shapes.some(item => item.id === value.id && item.id !== target.item?.id)) return setError("A shape already uses this name.");
      if (!target.item && !value.image) return setError("Upload an image for the new diamond shape.");
      next.shapes = target.item ? next.shapes.map(shape => shape.id === target.item!.id ? value : shape) : [...next.shapes, { ...value, folder: value.name }];
    } else if (target.kind === "style") {
      if (!value.id || !value.name.trim()) return setError("Add a setting style name.");
      const styles = getHeadStyles(next);
      if (styles.some(style => style.id === value.id && style.id !== target.item?.id)) return setError("A setting already uses this name.");
      next.headStyles = target.item ? styles.map(style => style.id === target.item!.id ? value : style) : [...styles, value];
    } else {
      if (!value.name.trim() || !value.description.trim() || !/^#[0-9a-f]{6}$/i.test(value.hexCode) || !/^#[0-9a-f]{6}$/i.test(value.previewColor)) return setError("Add a name, description and valid six-digit colors.");
      if (next.metals.some(item => item.id === value.id && item.id !== target.item?.id)) return setError("A metal already uses this name.");
      const metal = { ...value, gradient: `linear-gradient(135deg, ${value.hexCode}, #fff, ${value.hexCode})` };
      next.metals = target.item ? next.metals.map(item => item.id === target.item!.id ? metal : item) : [...next.metals, metal];
    }
    onApply(next);
  };
  const nameField = <Field label="Name"><input required maxLength={100} value={value.name || ""} placeholder={target.kind === "band" ? "e.g. Petite Pavé" : target.kind === "metal" ? "e.g. 18K Yellow Gold" : "e.g. Oval"} onChange={event => update({ name: event.target.value, ...(!target.item ? { id: slug(event.target.value) } : {}) })} /></Field>;
  return <Sheet title={`${target.item ? "Edit" : "Add"} ${target.kind === "head" ? "head model" : target.kind === "shape" ? "diamond shape" : target.kind === "style" ? "head setting" : target.kind}`} subtitle={target.kind === "head" ? "Link this model to its setting style, diamond shape and center carat size." : "Set up the details shoppers see in your ring builder."} onClose={onClose} onSubmit={submit} busy={busy} onDelete={target.item ? onDelete : undefined}>
    {error && <p className="admin-inline-error" role="alert">{error}</p>}
    {target.kind !== "head" && nameField}
    {target.kind === "band" && <Field label="Collection"><input required list="admin-collections" maxLength={100} value={value.category} onChange={event => update({ category: event.target.value })} /><datalist id="admin-collections">{[...new Set(catalog.shanks.map(item => item.category))].map(category => <option key={category}>{category}</option>)}</datalist></Field>}
    {target.kind === "head" && <><Field label="Head setting style"><select value={value.styleId} onChange={event => update({ styleId: event.target.value })}>{getHeadStyles(catalog).map(style => <option key={style.id} value={style.id}>{style.name}</option>)}</select></Field><div className="admin-field-row"><Field label="Diamond shape"><select value={value.shapeId} onChange={event => update({ shapeId: event.target.value })}>{catalog.shapes.map(shape => <option key={shape.id} value={shape.id}>{shape.name}</option>)}</select></Field><Field label="Carat size"><input type="number" min="0.1" max="25" step="0.05" required value={value.carat} onChange={event => update({ carat: Number(event.target.value), label: `${event.target.value} CT` })} /></Field></div><Field label="Size label"><input required value={value.label} maxLength={60} onChange={event => update({ label: event.target.value })} /></Field></>}
    {target.kind === "style" && <p className="admin-helper">After creating this setting, upload its head models for each shape and center carat size. Pricing rows appear automatically from those models.</p>}
    {(target.kind === "head" || target.kind === "band") && <><div className="admin-field-label">3D model</div><AssetUpload session={session} kind="model" modelKind={target.kind === "head" ? "head" : "shank"} value={value.file} onBusy={setBusy} onChange={asset => update({ file: asset.url, filename: asset.filename, ...(asset.thumbnail ? { thumbnail: asset.thumbnail } : {}) })} />
      <div className="admin-field-label">Selector thumbnail</div>{value.file && <div className="admin-editor-preview"><ModelThumbnail file={value.file} kind={target.kind === "head" ? "head" : "shank"} label="Model selector preview" thumbnail={value.thumbnail} /></div>}<AssetUpload session={session} kind="image" value={value.thumbnail || ""} onBusy={setBusy} onChange={asset => update({ thumbnail: asset.url })} /></>}
    {target.kind === "shape" && <><div className="admin-field-label">Diamond shape image</div>{value.image && <img className="admin-editor-preview" src={value.image} alt="Diamond shape preview" />}<AssetUpload session={session} kind="image" value={value.image || ""} onBusy={setBusy} onChange={asset => update({ image: asset.url })} />{!target.item && <p className="admin-helper">Add a head model to this shape before making it available in the builder.</p>}</>}
    {target.kind === "metal" && <><div className="admin-field-row"><Field label="Rendered metal color"><div className="admin-color-input"><input type="color" aria-label="Rendered metal color" value={value.hexCode} onChange={event => update({ hexCode: event.target.value })} /><input aria-label="Rendered metal hex" pattern="#[0-9a-fA-F]{6}" value={value.hexCode} onChange={event => update({ hexCode: event.target.value })} /></div></Field><Field label="Selector swatch"><div className="admin-color-input"><input type="color" aria-label="Selector swatch" value={value.previewColor} onChange={event => update({ previewColor: event.target.value })} /><input aria-label="Swatch hex" pattern="#[0-9a-fA-F]{6}" value={value.previewColor} onChange={event => update({ previewColor: event.target.value })} /></div></Field></div><Field label="Description"><textarea required maxLength={500} rows={3} value={value.description} onChange={event => update({ description: event.target.value })} /></Field></>}
    <Visibility enabled={value.enabled !== false} onChange={enabled => update({ enabled })} />
  </Sheet>;
};

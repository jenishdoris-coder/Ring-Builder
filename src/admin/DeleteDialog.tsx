import { useMemo } from "react";
import type { RingCatalog } from "../types/catalog";
import { deleteCatalogItem, type CatalogDeleteTarget } from "./deletion";
import { Sheet } from "./Editors";
import { Icon } from "./Icons";

export const DeleteDialog = ({ catalog,target,onClose,onConfirm }: {catalog:RingCatalog;target:CatalogDeleteTarget;onClose:()=>void;onConfirm:(result:ReturnType<typeof deleteCatalogItem>)=>void}) => {
  const preview = useMemo(() => { try { return { result:deleteCatalogItem(catalog,target),error:"" }; } catch(error) { return {result:undefined,error:error instanceof Error ? error.message : "This item cannot be deleted."}; } },[catalog,target]);
  const kind = target.kind === "style" ? "head setting" : target.kind === "shape" ? "diamond shape" : target.kind === "head" ? "head model" : target.kind;
  return <Sheet title={`Delete ${kind}?`} subtitle={preview.result?.label || "Review this catalog deletion."} onClose={onClose} onSubmit={event => { event.preventDefault(); if(preview.result)onConfirm(preview.result); }} confirmLabel="Delete from draft" danger confirmDisabled={!preview.result} className="admin-delete-dialog">
    {preview.error ? <p className="admin-inline-error" role="alert">{preview.error}</p> : <><div className="admin-delete-symbol"><Icon name="trash" size={27} /></div><p className="admin-delete-copy">This removes <strong>{preview.result?.label}</strong> from your catalog draft{(target.kind === "style" || target.kind === "shape") && preview.result?.removedModels ? ` and its ${preview.result.removedModels} head models` : ""}.</p><p className="admin-helper">Associated pricing entries are removed too. Uploaded files stay in your asset library. Save and publish the draft to update the live builder.</p>{preview.result?.changes.map(change => <p className="admin-warning" key={change}>{change}</p>)}<p className="admin-delete-undo"><Icon name="undo" size={16} />You can undo this change from the admin toolbar.</p></>}
  </Sheet>;
};

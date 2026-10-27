import { useEffect, useState } from "react";
import type { RingCatalog } from "../../types/catalog";
import type { PriceSelection } from "../../types/pricing";
import { money } from "../../utils/ringPricing";
const cache = new Map<string, { total: number | null; currency: string; time: number }>();
export const RingPrice = ({ catalog, selection }: { catalog: RingCatalog; selection: Omit<PriceSelection,"size"> }) => {
  const p = catalog.pricingPublic;
  const [chosenSize,setChosenSize] = useState(p?.defaultSize || "");
  const size = p?.sizes.includes(chosenSize) ? chosenSize : p?.defaultSize || "";
  const draft = catalog.previewSource === "draft";
  const demo = import.meta.env.DEV && new URLSearchParams(location.search).get("demo") === "pricing";
  const body = JSON.stringify({ ...selection,size });
  const key = catalog.releaseId + ":" + draft + ":" + body;
  const [result,setResult] = useState<{ key:string; total:number|null; currency:string }>();
  const [pending,setPending] = useState(false);
  useEffect(() => {
    if (!p?.enabled) return;
    const previous = !draft && cache.get(key);
    const cached = previous && Date.now() - previous.time < 60000 ? previous : undefined;
    if (cached) { setResult({ ...cached,key }); setPending(false); return; }
    const controller = new AbortController(); setPending(true);
    let cancelled = false;
    const timeout = setTimeout(() => { controller.abort(); if (!cancelled) { setResult({ key,total:null,currency:p.currency }); setPending(false); } },12000);
    const timer = setTimeout(() => {
      void fetch(demo ? "/api/pricing-demo" : "/api/quote" + (draft ? "?preview=draft" : ""), { method:"POST", credentials:"same-origin", signal:controller.signal, headers:{"Content-Type":"application/json"}, body }).then(async response => {
        if (!response.ok) throw new Error("Quote unavailable");
        const data = await response.json();
        const value = { total: typeof data.total === "number" && Number.isFinite(data.total) ? data.total : null, currency:data.currency || p.currency };
        if (!cancelled) { if (cache.size >= 100) cache.delete(cache.keys().next().value!); if (!draft) cache.set(key,{...value,time:Date.now()}); setResult({ ...value,key }); }
      }).catch(() => { if (!cancelled) setResult({ key,total:null,currency:p.currency }); }).finally(() => { clearTimeout(timeout); if (!cancelled) setPending(false); });
    },120);
    return () => { cancelled=true; controller.abort(); clearTimeout(timer); clearTimeout(timeout); };
  },[key,body,draft,demo,p?.enabled,p?.currency]);
  if (!p?.enabled) return null;
  const ready = result?.key === key;
  return <div className="product-ring-pricing"><div className="product-ring-price" aria-live="polite" aria-busy={pending}><strong>{!ready ? <span className="product-price-placeholder" aria-hidden="true" /> : result.total === null ? "Price on request" : money(result.total,result.currency)}</strong><span>{result?.currency || p.currency} · Complete ring</span></div><label className="product-ring-size">Ring size <small>{p.sizeSystem}</small><select aria-label="Ring size" value={size} onChange={event => setChosenSize(event.target.value)}>{p.sizes.map(value => <option key={value}>{value}</option>)}</select></label></div>;
};

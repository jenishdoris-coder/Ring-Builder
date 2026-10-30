import { useEffect, useState } from "react";
import type { RingCatalog } from "../../types/catalog";
import type { PriceSelection } from "../../types/pricing";
import { money } from "../../utils/ringPricing";
import { requestRingQuote, type PublicRingQuote } from "../../utils/requestRingQuote";
const cache = new Map<string, PublicRingQuote & { time: number }>();
export const RingPrice = ({ catalog, selection }: { catalog: RingCatalog; selection: Omit<PriceSelection,"size"> }) => {
  const p = catalog.pricingPublic;
  const [chosenSize,setChosenSize] = useState(p?.defaultSize || "");
  const size = p?.sizes.includes(chosenSize) ? chosenSize : p?.defaultSize || "";
  const draft = catalog.previewSource === "draft";
  const demo = import.meta.env.DEV && new URLSearchParams(location.search).get("demo") === "pricing";
  const body = JSON.stringify({ ...selection,size });
  const [refresh,setRefresh] = useState(0);
  const key = catalog.releaseId + ":" + draft + ":" + demo + ":" + body;
  const [result,setResult] = useState<{ key:string; status:"ready"; quote:PublicRingQuote } | { key:string; status:"error" }>();
  const [pending,setPending] = useState(false);
  useEffect(() => {
    if (!p?.enabled) return;
    const previous = !draft && cache.get(key);
    const cached = previous && Date.now() - previous.time < 60000 ? previous : undefined;
    if (cached) { setResult({ key,status:"ready",quote:cached }); setPending(false); return; }
    const controller = new AbortController(); setPending(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      void requestRingQuote({ endpoint:demo ? "/api/pricing-demo" : "/api/quote" + (draft ? "?preview=draft" : ""), method:demo ? "POST" : "GET", body,currency:p.currency,signal:controller.signal }).then(quote => {
        if (!cancelled) { if (cache.size >= 100) cache.delete(cache.keys().next().value!); if (!draft) cache.set(key,{...quote,time:Date.now()}); setResult({ key,status:"ready",quote }); }
      }).catch(() => { if (!cancelled) setResult({ key,status:"error" }); }).finally(() => { if (!cancelled) setPending(false); });
    },120);
    return () => { cancelled=true; controller.abort(); clearTimeout(timer); };
  },[key,body,draft,demo,p?.enabled,p?.currency,refresh]);
  useEffect(() => {
    // Mobile Safari may suspend requests when switching apps or locking the
    // phone. Recover a failed quote when the page or connection returns.
    if (result?.key !== key || result.status !== "error") return;
    const recover = () => { if (document.visibilityState === "visible") setRefresh(value => value + 1); };
    window.addEventListener("online", recover);
    window.addEventListener("pageshow", recover);
    document.addEventListener("visibilitychange", recover);
    return () => { window.removeEventListener("online", recover); window.removeEventListener("pageshow", recover); document.removeEventListener("visibilitychange", recover); };
  }, [key, result]);
  if (!p?.enabled) return null;
  const ready = result?.key === key;
  const quote = ready && result.status === "ready" ? result.quote : undefined;
  const failed = ready && result.status === "error" && !pending;
  if (quote?.enabled === false) return null;
  return <div className="product-ring-pricing"><div className="product-ring-price" aria-live="polite" aria-busy={pending}><strong>{!ready || pending ? <span className="product-price-placeholder" aria-hidden="true" /> : failed ? "Price unavailable" : quote?.total === null ? "Price on request" : quote ? money(quote.total!,quote.currency) : null}</strong><span>{quote?.currency || p.currency} · Complete ring</span></div><label className="product-ring-size">Ring size <small>{p.sizeSystem}</small><select aria-label="Ring size" value={size} onChange={event => setChosenSize(event.target.value)}>{p.sizes.map(value => <option key={value}>{value}</option>)}</select></label></div>;
};

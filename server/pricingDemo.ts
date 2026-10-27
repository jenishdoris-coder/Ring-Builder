import type { IncomingMessage, ServerResponse } from "node:http";
import type { RingCatalog } from "../src/types/catalog.js";
import type { PriceSelection } from "../src/types/pricing.js";
import { activeCatalog } from "./adminStore.js";
import { sameOrigin } from "./adminAuth.js";
import { publicCatalog } from "../src/admin/catalog.js";
import { bandPriceKey, emptyPricing, getHeadStyles, headPriceKey, headStyleId, quoteRing } from "../src/utils/ringPricing.js";

/** Fictional values for the explicitly labelled local demo. Never saved. */
export const pricingDemoCatalog = (source: RingCatalog): RingCatalog => {
  const pricing = emptyPricing();
  pricing.enabled = true;
  pricing.multiplier = 1.25;
  pricing.diamondPerCarat = 1000;
  pricing.accentDiamondPerCarat = 600;
  source.metals.forEach((metal,index) => { pricing.metalRates[metal.id] = { perGram: /white/i.test(metal.name) ? 60 : /rose/i.test(metal.name) ? 72 : /yellow/i.test(metal.name) ? 75 : 60 + index * 12 }; });
  const styles = getHeadStyles(source);
  source.shapes.forEach(shape => shape.carats.forEach(head => {
    const style = styles.find(style => style.id === headStyleId(head));
    pricing.heads[headPriceKey(headStyleId(head),head.carat)] = { mode:"weights",goldGrams:.5 + head.carat * .25,diamondCarats:/halo|diamond|pav/i.test(style?.name || "") ? .12 : 0 };
  }));
  source.shanks.forEach((band,index) => pricing.sizes.forEach(size => {
    const plain = /traditional|knife edge|plain|classic|solitaire/i.test(band.name);
    pricing.bands[bandPriceKey(band.id,size)] = { mode:"weights",goldGrams:3 + (plain ? 0 : index % 5 * .15) + (Number(size) - 7) * .15,diamondCarats:plain ? 0 : .15 + index % 4 * .05 };
  }));
  return { ...source,releaseId:`pricing-demo-${source.releaseId}`,pricing };
};

/** Registered by Vite only; no production API route is created. */
export default async function handler(request: IncomingMessage,response: ServerResponse) {
  response.setHeader("Content-Type","application/json; charset=utf-8");
  response.setHeader("Cache-Control","no-store");
  const send = (status:number,value:unknown) => response.writeHead(status).end(JSON.stringify(value));
  try {
    if (request.method !== "GET" && request.method !== "POST") { response.setHeader("Allow","GET, POST"); return send(405,{error:"Method not allowed"}); }
    if (request.method === "POST" && (!sameOrigin(request) || !request.headers["content-type"]?.startsWith("application/json"))) return send(403,{error:"Invalid request origin"});
    const catalog = pricingDemoCatalog((await activeCatalog()).catalog);
    if (request.method === "GET") return send(200,publicCatalog(catalog));
    let bytes=0; const chunks=[];
    for await(const chunk of request) { bytes+=chunk.length; if(bytes>4096)return send(413,{error:"Request too large"}); chunks.push(chunk); }
    const selection=JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as PriceSelection;
    if([selection.shapeId,selection.headStyleId,selection.bandId,selection.headMetalId,selection.bandMetalId,selection.size].some(value=>typeof value!=="string" || value.length>100) || !Number.isFinite(selection.carat)) return send(400,{error:"Invalid selection"});
    const quote=quoteRing(catalog,selection);
    return send(200,{total:quote.total,currency:quote.currency,enabled:true,demo:true});
  } catch(error) { return send(error instanceof SyntaxError ? 400 : 503,{error:"The local pricing demo could not be loaded."}); }
}

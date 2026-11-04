import {lazy,Suspense,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {RingCatalog} from '../types/catalog';
import type {EnvironmentChoice} from '../types/appearance';
import type {RingDetailPreviewRequest,RingPreviewImage} from '../config/ringPreviews';
import {studioEnvironment,portraitEnvironment} from '../config/appearance';
import {LIFESTYLE_PHOTOS} from '../config/lifestylePhotos';
import {FIXED_RING_TRANSFORM} from '../config/ringConfig';
import {getDefaultMetalId} from '../config/staticModels';
import {headStyleId,LEGACY_HEAD_STYLE} from '../utils/ringPricing';

const RingViewer=lazy(()=>import('../components/RingViewer'));
export type LightingPreviewJob={id:string;target:'studio'|'portraits';catalog:RingCatalog;environment:EnvironmentChoice};
/** Use the storefront's actual assembly, diamond shader and photo pipeline for one on-demand image. */
export default function LightingPreviewRenderer({job,onResult}:{job:LightingPreviewJob;onResult:(job:LightingPreviewJob,image:RingPreviewImage|null)=>void}){
 const [ready,setReady]=useState(false),result=useRef(onResult);result.current=onResult;
 const shape=job.catalog.shapes.find(s=>s.id===job.catalog.defaults.shapeId)||job.catalog.shapes[0];
 const head=shape.carats.find(h=>h.carat===job.catalog.defaults.carat&&headStyleId(h)===(job.catalog.defaults.headStyleId||LEGACY_HEAD_STYLE))||shape.carats[0];
 const band=job.catalog.shanks.find(b=>b.id==='triple-row')||job.catalog.shanks.find(b=>b.id===job.catalog.defaults.shankId)||job.catalog.shanks[0];
 const metal=job.catalog.metals.find(m=>m.id===getDefaultMetalId(job.catalog))||job.catalog.metals[0];
 const request=useMemo<RingDetailPreviewRequest|undefined>(()=>ready?{key:job.id,viewId:job.target==='studio'?'three-quarter':LIFESTYLE_PHOTOS[1].id,resolution:job.target==='studio'?720:1000,...(job.target==='portraits'?{environment:portraitEnvironment(job.environment)}:{})}:undefined,[ready,job]);
 const loading=useCallback((value:boolean)=>{if(!value)setReady(true);},[]);
 const complete=useCallback((_request:RingDetailPreviewRequest,image:RingPreviewImage|null)=>result.current(job,image),[job]);
 useEffect(()=>{const timer=setTimeout(()=>result.current(job,null),45000);return()=>clearTimeout(timer);},[job]);
 return <div className="appearance-render-worker" aria-hidden="true"><Suspense fallback={null}><RingViewer headFile={head.file} shankFile={band.file} headScale={job.catalog.defaults.headScale} shankScale={job.catalog.defaults.shankScale} headMetalHex={metal.hexCode} shankMetalHex={metal.hexCode} metalHex={metal.hexCode} ringTransform={FIXED_RING_TRANSFORM} isAutoRotating={false} cameraView="hero" previewKey={job.id} metalEnvironment={studioEnvironment(job.target==='studio'?job.environment:{id:'default',rotation:0,intensity:1})} onLoadingChange={loading} detailPreviewRequest={request} onDetailPreviewChange={complete}/></Suspense></div>;
}

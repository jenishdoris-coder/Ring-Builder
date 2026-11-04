import {lazy,Suspense,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {RingCatalog} from '../types/catalog';
import type {BuilderAppearance,EnvironmentChoice,ThumbnailChoice,ThumbnailMetal} from '../types/appearance';
import {ENVIRONMENTS,THUMBNAIL_PRESETS,getAppearance,thumbnailSignature} from '../config/appearance';
import {stockThumbnailUrl} from '../utils/thumbnailAssets';
import {uploadAsset,type AdminSession} from './api';
import {Field} from './Editors';
import {thumbnailCache} from './thumbnailCache';
import {runThumbnailCollection,thumbnailJobProgress} from './thumbnailJobs';
import type {LightingPreviewJob} from './LightingPreviewRenderer';
import {Icon} from './Icons';
import type {RingPreviewImage} from '../config/ringPreviews';
import type {ImageOrigin} from '../components/UI/ImageLightbox';
import './appearance.css';
const LightingPreviewRenderer=lazy(()=>import('./LightingPreviewRenderer'));
const PreviewLightbox=lazy(()=>import('../components/UI/ImageLightbox').then(module=>({default:module.ImageLightbox})));
const noop=()=>{};

function EnvironmentPicker({value,onChange,allowDefault=false}:{value:EnvironmentChoice;onChange:(value:EnvironmentChoice)=>void;allowDefault?:boolean}){
 const [search,setSearch]=useState('');const current=ENVIRONMENTS.find(e=>e.id===value.id);
 const picker=useRef<HTMLDetailsElement>(null),closeTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const clearClose=()=>clearTimeout(closeTimer.current);
 const closePicker=()=>{clearClose();if(picker.current)picker.current.open=false;};
 const select=(id:string)=>{onChange({...value,id});closePicker();picker.current?.querySelector('summary')?.focus();};
 useEffect(()=>()=>clearTimeout(closeTimer.current),[]);
 useEffect(()=>{const outside=(event:PointerEvent)=>{if(!picker.current?.contains(event.target as Node))closePicker();};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[]);
 return <div className="appearance-environment">
  <details ref={picker} onToggle={event=>{const element=event.currentTarget;if(!element.open)return;const r=element.getBoundingClientRect(),below=window.innerHeight-r.bottom-12,above=r.top-12,up=below<Math.min(390,window.innerHeight*.45)+65&&above>below;element.dataset.side=up?'up':'down';element.style.setProperty('--appearance-menu-height',`${Math.max(100,(up?above:below)-65)}px`);}} onPointerEnter={event=>{clearClose();if(event.pointerType==='mouse'&&window.matchMedia('(hover: hover)').matches)event.currentTarget.open=true;}} onPointerLeave={event=>{if(event.pointerType==='mouse'){clearClose();closeTimer.current=setTimeout(()=>{if(picker.current&&!picker.current.querySelector(':focus-visible'))picker.current.open=false;},180);}}} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))closePicker();}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();closePicker();picker.current?.querySelector('summary')?.focus();}}}><summary onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();clearClose();if(picker.current)picker.current.open=!picker.current.open;}if(event.key==='ArrowDown'){event.preventDefault();clearClose();if(picker.current){picker.current.open=true;picker.current.querySelector('input')?.focus();}}}}><img src={current?.preview||ENVIRONMENTS[0]?.preview} alt="" loading="lazy" /><span><strong>{current?.name||'Original studio environment'}</strong><small>Browse {ENVIRONMENTS.length} environments</small></span><svg className="appearance-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>
   <div className="appearance-env-popover">
   <input type="search" className="appearance-env-search" aria-label="Find an environment" placeholder="Find an environment…" value={search} onChange={e=>setSearch(e.target.value)}/>
   <div className="appearance-env-grid">{allowDefault&&<button type="button" aria-pressed={value.id==='default'} onClick={()=>select('default')}><span className="appearance-default-env">Studio</span><span>Original studio</span></button>}{ENVIRONMENTS.filter(e=>e.name.toLowerCase().includes(search.toLowerCase())).map(e=><button key={e.id} type="button" aria-pressed={value.id===e.id} onClick={()=>select(e.id)}><img src={e.preview} alt="" loading="lazy" decoding="async"/><span>{e.name}</span></button>)}</div>
   </div>
  </details>
  <div className="appearance-light-controls"><label><span>Rotation<output>{value.rotation}°</output></span><input aria-label="Environment rotation" type="range" min="0" max="360" step="5" value={value.rotation} onChange={e=>onChange({...value,rotation:Number(e.target.value)})}/></label><label><span>Intensity<output>{value.intensity.toFixed(2)}×</output></span><input aria-label="Environment intensity" type="range" min=".1" max="3" step=".05" value={value.intensity} onChange={e=>onChange({...value,intensity:Number(e.target.value)})}/></label></div>
 </div>;
}
export function AppearancePanel({catalog,session,onChange,onBusy}:{catalog:RingCatalog;session:AdminSession;onChange:(catalog:RingCatalog)=>void;onBusy:(busy:boolean)=>void}){
 const a=getAppearance(catalog.appearance),choice=a.thumbnails;
 const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState(''),[preview,setPreview]=useState('');
 const [modelKey,setModelKey]=useState(`shank:${catalog.shanks.find(b=>b.id==='triple-row')?.id||catalog.defaults.shankId}`);
 const [lightingJob,setLightingJob]=useState<LightingPreviewJob>();
 const [lightingPreviews,setLightingPreviews]=useState<Partial<Record<'studio'|'portraits',{signature:string;url:string}>>>({});
 const [lightingError,setLightingError]=useState('');
 const [enlarged,setEnlarged]=useState<{image:RingPreviewImage;origin:ImageOrigin}>();
 const closeEnlarged=useCallback(()=>setEnlarged(undefined),[]);
 const [savedProgress,setSavedProgress]=useState({rendered:0,uploaded:0,total:0});
 const controller=useRef<AbortController|undefined>(undefined),mounted=useRef(true),busyCallback=useRef(onBusy);busyCallback.current=onBusy;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();busyCallback.current(false);};},[]);
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
 const models=useMemo(()=>[...catalog.shanks.map(item=>({key:`shank:${item.id}`,file:item.file,kind:'shank' as const,label:`Band · ${item.name}`})),...catalog.shapes.flatMap(shape=>shape.carats.map(head=>({key:`head:${shape.id}:${head.styleId||'4-prong-talon'}:${head.carat}`,file:head.file,kind:'head' as const,label:`Head · ${shape.name} ${head.carat} ct`})))],[catalog.shanks,catalog.shapes]);
 const scope=`${session.username}:${catalog.assetBaseUrl}`,signature=thumbnailSignature(choice);
 useEffect(()=>{
  let current=true;setPreview('');setSavedProgress({rendered:0,uploaded:0,total:models.length});
  if(!models.every(model=>choice.mode==='preset'&&stockThumbnailUrl(model.file,model.kind,choice.preset)))void thumbnailJobProgress(models,scope,choice,thumbnailCache).then(value=>{if(current)setSavedProgress(value);}).catch(error=>{if(current)setError(error.message);});
  return()=>{current=false;};
 },[models,scope,signature]);
 const update=(next:BuilderAppearance)=>{onChange({...catalog,appearance:next});setStatus('');};
 const setChoice=(next:ThumbnailChoice)=>update({...a,thumbnails:next});
 const begin=()=>{const c=new AbortController();controller.current=c;setBusy(true);onBusy(true);setError('');return c;};
 const finish=()=>{if(mounted.current){setBusy(false);onBusy(false);}controller.current=undefined;};
 const renderLighting=(target:'studio'|'portraits')=>{begin();setLightingError('');setLightingJob({id:`admin-${target}-${Date.now()}`,target,catalog,environment:a[target]});};
 const expand=(url:string,label:string,element:HTMLElement)=>{const r=element.getBoundingClientRect();setEnlarged({image:{id:'admin-preview',label,url},origin:{left:r.left,top:r.top,width:r.width,height:r.height}});};
 const previewFrame=(url:string,label:string,className:string)=><div className={`${className} appearance-preview-frame`}><img src={url} alt={label}/><button className="appearance-expand" type="button" aria-label={`Enlarge ${label.toLowerCase()}`} title="Fullscreen preview" onClick={event=>expand(url,label,event.currentTarget.parentElement!)}><Icon name="expand" size={17}/></button></div>;
 const lightingCard=(target:'studio'|'portraits')=>{
  const image=lightingPreviews[target],current=image?.signature===JSON.stringify(a[target]);
  return <section className="admin-card"><div className="admin-card-heading"><div><h2>{target==='studio'?'Studio & 3D viewer':'Hand-image lighting'}</h2><p>{target==='studio'?'Metal lighting for the interactive ring and its three generated views.':'Independent metal lighting for the model portraits.'}</p></div></div><div className="appearance-card-body"><fieldset disabled={busy} className="appearance-fields"><EnvironmentPicker value={a[target]} allowDefault={target==='studio'} onChange={value=>update({...a,[target]:value})}/><button type="button" className="admin-button appearance-light-preview-button" aria-label={`Render ${target==='studio'?'studio':'hand-image'} lighting preview`} onClick={()=>renderLighting(target)}>Render preview</button></fieldset>{lightingJob?.target===target?<div className="appearance-light-preview" role="status">Rendering lighting preview…</div>:current?previewFrame(image.url,`${target==='studio'?'Studio ring':'Hand portrait'} lighting preview`,'appearance-light-preview'):image&&<p className="admin-helper">Lighting changed. Render a new preview to see it.</p>}</div></section>;
 };
 const previewStyle=async()=>{const c=begin();try{setStatus('Rendering selected model…');const model=models.find(m=>m.key===modelKey)||models[0];const {renderThumbnail}=await import('../utils/thumbnailRendering');const blob=await renderThumbnail(model.file,model.kind,choice);if(c.signal.aborted)return;setPreview(URL.createObjectURL(blob));setStatus('Preview ready. Generate the collection to apply this look.');}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Preview failed');}finally{finish();}};
 const generate=async()=>{const c=begin();try{
  const {generateThumbnail}=await import('./thumbnail');
  const images=await runThumbnailCollection({models,scope,choice,cache:thumbnailCache,signal:c.signal,
   stock:model=>choice.mode==='preset'?stockThumbnailUrl(model.file,model.kind,choice.preset):undefined,
   render:async model=>{const response=await fetch(model.file,{signal:c.signal});if(!response.ok)throw Error(`Model could not load: ${model.label}`);return generateThumbnail(new File([await response.blob()],'model.glb',{type:'model/gltf-binary'}),model.kind,choice,model.file);},
   upload:(file,key,model)=>uploadAsset(file,'image',session,()=>{},key,model.file),
   progress:value=>{if(mounted.current)setStatus(`${value.phase==='render'?'Preparing':'Uploading'} ${value.completed} / ${value.total} · ${value.label}`);},
  });
  if(c.signal.aborted)throw new DOMException('Generation cancelled','AbortError');
  onChange({...catalog,appearance:{...a,thumbnailSet:{signature:thumbnailSignature(choice),images}}});setStatus(`${models.length} thumbnails ready. Click Publish to update your website.`);
 }catch(e){if(mounted.current){if(e instanceof Error&&e.name==='AbortError')setStatus('Paused. Finished images are saved in this browser. Continue with the same settings to resume.');else setError(e instanceof Error?e.message:'Generation failed');}}finally{if(mounted.current)try{setSavedProgress(await thumbnailJobProgress(models,scope,choice,thumbnailCache));}catch{/* The original storage error is already shown above. */}finish();}};
 return <div className="appearance-panel">
  <div className="appearance-studio-grid">{lightingCard('studio')}{lightingCard('portraits')}</div>
  {lightingError&&<p className="admin-inline-error" role="alert">{lightingError}</p>}
  <p className="admin-helper">Preview lighting on a complete ring with diamonds before publishing. Studio and hand-image lighting are independent; diamond lighting remains separate.</p>
  <section className="admin-card"><div className="admin-card-heading"><div><h2>Selector thumbnails</h2><p>Static images for the head and band menus. Satin Silver D is the default.</p></div></div>
   <div className="appearance-card-body"><fieldset disabled={busy} className="appearance-fields"><div className="appearance-mode"><button type="button" aria-pressed={choice.mode==='preset'} onClick={()=>setChoice({...choice,mode:'preset'})}>Preset styles · A–L</button><button type="button" aria-pressed={choice.mode==='hdr'} onClick={()=>setChoice({...choice,mode:'hdr'})}>Real HDR lighting</button></div>
    {choice.mode==='preset'?<div className="appearance-preset-grid">{THUMBNAIL_PRESETS.map(p=><button key={p.id} type="button" aria-pressed={choice.preset===p.id} onClick={()=>setChoice({...choice,preset:p.id})}><img src={p.preview} alt="" loading="lazy" decoding="async"/><span><b>{p.id}</b>{p.name}</span><small>{p.caption}</small></button>)}</div>:<><Field label="Thumbnail metal"><select value={choice.metal} onChange={e=>setChoice({...choice,metal:e.target.value as ThumbnailMetal})}><option value="silver">Silver / white gold</option><option value="gold">Yellow gold</option><option value="rose">Rose gold</option></select></Field><EnvironmentPicker value={choice.environment} onChange={environment=>setChoice({...choice,environment})}/></>}
    <div className="appearance-preview"><div className="appearance-preview-controls"><Field label="Preview model"><select value={modelKey} onChange={e=>setModelKey(e.target.value)}>{models.map(m=><option key={m.key} value={m.key}>{m.label}</option>)}</select></Field><button type="button" className="admin-button" onClick={()=>void previewStyle()}>Render preview</button><p className="admin-helper">Check one model before applying the style to your collection.</p></div>{preview?previewFrame(preview,'Selected thumbnail style preview','appearance-preview-image'):<div className="appearance-preview-image"><span>Render one model<br/>to preview this look</span></div>}</div>
   </fieldset>
   <div className="appearance-generate"><button type="button" className="admin-button primary" disabled={busy} onClick={()=>void generate()}>{busy?'Working…':savedProgress.rendered>0?savedProgress.uploaded===models.length?'Apply saved thumbnails':`Resume generation · ${savedProgress.rendered}/${models.length}`:'Generate & apply collection thumbnails'}</button>{busy&&<button type="button" className="admin-button" onClick={()=>controller.current?.abort()}>Pause after current image</button>}</div>
   {savedProgress.rendered>0&&<p className="admin-helper">Saved progress for these settings: {savedProgress.rendered}/{models.length} rendered · {savedProgress.uploaded}/{models.length} uploaded.</p>}
   {status&&<p className="admin-helper" role="status">{status}</p>}{error&&<p className="admin-inline-error" role="alert">{error}</p>}
   <p className="admin-helper">Completed renders are kept in this browser so you can pause and resume. Cloudflare uploads start after the whole set is rendered. Only the completed collection is applied. Preset thumbnails are already saved; lighting changes do not require regenerating them.</p></div>
  </section>
  {lightingJob&&<Suspense fallback={null}><LightingPreviewRenderer key={lightingJob.id} job={lightingJob} onResult={(job,image)=>{if(!mounted.current)return;if(image)setLightingPreviews(previous=>({...previous,[job.target]:{signature:JSON.stringify(job.environment),url:image.url}}));else setLightingError('The lighting preview could not finish. Try rendering it again.');setLightingJob(undefined);finish();}}/></Suspense>}
  {enlarged&&<Suspense fallback={null}><PreviewLightbox image={enlarged.image} origin={enlarged.origin} onClose={closeEnlarged} onOpened={noop} onClosing={noop}/></Suspense>}
 </div>;
}

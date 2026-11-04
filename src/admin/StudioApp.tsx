import {useEffect,useMemo,useState,type ReactNode} from 'react';

import type {RingCatalog} from '../types/catalog';

import {adminRequest,ApiError,formatBytes,formatDate,type AdminSession,type AdminState} from './api';

import {CatalogEditor,Field,type EditorTarget} from './Editors';

import {DeleteDialog} from './DeleteDialog';

import type {CatalogDeleteTarget} from './deletion';

import {Icon,type IconName} from './Icons';

import {PricingPanel} from './PricingPanel';

import {AppearancePanel} from './AppearancePanel';

import {AppearanceProvider} from '../components/UI/AppearanceContext';

import {ModelThumbnail} from '../components/UI/ModelThumbnail';

import {catalogCounts,storefrontCatalog,validateCatalog} from './catalog';

import {getHeadStyles,headStyleId,LEGACY_HEAD_STYLE} from '../utils/ringPricing';

import './admin.css';

import './studio.css';
import {getAppearance} from '../config/appearance';

import {announceCatalogChange} from '../utils/catalogEvents';



const navigation=[{id:'overview',label:'Workspace',icon:'overview'},{id:'collection',label:'Collection',icon:'band'},{id:'pricing',label:'Pricing',icon:'pricing'},{id:'appearance',label:'Visual studio',icon:'diamond'},{id:'assets',label:'Files',icon:'assets'},{id:'settings',label:'Settings',icon:'settings'}] as const;

type Page=typeof navigation[number]['id'];

type CollectionTab='bands'|'heads'|'metals';

const initialPage=():Page=>['bands','heads','metals'].includes(location.hash.slice(1))?'collection':navigation.find(item=>item.id===location.hash.slice(1))?.id??'overview';

const originalUrl=(path='admin')=>location.port==='5175'?`http://${location.hostname}:5173/${path}`:`/${path}`;

const Button=({children,onClick,icon,primary=false,disabled=false}:{children:ReactNode;onClick?:()=>void;icon?:IconName;primary?:boolean;disabled?:boolean})=><button type="button" className={`studio-button ${primary?'is-primary':''}`} onClick={onClick} disabled={disabled}>{icon&&<Icon name={icon} size={17}/>} {children}</button>;

const Status=({enabled=true}:{enabled?:boolean})=><span className={`studio-status ${enabled?'':'is-muted'}`}><i/>{enabled?'Available':'Hidden'}</span>;



function Files(){

 const [query,setQuery]=useState(''),[page,setPage]=useState(0),[error,setError]=useState(''),[loading,setLoading]=useState(true);

 const [data,setData]=useState<{items:{sourcePath:string;url:string;bytes:number;contentType:string}[];total:number}>({items:[],total:0});

 useEffect(()=>{let active=true;setLoading(true);const timer=setTimeout(()=>void adminRequest<typeof data>(`assets&search=${encodeURIComponent(query)}&page=${page}`).then(value=>{if(active){setData(value);setError('');}}).catch(error=>{if(active)setError(error.message);}).finally(()=>{if(active)setLoading(false);}),200);return()=>{active=false;clearTimeout(timer);};},[query,page]);

 return <><div className="studio-toolbar"><label className="studio-search"><Icon name="search" size={18}/><input aria-label="Search files" placeholder="Search filenames…" value={query} onChange={event=>{setQuery(event.target.value);setPage(0);}}/></label><span>{loading?'Finding files…':`${data.total} model files`}</span></div>{error&&<p role="alert">{error}</p>}<div className="studio-file-list"><div className="studio-file-head"><span>File name</span><span>Format</span><span>Size</span><span/></div>{data.items.map(file=><a href={file.url} key={file.url} target="_blank" rel="noreferrer" className="studio-file-row"><span><i><Icon name="band"/></i><strong>{file.sourcePath}</strong></span><span>{file.contentType.split('/').pop()?.replace('gltf-binary','GLB')}</span><span>{formatBytes(file.bytes)}</span><Icon name="external" size={17}/></a>)}{!loading&&!data.items.length&&<div className="studio-empty">No matching files. Try another filename.</div>}</div><div className="studio-pagination"><span>Page {page+1} · {data.total} files</span><div><Button disabled={!page||loading} onClick={()=>setPage(page-1)}>Previous</Button><Button disabled={(page+1)*30>=data.total||loading} onClick={()=>setPage(page+1)}>Next</Button></div></div></>;

}



export default function StudioApp({preview=false}:{preview?:boolean}){

 const [checking,setChecking]=useState(true),[configured,setConfigured]=useState(true);

 const [state,setState]=useState<AdminState>(),[catalog,setCatalog]=useState<RingCatalog>(),[session,setSession]=useState<AdminSession>();

 const [page,setPage]=useState<Page>(initialPage),[tab,setTab]=useState<CollectionTab>(['bands','heads','metals'].includes(location.hash.slice(1))?location.hash.slice(1) as CollectionTab:'bands'),[query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[category,setCategory]=useState('all'),[list,setList]=useState(false),[collectionPage,setCollectionPage]=useState(0);

 const [editor,setEditor]=useState<EditorTarget>(),[deleting,setDeleting]=useState<CatalogDeleteTarget>(),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[rendering,setRendering]=useState(false),[history,setHistory]=useState<RingCatalog[]>([]);

 const handleError=(error:unknown)=>{setError(error instanceof Error?error.message:'Something went wrong.');if(error instanceof ApiError&&error.status===401){setSession(undefined);setCatalog(undefined);}};

 useEffect(()=>{document.title=preview?'Ring Studio · Admin preview':'Ring Studio · Store Admin';let active=true;void adminRequest<{configured:boolean;session:AdminSession|null}>('session').then(async access=>{if(!active)return;setConfigured(access.configured);if(!access.session)return;setSession(access.session);const value=await adminRequest<AdminState>('state',access.session);if(active){setState(value);setCatalog(value.catalog);}}).catch(error=>{if(active)handleError(error);}).finally(()=>{if(active)setChecking(false);});const hash=()=>{setPage(initialPage());const value=location.hash.slice(1);if(['bands','heads','metals'].includes(value))setTab(value as CollectionTab);setQuery('');setCollectionPage(0);};window.addEventListener('hashchange',hash);const wheel=(event:WheelEvent)=>{if(event.target instanceof HTMLInputElement&&event.target.type==='number'&&document.activeElement===event.target)event.target.blur();};document.addEventListener('wheel',wheel,{passive:true,capture:true});return()=>{active=false;window.removeEventListener('hashchange',hash);document.removeEventListener('wheel',wheel,true);};},[preview]);

 const login=async(username:string,password:string)=>{setBusy(true);setError('');try{const access=await adminRequest<{session:AdminSession}>('login',null,{username,password});setSession(access.session);const value=await adminRequest<AdminState>('state',access.session);setState(value);setCatalog(value.catalog);}catch(error){handleError(error);}finally{setBusy(false);}};

 const logout=async()=>{if(dirty&&!window.confirm('Discard your unpublished changes and sign out?'))return;setBusy(true);try{await adminRequest('logout',session,{});setCatalog(undefined);setSession(undefined);setHistory([]);setError('');}catch(error){handleError(error);}finally{setBusy(false);}};

 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),6000);return()=>clearTimeout(timer);},[notice]);

 const dirty=Boolean(catalog&&state&&JSON.stringify(catalog)!==JSON.stringify(state.catalog));

 useEffect(()=>{if(!dirty)return;const prevent=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',prevent);return()=>window.removeEventListener('beforeunload',prevent);},[dirty]);

 const update=(value:RingCatalog)=>{if(catalog)setHistory(items=>[...items.slice(-19),catalog]);setCatalog(value);setError('');};

 const navigate=(value:Page,collectionTab?:CollectionTab)=>{if(collectionTab){setTab(collectionTab);setFilter('all');setCategory('all');}location.hash=value;setPage(value);window.scrollTo({top:0,behavior:'instant'});};

 const publish=async()=>{if(!catalog||!state||!session||busy)return;const errors=validateCatalog(catalog);if(errors.length)return setError(errors.join(' '));setBusy(true);setError('');try{const value=await adminRequest<AdminState>('publish',session,{catalog,revision:state.revision,baseReleaseId:state.baseReleaseId});setState(value);setCatalog(value.catalog);setHistory([]);if(!preview)announceCatalogChange('published');setNotice(preview?'Preview published. Your original store has not changed.':`Your changes are published.${value.removedAssets?` ${value.removedAssets} unused files removed from Cloudflare.`:''}`);}catch(error){handleError(error);}finally{setBusy(false);}};

 const rows=useMemo(()=>{

  if(!catalog)return [];

  const all=tab==='bands'?catalog.shanks.map(item=>({id:item.id,name:item.name,file:item.file,thumbnail:item.thumbnail,category:item.category,enabled:item.enabled,kind:'shank' as const,target:{kind:'band' as const,item}}))

   :tab==='heads'?catalog.shapes.flatMap(shape=>shape.carats.map(item=>({id:`${shape.id}-${headStyleId(item)}-${item.carat}`,name:`${shape.name} · ${item.carat} ct`,file:item.file,thumbnail:item.thumbnail,category:getHeadStyles(catalog).find(style=>style.id===headStyleId(item))?.name??'Head setting',enabled:item.enabled!==false&&shape.enabled!==false,kind:'head' as const,target:{kind:'head' as const,shapeId:shape.id,item}})))

   :catalog.metals.map(item=>({id:item.id,name:item.name,file:'',thumbnail:undefined,category:item.description,enabled:item.enabled,kind:'shank' as const,target:{kind:'metal' as const,item},gradient:item.gradient}));

  return all.filter(row=>`${row.name} ${row.category}`.toLowerCase().includes(query.toLowerCase())&&(filter==='all'||(filter==='visible'?row.enabled!==false:row.enabled===false))&&(category==='all'||row.category===category)).sort((a,b)=>a.name.localeCompare(b.name));

 },[catalog,tab,query,filter,category]);

 const removeFromEditor=()=>{if(!editor?.item)return;if(editor.kind==='head')setDeleting({kind:'head',shapeId:editor.shapeId!,styleId:headStyleId(editor.item),carat:editor.item.carat});else setDeleting({kind:editor.kind,id:editor.item.id});};

 if(!checking&&!session)return <div className="studio-preview studio-login"><div className="studio-login-card"><a className="studio-brand" href="/"><span><Icon name="diamond" size={24}/></span><div>ring<span>studio</span><small>STORE WORKSPACE</small></div></a><p className="studio-eyebrow">YOUR COLLECTION STARTS HERE</p><h1>Welcome to your studio.</h1><p>Sign in to manage your collection, pricing and storefront.</p>{!configured?<div className="studio-alert">Run npm run admin:setup in the workspace, then restart the server.</div>:<form onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);void login(String(data.get('username')),String(data.get('password')));}}><Field label="Username"><input required name="username" autoComplete="username" placeholder="Your username" autoFocus/></Field><Field label="Password"><input required name="password" type="password" autoComplete="current-password" placeholder="Your password"/></Field>{error&&<p className="studio-login-error" role="alert">{error}</p>}<button type="submit" className="studio-button is-primary" disabled={busy}>{busy?'Signing in…':'Sign in'}<Icon name="arrow" size={16}/></button></form>}<a href="/" className="studio-login-back">Back to the ring builder <Icon name="external" size={14}/></a></div></div>;

 if(!catalog||!state||!session)return <div className="studio-start"><Icon name="diamond" size={32}/><h1>Opening your workspace</h1><p>{error||'Loading the preview collection…'}</p>{error&&<Button onClick={()=>location.reload()}>Try again</Button>}</div>;

 const counts=catalogCounts(catalog),visible=storefrontCatalog(catalog),defaultBand=catalog.shanks.find(band=>band.id===catalog.defaults.shankId)??catalog.shanks[0];

 const lighting=getAppearance(catalog.appearance);
 const readiness=[{ready:counts.bands>0&&counts.heads>0,title:'Collection curated',detail:`${counts.bands+counts.heads} models ready to explore`,page:'collection'},{ready:Boolean(catalog.pricing),title:catalog.pricing?'Pricing configured':'Set your pricing',detail:`${catalog.pricing?.currency||'USD'} · Rates & component weights`,page:'pricing'},{ready:Boolean(lighting.studio.id&&lighting.portraits.id),title:'Lighting selected',detail:'Studio & portrait environments',page:'appearance'},{ready:visible.shanks.some(band=>band.id===catalog.defaults.shankId),title:'Starting ring selected',detail:defaultBand.name,page:'settings'}];
 const titles:Record<Page,[string,string]>={overview:['Your workspace, at a glance.','Your collection, settings and storefront readiness in one place.'],collection:['The collection','Curate every band, setting and finish your customers can choose.'],pricing:['Build your pricing','One set of rates. Every possible ring.'],appearance:['The visual studio','Shape the light, materials and images of your storefront.'],assets:['Your asset library','The original files behind your collection.'],settings:['Make it your store','Choose the starting point for every new design.']};

 const setDefaults=(patch:Partial<RingCatalog['defaults']>)=>update({...catalog,defaults:{...catalog.defaults,...patch}});

 return <AppearanceProvider value={catalog.appearance}><div className="studio-preview" onClickCapture={event=>{if(preview&&(event.target as HTMLElement).closest('.appearance-generate')){event.preventDefault();event.stopPropagation();setNotice('Use Render preview to test lighting here. Bulk generation and uploads remain in the original admin.');}}}>

  {preview&&<div className="studio-preview-strip"><span><i/>DESIGN PREVIEW <b>Sample workspace · Changes stay here</b></span><a href={originalUrl()} target="_blank" rel="noreferrer">Original admin <Icon name="external" size={12}/></a></div>}

  <header className="studio-header"><a className="studio-brand" href="#overview"><span><Icon name="diamond" size={24}/></span><div>ring<span>studio</span><small>STORE WORKSPACE</small></div></a><nav aria-label="Workspace navigation">{navigation.map(item=><a key={item.id} href={`#${item.id}`} aria-current={page===item.id?'page':undefined}><Icon name={item.icon} size={17}/>{item.label}</a>)}</nav><a className="studio-store-link" href={originalUrl('')} target="_blank" rel="noreferrer"><span>View store</span><Icon name="external" size={16}/></a><span className="studio-avatar" title={session.username}>{session.username.slice(0,2).toUpperCase()}</span>{!preview&&<button className="studio-signout" aria-label="Sign out" disabled={busy} onClick={()=>void logout()}><Icon name="logout" size={17}/></button>}</header>

  <main className="studio-main" inert={busy} aria-busy={busy}><div className="studio-page-heading"><div><p className="studio-eyebrow">CURRENT STORE <span>/</span> {navigation.find(item=>item.id===page)?.label.toUpperCase()}</p><h1>{titles[page][0]}</h1><p>{titles[page][1]}</p></div><div className="studio-page-actions"><span className={`studio-save-status ${dirty?'is-dirty':''}`}><i/>{dirty||state.hasUnpublishedChanges?'Unpublished changes':'Everything is up to date'}</span><div>{history.length>0&&<Button icon="undo" onClick={()=>{setCatalog(history[history.length-1]);setHistory(items=>items.slice(0,-1));}}>Undo</Button>}<Button primary icon="publish" disabled={(!dirty&&!state.hasUnpublishedChanges)||busy||rendering} onClick={()=>void publish()}>{busy?'Publishing…':preview?'Publish preview':'Publish'}</Button></div></div></div>

   {error&&<div className="studio-alert is-error" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>setError('')}><Icon name="close" size={16}/></button></div>}{notice&&<div className="studio-alert" role="status">{notice}<button aria-label="Dismiss notification" onClick={()=>setNotice('')}><Icon name="close" size={16}/></button></div>}

   {state.cleanup?.pending>0&&<div className="studio-alert"><span>{state.cleanup.pending} unused Cloudflare files are waiting for removal.</span><Button disabled={busy} onClick={()=>{setBusy(true);void adminRequest<{deleted:number;pending:number}>('cleanup',session,{}).then(async result=>{setState(await adminRequest<AdminState>('state',session));setNotice(result.pending?'Storage cleanup is still pending.':`${result.deleted} unused Cloudflare files removed.`);}).catch(handleError).finally(()=>setBusy(false));}}>Retry cleanup</Button></div>}

   {page==='overview'&&<>

    <div className="studio-metrics">{[{name:'Band styles',value:counts.bands,detail:`${visible.shanks.length} on your storefront`,icon:'band',page:'bands'},{name:'Head models',value:counts.heads,detail:`${catalog.shapes.length} diamond shapes`,icon:'head',page:'heads'},{name:'Metal finishes',value:counts.metals,detail:'For heads and bands',icon:'metal',page:'metals'},{name:'Library size',value:formatBytes(state.storage.bytes),detail:`${state.storage.count.toLocaleString()} indexed assets`,icon:'assets',page:'assets'}].map(item=><button key={item.name} onClick={()=>item.page==='assets'?navigate('assets'):navigate('collection',item.page as CollectionTab)}><span><Icon name={item.icon as IconName} size={19}/>{item.name}<Icon name="arrow" size={16}/></span><strong>{item.value}</strong><small>{item.detail}</small></button>)}</div>

    <div className="studio-dashboard"><section className="studio-panel"><div className="studio-section-heading"><div><span className="studio-eyebrow">THE PIECES THAT MAKE IT PERSONAL</span><h2>Inside your collection</h2></div><button className="studio-text-button" onClick={()=>navigate('collection')}>View all <Icon name="arrow" size={16}/></button></div><div className="studio-featured-bands">{[defaultBand,...catalog.shanks.filter(band=>band.id!==defaultBand.id&&/pave|twist|cathedral/i.test(band.name)).slice(0,2)].map((band,i)=><button key={band.id} onClick={()=>setEditor({kind:'band',item:band})}><span className="studio-featured-image"><ModelThumbnail file={band.file} kind="shank" label={band.name} thumbnail={band.thumbnail}/><small>{i===0?'STARTING BAND':band.category}</small></span><strong>{band.name}</strong><span>Edit band <Icon name="arrow" size={14}/></span></button>)}</div><div className="studio-collection-links"><button onClick={()=>navigate('collection','heads')}><Icon name="head" size={24}/><span><strong>Head settings</strong><small>{counts.heads} models across {catalog.shapes.length} shapes</small></span><Icon name="arrow" size={18}/></button><button onClick={()=>navigate('collection','metals')}><span className="studio-metal-stack">{catalog.metals.slice(0,3).map(metal=><i key={metal.id} style={{background:metal.gradient}}/>)}</span><span><strong>Metal palette</strong><small>{catalog.metals.length} curated finishes</small></span><Icon name="arrow" size={18}/></button></div></section>

     <aside className="studio-dashboard-side"><section className="studio-panel studio-readiness"><div className="studio-section-heading"><div><span className="studio-eyebrow">THE ESSENTIALS</span><h2>Store readiness</h2></div><span className="studio-ready-count">{readiness.filter(item=>item.ready).length} / 4</span></div>{readiness.map(item=><button key={item.title} onClick={()=>navigate(item.page as Page)}><span className="studio-check"><Icon name={item.ready?'check':'arrow'} size={13}/></span><span><strong>{item.title}</strong><small>{item.detail}</small></span><Icon name="arrow" size={15}/></button>)}</section><section className="studio-activity"><div><span className="studio-eyebrow">WORKSPACE ACTIVITY</span><h2>Last published</h2></div><strong>{state.publishedAt?formatDate(state.publishedAt):'Not published yet'}</strong><p>{state.activity[0]?.message||'Your collection is ready.'}</p><span className="studio-workspace-note"><i/>{preview?'Isolated design preview':'Current store workspace'}</span></section></aside></div>

   </>}

   {page==='collection'&&<>

    <div className="studio-collection-heading"><div className="studio-tabs" role="tablist" aria-label="Collection type">{[{id:'bands',name:'Band styles',count:counts.bands},{id:'heads',name:'Heads & shapes',count:counts.heads},{id:'metals',name:'Metal finishes',count:counts.metals}].map(item=><button key={item.id} role="tab" aria-selected={tab===item.id} onClick={()=>{setTab(item.id as CollectionTab);setQuery('');setCategory('all');setFilter('all');setCollectionPage(0);}}>{item.name}<span>{item.count}</span></button>)}</div><div className="studio-collection-actions">{tab==='heads'&&<><Button onClick={()=>setEditor({kind:'shape'})}>Add shape</Button><Button onClick={()=>setEditor({kind:'style'})}>Add setting</Button></>}<Button icon="plus" primary onClick={()=>setEditor({kind:tab==='bands'?'band':tab==='heads'?'head':'metal'})}>Add {tab==='bands'?'band':tab==='heads'?'head model':'metal'}</Button></div></div>

    <div className="studio-toolbar"><label className="studio-search"><Icon name="search" size={17}/><input placeholder={`Find a ${tab==='bands'?'band style':tab==='heads'?'head or shape':'metal finish'}…`} aria-label="Search collection" value={query} onChange={event=>{setQuery(event.target.value);setCollectionPage(0);}}/></label>{tab==='bands'&&<select aria-label="Band category" value={category} onChange={event=>{setCategory(event.target.value);setCollectionPage(0);}}><option value="all">All categories</option>{[...new Set(catalog.shanks.map(band=>band.category))].sort().map(value=><option key={value}>{value}</option>)}</select>}<select aria-label="Collection visibility" value={filter} onChange={event=>{setFilter(event.target.value);setCollectionPage(0);}}><option value="all">All visibility</option><option value="visible">Available</option><option value="hidden">Hidden</option></select><span className="studio-results">{rows.length} {tab==='metals'?'finishes':'models'}</span><div className="studio-layout-switch"><button aria-label="Card layout" aria-pressed={!list} onClick={()=>setList(false)}><Icon name="overview" size={16}/></button><button aria-label="List layout" aria-pressed={list} onClick={()=>setList(true)}><Icon name="menu" size={17}/></button></div></div>

    {tab==='heads'&&<div className="studio-shape-strip"><span>SHAPES</span>{catalog.shapes.map(shape=><div key={shape.id}><button onClick={()=>{setQuery(shape.name);setCollectionPage(0);}}>{shape.image&&<img src={shape.image} alt=""/>}{shape.name}<span>{shape.carats.length}</span></button><button aria-label={`Edit ${shape.name} shape`} onClick={()=>setEditor({kind:'shape',item:shape})}><Icon name="edit" size={12}/></button></div>)}</div>}

    {tab==='heads'&&<div className="studio-shape-strip"><span>SETTINGS</span>{getHeadStyles(catalog).map(style=><div key={style.id}><button onClick={()=>{setQuery(style.name);setCollectionPage(0);}}>{style.name}</button><button aria-label={`Edit ${style.name} setting`} onClick={()=>setEditor({kind:'style',item:style})}><Icon name="edit" size={12}/></button></div>)}</div>}
    <div className={`studio-model-grid ${list?'is-list':''}`}>{rows.slice(collectionPage*12,collectionPage*12+12).map(row=><article key={row.id} className="studio-model-card"><div className="studio-model-image"><Status enabled={row.enabled!==false}/><button aria-label={`Edit ${row.name}`} onClick={()=>setEditor(row.target)}>{row.file?<ModelThumbnail file={row.file} kind={row.kind} label={row.name} thumbnail={row.thumbnail}/>:<span className="studio-finish-orb" style={{background:'gradient' in row?row.gradient:'#ddd'}}/>}</button></div><div className="studio-model-info"><span>{row.category}</span><h2>{row.name}</h2><div><button onClick={()=>setEditor(row.target)}>Edit {tab==='metals'?'finish':'model'}<Icon name="arrow" size={15}/></button><button aria-label={`Delete ${row.name}`} onClick={()=>row.target.kind==='head'?setDeleting({kind:'head',shapeId:row.target.shapeId,styleId:headStyleId(row.target.item),carat:row.target.item.carat}):setDeleting({kind:row.target.kind,id:row.target.item.id})}><Icon name="trash" size={16}/></button></div></div></article>)}</div>{!rows.length&&<div className="studio-empty">No models match these filters. Try another search.</div>}

    <div className="studio-pagination"><span>{rows.length?collectionPage*12+1:0}–{Math.min(rows.length,collectionPage*12+12)} of {rows.length}</span><div><Button disabled={!collectionPage} onClick={()=>setCollectionPage(value=>value-1)}>Previous</Button><Button disabled={(collectionPage+1)*12>=rows.length} onClick={()=>setCollectionPage(value=>value+1)}>Next</Button></div></div>

   </>}

   {page==='pricing'&&<div className="studio-pricing"><PricingPanel catalog={catalog} onChange={update}/></div>}

   {page==='appearance'&&<div className="studio-rendering"><div className="studio-render-note"><Icon name="diamond" size={20}/><div><strong>Your lighting. Three different canvases.</strong><p>Studio lighting shapes the viewer and ring photos. Portrait lighting is independent. Diamond lighting stays separate.</p></div><span>ON-DEMAND PREVIEWS</span></div><AppearancePanel catalog={catalog} session={session} onChange={update} onBusy={setRendering}/></div>}

   {page==='assets'&&<Files/>}

   {page==='settings'&&<div className="studio-settings"><section className="studio-panel"><div className="studio-section-heading"><div><span className="studio-eyebrow">THE FIRST IMPRESSION</span><h2>Your starting ring</h2></div><Icon name="band" size={24}/></div><div className="studio-settings-body"><Field label="Head setting"><select value={catalog.defaults.headStyleId||LEGACY_HEAD_STYLE} onChange={event=>{const shape=visible.shapes.find(shape=>shape.carats.some(head=>headStyleId(head)===event.target.value));const head=shape?.carats.find(head=>headStyleId(head)===event.target.value);if(shape&&head)setDefaults({headStyleId:event.target.value,shapeId:shape.id,carat:head.carat});}}>{getHeadStyles(visible).filter(style=>visible.shapes.some(shape=>shape.carats.some(head=>headStyleId(head)===style.id))).map(style=><option key={style.id} value={style.id}>{style.name}</option>)}</select></Field><div className="studio-field-pair"><Field label="Diamond shape"><select value={catalog.defaults.shapeId} onChange={event=>{const shape=visible.shapes.find(shape=>shape.id===event.target.value)!;const head=shape.carats.find(head=>headStyleId(head)===catalog.defaults.headStyleId)||shape.carats[0];setDefaults({shapeId:shape.id,headStyleId:headStyleId(head),carat:head.carat});}}>{visible.shapes.map(shape=><option key={shape.id} value={shape.id}>{shape.name}</option>)}</select></Field><Field label="Carat weight"><select value={catalog.defaults.carat} onChange={event=>setDefaults({carat:Number(event.target.value)})}>{visible.shapes.find(shape=>shape.id===catalog.defaults.shapeId)?.carats.filter(head=>headStyleId(head)===(catalog.defaults.headStyleId||LEGACY_HEAD_STYLE)).map(head=><option key={head.carat} value={head.carat}>{head.carat} ct</option>)}</select></Field></div><Field label="Band style"><select value={catalog.defaults.shankId} onChange={event=>setDefaults({shankId:event.target.value})}>{visible.shanks.map(band=><option key={band.id} value={band.id}>{band.name}</option>)}</select></Field><Field label="Metal finish"><select value={catalog.defaults.metalId} onChange={event=>setDefaults({metalId:event.target.value})}>{visible.metals.map(metal=><option key={metal.id} value={metal.id}>{metal.name}</option>)}</select></Field><details className="studio-advanced"><summary>Advanced model sizing</summary><div className="studio-field-pair">{(['headScale','shankScale'] as const).map(key=><Field key={key} label={key==='headScale'?'Head scale':'Band scale'}><input type="number" min="0.0001" max="100" step="0.001" value={catalog.defaults[key]} onChange={event=>setDefaults({[key]:Number(event.target.value)})}/></Field>)}</div></details></div></section><aside><div className="studio-default-card"><span className="studio-eyebrow">CURRENT STARTING BAND</span><ModelThumbnail file={defaultBand.file} kind="shank" label={defaultBand.name} thumbnail={defaultBand.thumbnail}/><h2>{defaultBand.name}</h2><p>{catalog.shapes.find(shape=>shape.id===catalog.defaults.shapeId)?.name} · {catalog.defaults.carat} ct · {catalog.metals.find(metal=>metal.id===catalog.defaults.metalId)?.name}</p></div><div className="studio-sandbox-note"><Icon name="check" size={20}/><div><strong>{preview?'A safe space to explore':'Connected to your store'}</strong><p>{preview?'Publishing here changes this sample workspace. Your original catalog, database and Cloudflare files stay untouched.':'Your catalog is stored in MongoDB. Models, images and environments are hosted on Cloudflare R2. Publish applies your changes to the store.'}</p></div></div></aside></div>}

   <footer className="studio-footer"><span><Icon name="diamond" size={14}/>Ring Studio · Store workspace</span><span>{preview?'Preview data only':session.username}<i/>{preview?'Original store unchanged':'Current store'}</span></footer>

  </main>

  {editor&&<CatalogEditor key={JSON.stringify(editor)} target={editor} catalog={catalog} session={session} onClose={()=>setEditor(undefined)} onApply={value=>{update(value);setEditor(undefined);setNotice(preview?'Collection updated. Publish preview to keep it in this workspace.':'Collection updated. Click Publish to update your store.');}} onDelete={removeFromEditor}/>}

  {deleting&&<DeleteDialog target={deleting} catalog={catalog} onClose={()=>setDeleting(undefined)} onConfirm={result=>{update(result.catalog);setDeleting(undefined);setEditor(undefined);setNotice(`${result.label} removed.${preview?'':' Click Publish to update the store.'} Undo is available above.`);}}/>}

 </div></AppearanceProvider>;

}


import {defineConfig,type Plugin} from 'vite';
import react from '@vitejs/plugin-react';

/** Isolated UI sandbox: every admin mutation is simulated in memory. No live API is installed. */
function previewApi():Plugin{
 return {name:'isolated-admin-design-preview',transformIndexHtml:{order:'pre',handler:html=>html.replace(/(\bsrc\s*=\s*["'])\/src\/main\.tsx(?:\?[^"']*)?(["'])/g,'$1/src/admin-preview/main.tsx$2')},configureServer(server){
  let state:any,initializing:Promise<any>|undefined;
  const initialize=()=>initializing??=Promise.all([server.ssrLoadModule('/src/config/staticModels.ts'),server.ssrLoadModule('/server/pricingDemo.ts'),server.ssrLoadModule('/src/config/appearance.ts')]).then(([models,pricing,appearance])=>{
   const catalog=pricing.pricingDemoCatalog(structuredClone(models.BOOTSTRAP_CATALOG));catalog.appearance=structuredClone(appearance.DEFAULT_APPEARANCE);
   catalog.defaults.shankId=catalog.shanks.find((band:any)=>band.id==='triple-row')?.id||catalog.defaults.shankId;
   return state={active:structuredClone(catalog),catalog,revision:1,baseReleaseId:catalog.releaseId,hasUnpublishedChanges:false,publishedAt:new Date().toISOString(),cleanup:{pending:0},storage:{count:1493,bytes:188400000},connections:{database:true,uploads:false},activity:[{type:'published',message:'Example collection ready to explore',username:'Design preview',createdAt:new Date().toISOString()}]};
  });
  server.middlewares.use(async(request,response,next)=>{
   const url=new URL(request.url||'/','http://preview.local');if(!url.pathname.startsWith('/api/'))return next();
   response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');
   const send=(data:unknown,status=200)=>response.writeHead(status).end(JSON.stringify(data));
   try{
    await initialize();if(url.pathname!=='/api/admin')return send({error:'Only the isolated admin preview API is available.'},404);
    const action=url.searchParams.get('action'),session={username:'Design preview',csrf:'preview-only',expires:Date.now()+86400000};
    if(action==='session')return send({configured:true,session});
    if(action==='state')return send(state);
    if(action==='login')return send({session});if(action==='logout')return send({ok:true});
    if(action==='assets'){
     const items=[...state.catalog.shanks.map((band:any)=>({sourcePath:band.name+'.glb',url:band.file,bytes:782400,contentType:'model/gltf-binary'})),...state.catalog.shapes.flatMap((shape:any)=>shape.carats.map((head:any)=>({sourcePath:head.filename,url:head.file,bytes:624300,contentType:'model/gltf-binary'})))].filter((item:any)=>item.sourcePath.toLowerCase().includes((url.searchParams.get('search')||'').toLowerCase()));
     const page=Math.max(0,Number(url.searchParams.get('page'))||0);return send({items:items.slice(page*30,(page+1)*30),total:items.length});
    }
    if(request.method!=='POST')return send({error:'Preview action not available.'},404);
    const chunks:Buffer[]=[];let length=0;for await(const chunk of request){length+=chunk.length;if(length>1048576)return send({error:'Preview request too large.'},413);chunks.push(chunk);}
    const input=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
    if(action==='publish'){
     const {validateCatalog,storefrontCatalog}=await server.ssrLoadModule('/src/admin/catalog.ts'),errors=validateCatalog(input.catalog);
     if(errors.length)return send({error:errors.join(' ')},400);
     if(input.revision!==state.revision)return send({error:'Reload this preview before publishing.'},409);
     state={...state,catalog:structuredClone(input.catalog),active:storefrontCatalog(structuredClone(input.catalog)),revision:state.revision+1,publishedAt:new Date().toISOString(),hasUnpublishedChanges:false};
     state.activity=[{type:'published',message:'Preview changes applied · original store unchanged',username:session.username,createdAt:state.publishedAt},...state.activity].slice(0,12);return send(state);
    }
    if(action==='cleanup')return send({deleted:0,pending:0});
    return send({error:'Uploads and storage changes are disabled in this design preview. Use the original admin for real changes.'},403);
   }catch{send({error:'The design preview could not complete this action.'},500);}
  });
 }};
}
export default defineConfig({plugins:[react(),previewApi()],publicDir:false,server:{host:'0.0.0.0',port:5175,strictPort:true,fs:{deny:['.env','.env.*','*.{crt,pem,key}','**/.git/**','**/.cert/**']},watch:{usePolling:true,interval:350,ignored:['**/artifacts/**','**/node_modules/**']}},resolve:{alias:{webgi:'webgi/dist/examples/runtime/bundle.m.js'},dedupe:['react','react-dom','three']}});

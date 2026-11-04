import * as T from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {DRACOLoader} from 'three/examples/jsm/loaders/DRACOLoader.js';
import {createWebGIAR} from '../../ar/src/webgi-ar-renderer';
import {assetUrl} from '../config/assets';
import {studioEnvironment,THUMBNAIL_METALS} from '../config/appearance';
import {cleanThumbnailModel} from '../utils/thumbnailRendering';
import type {ThumbnailChoice} from '../types/appearance';
export async function renderHdrThumbnail(file:string,kind:'head'|'shank',choice:ThumbnailChoice):Promise<Blob>{
 const draco=new DRACOLoader().setDecoderPath(assetUrl('/draco/')),loader=new GLTFLoader().setDRACOLoader(draco);
 const model=(await loader.loadAsync(file)).scene;cleanThumbnailModel(model);
 model.name=kind==='shank'?'band':'head';model.traverse((o:any)=>{if(o.isMesh)o.userData={...o.userData,arMetalHex:THUMBNAIL_METALS[choice.metal],arPart:kind==='shank'?'band':'head'};});
 const root=new T.Group();root.add(model);root.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(root,true),center=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3()),extent=Math.max(size.x,size.y,size.z)*1.25;root.userData.innerDiameter=extent;
 const canvas=document.createElement('canvas');canvas.style.cssText='position:fixed;left:0;top:0;width:480px;height:360px;z-index:-1;pointer-events:none';canvas.setAttribute('aria-hidden','true');document.body.appendChild(canvas);
 let renderer:Awaited<ReturnType<typeof createWebGIAR>>|undefined;
 try{
  // Both workspaces use Vite's deduped Three runtime; their declarations differ.
  renderer=await createWebGIAR(canvas,root as unknown as Parameters<typeof createWebGIAR>[1],new AbortController().signal,[],studioEnvironment(choice.environment));
  const zoom=kind==='shank'?1.65:1,camera=new T.OrthographicCamera(-extent*2/3/zoom,extent*2/3/zoom,extent/2/zoom,-extent/2/zoom,.001,10000);
  camera.position.copy(center).addScaledVector(new T.Vector3(.65,kind==='shank'?.25:.65,1).normalize(),extent*4);camera.lookAt(kind==='shank'?center.clone().add(new T.Vector3(0,size.y*.23,0)):center);camera.updateMatrixWorld();
  renderer.render({ring:root,camera,masks:[],width:480,height:360} as unknown as Parameters<typeof renderer.render>[0]);await renderer.frame();await renderer.frame();
  const output=document.createElement('canvas');output.width=480;output.height=360;const ctx=output.getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,480,360);ctx.drawImage(canvas,0,0,480,360);
  return await new Promise<Blob>((resolve,reject)=>output.toBlob(blob=>blob?resolve(blob):reject(Error('HDR thumbnail encoding failed')),'image/webp',.95));
 }finally{renderer?.dispose();canvas.remove();draco.dispose();model.traverse((o:any)=>{o.geometry?.dispose();if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();});}
}

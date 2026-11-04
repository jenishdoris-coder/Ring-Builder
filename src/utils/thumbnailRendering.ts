import { ACESFilmicToneMapping, Box3, BoxGeometry, Color, DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, OrthographicCamera, PerspectiveCamera, PMREMGenerator, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { isDiamondMesh } from "./meshUtils";
import { assetUrl } from "../config/assets";
import { DEFAULT_APPEARANCE, THUMBNAIL_PRESETS } from "../config/appearance";
import type { ThumbnailChoice } from "../types/appearance";
type Preset = { id: string; background: string; metal: string; wall: string; box: number; roughness: number; exposure: number; light?: string; metalness?: number; clearcoat?: number; direction?: number[]; headDirection?: number[]; zoom?: number; headZoom?: number; lift?: number; orthographic?: boolean; envRotation?: number };
const width=480,height=360;
let state: ReturnType<typeof initialize> | undefined;
function initialize() {
  const renderer=new WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(width,height);renderer.setPixelRatio(1);renderer.outputColorSpace=SRGBColorSpace;renderer.toneMapping=ACESFilmicToneMapping;
  const scene=new Scene(),light=new DirectionalLight(0xffffff,.45);light.position.set(2,5,4);scene.add(light,new HemisphereLight(0xffffff,0x404754,.08));
  const metal=new MeshPhysicalMaterial({metalness:1,clearcoat:.25,clearcoatRoughness:.1});
  const gem=new MeshPhysicalMaterial({color:'#dbe3ee',metalness:.35,roughness:.035,envMapIntensity:1.15,ior:2.42,reflectivity:1,clearcoat:1,flatShading:true});
  const draco=new DRACOLoader().setDecoderPath(assetUrl('/draco/'));const loader=new GLTFLoader().setDRACOLoader(draco);
  return {renderer,scene,metal,gem,draco,loader,maps:new Map<string,ReturnType<PMREMGenerator['fromScene']>>(),models:new Map<string,Group>()};
}
function environment(s: NonNullable<typeof state>, p: Preset) {
  const cached=s.maps.get(p.id);if(cached)return cached.texture;
  const room=new Scene();room.background=new Color(p.wall);const geometry=new BoxGeometry(),material=new MeshBasicMaterial();material.color.set(p.light||'#ffffff').multiplyScalar(p.box);
  for(const [position,scale] of [[[-4,1,0],[.1,7,4]],[[4,1,-2],[.1,6,3]],[[0,5,0],[5,.1,5]],[[0,1,5],[1.7,5,.1]],[[0,1,-5],[3,7,.1]]]){const box=new Mesh(geometry,material);box.position.fromArray(position);box.scale.fromArray(scale);room.add(box);}
  room.rotation.y=p.envRotation||0;const pmrem=new PMREMGenerator(s.renderer),target=pmrem.fromScene(room,.02,.1,100);s.maps.set(p.id,target);geometry.dispose();material.dispose();pmrem.dispose();return target.texture;
}
export function cleanThumbnailModel(model: Group) {
  const hidden: any[]=[];model.traverse((object:any)=>{if(object.isLine||object.isPoints){hidden.push(object);return;}if(!object.isMesh)return;const materials=Array.isArray(object.material)?object.material:[object.material];if(/channel.?cutter|ring.?rail|micro.?pave.?cut/i.test(object.name)||materials.some((m:any)=>/creation.?curves|finger.?sizes/i.test(m.name)))hidden.push(object);});hidden.forEach(object=>object.removeFromParent());
}
export async function renderThumbnail(file: string, kind: "head" | "shank", choice: ThumbnailChoice=DEFAULT_APPEARANCE.thumbnails): Promise<Blob> {
  if(choice.mode==='hdr')return (await import('../admin/hdrThumbnail')).renderHdrThumbnail(file,kind,choice);
  const s=state??=initialize(),p=(THUMBNAIL_PRESETS.find(p=>p.id===choice.preset)||THUMBNAIL_PRESETS.find(p=>p.id==='D')) as unknown as Preset;
  let model=s.models.get(file);
  if(!model){model=(await s.loader.loadAsync(file)).scene;cleanThumbnailModel(model);model.traverse((mesh:any)=>{if(!mesh.isMesh)return;const diamond=isDiamondMesh(mesh);for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])m.dispose();mesh.material=diamond?s.gem:s.metal;});s.models.set(file,model);while(s.models.size>2){const key=s.models.keys().next().value!;s.models.get(key)!.traverse((m:any)=>m.geometry?.dispose());s.models.delete(key);}}
  s.scene.add(model);
  try {
    s.scene.background=new Color(p.background);s.scene.environment=environment(s,p);s.renderer.toneMappingExposure=p.exposure;s.metal.color.set(p.metal);s.metal.roughness=p.roughness;s.metal.metalness=p.metalness??1;s.metal.clearcoat=p.clearcoat??.25;
    model.updateWorldMatrix(true,true);const bounds=new Box3().setFromObject(model,true),center=bounds.getCenter(new Vector3()),size=bounds.getSize(new Vector3());const extent=Math.max(size.x,size.y,size.z)*1.25;
    const camera=p.orthographic?new OrthographicCamera(-extent*2/3,extent*2/3,extent/2,-extent/2,.001,10000):new PerspectiveCamera(30,4/3,.001,10000);
    const direction=kind==='head'?(p.headDirection||[.65,.65,1]):(p.direction||[.65,.25,1]);camera.position.copy(center).addScaledVector(new Vector3().fromArray(direction).normalize(),extent/(2*Math.tan(Math.PI/12)));camera.lookAt(kind==='head'?center:center.clone().add(new Vector3(0,size.y*(p.lift??.23),0)));camera.zoom=kind==='head'?(p.headZoom??1):(p.zoom??1.65);camera.updateProjectionMatrix();s.renderer.render(s.scene,camera);
    return await new Promise<Blob>((resolve,reject)=>s.renderer.domElement.toBlob(blob=>blob?resolve(blob):reject(Error('Thumbnail encoding failed.')),'image/webp',.94));
  } finally {s.scene.remove(model);}
}
export function disposeThumbnailRenderer() {if(!state)return;for(const m of state.models.values())m.traverse((o:any)=>o.geometry?.dispose());for(const map of state.maps.values())map.dispose();state.metal.dispose();state.gem.dispose();state.draco.dispose();state.renderer.dispose();state.renderer.forceContextLoss();state=undefined;}

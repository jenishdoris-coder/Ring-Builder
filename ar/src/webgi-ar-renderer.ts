import * as W from "webgi";
import type * as THREE from "three";
import { DIAMOND_GEM, applyDiamondShaderProps, getDiamondBakeConfig, syncDiamondPluginFromConfig } from "../../src/config/materialConfig";
import { CUSTOM_DIAMOND_ENV_URL, CUSTOM_METAL_ENV_URL, METAL_ENV_ROTATION, TONEMAP_CONTRAST, TONEMAP_SATURATION } from "../../src/config/viewerConfig";
import { getMetalRoughness, hexSrgbToMetalColor, isWhiteGoldSrgb } from "../../src/utils/colorUtils";
import { isDiamondMesh } from "./ring-meshes";
import { inspectCanvasTransparency, inspectTransparency, readCanvasPixels } from "./render-validation";
import { arRenderScale } from "./render-quality";
import { MultiRingEngraving } from "../../src/utils/ringEngraving";
import type { RingEngravingConfig } from "../../src/config/engraving";

type Frame = {ring:THREE.Group|null; camera:THREE.OrthographicCamera; masks:THREE.Object3D[]; width:number; height:number};
export interface WebGIAR {
  render(frame:Frame):void;
  beforeFrame(callback:()=>void):()=>void;
  frame():Promise<void>;
  checkOcclusion():Promise<{passed:boolean;clear:number;front:number;behind:number;masked:number}>;
  checkProjection():Promise<{passed:boolean;meanError:number;samples:number}>;
  checkFrameSync():Promise<{passed:boolean;frames:number;matched:number}>;
  checkEdges():Promise<{passed:boolean;blendedEdges:number;foreground:number;scale:number}>;
  checkFading():Promise<{passed:boolean;softened:number;retained:number;opacityRatio:number}>;
  dispose():void;
}

/** Use the builder's actual WebGI plugin and assets, rather than approximating
 * its diamond shader. The SDK performs the final camera-overlay alpha clipping. */
export async function createWebGIAR(canvas:HTMLCanvasElement, source:THREE.Object3D, signal:AbortSignal, inscriptions:RingEngravingConfig[]=[]):Promise<WebGIAR> {
  canvas.style.opacity="0";
  const floatComparison=import.meta.env.DEV&&new URLSearchParams(location.search).get("pipeline")==="float";
  const viewer:any = new W.CoreViewerApp({canvas,useRgbm:!floatComparison,useGBufferDepth:true,isAntialiased:true});
  const sdk:any = viewer;
  let disposed=false;
  const geometries = new Set<any>(), materials = new Set<any>(), environments = new Set<any>();
  let maskTarget:any;
  const engraving = new MultiRingEngraving();
  const guard=()=>{if(disposed||signal.aborted)throw new DOMException("WebGI AR load cancelled.","AbortError");};
  try {
    await viewer.initialize({ground:false,bloom:false,depthTonemap:true,enableDrop:false,importPopup:false,interactionPrompt:false,caching:false}); guard();
    for(const name of ["FrameFade","LUT","SSReflection","SSR","SSAO","SSCS","DepthOfField","LoadingScreen","InteractionPrompt","GLTFAnimation"]){
      const plugin=sdk.getPluginByType(name);if(plugin){plugin.stopTransition?.();plugin.enabled=false;if(plugin.pass)plugin.pass.enabled=false;}
    }
    viewer.scene.setBackgroundColor(null); viewer.scene.background=null;
    viewer.renderer.renderScale = 2.5;
    await viewer.getOrAddPlugin(W.GBufferPlugin);
    const tonemap:any = viewer.getPlugin(W.TonemapPlugin) || await viewer.addPlugin(new W.TonemapPlugin(true));
    if(!tonemap.config?.depthTonemap)throw new Error("WebGI depth tone mapping is required for the camera overlay.");
    Object.assign(tonemap.config,{clipBackground:true,tonemapBackground:false,contrast:TONEMAP_CONTRAST,saturation:TONEMAP_SATURATION});tonemap.config.setDirty?.();
    const progressive:any = viewer.getPlugin(W.ProgressivePlugin) || await viewer.addPlugin(new W.ProgressivePlugin(8));
    progressive.maxFrameCount=1;
    const temporal:any = viewer.getPlugin(W.TemporalAAPlugin) || await viewer.addPlugin(W.TemporalAAPlugin);
    // A camera frame, cropped viewport and hand mask must describe one instant.
    // History accumulation and subpixel jitter smear moving facets and make
    // the depth cut swim. Use multisampling and 2x spatial sampling instead.
    temporal.enabled=false;
    const manager:any = sdk.getManager?.() || viewer.getPlugin(W.AssetManagerPlugin) || await viewer.addPlugin(W.AssetManagerPlugin);
    await viewer.getOrAddPlugin(W.EXRLoadPlugin);
    const diamond:any = await viewer.getOrAddPlugin(W.DiamondPlugin);
    syncDiamondPluginFromConfig(diamond);
    const [metalEnv,diamondEnv]=await Promise.all([manager.importer.importSinglePath(CUSTOM_METAL_ENV_URL),manager.importer.importSinglePath(CUSTOM_DIAMOND_ENV_URL)]);guard();
    environments.add(metalEnv);environments.add(diamondEnv);
    viewer.scene.setEnvironment(metalEnv);if(viewer.scene.environment)(viewer.scene.environment as any).rotation=METAL_ENV_ROTATION;
    viewer.scene.fixedEnvMapDirection=true;
    diamond.forceSceneEnvMap=false;diamond.config.forceSceneEnvMap=false;
    diamond.envMap=diamondEnv;diamond.envMap2=diamondEnv;diamond.envMap3=diamondEnv;diamond.refreshEnvMaps?.();
    const light=new W.DirectionalLight(0xf5f5f5,.12);light.position.set(1.5,6,1.5);viewer.scene.add(light,new W.AmbientLight(0xffffff,1.3));

    const geometryCache=new Map<THREE.BufferGeometry,any>();
    const geometryFor=(geometry:THREE.BufferGeometry,dynamic=false)=>{
      if(geometryCache.has(geometry))return geometryCache.get(geometry);
      const copy=new W.BufferGeometry();copy.name=geometry.name;
      for(const [name,attribute]of Object.entries(geometry.attributes)){
        const attributeCopy=new W.BufferAttribute((attribute.array as any).slice(),attribute.itemSize,attribute.normalized);
        if(dynamic)attributeCopy.setUsage(W.DynamicDrawUsage);
        copy.setAttribute(name,attributeCopy);
      }
      if(geometry.index)copy.setIndex(new W.BufferAttribute((geometry.index.array as any).slice(),1));
      for(const group of geometry.groups)copy.addGroup(group.start,group.count,group.materialIndex);
      geometries.add(copy);geometryCache.set(geometry,copy);return copy;
    };
    const ring=new W.Object3D();ring.name="webgi-ar-selected-ring";
    const bandGroup=new W.Object3D();bandGroup.name="band";ring.add(bandGroup);
    const viewDirection={value:new W.Vector3(0,0,-1)};
    const perspectiveComparison=import.meta.env.DEV&&new URLSearchParams(location.search).has("perspectiveDiamonds");
    source.updateWorldMatrix(true,true);const inverse=source.matrixWorld.clone().invert();
    // Preserve the band's CAD frame for the shared inside-engraving shader.
    // Flattening the AR half-turn into every mesh would swap its top/bottom.
    const bandSource=source.getObjectByName('band');
    const bandInverse=bandSource?.matrixWorld.clone().invert();
    if(bandSource){const transform=inverse.clone().multiply(bandSource.matrixWorld);bandGroup.matrix.fromArray(transform.elements);bandGroup.matrix.decompose(bandGroup.position,bandGroup.quaternion,bandGroup.scale);}
    const gems:any[]=[];
    source.traverse(object=>{
      const mesh=object as THREE.Mesh;if(!mesh.isMesh)return;
      const gem=isDiamondMesh(mesh);
      const hex=mesh.userData.arMetalHex||"#C2C2C3";
      const material:any=new W.MeshStandardMaterial2({name:gem?"Gem 03":"Metal 01",color:gem?new W.Color("#ffffff"):hexSrgbToMetalColor(W.Color,hex),metalness:gem?0:1,roughness:gem?0:getMetalRoughness(hex),envMapIntensity:1,side:W.DoubleSide,clearcoat:0});
      if(!gem&&isWhiteGoldSrgb(hex)){material.emissive.copy(material.color);material.emissiveIntensity=.005;}
      materials.add(material);
      const copy=new W.Mesh(geometryFor(mesh.geometry),material);copy.name=mesh.name;copy.renderOrder=gem?DIAMOND_GEM.renderOrder:1;
      const relative=(mesh.userData.arPart==="band"&&bandInverse?bandInverse:inverse).clone().multiply(mesh.matrixWorld);copy.matrix.fromArray(relative.elements);copy.matrix.decompose(copy.position,copy.quaternion,copy.scale);
      copy.userData={...mesh.userData};(mesh.userData.arPart==="band"?bandGroup:ring).add(copy);if(gem)gems.push(copy);
    });
    await manager.addImported(ring,{autoScale:false,autoCenter:false,addToRoot:true,loadAnimations:false});guard();
    viewer.scene.modelRoot.add(ring);
    if(inscriptions.length){ring.updateMatrixWorld(true);engraving.apply(bandGroup,inscriptions);}
    viewer.scene.setDirty({sceneUpdate:true});
    for(let start=0;start<gems.length;start+=4){
      await Promise.all(gems.slice(start,start+4).map(async(mesh,index)=>{
        const options={normalMapRes:DIAMOND_GEM.normalMapRes};
        await diamond.prepareDiamondMesh(mesh,options);guard();
        diamond.makeDiamondMesh({modelObject:mesh,geometry:mesh.geometry,material:mesh.material,setMaterial:(next:any)=>{if(next)mesh.material=next;}},options,getDiamondBakeConfig(`ar-webgi-${source.uuid}-${start+index}`));
        applyDiamondShaderProps(mesh.material);mesh.material.color?.set?.("#ffffff");mesh.material.userData={...mesh.material.userData,__isDiamond:true};materials.add(mesh.material);
        if(!perspectiveComparison)mesh.material.registerMaterialExtensions([{
          uuid:"ar-orthographic-diamond-rays",customCacheKey:"ar-orthographic-diamond-rays-v1",isCompatible:()=>true,
          extraUniforms:{arViewDirection:viewDirection},parsFragmentSnippet:"uniform vec3 arViewDirection;",
          shaderExtender:(shader:any)=>{
            const perspectiveRay=/normalize\s*\(\s*vWorldPosition\s*-\s*cameraPosition\s*\)/;
            if(!perspectiveRay.test(shader.fragmentShader))throw new Error("The WebGI diamond camera adapter needs updating.");
            shader.fragmentShader=shader.fragmentShader.replace(perspectiveRay,"normalize(arViewDirection)");
            canvas.dataset.diamondProjection="orthographic";
          }
        }]);
      }));guard();
    }
    const camera=new W.OrthographicCamera(-1,1,1,-1,.1,100);camera.position.set(0,0,4);camera.lookAt(0,0,0);camera.userData.autoNearFar=false;camera.updateMatrixWorld(true);
    const controller=new W.CameraController(camera,{type:"OrthographicCamera",aspect:1,controlsEnabled:false,controlsMode:""},canvas);controller.autoLookAtTarget=false;controller.interactionsEnabled=false;
    viewer.scene.activeCamera=controller;viewer.scene.renderCamera=controller;

    // The hand masks are rendered into a separate depth texture. They never
    // enter the visible WebGI scene or turn camera pixels into opaque black.
    const maskScene=new W.Scene();const maskMaterial=new W.MeshBasicMaterial({colorWrite:false,depthWrite:true,depthTest:true,side:W.DoubleSide});materials.add(maskMaterial);
    const maskCopies=new Map<THREE.Mesh,any>();
    const probeGeometry=new W.PlaneGeometry(20,20);geometries.add(probeGeometry);
    const probePlane=new W.Mesh(probeGeometry,maskMaterial);probePlane.frustumCulled=false;probePlane.visible=false;maskScene.add(probePlane);
    let probe:"clear"|"front"|"behind"|null=null;
    maskTarget=new W.WebGLRenderTarget(1,1,{depthBuffer:true,stencilBuffer:false});
    maskTarget.depthTexture=new W.DepthTexture(1,1,W.UnsignedIntType);
    const uniforms:any={
      arHandDepth:{value:maskTarget.depthTexture},arDepthSize:{value:new W.Vector2(1,1)},arDepthFade:{value:.000001},arFeatherPixels:{value:1},
      arCameraWorld:{value:new W.Matrix4()},arProjectionInverse:{value:new W.Matrix4()},
      arRingCenter:{value:new W.Vector3()},arRingAxis:{value:new W.Vector3(0,1,0)},arRingRadius:{value:1},arRearFadeEnabled:{value:1}
    };
    const post:any=viewer.getPluginByType("CombinedPostPlugin");
    if(!post?.addExtension)throw new Error("WebGI camera compositor is unavailable.");
    // WebGI may already have compiled this post material while loading the
    // environment. A distinct program key forces the new hand extension into
    // the GPU program; marking it dirty alone can reuse the unmasked shader.
    if(!new URLSearchParams(location.search).has("nohandmask"))post.addExtension({uuid:"ring-ar-hand-depth",customCacheKey:"ring-ar-hand-depth-v4-original-fade",isCompatible:()=>true,extraUniforms:uniforms,
      parsFragmentSnippet:`uniform sampler2D arHandDepth;uniform vec2 arDepthSize;uniform float arDepthFade;uniform float arFeatherPixels;
        uniform mat4 arCameraWorld;uniform mat4 arProjectionInverse;uniform vec3 arRingCenter;uniform vec3 arRingAxis;uniform float arRingRadius;uniform float arRearFadeEnabled;`,
      shaderExtender:(shader:any)=>{
        canvas.dataset.occlusionShader=shader.fragmentShader.includes("#glMarker")?"marker-found":"marker-missing";
        shader.fragmentShader=shader.fragmentShader.replace("#glMarker",`
          float arDepth=getDepth(vUv);float arVisibility=0.0;
          for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
            float arMask=texture2D(arHandDepth,vUv+vec2(float(x),float(y))*arFeatherPixels/arDepthSize).r;
            float arWeight=(x==0?2.0:1.0)*(y==0?2.0:1.0);
            arVisibility+=arWeight*(1.0-smoothstep(0.0,arDepthFade,arDepth-arMask));
          }
          // Match the original AR project's continuous rear-band fade. Recover
          // world position from the same depth/camera as the current ring frame.
          vec4 arWorld=arCameraWorld*arProjectionInverse*vec4(vUv*2.0-1.0,arDepth*2.0-1.0,1.0);
          vec3 arRelative=arWorld.xyz/arWorld.w-arRingCenter;
          vec3 arRadial=arRelative-arRingAxis*dot(arRelative,arRingAxis);
          float arRearFade=smoothstep(-0.35,0.35,arRadial.z/max(arRingRadius,0.0001));
          gl_FragColor.a*=arVisibility/16.0*mix(1.0,arRearFade,arRearFadeEnabled);
          #glMarker`);
      }
    });
    post.pass.passObject.material.setDirty();
    post.pass.dirty=true;
    let latest:Frame|undefined;
    let cameraFrame:(()=>void)|undefined;
    const updateCameraFrame=()=>cameraFrame?.();
    viewer.addEventListener("preFrame",updateCameraFrame);
    const applyFrame=()=>{
      const frame=latest;if(!frame||disposed)return;
      const input=frame.camera;
      Object.assign(camera,{left:input.left,right:input.right,top:input.top,bottom:input.bottom,near:input.near,far:input.far});
      // The old 0.1..100 depth range spent almost all G-buffer precision on
      // empty space. Crop only depth (orthographic XY stays unchanged), keeping
      // enough room for the palm and neighboring fingers around the band.
      const diameter=(frame.ring?.scale.x||1)*(source.userData.innerDiameter||1);
      const halfDepth=Math.max(.2,diameter*4);
      const depthCenter=input.position.z-(frame.ring?.position.z||0);
      camera.near=Math.max(.01,depthCenter-halfDepth);
      camera.far=Math.max(camera.near+.1,depthCenter+halfDepth);
      uniforms.arDepthFade.value=Math.max(.000001,diameter*.025/(camera.far-camera.near));
      camera.position.set(input.position.x,input.position.y,input.position.z);camera.quaternion.set(input.quaternion.x,input.quaternion.y,input.quaternion.z,input.quaternion.w);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
      uniforms.arCameraWorld.value.copy(camera.matrixWorld);
      uniforms.arProjectionInverse.value.copy(camera.projectionMatrixInverse);
      ring.getWorldPosition(uniforms.arRingCenter.value);
      uniforms.arRingAxis.value.set(0,1,0).transformDirection(ring.matrixWorld);
      uniforms.arRingRadius.value=diameter*.5;
      // Preserve the original softness in screen pixels at the higher sampling
      // density used by the WebGI overlay.
      const pixelWidth=diameter*frame.height/Math.max(.0001,camera.top-camera.bottom);
      uniforms.arFeatherPixels.value=Math.max(1,Math.min(4,pixelWidth*.025))*viewer.renderer.renderScale/Math.min(window.devicePixelRatio||1,2);
      viewDirection.value.set(0,0,-1).applyQuaternion(camera.quaternion);
      const renderer:any=viewer.renderer.rendererObject;
      const drawing=renderer.getDrawingBufferSize(new W.Vector2());
      if(maskTarget.width!==drawing.x||maskTarget.height!==drawing.y){maskTarget.setSize(drawing.x,drawing.y);uniforms.arDepthSize.value.copy(drawing);}
      for(const mesh of maskCopies.values())mesh.visible=false;
      for(const root of frame.masks){root.updateWorldMatrix(true,true);root.traverse(object=>{
        const mesh=object as THREE.Mesh;if(!mesh.isMesh)return;
        let visible=true;for(let node:THREE.Object3D|null=mesh;node;node=node.parent)if(!node.visible)visible=false;
        let copy=maskCopies.get(mesh);
        if(!copy){copy=new W.Mesh(geometryFor(mesh.geometry,true),maskMaterial);copy.matrixAutoUpdate=false;copy.frustumCulled=false;maskCopies.set(mesh,copy);maskScene.add(copy);}
        copy.visible=probe===null&&visible;copy.matrix.fromArray(mesh.matrixWorld.elements);copy.matrixWorldNeedsUpdate=true;
        const positions=copy.geometry.attributes.position;positions.array.set(mesh.geometry.attributes.position.array);positions.needsUpdate=true;
      });}
      probePlane.visible=probe==="front"||probe==="behind";
      probePlane.position.z=probe==="front"?camera.position.z-camera.near-.1:camera.position.z-camera.far+.1;
      const target=renderer.getRenderTarget();const shadows=renderer.shadowMap.autoUpdate;renderer.shadowMap.autoUpdate=false;
      try {renderer.setRenderTarget(maskTarget);renderer.clear(true,true,true);renderer.render(maskScene,camera);}
      finally {renderer.setRenderTarget(target);renderer.shadowMap.autoUpdate=shadows;}
    };
    viewer.addEventListener("preRender",applyFrame);
    let firstFrame=false;
    const render=(frame:Frame)=>{
      latest=frame;const parent=frame.ring;
      ring.visible=!!parent?.visible;
      if(parent){parent.updateWorldMatrix(true,false);ring.matrix.fromArray(parent.matrixWorld.elements);ring.matrix.decompose(ring.position,ring.quaternion,ring.scale);ring.updateMatrixWorld(true);
      }
      const scale=arRenderScale(frame.width,frame.height,window.devicePixelRatio,viewer.renderer.rendererObject.capabilities.maxTextureSize);
      const scaleChanged=Math.abs(viewer.renderer.renderScale-scale)>.01;
      if(scaleChanged)viewer.renderer.renderScale=scale;
      if(scaleChanged||canvas.clientWidth!==frame.width||canvas.clientHeight!==frame.height){
        canvas.style.width=`${frame.width}px`;canvas.style.height=`${frame.height}px`;
        // Tracking runs at preFrame, after the SDK's ordinary resize stage.
        // Resize now so the new crop and its pixels are presented together.
        viewer.renderer.setSize(frame.width,frame.height,true);viewer.resize();
      }
      canvas.dataset.renderScale=String(scale);canvas.dataset.edgeAntialiasing="spatial";
      if(!firstFrame){firstFrame=true;void viewer.doOnce("postRender").then(()=>{if(!disposed)canvas.style.opacity="1";});}
      viewer.setDirty();
    };
    canvas.dataset.renderer="webgi";canvas.dataset.arVersion="integrated-v12";canvas.dataset.hdrPipeline=floatComparison?"float":"rgbm";canvas.dataset.diamondBounces=String(DIAMOND_GEM.rayBounces);canvas.dataset.diamondNormalMap=String(DIAMOND_GEM.normalMapRes);
    const frame=async()=>{if(disposed)return;const rendered=viewer.doOnce("postRender");viewer.setDirty();await Promise.race([rendered,new Promise(resolve=>setTimeout(resolve,700))]);};
    const checkOcclusion=async()=>{
      const counts:Record<string,number>={};
      try {for(const mode of ["clear","front","behind"] as const){probe=mode;await frame();await frame();counts[mode]=inspectCanvasTransparency(canvas).foreground;}}
      finally{probe=null;await frame();await frame();counts.masked=inspectCanvasTransparency(canvas).foreground;}
      return {passed:counts.clear>10&&counts.front<counts.clear*.02&&counts.behind>counts.clear*.95,clear:counts.clear,front:counts.front,behind:counts.behind,masked:counts.masked};
    };
    const checkProjection=async()=>{
      if(!latest)throw new Error("Load a ring before checking its camera projection.");
      const saved=latest,position=ring.position.clone();let baseline:ImageData|undefined,meanError=0,samples=0;
      try {
        probe="clear";
        for(const offset of [0,(source.userData.innerDiameter||1)*ring.scale.x*1.5]){
          const shifted=saved.camera.clone();shifted.left+=offset;shifted.right+=offset;
          latest={...saved,camera:shifted};ring.position.copy(position);ring.position.x+=offset;ring.updateMatrixWorld(true);
          await frame();await frame();const pixels=readCanvasPixels(canvas);
          if(!baseline){baseline=pixels;continue;}
          for(let i=0;i<pixels.data.length;i+=4)if(pixels.data[i+3]===255&&baseline.data[i+3]===255){
            for(let channel=0;channel<3;channel++)meanError+=Math.abs(pixels.data[i+channel]-baseline.data[i+channel]);
            samples+=3;
          }
        }
      }finally{latest=saved;ring.position.copy(position);ring.updateMatrixWorld(true);probe=null;await frame();}
      meanError/=Math.max(1,samples);
      return {passed:samples>30&&meanError<.5,meanError,samples};
    };
    const checkFrameSync=async()=>{
      if(!latest||cameraFrame)throw new Error("Use camera-free replay to check frame timing.");
      const saved=latest;let frames=0,matched=0;
      const widths=[saved.width,saved.width+64,saved.width];
      const inspect=()=>{
        if(frames>=widths.length)return;
        const expected=Math.round(widths[frames]*viewer.renderer.renderScale);
        if(canvas.width===expected&&maskTarget.width===expected)matched++;
        frames++;
      };
      cameraFrame=()=>{if(frames<widths.length)render({...saved,width:widths[frames]});};
      viewer.addEventListener("postRender",inspect);
      try{for(let i=0;i<3;i++)await frame();}
      finally{cameraFrame=undefined;viewer.removeEventListener("postRender",inspect);render(saved);await frame();}
      return {passed:frames===3&&matched===3,frames,matched};
    };
    const checkEdges=async()=>{
      if(!latest)throw new Error("Load a ring before checking its edges.");
      await frame();await frame();
      const display=document.createElement('canvas'),native=Math.min(window.devicePixelRatio||1,3);
      display.width=Math.round(latest.width*native);display.height=Math.round(latest.height*native);
      const context=display.getContext('2d');if(!context)throw new Error("Image readback unavailable.");
      context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
      context.drawImage(canvas,0,0,display.width,display.height);
      const result=inspectTransparency(context.getImageData(0,0,display.width,display.height).data,display.width,display.height);
      return {passed:result.passed&&result.blendedEdges>25,blendedEdges:result.blendedEdges,foreground:result.foreground,scale:viewer.renderer.renderScale};
    };
    const checkFading=async()=>{
      if(!latest)throw new Error("Load a ring before checking its fading.");
      let baseline:ImageData|undefined,softened=0,retained=0,opacityBefore=0,opacityAfter=0;
      try {
        probe="clear";
        for(const enabled of [0,1]){
          uniforms.arRearFadeEnabled.value=enabled;await frame();await frame();
          const pixels=readCanvasPixels(canvas);
          if(!enabled){baseline=pixels;continue;}
          for(let i=3;i<pixels.data.length;i+=4){
            const before=baseline!.data[i],after=pixels.data[i];opacityBefore+=before;opacityAfter+=after;
            if(before===255&&after>0&&after<250)softened++;
            if(before===255&&after===255)retained++;
          }
        }
      }finally{uniforms.arRearFadeEnabled.value=1;probe=null;await frame();}
      const opacityRatio=opacityAfter/Math.max(1,opacityBefore);
      return {passed:softened>25&&retained>25&&opacityRatio>.1&&opacityRatio<.99,softened,retained,opacityRatio};
    };
    return {render,frame,checkOcclusion,checkProjection,checkFrameSync,checkEdges,checkFading,beforeFrame:(callback)=>{
      cameraFrame=callback;return()=>{if(cameraFrame===callback)cameraFrame=undefined;};
    },dispose:()=>{
      if(disposed)return;disposed=true;cameraFrame=undefined;viewer.removeEventListener("preFrame",updateCameraFrame);viewer.removeEventListener("preRender",applyFrame);engraving.dispose();viewer.enabled=false;viewer.dispose();maskTarget?.dispose();for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose?.();for(const env of environments)env?.dispose?.();controller.dispose();
    }};
  }catch(error){disposed=true;engraving.dispose();viewer.enabled=false;viewer.dispose();maskTarget?.dispose();for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose?.();for(const env of environments)env?.dispose?.();throw error;}
}

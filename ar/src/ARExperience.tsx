'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebGIAR } from './webgi-ar-renderer';
import { loadSelectedRing, type SelectedRing } from './selected-ring';
import { CUSTOM_DIAMOND_ENV_URL, CUSTOM_METAL_ENV_URL } from '../../src/config/viewerConfig';
import type { RingEngravingConfig } from '../../src/config/engraving';
import './globals.css';
import { ARIcon } from './ARIcon';
import { isDiamondMesh } from './ring-meshes';
import { inspectCanvasTransparency, readCanvasPixels } from './render-validation';
import { replayRecordedHand } from './occlusion-replay';
import { handMaskPose } from './occlusion-pose';
import { placeFingerOccluder as placeRingOccluder } from './finger-occluder';
import type { HandLandmarker } from '@mediapipe/tasks-vision';
import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  detectionSize, solveRingPose, fitPalmMotion, skinScaleEvidence, RingPoseFilter, FingerFitFilter, RingSurfaceConstraint,
  type HandPoint, type RingPlacement as RingModelPlacement,
} from './ring-tracking';
import { SkinMotionTracker, type SkinMotion, type FlowCv } from './skin-motion';
import { findFingerSilhouette, type FingerSilhouette } from './finger-silhouette';
import { ringPixelRatio, loadOptionalEnvironment, createFallbackDiamondMaterial, createRingMetalMaterial } from './ring-runtime';
import { PatchMotionTracker, usesLightweightTracking } from './patch-motion';
import { handOcclusionSegments, handOcclusionJoints, palmOcclusionTriangles, HandOcclusionStabilizer, PALM_MASK_VERTEX_COUNT, type HandOcclusionSnapshot } from './hand-occlusion';
import contactProfile from './ring-contact-profile.json';
import { SoftRingOcclusion } from './soft-ring-occlusion';
import { RingFingerShadow } from './ring-finger-shadow';
import { HandIdentityTracker } from './hand-identity';
import { FingerStillnessTracker } from './finger-stillness';
import { enableContinuousAutofocus } from './camera-focus';
import { ringRenderViewport, cropRingCamera, type RingRenderViewport } from './ring-render-viewport';
import { FingerTrackingWindow, FINGER_TRACKING_RESOLUTION, fingerMotionToVideo } from './finger-tracking-window';

const useWebGIAR = true;
const debugMode = import.meta.env.DEV && new URLSearchParams(location.search).get('arDebug') === '1';
const replayMode = debugMode && new URLSearchParams(location.search).get('replay') === '1';
export interface ARExperienceProps { selection: SelectedRing; engraving?: RingEngravingConfig[]; onClose: () => void }
type CameraState = 'idle' | 'requesting' | 'active' | 'error';
type FacingMode = 'environment' | 'user';
type ScreenshotState = 'idle' | 'saving' | 'saved' | 'error';
type Handedness = 'Left' | 'Right';
type DetectedHand = {
  landmarks: HandPoint[];
  handedness: Handedness | null;
};
type CameraPoint = { x: number; y: number };
type FingerEdgePair = Omit<FingerSilhouette, 'width'> & {
  revision: number;
};
type RingEnvironmentAssets = {
  diamond: THREE.Texture;
  metal: THREE.Texture;
};
type OpenCvApi = FlowCv;
type OpenCvRuntime = OpenCvApi & {
  calledRun?: boolean;
  then?: unknown;
};

declare global {
  interface Window {
    cv?: OpenCvRuntime;
  }
}

const errorMessages: Record<string, string> = {
  NotAllowedError: 'Camera permission was denied.',
  NotFoundError: 'No camera was found on this device.',
  NotReadableError: 'The camera is already being used by another app.',
  SecurityError: 'Camera access requires a secure HTTPS connection.',
  AbortError: 'The camera could not start. Close other camera apps and try again.',
  InvalidStateError: 'Open this page directly in Safari and try again.',
};
const HAND_MODEL_INPUT_SIZE = 640;
// Point 13 is closer to the palm and point 14 is closer to the fingertip.
// Keep the ring a little closer to the palm while using the same position
// for the edge measurement that controls its size.
const FINGER_EDGE_CROSS_POSITION = 0.53;
// Measured from LR1844's metal-band vertices: inner width 1.91 / outer width
// 2.407. Scaling with the true opening makes the inside edges meet the
// detected finger edges instead of leaving the band slightly undersized.
const LR1844_INNER_TO_OUTER_DIAMETER = 0.797;
// A small contact inset seats the rounded inner shoulders against the skin.
// Apply only to the jewelry: the measured finger and depth mask stay full size.
const RING_CONTACT_FIT_RATIO = 0.97;
const RING_CAMERA_DISTANCE = 4;
const RING_WORLD_HEIGHT = 2;

async function loadAREnvironment(url: string) {
  const texture = await new EXRLoader().loadAsync(url);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}


function disposeModelResources(model: THREE.Object3D | null) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  model?.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}

function placeRingContactShadow(
  shadow: THREE.Mesh,
  x: number,
  y: number,
  orientation: THREE.Quaternion,
  width: number,
  surfaceFacing: number,
) {
  shadow.visible = true;
  shadow.position.set(x, y, 0);
  shadow.quaternion.copy(orientation);
  // Wrap contact darkening around the same surface as the depth mask.
  // A plane at the bone center projected away from the band when pitched.
  shadow.scale.set(width * 0.502, width * contactProfile.heightRatio * RING_CONTACT_FIT_RATIO, width * 0.502);

  const material = shadow.material;
  if (material instanceof THREE.ShaderMaterial) {
    material.uniforms.opacity.value = THREE.MathUtils.lerp(
      0.22,
      0.32,
      surfaceFacing,
    );
  }
}


export default function ARExperience({ selection, engraving = [], onClose }: ARExperienceProps) {
  // A camera session uses the exact design selected when it was opened.
  const selectionRef = useRef(selection);
  const engravingRef = useRef(engraving);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const ringCanvasRef = useRef<HTMLCanvasElement>(null);
  const webgiCanvasRef = useRef<HTMLCanvasElement>(null);
  const webgiRendererRef = useRef<WebGIAR | null>(null);
  const webgiCameraClockRef = useRef<(()=>void)|null>(null);
  const webgiLoadAbortRef = useRef<AbortController | null>(null);
  const pointsCanvasRef = useRef<HTMLCanvasElement>(null);
  const ringRendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const ringSafeShaderRef = useRef(false);
  const ringRenderViewportRef = useRef<RingRenderViewport | undefined>(undefined);
  const ringSceneRef = useRef<THREE.Scene | null>(null);
  const ringCameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const ringGroupRef = useRef<THREE.Group | null>(null);
  const latestRingPlacementRef = useRef<RingModelPlacement | null>(null);
  const fingerWindowRef = useRef(new FingerTrackingWindow());
  const handMaskStabilizerRef = useRef(new HandOcclusionStabilizer());
  const ringOccluderRef = useRef<THREE.Mesh | null>(null);
  const ringContactShadowRef = useRef<THREE.Mesh | null>(null);
  const ringFingerShadowRef = useRef<RingFingerShadow | null>(null);
  const handOccluderRef = useRef<THREE.Group | null>(null);
  const handOcclusionPointsRef = useRef<HandOcclusionSnapshot | null>(null);
  const handMaskRawPoseRef = useRef<RingModelPlacement | null>(null);
  const fingerProjectionRef = useRef<{ renderedWidth: number; renderedHeight: number; offsetX: number; offsetY: number; mode: FacingMode } | null>(null);
  const ringModelPromiseRef = useRef<Promise<THREE.Group> | null>(null);
  const ringModelRef = useRef<THREE.Group | null>(null);
  const ringLoadFailedRef = useRef(false);
  const ringContextLostRef = useRef(false);
  const ringShaderFailedRef = useRef(false);
  const resourceGenerationRef = useRef(0);
  const ringEnvironmentRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const ringEnvironmentAssetsRef = useRef<RingEnvironmentAssets | null>(null);
  const ringEnvironmentAssetsPromiseRef =
    useRef<Promise<RingEnvironmentAssets> | null>(null);
  const ringDiamondMaterialsRef = useRef<THREE.ShaderMaterial[]>([]);
  const ringDiamondBvhsRef = useRef<Set<{ dispose: () => void }>>(new Set());
  const modelEnabledRef = useRef(true);
  const ringPoseFilterRef = useRef(new RingPoseFilter());
  const fingerFitFilterRef = useRef(new FingerFitFilter());
  const ringSurfaceRef = useRef(new RingSurfaceConstraint());
  const trackingSnapshotRef = useRef<Record<string, unknown> | null>(null);
  const trackingTraceRef = useRef<number[][]>([]);
  const handDetectionRef = useRef<{ label: Handedness | null; score: number; accepted: Handedness | null; pending: boolean; reset: boolean; time: number } | null>(null);
  const skinMotionRef = useRef(new SkinMotionTracker());
  const fingerStillnessRef = useRef(new FingerStillnessTracker());
  const patchMotionRef = useRef(new PatchMotionTracker());
  const flowCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraRequestRef = useRef(0);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const handLandmarkerPromiseRef = useRef<Promise<HandLandmarker> | null>(null);
  const openCvRef = useRef<OpenCvApi | null>(null);
  const openCvPromiseRef = useRef<Promise<OpenCvApi> | null>(null);
  const handDetectionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sobelFingerEdgesRef = useRef<FingerEdgePair | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const lastDetectionTimeRef = useRef(0);
  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const [fps, setFps] = useState(0);
  const [replayPose,setReplayPose] = useState(0);
  const [replayReady,setReplayReady] = useState(false);
  const [facingMode, setFacingMode] = useState<FacingMode>('environment');
  const [screenshotState, setScreenshotState] =
    useState<ScreenshotState>('idle');
  const [modelEnabled, setModelEnabled] = useState(true);
  const [message, setMessage] = useState('');
  const [softOcclusion] = useState(() => new SoftRingOcclusion());
  const drawRingScene = useCallback((renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => {
    const masks = [ringOccluderRef.current, handOccluderRef.current].filter((p): p is THREE.Mesh | THREE.Group => p !== null);
    if (useWebGIAR) {
      const canvas=webgiCanvasRef.current,legacy=ringCanvasRef.current;
      if (canvas&&legacy&&webgiRendererRef.current) {
        // Keep the original tracker's geometry-based finger shadow beneath
        // WebGI. Jewelry in this context writes depth and casts shadows only.
        softOcclusion.render(renderer, scene, camera, masks);
        canvas.style.left=legacy.style.left;canvas.style.top=legacy.style.top;
        webgiRendererRef.current.render({ring:ringGroupRef.current,camera:camera as THREE.OrthographicCamera,masks,width:legacy.clientWidth,height:legacy.clientHeight});
      }
      return;
    }
    softOcclusion.render(renderer, scene, camera, masks);
  }, [softOcclusion]);

  const loadRingEnvironments = useCallback(() => {
    if (!ringEnvironmentAssetsPromiseRef.current) {
      const generation = resourceGenerationRef.current;
      ringEnvironmentAssetsPromiseRef.current = Promise.allSettled([
        loadOptionalEnvironment(() => loadAREnvironment(CUSTOM_DIAMOND_ENV_URL)),
        loadOptionalEnvironment(() => loadAREnvironment(CUSTOM_METAL_ENV_URL)),
      ])
        .then(([diamondResult, metalResult]) => {
          if (
            generation !== resourceGenerationRef.current ||
            diamondResult.status === 'rejected' ||
            metalResult.status === 'rejected'
          ) {
            if (diamondResult.status === 'fulfilled') diamondResult.value.dispose();
            if (metalResult.status === 'fulfilled') metalResult.value.dispose();
            if (diamondResult.status === 'rejected') throw diamondResult.reason;
            if (metalResult.status === 'rejected') throw metalResult.reason;
            throw new DOMException('Environment load was cancelled.', 'AbortError');
          }
          const diamond = diamondResult.value;
          const metal = metalResult.value;
          diamond.mapping = THREE.EquirectangularReflectionMapping;
          diamond.wrapS = THREE.RepeatWrapping;
          diamond.wrapT = THREE.ClampToEdgeWrapping;
          // Half-float EXRs support linear filtering; keep the fallback's
          // nearest filtering on devices without float-linear support.
          if (diamond.type === THREE.HalfFloatType) {
            diamond.minFilter = THREE.LinearFilter;
            diamond.magFilter = THREE.LinearFilter;
          }
          diamond.generateMipmaps = false;
          diamond.needsUpdate = true;

          const assets = { diamond, metal };
          ringEnvironmentAssetsRef.current = assets;
          return assets;
        })
        .catch((error) => {
          if (generation === resourceGenerationRef.current) {
            ringEnvironmentAssetsPromiseRef.current = null;
          }
          throw error;
        });
    }

    return ringEnvironmentAssetsPromiseRef.current;
  }, []);

  const loadRingModel = useCallback(() => {
    if (!ringModelPromiseRef.current) {
      const generation = resourceGenerationRef.current;
      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath('/ar/runtime/draco/');
      const loader = new GLTFLoader();
      loader.setDRACOLoader(dracoLoader);

      const gltfPromise = Promise.resolve().then(() => loadSelectedRing(loader, selectionRef.current))
        .finally(() => dracoLoader.dispose());

      ringModelPromiseRef.current = Promise.allSettled([
        gltfPromise,
        loadRingEnvironments(),
      ])
        .then(async ([gltfResult, environmentResult]) => {
          if (
            generation !== resourceGenerationRef.current ||
            gltfResult.status === 'rejected' ||
            environmentResult.status === 'rejected'
          ) {
            if (gltfResult.status === 'fulfilled') {
              disposeModelResources(gltfResult.value.scene);
            }
            if (gltfResult.status === 'rejected') throw gltfResult.reason;
            if (environmentResult.status === 'rejected') throw environmentResult.reason;
            throw new DOMException('Ring load was cancelled.', 'AbortError');
          }
          const gltf = gltfResult.value;
          const model = new THREE.Group();
          ringModelRef.current = model;
          model.add(gltf.scene);
          model.updateMatrixWorld(true);

          const bounds = new THREE.Box3().setFromObject(model);
          const center = bounds.getCenter(new THREE.Vector3());
          // Center only in screen space. The CAD origin is the band/cylinder
          // center on z; centering the full bounds on z shifts it toward the
          // raised setting and breaks front/back depth occlusion.
          if (!gltf.scene.userData.assembled) gltf.scene.position.x -= center.x;
          if (!gltf.scene.userData.assembled) gltf.scene.position.y -= center.y;
          model.updateMatrixWorld(true);

          const centeredBounds = new THREE.Box3().setFromObject(model);
          const size = centeredBounds.getSize(new THREE.Vector3());
          // LR1844's x-axis is the band diameter in its side-on AR pose.
          // Measuring vertices here also captures the stone setting, which made
          // the ring nearly three times too large. Use the band's CAD ratio so
          // the inner opening, rather than the setting, fits the finger edges.
          model.userData.innerDiameter = Math.max(
            gltf.scene.userData.innerDiameter || size.x * LR1844_INNER_TO_OUTER_DIAMETER,
            0.001,
          );

          const metalMaterial = createRingMetalMaterial();
          const selectedMetalMaterials = new Map<string, THREE.MeshPhysicalMaterial>();
          const diamondMaterials: THREE.ShaderMaterial[] = [];
          const diamondBvhs = new Set<{ dispose: () => void }>();
          // Register ownership before processing so a partial failure can clean up.
          ringDiamondMaterialsRef.current = diamondMaterials;
          ringDiamondBvhsRef.current = diamondBvhs;
          const supersededMaterials = new Set<THREE.Material>();
          let usesMetalMaterial = false;

          model.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            // Keep every jewelry section above the skin's contact shadow.
            // Equal transparent render orders let the shadow sort between the
            // two band halves, darkening only one half as the hand turned.
            object.renderOrder = 1;

            object.castShadow = true;
            object.receiveShadow = true;
            const materials = Array.isArray(object.material)
              ? object.material
              : [object.material];
            const materialLabel = [
              object.name,
              ...materials.map((material) => material.name),
            ]
              .join(' ')
              .toLowerCase();

            // Jewelry is shaded exclusively by the shared WebGI renderer.
            // This Three.js scene supplies tracking geometry and skin shadow.
            if (isDiamondMesh(object)) return;

            if (object.userData.arMetalHex || /\b(metal|gold|silver|platinum)\b/.test(materialLabel)) {
              for (const material of materials) {
                supersededMaterials.add(material);
              }
              if (object.userData.arMetalHex) {
                const color = object.userData.arMetalHex as string;
                if (!selectedMetalMaterials.has(color)) { const material = createRingMetalMaterial(); material.color.set(color); material.roughness = 0.12; selectedMetalMaterials.set(color, material); }
                object.material = selectedMetalMaterials.get(color)!;
              } else object.material = metalMaterial;
              usesMetalMaterial = true;
              return;
            }

            for (const material of materials) {
              // Keep any unclassified thin/open CAD surfaces visible when the
              // model turns over for a palm-facing hand.
              material.side = THREE.DoubleSide;
              material.transparent = true;
              material.depthWrite = true;
            }
          });

          const retainedMaterials = new Set<THREE.Material>();
          model.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            const materials = Array.isArray(object.material)
              ? object.material
              : [object.material];
            for (const material of materials) retainedMaterials.add(material);
          });
          for (const material of supersededMaterials) {
            if (!retainedMaterials.has(material)) material.dispose();
          }
          if (!usesMetalMaterial || !retainedMaterials.has(metalMaterial)) metalMaterial.dispose();
          if (useWebGIAR) for (const material of retainedMaterials) material.colorWrite = false;
          else for (const material of retainedMaterials) softOcclusion.install(material);

          ringDiamondMaterialsRef.current = diamondMaterials;
          ringDiamondBvhsRef.current = diamondBvhs;
          if (useWebGIAR) {
            const canvas=webgiCanvasRef.current;if(!canvas)throw new Error('WebGI AR canvas is unavailable.');
            const abort=new AbortController();webgiLoadAbortRef.current=abort;
            const {createWebGIAR}=await import('./webgi-ar-renderer');
            const bridge=await createWebGIAR(canvas,model,abort.signal,engravingRef.current);
            if(generation!==resourceGenerationRef.current){bridge.dispose();throw new DOMException('AR loading cancelled.','AbortError');}
            webgiRendererRef.current=bridge;
          }
          return model;
        })
        .catch((error) => {
          if (generation === resourceGenerationRef.current) {
            disposeModelResources(ringModelRef.current);
            ringModelRef.current = null;
            for (const bvh of ringDiamondBvhsRef.current) bvh.dispose();
            ringDiamondBvhsRef.current.clear();
            ringDiamondMaterialsRef.current = [];
            ringModelPromiseRef.current = null;
            ringLoadFailedRef.current = true;
          }
          throw error;
        });
    }

    return ringModelPromiseRef.current;
  }, [loadRingEnvironments, softOcclusion]);

  const disposeRingModel = useCallback(() => {
    webgiLoadAbortRef.current?.abort();webgiLoadAbortRef.current=null;webgiRendererRef.current?.dispose();webgiRendererRef.current=null;
    softOcclusion.dispose();
    resourceGenerationRef.current += 1;
    // Preloaded models also own resources before they are added to the scene.
    disposeModelResources(ringModelRef.current);
    ringModelRef.current = null;
    for (const bvh of ringDiamondBvhsRef.current) bvh.dispose();
    ringDiamondBvhsRef.current.clear();
    ringDiamondMaterialsRef.current = [];
    ringOccluderRef.current?.geometry.dispose();
    const occluderMaterial = ringOccluderRef.current?.material;
    if (Array.isArray(occluderMaterial)) {
      for (const material of occluderMaterial) material.dispose();
    } else {
      occluderMaterial?.dispose();
    }
    ringContactShadowRef.current?.geometry.dispose();
    ringFingerShadowRef.current?.dispose();
    ringFingerShadowRef.current = null;
    const contactShadowMaterial = ringContactShadowRef.current?.material;
    if (contactShadowMaterial instanceof THREE.ShaderMaterial) {
      contactShadowMaterial.uniforms.contactMap.value.dispose();
    }
    disposeModelResources(handOccluderRef.current);
    handOccluderRef.current = null;
    handOcclusionPointsRef.current = null;
    if (Array.isArray(contactShadowMaterial)) {
      for (const material of contactShadowMaterial) material.dispose();
    } else {
      contactShadowMaterial?.dispose();
    }
    ringEnvironmentRef.current?.dispose();
    ringEnvironmentAssetsRef.current?.diamond.dispose();
    ringEnvironmentAssetsRef.current?.metal.dispose();
    ringRendererRef.current?.dispose();
    ringGroupRef.current = null;
    ringOccluderRef.current = null;
    ringContactShadowRef.current = null;
    ringRendererRef.current = null;
    ringRenderViewportRef.current = undefined;
    ringSceneRef.current = null;
    ringCameraRef.current = null;
    ringEnvironmentRef.current = null;
    ringEnvironmentAssetsRef.current = null;
    ringEnvironmentAssetsPromiseRef.current = null;
    ringModelPromiseRef.current = null;
  }, [softOcclusion]);

  const renderRingModel = useCallback(
    function renderLoadedRing(placement: RingModelPlacement | null): void {
      latestRingPlacementRef.current = placement;
      const canvas = ringCanvasRef.current;
      if (!canvas || ringContextLostRef.current) return;

      let renderer = ringRendererRef.current;
      let scene = ringSceneRef.current;
      let camera = ringCameraRef.current;
      const ring = ringGroupRef.current;
      let occluder = ringOccluderRef.current;
      const contactShadow = ringContactShadowRef.current;

      if (!placement || !modelEnabledRef.current) {
        if (renderer && scene && camera) {
          if (ring) ring.visible = false;
          if (occluder) occluder.visible = false;
          if (contactShadow) contactShadow.visible = false;
          ringFingerShadowRef.current?.hide();
          if (handOccluderRef.current) handOccluderRef.current.visible = false;
          drawRingScene(renderer, scene, camera);
        }
        return;
      }

      const width = pointsCanvasRef.current?.clientWidth ?? 0;
      const height = pointsCanvasRef.current?.clientHeight ?? 0;
      if (!width || !height) return;

      if (!renderer || !scene || !camera) {
        renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: true,
          // Screenshots explicitly redraw below; do not retain an extra
          // full-screen drawing buffer throughout the live camera session.
          preserveDrawingBuffer: false,
          powerPreference: 'high-performance',
        });
        renderer.setClearColor(0x000000, 0);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
          console.error('Ring shader failed.', gl.getProgramInfoLog(program),
            gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment));
          ringShaderFailedRef.current = true;
        };

        scene = new THREE.Scene();
        // The video landmarks already contain perspective. An orthographic
        // overlay avoids adding a second off-axis camera projection that made
        // the raised stone slide as the hand crossed the screen.
        camera = new THREE.OrthographicCamera(
          -width / height,
          width / height,
          1,
          -1,
          0.1,
          100,
        );
        camera.position.set(0, 0, RING_CAMERA_DISTANCE);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();

        const environmentGenerator = new THREE.PMREMGenerator(renderer);
        // The HDR is normally ready from page preload. Use it immediately
        // instead of compiling a room map and then generating a second map.
        const initialMetalEnvironment = ringEnvironmentAssetsRef.current?.metal;
        let environment: THREE.WebGLRenderTarget;
        if (initialMetalEnvironment) {
          environment = environmentGenerator.fromEquirectangular(initialMetalEnvironment);
        } else {
          const roomEnvironment = new RoomEnvironment();
          environment = environmentGenerator.fromScene(roomEnvironment, 0.04);
          roomEnvironment.dispose();
        }
        scene.environment = environment.texture;
        environmentGenerator.dispose();
        ringEnvironmentRef.current = environment;

        scene.add(new THREE.HemisphereLight(0xffffff, 0x4d2d10, 2.5));
        const keyLight = new THREE.DirectionalLight(0xfff2d5, 4.5);
        keyLight.position.set(-1, -2, 4);
        scene.add(keyLight);
        scene.add(keyLight.target);
        const fingerShadow = new RingFingerShadow(512);
        softOcclusion.install(fingerShadow.receiver.material, false);
        scene.add(fingerShadow.receiver);
        scene.add(fingerShadow.light, fingerShadow.light.target);
        ringFingerShadowRef.current = fingerShadow;
        const rimLight = new THREE.DirectionalLight(0xffd38a, 2.4);
        rimLight.position.set(2, 1, 2);
        scene.add(rimLight);

        // A solid depth mask keeps hidden metal hidden as the hand moves.
        // Screen-space dithering made grazing band edges appear/disappear.
        const occlusionMaterial = new THREE.MeshBasicMaterial({
          colorWrite: false,
          depthTest: true,
          depthWrite: true,
        });
        occluder = new THREE.Mesh(
          new THREE.CylinderGeometry(1, 1, 1, 64, 1, false),
          occlusionMaterial,
        );
        occluder.renderOrder = -100;
        occluder.frustumCulled = false;
        scene.add(occluder);

        const handOccluder = new THREE.Group();
        const fingerGeometry = new THREE.CylinderGeometry(1, 1, 1, 32, 1, false);
        const fingerMaterial = occlusionMaterial.clone();
        for (let i = 0; i < 14; i++) {
          const finger = new THREE.Mesh(fingerGeometry, fingerMaterial);
          finger.renderOrder = -99;
          finger.frustumCulled = false;
          handOccluder.add(finger);
        }
        const joints = new THREE.Group(); joints.name = 'finger-joints';
        const jointGeometry = new THREE.SphereGeometry(1, 20, 12);
        for (let i = 0; i < 21; i++) {
          const joint = new THREE.Mesh(jointGeometry, fingerMaterial);
          joint.renderOrder = -99; joint.frustumCulled = false; joints.add(joint);
        }
        handOccluder.add(joints);
        const palmGeometry = new THREE.BufferGeometry();
        palmGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PALM_MASK_VERTEX_COUNT * 3), 3));
        const palmMaterial = occlusionMaterial.clone();
        palmMaterial.side = THREE.DoubleSide;
        const palmMask = new THREE.Mesh(palmGeometry, palmMaterial);
        palmMask.name = 'palm-depth';
        palmMask.frustumCulled = false;
        palmMask.renderOrder = -99;
        handOccluder.add(palmMask);
        scene.add(handOccluder);
        handOccluderRef.current = handOccluder;

        const contactMap = new THREE.DataTexture(Uint8Array.from(contactProfile.data),
          contactProfile.width, contactProfile.height, THREE.RedFormat, THREE.UnsignedByteType);
        contactMap.wrapS = THREE.RepeatWrapping;
        contactMap.minFilter = THREE.LinearFilter;
        contactMap.magFilter = THREE.LinearFilter;
        contactMap.needsUpdate = true;

        const contactShadowMaterial = new THREE.ShaderMaterial({
          transparent: true,
          depthTest: true,
          depthWrite: false,
          side: THREE.FrontSide,
          uniforms: { opacity: { value: 0.32 }, contactMap: { value: contactMap } },
          vertexShader: `
            varying vec2 vUv;
            varying vec3 vViewNormal;
            void main() {
              vUv = uv;
              vViewNormal = normalize(normalMatrix * normal);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            precision highp float;
            uniform float opacity;
            uniform sampler2D contactMap;
            varying vec2 vUv;
            varying vec3 vViewNormal;
            void main() {
              float contact = texture2D(contactMap, vUv).r;
              float facing = smoothstep(0.08, 0.35, normalize(vViewNormal).z);
              gl_FragColor = vec4(0.0, 0.0, 0.0, opacity * contact * facing);
            }
          `,
        });
        const contactShadow = new THREE.Mesh(
          new THREE.CylinderGeometry(1, 1, 1, 64, 1, true),
          contactShadowMaterial,
        );
        softOcclusion.install(contactShadowMaterial, false);
        contactShadow.renderOrder = 0;
        contactShadow.frustumCulled = false;
        scene.add(contactShadow);

        ringRendererRef.current = renderer;
        ringSceneRef.current = scene;
        ringCameraRef.current = camera;
        ringOccluderRef.current = occluder;
        ringContactShadowRef.current = contactShadow;

        const initializedRenderer = renderer;
        const initializedScene = scene;
        const initializedCamera = camera;
        void loadRingEnvironments()
          .then(({ metal }) => {
            if (
              ringRendererRef.current !== initializedRenderer ||
              ringSceneRef.current !== initializedScene || initialMetalEnvironment === metal
            ) {
              return;
            }

            const metalEnvironmentGenerator = new THREE.PMREMGenerator(
              initializedRenderer,
            );
            metalEnvironmentGenerator.compileEquirectangularShader();
            const metalEnvironment =
              metalEnvironmentGenerator.fromEquirectangular(metal);
            metalEnvironmentGenerator.dispose();

            const previousEnvironment = ringEnvironmentRef.current;
            initializedScene.environment = metalEnvironment.texture;
            ringEnvironmentRef.current = metalEnvironment;
            previousEnvironment?.dispose();

            for (const material of ringDiamondMaterialsRef.current) {
              const cameraPosition = material.uniforms.cameraPos?.value;
              if (cameraPosition instanceof THREE.Vector3) {
                cameraPosition.copy(initializedCamera.position);
              }
            }
            drawRingScene(initializedRenderer, initializedScene, initializedCamera);
          })
          .catch((error) => {
            console.error('Unable to load the ring environment maps.', error);
          });
      }

      const pixelRatio = ringPixelRatio(window.devicePixelRatio);

      if (!ring) {
        if (ringLoadFailedRef.current) return;
        const loadingScene = scene;
        void loadRingModel()
          .then((model) => {
            if (ringSceneRef.current !== loadingScene || ringGroupRef.current) return;

            const group = new THREE.Group();
            group.renderOrder = 1;
            group.visible = false;
            group.add(model);
            ringSceneRef.current.add(group);
            ringGroupRef.current = group;
            // Do not wait for another slow inference frame once loading is
            // complete. Use the latest pose, including null after camera stop.
            renderLoadedRing(latestRingPlacementRef.current);
          })
          .catch((error) => {
            if (ringSceneRef.current !== loadingScene) return;
            console.error('Unable to load the selected ring.', error);
            setMessage('Your ring could not load. Go back and open try-on again.');
          });
        return;
      }

      if (ringShaderFailedRef.current) {
        ringShaderFailedRef.current = false;
        const shaders = new Set(ringDiamondMaterialsRef.current);
        const fallback = createFallbackDiamondMaterial();
        softOcclusion.install(fallback);
        let replaced = false;
        ring.traverse(object => {
          if (object instanceof THREE.Mesh && shaders.has(object.material)) {
            object.material = fallback;
            replaced = true;
          }
        });
        if (!replaced) fallback.dispose();
        for (const material of shaders) material.dispose();
        ringDiamondMaterialsRef.current = [];
        for (const bvh of ringDiamondBvhsRef.current) bvh.dispose();
        ringDiamondBvhsRef.current.clear();
      }

      const worldUnitsPerPixel = RING_WORLD_HEIGHT / height;
      const worldX = (placement.x - width / 2) * worldUnitsPerPixel;
      const worldY = (height / 2 - placement.y) * worldUnitsPerPixel;
      const worldWidth = placement.width * worldUnitsPerPixel;

      ring.visible = true;
      if (occluder) {
        placeRingOccluder(
          occluder,
          worldX,
          worldY,
          placement.orientation,
          worldWidth,
        );
      }
      if (contactShadow) {
        placeRingContactShadow(
          contactShadow,
          worldX,
          worldY,
          placement.orientation,
          worldWidth,
          placement.surfaceFacing,
        );
      }
      ring.position.set(worldX, worldY, 0);
      ring.quaternion.copy(placement.orientation);
      const model = ring.children[0];
      // All pose rotation belongs to the ring group so the model, depth mask,
      // and shadow use one hand-locked coordinate frame.
      model?.rotation.set(0, 0, 0, 'XYZ');
      const innerDiameter =
        typeof model?.userData.innerDiameter === 'number'
          ? model.userData.innerDiameter
          : 1;
      ring.scale.setScalar(worldWidth * RING_CONTACT_FIT_RATIO / innerDiameter);
      if (ringModelRef.current?.children[0]?.userData.assembled && contactShadow) contactShadow.visible = false;
      ringFingerShadowRef.current?.update(worldX, worldY, placement.orientation, worldWidth);
      const handMask = handOccluderRef.current;
      const handPoints = handOcclusionPointsRef.current;
      const maskPose = handMaskRawPoseRef.current ?? placement;
      if (handMask) {
        handMask.visible = !!handPoints;
        handMask.matrixAutoUpdate = false;
        handMask.matrix.copy(handMaskPose(maskPose, placement, width, height));
        handMask.matrixWorldNeedsUpdate = true;
        const segments = handPoints ? handOcclusionSegments(handPoints.landmarks, handPoints.screen, maskPose) : [];
        const joints = handOcclusionJoints(segments);
        handMask.children.forEach((mesh, i) => {
          if (mesh.name === 'finger-joints') {
            mesh.children.forEach((joint, index) => {
              const data = joints[index]; joint.visible = !!data;
              if (!data) return;
              joint.position.set((data.position.x - width / 2) * worldUnitsPerPixel,
                (data.position.y + height / 2) * worldUnitsPerPixel, data.position.z * worldUnitsPerPixel);
              joint.scale.setScalar(data.radius * worldUnitsPerPixel);
            });
            return;
          }
          if (mesh.name === 'palm-depth') {
            const points = handPoints ? palmOcclusionTriangles(handPoints.landmarks, handPoints.screen, maskPose) : [];
            mesh.visible = points.length === PALM_MASK_VERTEX_COUNT;
            if (!mesh.visible) return;
            const positions = (mesh as THREE.Mesh).geometry.getAttribute('position') as THREE.BufferAttribute;
            points.forEach((p, vertex) => positions.setXYZ(vertex, (p.x - width / 2) * worldUnitsPerPixel,
              (p.y + height / 2) * worldUnitsPerPixel, p.z * worldUnitsPerPixel));
            positions.needsUpdate = true;
            return;
          }
          const segment = segments[i];
          mesh.visible = !!segment;
          if (!segment) return;
          const middle = segment.a.clone().add(segment.b).multiplyScalar(0.5);
          mesh.position.set((middle.x - width / 2) * worldUnitsPerPixel,
            (middle.y + height / 2) * worldUnitsPerPixel, middle.z * worldUnitsPerPixel);
          const direction = segment.b.clone().sub(segment.a);
          const length = direction.length();
          if (length < 1) { mesh.visible = false; return; }
          mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
          mesh.scale.set(segment.radius * worldUnitsPerPixel,
            length * worldUnitsPerPixel, segment.radius * worldUnitsPerPixel);
        });
      }
      for (const material of ringDiamondMaterialsRef.current) {
        const cameraPosition = material.uniforms.cameraPos?.value;
        if (cameraPosition instanceof THREE.Vector3) {
          cameraPosition.copy(camera.position);
        }
      }
      ring.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(ring);
      const receiver = ringFingerShadowRef.current?.receiver;
      if (receiver) bounds.union(new THREE.Box3().setFromObject(receiver));
      if (contactShadow) bounds.union(new THREE.Box3().setFromObject(contactShadow));
      const viewport = ringRenderViewport(bounds, width, height, ringRenderViewportRef.current);
      ringRenderViewportRef.current = viewport;
      canvas.style.left = `${viewport.x}px`;
      canvas.style.top = `${viewport.y}px`;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      if (renderer.getPixelRatio() !== pixelRatio || canvas.width !== Math.floor(viewport.width * pixelRatio)
        || canvas.height !== Math.floor(viewport.height * pixelRatio)) {
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(viewport.width, viewport.height, false);
      }
      cropRingCamera(camera, viewport, width, height);
      softOcclusion.update(new THREE.Vector3(worldX, worldY, 0),
        new THREE.Vector3(0, 1, 0).applyQuaternion(placement.orientation),
        worldWidth, placement.width * pixelRatio, camera);
      drawRingScene(renderer, scene, camera);
    },
    [loadRingEnvironments, loadRingModel, drawRingScene, softOcclusion],
  );

  const clearPoints = useCallback(() => {
    const canvas = pointsCanvasRef.current;
    const context = canvas?.getContext('2d');

    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  const clearSobelOverlay = useCallback(() => {
    sobelFingerEdgesRef.current = null;
  }, []);


  const stopHandTracking = useCallback(() => {
    webgiCameraClockRef.current?.();
    webgiCameraClockRef.current = null;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const preview = previewCanvasRef.current;
    preview?.getContext('2d')?.clearRect(0, 0, preview.width, preview.height);
    lastVideoTimeRef.current = -1;
    lastDetectionTimeRef.current = 0;
    handDetectionRef.current = null;
    setFps(0);
    ringPoseFilterRef.current.reset();
    fingerProjectionRef.current = null;
    fingerFitFilterRef.current.reset();
    ringSurfaceRef.current.reset();
    skinMotionRef.current.reset();
    patchMotionRef.current.reset();
    fingerStillnessRef.current.reset();
    fingerWindowRef.current.reset();
    handMaskStabilizerRef.current.reset();
    clearPoints();
    clearSobelOverlay();
    renderRingModel(null);
  }, [clearPoints, clearSobelOverlay, renderRingModel]);

  const getHandLandmarker = useCallback(() => {
    if (!handLandmarkerPromiseRef.current) {
      const generation = resourceGenerationRef.current;
      handLandmarkerPromiseRef.current = (async () => {
        const { FilesetResolver, HandLandmarker } = await import(
          '@mediapipe/tasks-vision'
        );
        const vision = await FilesetResolver.forVisionTasks('/ar/runtime/mediapipe/wasm');
        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/ar/runtime/mediapipe/models/hand_landmarker.task',
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.65,
          minHandPresenceConfidence: 0.65,
          minTrackingConfidence: 0.6,
        });

        if (generation !== resourceGenerationRef.current) {
          landmarker.close();
          throw new DOMException('Hand tracking load was cancelled.', 'AbortError');
        }
        handLandmarkerRef.current = landmarker;
        return landmarker;
      })().catch((error) => {
        if (generation === resourceGenerationRef.current) {
          handLandmarkerPromiseRef.current = null;
        }
        throw error;
      });
    }

    return handLandmarkerPromiseRef.current;
  }, []);

  const getOpenCv = useCallback(() => {
    if (!openCvPromiseRef.current) {
      const generation = resourceGenerationRef.current;
      openCvPromiseRef.current = new Promise<OpenCvApi>((resolve, reject) => {
        const existingScript = document.querySelector<HTMLScriptElement>(
          'script[data-opencv-runtime]',
        );
        const script = existingScript ?? document.createElement('script');
        let timer: number | undefined;
        const cleanup = () => {
          window.clearTimeout(timer);
          script.removeEventListener('error', handleError);
        };
        const handleError = () => {
          cleanup();
          // A failed script must be removed so a later attempt can fetch it.
          script.remove();
          reject(new Error('Unable to load OpenCV.'));
        };
        const startedAt = performance.now();
        const checkRuntime = () => {
          const runtime = window.cv;
          if (generation !== resourceGenerationRef.current) {
            cleanup();
            reject(new DOMException('OpenCV load was cancelled.', 'AbortError'));
            return;
          }
          if (runtime?.calledRun && typeof runtime.Mat === 'function') {
            cleanup();
            delete runtime.then;
            resolve(runtime);
            return;
          }
          if (performance.now() - startedAt >= 30000) {
            handleError();
            return;
          }
          timer = window.setTimeout(checkRuntime, 25);
        };
        script.addEventListener('error', handleError, { once: true });
        if (!existingScript && !window.cv) {
          script.src = '/ar/runtime/opencv/opencv.js';
          script.async = true;
          script.dataset.opencvRuntime = 'true';
          document.head.appendChild(script);
        }
        // Poll immediately: a reused script may already have fired its load event.
        checkRuntime();
      })
        .then((openCv) => {
          if (generation === resourceGenerationRef.current) openCvRef.current = openCv;
          return openCv;
        })
        .catch((error) => {
          if (generation === resourceGenerationRef.current) openCvPromiseRef.current = null;
          throw error;
        });
    }

    return openCvPromiseRef.current;
  }, []);

  const updateHorizontalSobel = useCallback(
    (source: HTMLCanvasElement, landmarks: HandPoint[] | null) => {
      if (!landmarks?.[14] || !source.width || !source.height) {
        sobelFingerEdgesRef.current = null;
        return;
      }

      // Read the exact captured frame used for landmarks and optical flow.
      // Reading the live video again could measure a later, already moved hand.
      const size = { width: source.width, height: source.height };
      const context = source.getContext('2d');
      if (!context) return;
      const point = (i: number) => ({ x: landmarks[i].x * size.width, y: landmarks[i].y * size.height });
      const fittedWidth = ringPoseFilterRef.current.current()?.width;
      const projectedWidth = fingerProjectionRef.current?.renderedWidth;
      // Compare actual edges with the last fitted diameter in this captured
      // image's coordinates. Use the pose's projection, including during resize.
      const calibrated = fittedWidth && projectedWidth && projectedWidth > 0
        ? { width: fittedWidth / projectedWidth * size.width } : undefined;
      const edges = findFingerSilhouette(
        context.getImageData(0, 0, size.width, size.height),
        point(13), point(14),
        [{ base: point(9), tip: point(10) }, { base: point(17), tip: point(18) }],
        FINGER_EDGE_CROSS_POSITION,
        calibrated,
      );
      const normalize = (p: CameraPoint) => ({ x: p.x / size.width, y: p.y / size.height });
      sobelFingerEdgesRef.current = edges ? {
        ...edges, left: normalize(edges.left), right: normalize(edges.right), revision: performance.now(),
        sections: edges.sections.map(section => ({ left: normalize(section.left), right: normalize(section.right) })),
      } : null;
    }, [],
  );

  const drawPoints = useCallback(
    (hands: DetectedHand[], mode: FacingMode, imageMotion?: SkinMotion | null, imageStill = false, imagePoseStable = false) => {
      const canvas = pointsCanvasRef.current;
      const video = videoRef.current;

      if (!canvas || !video || !video.videoWidth || !video.videoHeight) {
        return;
      }

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const pixelRatio = ringPixelRatio(window.devicePixelRatio);
      const targetWidth = Math.round(width * pixelRatio);
      const targetHeight = Math.round(height * pixelRatio);

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      const context = canvas.getContext('2d');
      if (!context) return;

      if (video.style.transform) {
        video.style.removeProperty('transform');
      }

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);

      const scale = Math.max(
        width / video.videoWidth,
        height / video.videoHeight,
      );
      const renderedWidth = video.videoWidth * scale;
      const renderedHeight = video.videoHeight * scale;
      const offsetX = (width - renderedWidth) / 2;
      const offsetY = (height - renderedHeight) / 2;
      const previousProjection = fingerProjectionRef.current;
      if (previousProjection && (previousProjection.renderedWidth !== renderedWidth
        || previousProjection.renderedHeight !== renderedHeight || previousProjection.offsetX !== offsetX
        || previousProjection.offsetY !== offsetY || previousProjection.mode !== mode)) {
        const factor = renderedWidth / previousProjection.renderedWidth;
        const uniform = Math.abs(renderedHeight / previousProjection.renderedHeight - factor) < 0.001;
        if (uniform && previousProjection.mode === mode) {
          fingerFitFilterRef.current.reproject(p => ({
            x: offsetX + (p.x - previousProjection.offsetX) * factor,
            y: offsetY + (p.y - previousProjection.offsetY) * factor,
          }), factor);
        } else fingerFitFilterRef.current.reset();
        // Pixel-space smoothing cannot retain coordinates from the old view.
        // Reproject the physical fit, then seed pose and masks in the new view.
        ringPoseFilterRef.current.reset();
        ringSurfaceRef.current.reset();
        handOcclusionPointsRef.current = null;
        imageMotion = null;
        imageStill = false;
        imagePoseStable = false;
      }
      fingerProjectionRef.current = { renderedWidth, renderedHeight, offsetX, offsetY, mode };
      let ringPlacement: RingModelPlacement | null = null;
      const previousOcclusion = handOcclusionPointsRef.current;
      handOcclusionPointsRef.current = null;

      for (const hand of hands) {
        const landmarks = hand.landmarks;

        const screenLandmarks = landmarks.map((point) => ({
          x:
            offsetX +
            (mode === 'user' ? 1 - point.x : point.x) * renderedWidth,
          y: offsetY + point.y * renderedHeight,
        }));
        const point13 = screenLandmarks[13];
        const point14 = screenLandmarks[14];
        // Ring-finger stillness does not imply that neighboring fingers are
        // stationary. Keep its attachment steady while other masks can move.

        if (!point13 || !point14) continue;


        const ringCenter = {
          x:
            point13.x +
            (point14.x - point13.x) * FINGER_EDGE_CROSS_POSITION,
          y:
            point13.y +
            (point14.y - point13.y) * FINGER_EDGE_CROSS_POSITION,
        };
        const fingerScreenX = point14.x - point13.x;
        const fingerScreenY = point14.y - point13.y;
        let perpendicularX = -fingerScreenY;
        let perpendicularY = fingerScreenX;
        const perpendicularLength = Math.hypot(
          perpendicularX,
          perpendicularY,
        );

        if (!perpendicularLength) continue;

        perpendicularX /= perpendicularLength;
        perpendicularY /= perpendicularLength;

        const surfacePose = solveRingPose(
          landmarks, screenLandmarks, hand.handedness, mode === 'user',
          ringPoseFilterRef.current.current()?.orientation,
          renderedWidth,
        );
        if (!surfacePose) continue;
        let edgeSample: { width: number; offset: number; revision: number; confidence: number; support: number } | undefined;
        const fingerEdges = sobelFingerEdgesRef.current;

        if (fingerEdges) {
          const toScreenPoint = (point: CameraPoint) => ({
            x:
              offsetX +
              (mode === 'user' ? 1 - point.x : point.x) * renderedWidth,
            y: offsetY + point.y * renderedHeight,
          });
          const detectedLeftEdge = toScreenPoint(fingerEdges.left);
          const detectedRightEdge = toScreenPoint(fingerEdges.right);
          const detectedWidth = Math.hypot(
            detectedRightEdge.x - detectedLeftEdge.x,
            detectedRightEdge.y - detectedLeftEdge.y,
          );

          if (detectedWidth && performance.now() - fingerEdges.revision < 120) {
            edgeSample = {
              width: detectedWidth,
              offset: ((detectedLeftEdge.x + detectedRightEdge.x) / 2 - ringCenter.x) * perpendicularX
                + ((detectedLeftEdge.y + detectedRightEdge.y) / 2 - ringCenter.y) * perpendicularY,
              revision: fingerEdges.revision,
              confidence: fingerEdges.confidence,
              support: fingerEdges.support,
            };
          }
        }
        const acrossAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(surfacePose.orientation);
        const centeringProjection = acrossAxis.x * perpendicularX - acrossAxis.y * perpendicularY;
        const screenMotion = imageMotion ? {
          before: imageMotion.before.map(point => ({
            x: offsetX + (mode === 'user' ? 1 - point.x : point.x) * renderedWidth,
            y: offsetY + point.y * renderedHeight,
          })),
          after: imageMotion.after.map(point => ({
            x: offsetX + (mode === 'user' ? 1 - point.x : point.x) * renderedWidth,
            y: offsetY + point.y * renderedHeight,
          })),
        } : undefined;
        const skinMagnification = screenMotion ? skinScaleEvidence(screenMotion.before, screenMotion.after) : undefined;
        const boneDepth = new THREE.Vector3(0, 1, 0).applyQuaternion(surfacePose.orientation).z;
        const fit = fingerFitFilterRef.current.update(
          surfacePose.handScale, surfacePose.facing, edgeSample, surfacePose.anchors, centeringProjection,
          { time: performance.now(), frontal: surfacePose.facing >= 0.94 && Math.abs(boneDepth) < 0.25,
            scale: skinMagnification, still: imageStill },
        );
        if (!fit) continue;
        const orientation = ringSurfaceRef.current.update(
          surfacePose.orientation, surfacePose.anchors, surfacePose.fingerLength, fit.width, surfacePose.imageDepth, surfacePose.metricOrientation,
        );
        ringPlacement = {
          x: ringCenter.x + perpendicularX * fit.offset,
          y: ringCenter.y + perpendicularY * fit.offset,
          width: fit.width,
          scaleObserved: fit.scaleObserved,
          fitRevision: fit.revision,
          edgeConfidence: edgeSample?.confidence ?? 0,
          orientation,
          surfaceFacing: Math.abs(new THREE.Vector3(0, 0, 1).applyQuaternion(orientation).z),
          anchors: surfacePose.anchors,
          fingerLength: surfacePose.fingerLength,
          fingerSegment: { base: point13, tip: point14, fraction: FINGER_EDGE_CROSS_POSITION },
          handScale: surfacePose.handScale,
          imageDepthScale: renderedWidth,
          imageStill,
          imagePoseStable,
          imageMotion: screenMotion,
        };
        handOcclusionPointsRef.current = handMaskStabilizerRef.current.update(
          { landmarks, screen: screenLandmarks, width, height, mode, pose: ringPlacement },
          (imageStill || imagePoseStable) && !fit.scaleObserved, ringPlacement, performance.now());
      }

      const stablePlacement = ringPoseFilterRef.current.update(ringPlacement, performance.now());
      // A short detector miss can retain the last fitted ring. Keep its matching
      // hand depth too: clearing only the mask exposes the band over the palm.
      if (!ringPlacement && stablePlacement) handOcclusionPointsRef.current = previousOcclusion;
      handMaskRawPoseRef.current = handOcclusionPointsRef.current?.pose ?? ringPlacement;
      if (ringPlacement && stablePlacement) {
        const motion = ringPlacement.imageMotion;
        const measured = motion ? fitPalmMotion(motion.before, motion.after) : null;
        const moved = measured?.map(stablePlacement);
        trackingTraceRef.current.push([performance.now(), ringPlacement.x, ringPlacement.y, ringPlacement.width,
          stablePlacement.x, stablePlacement.y, stablePlacement.width,
          ...stablePlacement.orientation.toArray(), imageMotion?.before.length ?? 0,
          ...ringPlacement.orientation.toArray(), ringPlacement.edgeConfidence ?? 0,
          moved ? moved.x - stablePlacement.x : 0, moved ? moved.y - stablePlacement.y : 0,
          measured?.angle ?? 0, measured?.scale ?? 1, measured?.residual ?? -1, ringPlacement.fitRevision ?? 0, imagePoseStable ? 1 : 0]);
        if (trackingTraceRef.current.length > 12) trackingTraceRef.current.shift();
      } else trackingTraceRef.current = [];
      const snapshotPose = (p: RingModelPlacement | null) => p ? {
        x: p.x, y: p.y, width: p.width, orientation: p.orientation.toArray(),
        fingerLength: p.fingerLength, handScale: p.handScale,
        imageDepthScale: p.imageDepthScale,
        fingerSegment: p.fingerSegment,
      } : null;
      trackingSnapshotRef.current = {
        version: 2, rendererVersion: 'webgi-integrated-v12', time: performance.now(), mode, viewport: { width, height },
        frameIntervalMs: trackingSnapshotRef.current ? performance.now() - Number(trackingSnapshotRef.current.time) : 0,
        video: { width: video.videoWidth, height: video.videoHeight },
        hand: hands[0] ?? null, edges: sobelFingerEdgesRef.current,
        handDetection: handDetectionRef.current,
        raw: snapshotPose(ringPlacement), rendered: snapshotPose(stablePlacement),
        fit: fingerFitFilterRef.current.diagnostics,
        texturePoints: imageMotion?.before.length ?? 0,
        imageStill,
        imagePoseStable,
        stillness: fingerStillnessRef.current.diagnostics,
        textureReferenceAgeMs: imageMotion?.referenceAgeMs ?? 0,
        fingerWindow: fingerWindowRef.current.diagnostics,
        traceColumns: ['time', 'rawX', 'rawY', 'rawWidth', 'x', 'y', 'width', 'qx', 'qy', 'qz', 'qw', 'texturePoints', 'rawQx', 'rawQy', 'rawQz', 'rawQw', 'edgeConfidence', 'skinDx', 'skinDy', 'skinRoll', 'skinScale', 'skinResidual', 'fitRevision', 'imagePoseStable'],
        trace: trackingTraceRef.current.map(row => [...row]),
        motionTracker: usesLightweightTracking(navigator.userAgent, navigator.maxTouchPoints)
          || !openCvRef.current ? 'patch-reference' : 'patch-reference/lk-recovery',
      };
      renderRingModel(stablePlacement);
    },
    [renderRingModel],
  );

  const startHandTracking = useCallback(
    async (
      stream: MediaStream,
      mode: FacingMode,
      onError: (error: unknown) => void,
    ) => {
      const handLandmarker = await getHandLandmarker();

      if (streamRef.current !== stream) {
        return;
      }

      // Apple mobile devices use skin patch tracking without allocating the
      // second 128 MiB WASM heap alongside MediaPipe and the graphics buffers.
      const preferPatchTracking = usesLightweightTracking(navigator.userAgent, navigator.maxTouchPoints);
      if (!preferPatchTracking) {
        void getOpenCv().catch((error) => {
          if (streamRef.current === stream) console.warn('Skin motion tracking could not load; using patch tracking.', error);
        });
      }

      const handIdentity = new HandIdentityTracker();
      let fpsFrames = 0;
      let fpsWindowStartedAt = performance.now();
      const renderPoints = () => {
        const video = videoRef.current;

        if (streamRef.current !== stream || !video) {
          return;
        }

        try {
        const now = performance.now();
        const capturedVideoTime = video.currentTime;
        const hasNewFrame = capturedVideoTime !== lastVideoTimeRef.current;

        // Process the newest available frame. This prevents the 30 ms tracking
        // gap that made the model trail behind a moving camera or hand.
        if (video.readyState >= 2 && hasNewFrame) {
          const detectionCanvas =
            handDetectionCanvasRef.current ?? document.createElement('canvas');
          handDetectionCanvasRef.current = detectionCanvas;
          const inputSize = detectionSize(video.videoWidth, video.videoHeight, HAND_MODEL_INPUT_SIZE);
          if (detectionCanvas.width !== inputSize.width || detectionCanvas.height !== inputSize.height) {
            detectionCanvas.width = inputSize.width;
            detectionCanvas.height = inputSize.height;
          }
          const detectionContext = detectionCanvas.getContext('2d', { willReadFrequently: true });
          let detectedLandmarks: HandPoint[] | null = null;
          let detectedHandedness: Handedness | null = null;

          if (detectionContext) {
            // Preserve the whole video and its aspect ratio, including corners.
            const preview = previewCanvasRef.current;
            const previewContext = preview?.getContext('2d');
            if (!preview || !previewContext) throw new Error('Camera presentation is unavailable.');
            if (preview.width !== video.videoWidth || preview.height !== video.videoHeight) {
              preview.width = video.videoWidth; preview.height = video.videoHeight;
            }
            // Present the same camera frame used for the pose. A live <video>
            // can advance independently while inference is still running.
            previewContext.drawImage(video, 0, 0, preview.width, preview.height);
            detectionContext.drawImage(preview, 0, 0, inputSize.width, inputSize.height);

            const result = handLandmarker.detectForVideo(detectionCanvas, now);
            const imageLandmarks = result.landmarks[0];
            const worldLandmarks = result.worldLandmarks[0];
            const category = result.handedness[0]?.[0];
            const label = category?.categoryName;
            const identity = handIdentity.update(
              label === 'Left' || label === 'Right' ? label : null,
              category?.score ?? 0, imageLandmarks ?? null, now,
              video.videoHeight / video.videoWidth,
            );
            handDetectionRef.current = { label: label === 'Left' || label === 'Right' ? label : null,
              score: category?.score ?? 0, accepted: identity.handedness,
              pending: identity.pending, reset: identity.reset, time: now };
            if (identity.reset) {
              // A new hand must never inherit the old hand's palm-side sign,
              // scale calibration, smoothed orientation, or skin attachment.
              ringSurfaceRef.current.reset();
              ringPoseFilterRef.current.reset();
              fingerFitFilterRef.current.reset();
              skinMotionRef.current.reset();
              patchMotionRef.current.reset();
              fingerStillnessRef.current.reset();
              fingerWindowRef.current.reset();
              handMaskStabilizerRef.current.reset();
              sobelFingerEdgesRef.current = null;
              handOcclusionPointsRef.current = null;
              trackingTraceRef.current = [];
              trackingSnapshotRef.current = null;
            }
            // A pending anatomy reclassification is still the same accepted
            // hand until the new label is confirmed. Dropping these frames
            // repeatedly reset the attachment during ordinary label flicker.
            if (imageLandmarks && identity.handedness) {
              detectedHandedness = identity.handedness;
              detectedLandmarks = imageLandmarks.map((point, index) => {
                const worldPoint = worldLandmarks?.[index];
                return {
                  x: point.x,
                  y: point.y,
                  z: point.z,
                  worldX: worldPoint?.x,
                  worldY: worldPoint?.y,
                  worldZ: worldPoint?.z,
                };
              });
            }
          }

          const frameLandmarks = detectedLandmarks;
          const lightweightMotion = preferPatchTracking || !openCvRef.current;
          let skinMotion: SkinMotion | null = null;
          let imageStill = false;
          let imagePoseStable = false;
          if ((lightweightMotion || openCvRef.current) && frameLandmarks) {
            const flowCanvas = flowCanvasRef.current ?? document.createElement('canvas');
            flowCanvasRef.current = flowCanvas;
            const flowSize = { width: FINGER_TRACKING_RESOLUTION, height: FINGER_TRACKING_RESOLUTION };
            if (flowCanvas.width !== flowSize.width || flowCanvas.height !== flowSize.height) {
              flowCanvas.width = flowSize.width; flowCanvas.height = flowSize.height;
            }
            const flowContext = flowCanvas.getContext('2d', { willReadFrequently: true });
            if (flowContext) {
              try {
                // Use the calibrated diameter to keep texture features inside
                // skin, including when finger length foreshortens during a tilt.
                const fittedWidth = ringPoseFilterRef.current.current()?.width;
                const viewport = pointsCanvasRef.current;
                const videoScale = Math.max(
                  (viewport?.clientWidth ?? video.clientWidth) / video.videoWidth,
                  (viewport?.clientHeight ?? video.clientHeight) / video.videoHeight,
                );
                const skinWidth = fittedWidth && videoScale > 0 ? fittedWidth / videoScale : undefined;
                const tracked = fingerWindowRef.current.update(video.videoWidth, video.videoHeight,
                  [frameLandmarks[13], frameLandmarks[14]], skinWidth);
                if (tracked) {
                  const { window, previous, region, fingerWidth } = tracked;
                  // Read the already captured camera frame directly. Upscaling
                  // the 640px landmark input cannot recover fine skin detail.
                  flowContext.drawImage(previewCanvasRef.current!, window.x, window.y, window.size, window.size,
                    0, 0, flowSize.width, flowSize.height);
                  const image = flowContext.getImageData(0, 0, flowSize.width, flowSize.height);
                  if (tracked.changed) fingerStillnessRef.current.reset();
                  if (!previous) { skinMotionRef.current.reset(); patchMotionRef.current.reset(); }
                  imageStill = fingerStillnessRef.current.update(image, region, now, fingerWidth);
                  imagePoseStable = fingerStillnessRef.current.diagnostics.poseStable;
                  let localMotion: SkinMotion | null;
                  // A fixed skin reference avoids integrating LK's small errors
                  // into visible attachment drift. Keep LK as recovery for a
                  // changed patch appearance, without changing the renderer.
                  localMotion = patchMotionRef.current.update(image, region, now, fingerWidth);
                  if (!localMotion && !lightweightMotion) localMotion = skinMotionRef.current.update(openCvRef.current!, image, region, now, fingerWidth);
                  else skinMotionRef.current.reset();
                  skinMotion = fingerMotionToVideo(localMotion, previous, window);
                } else {
                  fingerStillnessRef.current.reset(); skinMotionRef.current.reset(); patchMotionRef.current.reset();
                }
              } catch (error) {
                imageStill = false;
                imagePoseStable = false;
                fingerStillnessRef.current.reset();
                fingerWindowRef.current.reset();
                skinMotionRef.current.reset();
                patchMotionRef.current.reset();
                console.warn('Skin tracking unavailable for this frame.', error);
              }
            }
          } else {
            fingerStillnessRef.current.reset();
            fingerWindowRef.current.reset();
            skinMotionRef.current.reset();
            patchMotionRef.current.reset();
          }

          if (!frameLandmarks) {
            sobelFingerEdgesRef.current = null;
          }

          // Measure this captured frame, never reuse an older edge midpoint
          // against newer landmarks: that produces a motion-dependent offset.
          {
            try {
              updateHorizontalSobel(
                detectionCanvas,
                frameLandmarks,
              );
            } catch (error) {
              clearSobelOverlay();
              console.error('Horizontal Sobel filtering failed.', error);
            }
          }

          drawPoints(
            frameLandmarks
              ? [
                  {
                    landmarks: frameLandmarks,
                    handedness: detectedHandedness,
                  },
                ]
              : [],
            mode,
            skinMotion,
            imageStill,
            imagePoseStable,
          );

          lastVideoTimeRef.current = capturedVideoTime;
          lastDetectionTimeRef.current = now;
          fpsFrames += 1;
        }

        // Count completed camera/tracking frames, including their processing
        // time. Animation callbacks without a new video frame do not count.
        const fpsSampleTime = performance.now();
        const fpsElapsed = fpsSampleTime - fpsWindowStartedAt;
        if (fpsElapsed >= 1000) {
          setFps(Math.round(fpsFrames * 1000 / fpsElapsed));
          fpsFrames = 0;
          fpsWindowStartedAt = fpsSampleTime;
        }

        scheduleCameraFrame();
        } catch (error) {
          onError(error);
        }
      };

      const scheduleCameraFrame = () => {
        if (webgiCameraClockRef.current) return;
        const bridge = useWebGIAR ? webgiRendererRef.current : null;
        if (bridge) {
          // Infer, update the preview, pose and masks before WebGI renders in
          // this same browser frame. Separate RAF loops showed old jewelry
          // over a newer camera frame and moved the crop before its pixels.
          animationFrameRef.current = null;
          webgiCameraClockRef.current = bridge.beforeFrame(renderPoints);
        } else animationFrameRef.current = requestAnimationFrame(renderPoints);
      };

      stopHandTracking();
      scheduleCameraFrame();
    },
    [
      clearSobelOverlay,
      drawPoints,
      getHandLandmarker,
      getOpenCv,
      stopHandTracking,
      updateHorizontalSobel,
    ],
  );

  const releaseStream = useCallback(() => {
    // Invalidate pending permission/play requests before releasing this stream.
    cameraRequestRef.current += 1;
    stopHandTracking();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [stopHandTracking]);

  const stopCamera = useCallback(() => {
    releaseStream();
    setCameraState('idle');
    setScreenshotState('idle');
    setMessage('');
  }, [releaseStream]);

  const startCamera = useCallback(
    async (mode: FacingMode) => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setCameraState('error');
        setMessage('Camera access requires HTTPS on phones and tablets.');
        return;
      }
      if (ringContextLostRef.current) {
        setCameraState('error');
        setMessage('Graphics are still recovering. Close this tab and reopen the try-on if this persists.');
        return;
      }

      releaseStream();
      const requestId = cameraRequestRef.current;
      ringLoadFailedRef.current = false;
      setCameraState('requesting');
      setMessage('');

      // Prepare tracking during camera permission/setup rather than starting
      // its WASM/model load only after the camera and autofocus have settled.
      // startHandTracking handles failures and shares this cached promise.
      void getHandLandmarker().catch(() => {});

      try {
        let stream: MediaStream;

        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { ideal: mode },
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30, max: 30 },
            },
          });
        } catch (error) {
          if (requestId !== cameraRequestRef.current) return;
          if (!(error instanceof DOMException) || error.name !== 'OverconstrainedError') {
            throw error;
          }

          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: true,
          });
        }

        if (requestId !== cameraRequestRef.current || !videoRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.muted = true;
          videoRef.current.playsInline = true;
          videoRef.current.srcObject = stream;

          try {
            await videoRef.current.play();
          } catch {
            // iOS Safari can reject the explicit play call while still honoring
            // the muted autoplay attributes once camera metadata is available.
          }
        }

        void enableContinuousAutofocus(stream.getVideoTracks()[0]);

        if (requestId !== cameraRequestRef.current || streamRef.current !== stream) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        setFacingMode(mode);
        setCameraState('active');
        const handleTrackingError = (error: unknown) => {
          if (streamRef.current !== stream) return;
          console.error('Hand tracking failed.', error);
          releaseStream();
          setCameraState('error');
          setMessage('Hand tracking could not start or stopped unexpectedly. Start the camera to try again.');
        };
        void startHandTracking(stream, mode, handleTrackingError).catch(handleTrackingError);

        stream.getVideoTracks()[0]?.addEventListener(
          'ended',
          () => {
            if (streamRef.current !== stream) return;
            releaseStream();
            setCameraState('idle');
            setMessage('Camera disconnected. Start the camera to reconnect.');
          },
          { once: true },
        );
      } catch (error) {
        if (requestId !== cameraRequestRef.current) return;
        releaseStream();
        const name = error instanceof DOMException ? error.name : '';
        setCameraState('error');
        setMessage(errorMessages[name] ?? 'Unable to start the camera.');
      }
    },
    [releaseStream, startHandTracking, getHandLandmarker],
  );

  const toggleCamera = () => {
    if (cameraState === 'active') {
      stopCamera();
      return;
    }

    void startCamera(facingMode);
  };

  const switchCamera = () => {
    const nextMode: FacingMode =
      facingMode === 'environment' ? 'user' : 'environment';

    if (cameraState === 'active') {
      void startCamera(nextMode);
      return;
    }

    setFacingMode(nextMode);
    setMessage('');
  };

  const toggleModel = () => {
    setModelEnabled((enabled) => !enabled);
  };

  const checkFingerShadow = () => {
    try {
      const renderer = ringRendererRef.current, scene = ringSceneRef.current, camera = ringCameraRef.current, canvas = ringCanvasRef.current;
      if (!renderer || !scene || !camera || !canvas) throw new Error('Load a ring first.');
      drawRingScene(renderer, scene, camera);
      const pixels = readCanvasPixels(canvas).data, tones = new Set<number>();
      let maximum = 0, covered = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) { covered++; maximum = Math.max(maximum, pixels[i]); tones.add(pixels[i]); }
      setMessage(`Shadow ${covered > 25 && tones.size >= 8 && maximum <= 48 ? 'passed' : 'FAILED'} · ${covered} pixels · ${tones.size} soft alpha levels · ${Math.round(maximum / 255 * 100)}% maximum opacity`);
    } catch { setMessage('Shadow check failed. Load a front-facing ring pose first.'); }
  };

  const takeScreenshot = async () => {
    const video = videoRef.current;
    const ringCanvas = useWebGIAR ? webgiCanvasRef.current : ringCanvasRef.current;
    const pointsCanvas = pointsCanvasRef.current;

    if (
      cameraState !== 'active' ||
      !video ||
      !pointsCanvas ||
      !video.videoWidth ||
      !video.videoHeight
    ) {
      return;
    }

    setScreenshotState('saving');

    try {
      const width = pointsCanvas.clientWidth;
      const height = pointsCanvas.clientHeight;
      const pixelRatio = ringPixelRatio(window.devicePixelRatio);
      const screenshotCanvas = document.createElement('canvas');
      screenshotCanvas.width = Math.max(1, Math.round(width * pixelRatio));
      screenshotCanvas.height = Math.max(1, Math.round(height * pixelRatio));
      const context = screenshotCanvas.getContext('2d');
      if(context){context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';}

      if (!context) {
        throw new Error('Screenshot canvas is unavailable.');
      }

      context.fillStyle = '#111111';
      context.fillRect(0, 0, screenshotCanvas.width, screenshotCanvas.height);

      const videoScale = Math.max(
        width / video.videoWidth,
        height / video.videoHeight,
      );
      const renderedWidth = video.videoWidth * videoScale;
      const renderedHeight = video.videoHeight * videoScale;
      const offsetX = (width - renderedWidth) / 2;
      const offsetY = (height - renderedHeight) / 2;
      const computedTransform = window.getComputedStyle(video).transform;
      const transform = new DOMMatrixReadOnly(
        computedTransform === 'none' ? undefined : computedTransform,
      );

      context.setTransform(
        pixelRatio * transform.a,
        pixelRatio * transform.b,
        pixelRatio * transform.c,
        pixelRatio * transform.d,
        pixelRatio * transform.e,
        pixelRatio * transform.f,
      );
      context.drawImage(
        previewCanvasRef.current ?? video,
        offsetX,
        offsetY,
        renderedWidth,
        renderedHeight,
      );

      context.setTransform(1, 0, 0, 1, 0, 0);
      if (ringCanvas && modelEnabledRef.current) {
        // The default framebuffer may have been discarded after presentation.
        if (ringRendererRef.current && ringSceneRef.current && ringCameraRef.current && !ringContextLostRef.current) {
          drawRingScene(ringRendererRef.current, ringSceneRef.current, ringCameraRef.current);
        }
        if (useWebGIAR) await webgiRendererRef.current?.frame();
        if (useWebGIAR && ringCanvasRef.current) context.drawImage(ringCanvasRef.current,
          (ringRenderViewportRef.current?.x ?? 0) * pixelRatio,
          (ringRenderViewportRef.current?.y ?? 0) * pixelRatio,
          (ringRenderViewportRef.current?.width ?? width) * pixelRatio,
          (ringRenderViewportRef.current?.height ?? height) * pixelRatio);
        context.drawImage(
          ringCanvas,
          (ringRenderViewportRef.current?.x ?? 0) * pixelRatio,
          (ringRenderViewportRef.current?.y ?? 0) * pixelRatio,
          (ringRenderViewportRef.current?.width ?? width) * pixelRatio,
          (ringRenderViewportRef.current?.height ?? height) * pixelRatio,
        );
      }
      // Freeze metadata before encoding yields to the next camera frame.
      // Keep the tracking header below normal browser/server header limits.
      // Retain a short motion trace to diagnose scale and attachment jumps.
      const snapshot = trackingSnapshotRef.current;
      const capture = snapshot ? Object.fromEntries(['version', 'rendererVersion', 'time', 'mode', 'viewport', 'video', 'hand', 'raw', 'rendered', 'fit', 'handDetection', 'imageStill', 'imagePoseStable', 'stillness', 'motionTracker', 'fingerWindow', 'textureReferenceAgeMs', 'frameIntervalMs', 'traceColumns', 'trace']
        .map(key => [key, snapshot[key]])) : null;
      const encodeTracking = () => btoa(JSON.stringify(capture, (_key, value) =>
        typeof value === 'number' ? Math.round(value * 100000) / 100000 : value));
      let tracking = encodeTracking();
      if (capture && Array.isArray(capture.trace)) {
        const trace = [...capture.trace];capture.trace = trace;
        while (tracking.length > 12000 && trace.length) { trace.shift(); tracking = encodeTracking(); }
      }
      const screenshot = await new Promise<Blob>((resolve, reject) => {
        screenshotCanvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Unable to encode the screenshot.'));
          }
        }, 'image/png');
      });
      // Customer photos remain on their device. The integrated experience
      // does not depend on the sandbox's screenshot-upload endpoint.
      const downloadUrl = URL.createObjectURL(screenshot);
      const download = document.createElement('a');
      download.href = downloadUrl;
      download.download = `my-ring-${Date.now()}.png`;
      document.body.appendChild(download);
      download.click();
      download.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 10000);
      if (debugMode) console.debug('AR capture diagnostics', capture, tracking.length);

      setScreenshotState('saved');
      window.setTimeout(() => setScreenshotState('idle'), 1800);
    } catch (error) {
      console.error('Screenshot capture failed.', error);
      setScreenshotState('error');
      window.setTimeout(() => setScreenshotState('idle'), 2400);
    }
  };

  useEffect(() => {
    modelEnabledRef.current = modelEnabled;
    if (!modelEnabledRef.current) {
      renderRingModel(null);
    }
  }, [modelEnabled, renderRingModel]);

  useEffect(() => {
    const generation = resourceGenerationRef.current;
    void loadRingModel().catch((error) => {
      if (generation !== resourceGenerationRef.current) return;
      console.error('Unable to preload the selected ring.', error);
      setMessage('Your ring could not load. Go back and open try-on again.');
    });
    const canvas = useWebGIAR ? webgiCanvasRef.current : ringCanvasRef.current;
    let mounted = true;
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      ringContextLostRef.current = true;
      ringSafeShaderRef.current = true;
      stopCamera();
      setCameraState('error');
      setMessage('The graphics session stopped. Waiting for recovery before restarting the camera.');
    };
    const handleContextRestored = () => {
      // Let Three finish its own context-restored event handler first.
      queueMicrotask(() => {
        if (!mounted) return;
        disposeRingModel();
        ringContextLostRef.current = false;
        ringLoadFailedRef.current = false;
        ringShaderFailedRef.current = false;
        setCameraState('idle');
        setMessage('Graphics recovered. Start the camera to try again.');
      });
    };
    canvas?.addEventListener('webglcontextlost', handleContextLost);
    canvas?.addEventListener('webglcontextrestored', handleContextRestored);
    const handlePageHide = () => stopCamera();
    const handleVisibility = () => { if (document.hidden) stopCamera(); };
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      mounted = false;
      canvas?.removeEventListener('webglcontextlost', handleContextLost);
      canvas?.removeEventListener('webglcontextrestored', handleContextRestored);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibility);
      releaseStream();
      handLandmarkerRef.current?.close();
      handLandmarkerRef.current = null;
      handLandmarkerPromiseRef.current = null;
      openCvPromiseRef.current = null;
      openCvRef.current = null;
      disposeRingModel();
    };
  }, [disposeRingModel, loadRingModel, releaseStream, stopCamera]);


  useEffect(() => {
    if (!replayMode) return;
    let cancelled = false;
    const draw = async () => {
      const width = pointsCanvasRef.current?.clientWidth || 800, height = pointsCanvasRef.current?.clientHeight || 600;
      const poses = [new THREE.Euler(Math.PI,0,0),new THREE.Euler(Math.PI,0.65,-0.18),new THREE.Euler(Math.PI-0.8,0,0.2)];
      if (replayPose >= 3) {
        const capture = replayPose === 3 ? (await import('../tests/fixtures/fist-occlusion.json')).default : (await import('../tests/fixtures/frontal-ring-alignment.json')).default[replayPose - 4];
        if (cancelled) return;
        const replay = replayRecordedHand(capture, width, height);
        handOcclusionPointsRef.current = replay.mask;
        handMaskRawPoseRef.current = replay.placement;
        renderRingModel(replay.placement);
        setMessage(replayPose === 3 ? 'Recorded bent-hand pose · Camera is off' : 'Recorded open-hand pose · Camera is off');
        setReplayReady(true);
        return;
      }
      handOcclusionPointsRef.current = null;
      handMaskRawPoseRef.current = null;
      setMessage('Tracking renderer replay · Camera is off');
      const orientation = new THREE.Quaternion().setFromEuler(poses[replayPose]);
      renderRingModel({x:width*.5,y:height*.48,width:Math.min(width,height)*.32,orientation,surfaceFacing:-1,anchors:[],fingerLength:height*.3,handScale:height*.6});
      setReplayReady(true);
    };
    void loadRingModel().then(()=> {if (!cancelled) draw();}).catch(()=>{if(!cancelled)setMessage('Unable to load the selected ring for replay.');});
    window.addEventListener('resize',draw);
    return () => {cancelled=true;window.removeEventListener('resize',draw);};
  },[loadRingModel,renderRingModel,replayPose]);

  return (
    <section className={`camera-screen camera-screen--${facingMode} ${replayMode ? "ar-replay" : ""}`} aria-label="Live ring try-on">
      <header className="ar-experience-header">
        <button type="button" className="ar-back-button" onClick={onClose} aria-label="Back to ring builder"><ARIcon name="back" /><span>Back to your ring</span></button>
        <div className="ar-design-label"><span>Virtual try-on{debugMode ? ' · v12' : ''}</span><strong>{selection.label}</strong></div>
        <span className={`ar-camera-state ${cameraState === 'active' ? 'is-live' : ''}`}>{cameraState === 'active' ? 'Live camera' : 'Camera off'}</span>
      </header>
      <video
        ref={videoRef}
        className="camera-preview"
        muted
        playsInline
        autoPlay
        style={{ opacity: cameraState === 'active' ? 0 : 1 }}
        aria-hidden="true"
      />
      <canvas ref={previewCanvasRef} className="camera-preview" aria-label="Live camera preview"
        style={{ visibility: cameraState === 'active' || replayMode ? 'visible' : 'hidden' }} />
      <canvas
        ref={ringCanvasRef}
        className="ring-model"
        style={{ visibility: cameraState === 'active' || replayMode ? 'visible' : 'hidden' }}
        aria-hidden="true"
      />
      <canvas ref={webgiCanvasRef} className="ring-model" aria-label="WebGI AR diamond render" style={{visibility:useWebGIAR && (cameraState === "active" || replayMode) ? "visible" : "hidden"}} />
      <canvas
        ref={pointsCanvasRef}
        className="hand-points"
        style={{ visibility: cameraState === 'active' || replayMode ? 'visible' : 'hidden' }}
        aria-hidden="true"
      />

      {debugMode && <output
        className="fps-counter"
        aria-label="Processed frames per second"
        aria-live="off"
        title="Completed camera tracking updates per second"
      >
        {fps} FPS
      </output>}

      {(replayMode || cameraState === 'requesting' || (cameraState === 'active' && message)) && (
        <div className="camera-status" role="status" aria-live="polite">
          {replayMode ? (message || (replayReady ? 'Tracking renderer replay · Camera is off' : 'Loading selected ring…')) : cameraState === 'requesting'
            ? 'Starting camera…'
            : message || 'Camera is off'}
        </div>
      )}

      {!replayMode && (cameraState === 'idle' || cameraState === 'error') && <div className="ar-welcome">
        <div className="ar-welcome-symbol"><ARIcon name="hand" /></div>
        <span className="ar-eyebrow">Made for your hand</span>
        <h2>Try your ring on</h2>
        <p>Show the back of your hand and keep your ring finger in view. Move slowly to explore your design.</p>
        {message && <p className="ar-error-message" role="status">{message}</p>}
        <button type="button" className="ar-start-button" onClick={toggleCamera}><ARIcon name="camera" />{cameraState === 'error' ? 'Try camera again' : 'Enable camera'}</button>
        <small>Your camera is used on this device. Photos are saved only when you choose.</small>
      </div>}

      {!debugMode && cameraState === 'active' && <>
        <p className="ar-position-tip">Hold your hand flat for a moment, then turn slowly.</p>
        <div className="ar-live-controls" role="toolbar" aria-label="AR camera controls">
          <div className="ar-controls-side">
          <button type="button" onClick={switchCamera} aria-label="Switch camera" title="Switch camera"><ARIcon name="switch" /></button>
          </div>
          <button type="button" className="ar-shutter" onClick={() => void takeScreenshot()} disabled={screenshotState === 'saving'} aria-label="Save try-on photo" title="Save photo"><span /></button>
          <div className="ar-controls-side">
          <button type="button" onClick={() => { fingerFitFilterRef.current.reset(); ringSurfaceRef.current.reset(); ringPoseFilterRef.current.reset(); clearSobelOverlay(); renderRingModel(null); }} aria-label="Refit ring" title="Refit ring"><ARIcon name="refit" /></button>
          <button type="button" onClick={stopCamera} aria-label="Stop camera" title="Stop camera"><ARIcon name="camera" /></button>
          </div>
        </div>
        {screenshotState !== 'idle' && <span className="ar-photo-status" role="status">{screenshotState === 'saved' ? 'Photo saved' : screenshotState === 'saving' ? 'Saving photo…' : 'Unable to save photo'}</span>}
      </>}

      {debugMode && <div className="camera-controls">
        {replayMode && <button className="control-button" onClick={checkFingerShadow}>Check shadow</button>}
        {replayMode && <button className="control-button" onClick={()=>{setMessage('Checking original edge fading…');void webgiRendererRef.current?.checkFading().then(result=>setMessage(`Edge fading ${result.passed?'passed':'FAILED'} · ${result.softened} softened pixels · ${result.retained} solid pixels · ${Math.round(result.opacityRatio*100)}% opacity retained`)).catch(()=>setMessage('Edge fading check failed.'));}}>Check fading</button>}
        {replayMode && <button className="control-button" onClick={()=>{setMessage('Checking edge coverage…');void webgiRendererRef.current?.checkEdges().then(result=>setMessage(`Edge coverage ${result.passed?'passed':'FAILED'} · ${result.blendedEdges} blended pixels · ${result.scale}× sampling`)).catch(()=>setMessage('Edge coverage check failed.'));}}>Check edge quality</button>}
        {replayMode && <><button className="control-button" onClick={()=>setReplayPose(value=>(value+1)%6)}>Replay next hand pose</button>{useWebGIAR && <button className="control-button" onClick={()=>{void (async()=>{try{await webgiRendererRef.current?.frame();const canvas=webgiCanvasRef.current;if(!canvas)throw new Error();const result=inspectCanvasTransparency(canvas);setMessage(result.passed ? `WebGI transparency passed · ${result.foreground} ring pixels · Clear border` : 'Transparency check failed: ring or border needs attention.');}catch{setMessage('Unable to read the WebGI canvas.');}})();}}>Check transparency</button>}{useWebGIAR && <button className="control-button" onClick={()=>{setMessage('Checking camera frame timing…');void webgiRendererRef.current?.checkFrameSync().then(result=>setMessage('Frame timing '+(result.passed?'passed':'FAILED')+' · '+result.matched+'/'+result.frames+' current-frame crops')).catch(()=>setMessage('Frame timing check failed.'));}}>Check frame timing</button>}{useWebGIAR && <button className="control-button" onClick={()=>{setMessage('Checking diamond projection…');void webgiRendererRef.current?.checkProjection().then(result=>setMessage(`Diamond projection ${result.passed?'passed':'FAILED'} · RGB error ${result.meanError.toFixed(3)} · ${result.samples} samples`)).catch(()=>setMessage('Diamond projection check failed.'));}}>Check diamond projection</button>}{useWebGIAR && <button className="control-button" onClick={()=>{setMessage('Checking front/behind occlusion…');void webgiRendererRef.current?.checkOcclusion().then(result=>setMessage(`Occlusion ${result.passed?'passed':'FAILED'} · Clear ${result.clear} · Front ${result.front} · Behind ${result.behind} · Hand ${result.masked}`)).catch(()=>setMessage('Occlusion check failed to run.'));}}>Check occlusion</button>}<button className="control-button" onClick={()=>{setMessage('Checking tracking engine…');void Promise.all([getHandLandmarker(),getOpenCv()]).then(()=>setMessage('Hand tracker and optical flow ready · Camera is off')).catch(()=>setMessage('Tracking initialization failed. Check local assets.'));}}>Check tracking engine</button><a className="control-button" href={location.href.replace(/([?&])replay=1&?/,"$1")}>Open live camera mode</a></>}
        <button
          className="control-button control-button--primary"
          type="button"
          onClick={toggleCamera}
          disabled={cameraState === 'requesting'}
        >
          {cameraState === 'active' ? 'Stop camera' : 'Start camera'}
        </button>

        <button
          className="control-button"
          type="button"
          onClick={switchCamera}
          disabled={cameraState === 'requesting'}
        >
          {facingMode === 'environment'
            ? 'Use front camera'
            : 'Use back camera'}
        </button>

        <button
          className="control-button"
          type="button"
          onClick={toggleModel}
          aria-pressed={modelEnabled}
        >
          {modelEnabled ? 'Hide ring model' : 'Show ring model'}
        </button>

        <button
          className="control-button"
          type="button"
          disabled={cameraState !== 'active'}
          onClick={() => {
            fingerFitFilterRef.current.reset();
            ringSurfaceRef.current.reset();
            ringPoseFilterRef.current.reset();
            clearSobelOverlay();
            renderRingModel(null);
          }}
        >
          Refit ring
        </button>

        <button
          className="control-button"
          type="button"
          onClick={() => void takeScreenshot()}
          disabled={
            cameraState !== 'active' || screenshotState === 'saving'
          }
        >
          {screenshotState === 'saving'
            ? 'Saving…'
            : screenshotState === 'saved'
              ? 'Saved'
              : screenshotState === 'error'
                ? 'Save failed'
                : 'Take screenshot'}
        </button>
      </div>}
    </section>
  );
}

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { gsap } from "gsap";
import {
  AmbientLight,
  AssetManagerPlugin,
  Color,
  ContactShadowGroundPlugin,
  CoreViewerApp,
  DepthOfFieldPlugin,
  DiamondPlugin,
  DirectionalLight,
  EXRLoadPlugin,
  GBufferPlugin,
  InteractionPromptPlugin,
  LoadingScreenPlugin,
  LUTPlugin,
  Matrix4,
  Object3D,
  ProgressivePlugin,
  Quaternion,
  RandomizedDirectionalLightPlugin,
  TemporalAAPlugin,
  TonemapPlugin,
  Vector3,
  mobileAndTabletCheck,
} from "webgi";

// Config
import {
  RING_POSITION_X,
  RING_POSITION_Y,
  RING_POSITION_Z,
  RING_ROTATION_X,
  RING_ROTATION_Y,
  RING_ROTATION_Z,
  RING_SCALE_MULTIPLIER,
  MATCHING_BAND_GAP,
} from "../../config/ringConfig";
import type { RingTransform } from "../../config/ringConfig";
import { assetUrl } from "../../config/assets";
import {
  PROGRESSIVE_PLUGIN_SAMPLES,
  DISPLAY_CANVAS_SCALING,
  TONEMAP_CONTRAST,
  TONEMAP_SATURATION,
  TEMPORAL_AA_ENABLED,
  TEMPORAL_AA_USE_TOTAL_FRAME_COUNT,
  CAMERA_FOV_MOBILE,
  CAMERA_MIN_DISTANCE_DESKTOP,
  CAMERA_MAX_DISTANCE_DESKTOP,
  CAMERA_MIN_DISTANCE_MOBILE,
  CAMERA_MAX_DISTANCE_MOBILE,
  CAMERA_AUTO_ROTATE_SPEED,
  ENABLE_MSAA,
  BACKGROUND_COLOR,
  CUSTOM_METAL_ENV_URL,
  CUSTOM_DIAMOND_ENV_URL,
  METAL_ENV_ROTATION,
  DIAMOND_BAKE_CONCURRENCY,
  FIRST_LOAD_DIAMOND_BAKE_CONCURRENCY,
} from "../../config/viewerConfig";
import {
  DIAMOND_GEM,
  applyDiamondMaterialRuntimeSettings,
  applyDiamondShaderProps,
  getDiamondBakeConfig,
  syncDiamondPluginFromConfig,
  syncRefractionPassRayBounces,
} from "../../config/materialConfig";

// Utils
import {
  METAL_COLORS_SRGB,
  hexSrgbToMetalColor,
  isWhiteGoldSrgb,
  getMetalRoughness,
} from "../../utils/colorUtils";
import {
  isDiamondMesh,
  isDiamondMeshOrMaterial,
  isDiamondMaterialType,
  getMeshPrimaryMaterial,
  ensureUniqueDiamondMaterialForMesh,
  applyDiamondWhiteColor,
  findPartContainerForMesh,
  cloneMeshForDisplay,
} from "../../utils/meshUtils";
import {
  refreshDiamondPluginEnvOnly,
  ensureSSRDisabled,
  disableSSRPlugin,
  configureRingOcclusion,
  disableViewerGltfAnimations,
  disableModelGltfAnimations,
  setSubtreeCastShadow,
  configureContactShadowGround,
  refreshContactShadowGround,
  createContactShadowFade,
  freezeContactShadowGroundTransform,
  unfreezeContactShadowGroundTransform,
} from "../../utils/sceneUtils";
import {
  getPartLoadKey,
  getPartModelCache,
  getValidCachedMeshes,
  getDiamondBakeCacheKey,
  buildPartContainer,
  resolveAssetManager,
  ensurePartMeshesCached,
  prefetchHeadShankMeshes,
} from "../../utils/partLoader";
import {
  animateRingDissolve,
  prepareRingDissolve,
  type RingDissolveTransition,
} from "../../utils/ringDissolve";
import { alignRingHeadToShank } from "../../utils/ringAssembly";
import { captureRingPreviews, type RingPreviewImage, type RingDetailPreviewRequest } from "../../utils/ringPreview";
import { getRingCameraPose, type RingCameraView } from "../../utils/ringCameraViews";
import { HandPreview } from "../../utils/handPreview";
import { MultiRingEngraving as RingEngraving } from "../../utils/ringEngraving";
import type { EngravingPosition, EngravingStatus, RingEngravingConfig } from "../../config/engraving";
import { DEFAULT_SKIN_TONE } from "../../config/skinTones";
import { holdViewerFrame, clearViewerFrames } from "../../utils/viewerFrame";

// Types
import type { PartLoadType, PartMeshCaches } from "../../types/ring.types";

export interface RingViewerProps {
  headFile?: string;
  headScale?: number;
  headPosZ?: number;
  shankFile?: string;
  shankScale?: number;
  shankPosZ?: number;
  metalHex?: string;
  headMetalHex?: string;
  shankMetalHex?: string;
  bandFile1?: string;
  bandFile2?: string;
  matchingBandCount?: number;
  cameraView?: RingCameraView | string;
  cameraViewRevision?: number;
  previewKey?: string;
  onPreviewImagesChange?: (key: string, images: RingPreviewImage[]) => void;
  detailPreviewRequest?: RingDetailPreviewRequest;
  onDetailPreviewChange?: (request: RingDetailPreviewRequest, image: RingPreviewImage | null) => void;
  isAutoRotating?: boolean;
  handSkinTone?: number;
  onLoadingChange?: (loading: boolean) => void;
  ringTransform?: RingTransform;
  engraving?: RingEngravingConfig[];
  engravingFocusPosition?: EngravingPosition;
  engravingPhotoPosition?: EngravingPosition;
  onEngravingStatusChange?: (status: EngravingStatus) => void;
}

const DEFAULT_HEAD_FILE = assetUrl(
  "/models/4 PRONG/4 PRONG TALON ROUND/4 PRONG TALON ROUND 2CT.glb");
const DEFAULT_SHANK_FILE = assetUrl("/models/Shank/Traditional Solitaire.glb");
const DEFAULT_METAL_HEX = "#C2C2C3";

export const CAMERA_PRESETS = {
  hero: {
    position: { x: 6.75, y: 3.43, z: -6.75 },
    target: { x: 0, y: 0.1, z: 0 },
    autoRotate: true,
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const RingViewer: React.FC<RingViewerProps> = (props = {}) => {
  const [isViewerReady, setIsViewerReady] = useState(false);
  const isInitialMountDone = useRef(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<any>(null);
  const managerRef = useRef<any>(null);
  const diamondPluginRef = useRef<any>(null);
  const metalEnvironmentAssetRef = useRef<any>(null);
  const diamondEnvironmentAssetRef = useRef<any>(null);
  const applyCustomEnvironmentRef = useRef<(() => Promise<void>) | null>(null);
  const temporalAAPluginRef = useRef<any>(null);
  const contactShadowGroundRef = useRef<any>(null);
  const object3dRef = useRef<any>(null);
  const colorRef = useRef<any>(null);
  const currentHeadRef = useRef<any>(null);
  const currentShankRef = useRef<any>(null);
  const currentBandRefs = useRef<Array<any | null>>([null, null]);
  const currentBandBaseZRefs = useRef<Array<number | null>>([null, null]);

  const currentHeadFileRef = useRef<string | null>(null);
  const currentShankFileRef = useRef<string | null>(null);
  const currentBandFileRefs = useRef<Array<string | null>>([null, null]);
  const lastMatchingBandCountRef = useRef(0);

  const headModelCacheRef = useRef<Map<string, any[]>>(new Map());
  const shankModelCacheRef = useRef<Map<string, any[]>>(new Map());
  const bandModelCacheRef = useRef<Map<string, any[]>>(new Map());
  const partLoadInFlightRef = useRef<Map<string, Promise<boolean>>>(new Map());

  const loadIdRef = useRef(0);
  const previewCaptureRef = useRef<AbortController | null>(null);
  const previewCacheRef = useRef(new Map<string, RingPreviewImage[]>());
  const detailPreviewCacheRef = useRef(new Map<string, RingPreviewImage>());
  const initializeRingCameraRef = useRef<(() => Promise<void>) | null>(null);
  const initialCameraReadyRef = useRef(false);
  const firstCameraPropHandledRef = useRef(false);
  const previewRequestRef = useRef({ key: props.previewKey, callback: props.onPreviewImagesChange });
  previewRequestRef.current = { key: props.previewKey, callback: props.onPreviewImagesChange };
  const partTransitionRef = useRef<RingDissolveTransition | null>(null);
  const [partTransitionPhase, setPartTransitionPhase] = useState("idle");
  const activeCameraRef = useRef<any>(null);
  const cameraTweenRef = useRef<gsap.core.Tween | null>(null);
  const pendingCameraViewRef = useRef<string | null>(null);
  const handPreviewRef = useRef<HandPreview | null>(null);
  const engravingRef = useRef<RingEngraving | null>(null);
  const engravingRequestRef = useRef({ config: props.engraving ?? [], callback: props.onEngravingStatusChange });
  engravingRequestRef.current = { config: props.engraving ?? [], callback: props.onEngravingStatusChange };
  const engravingFocusPositionRef = useRef(props.engravingFocusPosition);
  engravingFocusPositionRef.current = props.engravingFocusPosition;
  const engravingPhotoPositionRef = useRef(props.engravingPhotoPosition);
  engravingPhotoPositionRef.current = props.engravingPhotoPosition;
  const selectedCameraViewRef = useRef(props.cameraView);
  selectedCameraViewRef.current = props.cameraView;
  const cameraRequestRef = useRef(0);
  const [handPreviewStatus, setHandPreviewStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const handSkinToneRef = useRef(props.handSkinTone ?? DEFAULT_SKIN_TONE);
  handSkinToneRef.current = props.handSkinTone ?? DEFAULT_SKIN_TONE;
  const cameraControlsRef = useRef<any>(null);
  const controlsLockDepthRef = useRef(0);
  const viewerInputLockedRef = useRef(false);
  const initialRevealDoneRef = useRef(false);
  const isAutoRotatingRef = useRef(false);
  isAutoRotatingRef.current = props.isAutoRotating === true && (!props.cameraView || props.cameraView === "front" || props.cameraView === "hero");
  const loadModelsRef = useRef<any>(null);
  const [isViewerRevealed, setIsViewerRevealed] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setShowInstructions(params.get("showInstructions") === "true");
  }, []);

  useEffect(() => {
    const handleInteraction = () => setHasInteracted(true);
    window.addEventListener("pointerdown", handleInteraction, { once: true });
    window.addEventListener("wheel", handleInteraction, { once: true });
    window.addEventListener("touchstart", handleInteraction, { once: true });
    return () => {
      window.removeEventListener("pointerdown", handleInteraction);
      window.removeEventListener("wheel", handleInteraction);
      window.removeEventListener("touchstart", handleInteraction);
    };
  }, []);

  const ringRotationRef = useRef({
    x: props.ringTransform?.rotX ?? RING_ROTATION_X,
    y: props.ringTransform?.rotY ?? RING_ROTATION_Y,
    z: props.ringTransform?.rotZ ?? RING_ROTATION_Z,
  });
  const ringPositionRef = useRef({
    x: props.ringTransform?.posX ?? RING_POSITION_X,
    y: props.ringTransform?.posY ?? RING_POSITION_Y,
    z: props.ringTransform?.posZ ?? RING_POSITION_Z,
  });

  const lastHeadHexRef = useRef<string | null>(null);
  const lastShankHexRef = useRef<string | null>(null);

  const degToRad = (deg: number) => (deg * Math.PI) / 180;

  const getBandOffset = (
    index: number,
    rotationX = ringRotationRef.current.x,
  ) => {
    const signedGap = (index === 0 ? -1 : 1) * MATCHING_BAND_GAP;
    const radX = degToRad(rotationX);
    return {
      y: Math.cos(radX) * signedGap,
      z: Math.sin(radX) * signedGap,
    };
  };

  const updateRingRotation = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const { x, y, z } = ringRotationRef.current;
    const rx = degToRad(x);
    const ry = degToRad(y);
    const rz = degToRad(z);

    if (currentHeadRef.current) {
      currentHeadRef.current.rotation.set(rx, ry, rz, "XYZ");
    }
    if (currentShankRef.current) {
      currentShankRef.current.rotation.set(rx, ry, rz, "XYZ");
    }
    const baseY = ringPositionRef.current.y;
    currentBandRefs.current.forEach((band, index) => {
      if (!band) return;
      band.rotation.set(rx, ry, rz, "XYZ");
      const offset = getBandOffset(index, x);
      const baseZ = currentBandBaseZRefs.current[index] ?? band.position.z;
      band.position.y = baseY + offset.y;
      band.position.z = baseZ + offset.z;
    });
    viewer.setDirty?.();
  }, []);

  const updateRingPosition = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const { x, y, z } = ringPositionRef.current;
    if (currentHeadRef.current) {
      currentHeadRef.current.position.set(x, y, z);
    }
    if (currentShankRef.current) {
      currentShankRef.current.position.set(x, y, z);
    }
    currentBandRefs.current.forEach((band, index) => {
      if (!band) return;
      const offset = getBandOffset(index);
      const baseZ = currentBandBaseZRefs.current[index] ?? 0;
      band.position.set(x, y + offset.y, z + baseZ + offset.z);
    });
    refreshContactShadowGround(contactShadowGroundRef.current, viewer);
    viewer.setDirty?.();
  }, []);

  // Synchronize live transform prop changes from UI in real time
  useEffect(() => {
    if (!props.ringTransform) return;
    const { posX, posY, posZ, rotX, rotY, rotZ, scale } = props.ringTransform;
    ringRotationRef.current = { x: rotX, y: rotY, z: rotZ };
    ringPositionRef.current = { x: posX, y: posY, z: posZ };

    const rx = degToRad(rotX);
    const ry = degToRad(rotY);
    const rz = degToRad(rotZ);

    const baseHeadScale = typeof props.headScale === "number" ? props.headScale : 0.17;
    const baseShankScale = typeof props.shankScale === "number" ? props.shankScale : 0.17;

    if (currentHeadRef.current) {
      currentHeadRef.current.position.set(posX, posY, posZ);
      currentHeadRef.current.rotation.set(rx, ry, rz, "XYZ");
      const hs = baseHeadScale * scale;
      currentHeadRef.current.scale.set(hs, hs, hs);
    }
    if (currentShankRef.current) {
      currentShankRef.current.position.set(posX, posY, posZ);
      currentShankRef.current.rotation.set(rx, ry, rz, "XYZ");
      const ss = baseShankScale * scale;
      currentShankRef.current.scale.set(ss, ss, ss);
    }
    currentBandRefs.current.forEach((band, index) => {
      if (!band) return;
      const offset = getBandOffset(index, rotX);
      const baseZ = currentBandBaseZRefs.current[index] ?? 0;
      band.position.set(posX, posY + offset.y, posZ + baseZ + offset.z);
      band.rotation.set(rx, ry, rz, "XYZ");
    });

    alignRingHeadToShank(currentHeadRef.current, currentShankRef.current);

    if (contactShadowGroundRef.current && viewerRef.current) {
      refreshContactShadowGround(contactShadowGroundRef.current, viewerRef.current);
    }
    viewerRef.current?.setDirty?.();
  }, [props.ringTransform, props.headScale, props.shankScale]);

  useEffect(() => {
    (window as any).updateRingRotation = updateRingRotation;
    (window as any).updateRingPosition = updateRingPosition;
    (window as any).getRingRotationX = () => ringRotationRef.current.x;
    (window as any).setRingRotationX = (value: number) => {
      ringRotationRef.current.x = value;
      updateRingRotation();
    };
    (window as any).getRingRotationY = () => ringRotationRef.current.y;
    (window as any).setRingRotationY = (value: number) => {
      ringRotationRef.current.y = value;
      updateRingRotation();
    };
    (window as any).getRingRotationZ = () => ringRotationRef.current.z;
    (window as any).setRingRotationZ = (value: number) => {
      ringRotationRef.current.z = value;
      updateRingRotation();
    };
    (window as any).getRingPositionX = () => ringPositionRef.current.x;
    (window as any).setRingPositionX = (value: number) => {
      ringPositionRef.current.x = value;
      updateRingPosition();
    };
    (window as any).getRingPositionY = () => ringPositionRef.current.y;
    (window as any).setRingPositionY = (value: number) => {
      ringPositionRef.current.y = value;
      updateRingPosition();
    };
    (window as any).getRingPositionZ = () => ringPositionRef.current.z;
    (window as any).setRingPositionZ = (value: number) => {
      ringPositionRef.current.z = value;
      updateRingPosition();
    };
  }, [updateRingRotation, updateRingPosition]);

  const setViewerControlsEnabled = useCallback((enabled: boolean) => {
    viewerInputLockedRef.current = !enabled;

    const camera =
      activeCameraRef.current ?? viewerRef.current?.scene?.activeCamera;
    const controls =
      camera?.controls ??
      camera?.getControls?.() ??
      cameraControlsRef.current;
    if (controls) {
      try {
        controls.autoRotate = enabled && !cameraTweenRef.current && isAutoRotatingRef.current !== false;
        controls.enabled = enabled && !cameraTweenRef.current;
        if ("enableRotate" in controls) controls.enableRotate = enabled;
        if ("enablePan" in controls) controls.enablePan = enabled;
        if ("enableZoom" in controls) controls.enableZoom = enabled;
      } catch {
        /* ignore */
      }
    }

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.pointerEvents = enabled ? "auto" : "none";
      // OrbitControls owns drag and pinch gestures even after a capture unlock.
      canvas.style.touchAction = "none";
    }
  }, []);

  const lockViewerControls = useCallback(() => {
    controlsLockDepthRef.current += 1;
    if (controlsLockDepthRef.current === 1) {
      setViewerControlsEnabled(false);
    }
  }, [setViewerControlsEnabled]);

  const unlockViewerControls = useCallback(() => {
    controlsLockDepthRef.current = Math.max(0, controlsLockDepthRef.current - 1);
    if (controlsLockDepthRef.current === 0) {
      setViewerControlsEnabled(true);
    }
  }, [setViewerControlsEnabled]);

  const syncShankOnlyContactShadowCasting = useCallback(() => {
    if (currentHeadRef.current) {
      setSubtreeCastShadow(currentHeadRef.current, false);
    }
    if (currentShankRef.current) {
      setSubtreeCastShadow(currentShankRef.current, true);
    }
    currentBandRefs.current.forEach((band) => {
      if (band) setSubtreeCastShadow(band, false);
    });
    refreshContactShadowGround(
      contactShadowGroundRef.current,
      viewerRef.current,
    );
  }, []);

  const syncEngraving = useCallback(() => {
    const engraving = engravingRef.current ??= new RingEngraving();
    const revision = engraving.revision;
    const status = engraving.apply(currentShankRef.current, engravingRequestRef.current.config);
    if (engraving.active && engraving.revision !== revision && selectedCameraViewRef.current === "engraving") pendingCameraViewRef.current = "engraving";
    if (status === "unavailable" && pendingCameraViewRef.current === "engraving") pendingCameraViewRef.current = "front";
    engravingRequestRef.current.callback?.(status);
    viewerRef.current?.setDirty?.();
    return engraving.active ? engraving : undefined;
  }, []);

  // Both model changes and inscription changes share this capture path.
  // The caller owns the controls lock until the live transforms are restored.
  const refreshGallery = useCallback(async (viewer: any, request = previewRequestRef.current) => {
    const engraving = syncEngraving();
    if (!request.key || !request.callback || !initialRevealDoneRef.current) return;
    const key = request.key;
    const cached = previewCacheRef.current.get(key);
    if (cached) { request.callback(key, cached); return; }
    const controller = new AbortController();
    previewCaptureRef.current = controller;
    handPreviewRef.current?.suspend();
    try {
      const position = engravingPhotoPositionRef.current;
      const images = await captureRingPreviews(viewer, [currentHeadRef.current, currentShankRef.current, ...currentBandRefs.current].filter(root => root?.visible), controller.signal, { engraving: engraving && { position, cameraPose: camera => engraving.cameraPose(camera, position) } });
      if (!controller.signal.aborted && viewer === viewerRef.current && key === previewRequestRef.current.key && images.length === 3) {
        if (previewCacheRef.current.size >= 6) previewCacheRef.current.delete(previewCacheRef.current.keys().next().value!);
        previewCacheRef.current.set(key, images);
        request.callback(key, images);
      }
    } catch (error) {
      if (!controller.signal.aborted) console.warn("Ring gallery capture failed", error);
    } finally {
      if (previewCaptureRef.current === controller) previewCaptureRef.current = null;
    }
  }, [syncEngraving]);

  const loadModels = useCallback(
    async (
      viewer: any,
      manager: any,
      headData: {
        file: string | null;
        scale?: number;
        posZ?: number;
        name?: string;
      } | null,
      shankData: {
        file: string | null;
        scale?: number;
        posZ?: number;
        name?: string;
      } | null,
      bandData: Array<{
        file: string | null;
        scale?: number;
        posZ?: number;
        name?: string;
      } | null> = [null, null],
      matchingBandCount: number = 0,
      metalHex?: string,
      headMetalHex?: string,
      shankMetalHex?: string,
    ) => {
      const loadId = (loadIdRef.current += 1);
      previewCaptureRef.current?.abort();
      handPreviewRef.current?.resume(currentShankRef.current);
      const previewRequest = previewRequestRef.current;
      // A new selection restores the visible part before preparing its successor.
      partTransitionRef.current?.cancel();
      partTransitionRef.current = null;
      setPartTransitionPhase("idle");
      const hadRingBeforeLoad = !!(
        currentHeadRef.current || currentShankRef.current
      );
      const deferRingVisibility = !hadRingBeforeLoad;

      if (loadId !== loadIdRef.current) return;

      if (!viewer || viewer !== viewerRef.current) {
        console.warn("[loadModels] Stale or disposed viewer — skipping load");
        return;
      }

      const assetManager = resolveAssetManager(viewer);
      if (!assetManager?.addFromPath) {
        console.warn("[loadModels] AssetManagerPlugin not ready — skipping load");
        return;
      }

      lockViewerControls();
      try {
        if (
          !diamondPluginRef.current?.makeDiamondMesh &&
          !diamondPluginRef.current?.makeDiamond
        ) {
          const maxAttempts = deferRingVisibility ? 20 : 60;
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const dp = diamondPluginRef.current;
            if (dp?.makeDiamondMesh || dp?.makeDiamond) break;
            await new Promise((r) => setTimeout(r, 10));
          }
        }
        console.log("Starting load...");

        // ── Color application helper ───────────────────────────────────────
        const applyColorToModel = (root: any, colorHex: string) => {
          if (!root?.traverse || !colorHex) return;

          const ColorCtor = colorRef.current;
          if (!ColorCtor) return;

          const metalColor = hexSrgbToMetalColor(ColorCtor, colorHex);
          const isWhiteMetal = isWhiteGoldSrgb(colorHex);
          const metalRoughness = getMetalRoughness(colorHex);

          root.traverse((child: any) => {
            const materials = Array.isArray(child.material)
              ? child.material
              : [child.material];
            const meshIsDiamond =
              child.isMesh && isDiamondMeshOrMaterial(child.name || "");

            if (child.isMesh && materials.length > 0) {
              materials.forEach((mat: any) => {
                if (!mat) return;
                const matName = mat.name || "";

                if (
                  meshIsDiamond ||
                  isDiamondMeshOrMaterial(matName) ||
                  isDiamondMaterialType(mat)
                ) {
                  return;
                }

                if (mat.color) {
                  if (typeof mat.color.copy === "function") {
                    mat.color.copy(metalColor);
                  }
                  if (mat.emissive && typeof mat.emissive.copy === "function") {
                    if (isWhiteMetal) {
                      mat.emissive.copy(metalColor);
                      if (mat.emissiveIntensity !== undefined) {
                        mat.emissiveIntensity = 0.005;
                      }
                    } else if (typeof mat.emissive.setHex === "function") {
                      mat.emissive.setHex(0x000000);
                      if (mat.emissiveIntensity !== undefined) {
                        mat.emissiveIntensity = 0;
                      }
                    }
                  }

                  if (mat.metalness !== undefined) mat.metalness = 1.0;
                  if (mat.roughness !== undefined) mat.roughness = metalRoughness;
                  if (mat.envMapIntensity !== undefined) mat.envMapIntensity = 1.0;
                  if (mat.clearcoat !== undefined) mat.clearcoat = 0;
                  if (mat.clearcoatRoughness !== undefined) mat.clearcoatRoughness = 0;
                  if (mat.setDirty) mat.setDirty();
                  mat.needsUpdate = true;
                }
              });
            }
          });
        };

        // ── Diamond bake helpers ───────────────────────────────────────────
        const bakeDiamondOnMesh = async (
          diamondPlugin: any,
          child: any,
          cacheKey: string,
          fastFirstLoad = false,
        ) => {
          ensureUniqueDiamondMaterialForMesh(child);
          const mat = getMeshPrimaryMaterial(child);
          if (!mat) return;

          const bakeConfig = getDiamondBakeConfig(cacheKey);
          const prepareParams = { normalMapRes: DIAMOND_GEM.normalMapRes };

          if (!fastFirstLoad) {
            try {
              diamondPlugin.disposeCacheMap?.(cacheKey);
            } catch {
              /* ignore */
            }
          }

          if (typeof diamondPlugin.prepareDiamondMesh === "function") {
            await diamondPlugin.prepareDiamondMesh(child, prepareParams);
          }

          if (typeof diamondPlugin.makeDiamondMesh === "function") {
            diamondPlugin.makeDiamondMesh(
              {
                modelObject: child,
                geometry: child.geometry,
                material: mat,
                setMaterial: (nextMat: any) => {
                  if (nextMat) child.material = nextMat;
                },
              },
              prepareParams,
              bakeConfig,
            );
          } else if (typeof diamondPlugin.makeDiamond === "function") {
            diamondPlugin.makeDiamond(mat, bakeConfig, {});
          }

          const diamondMat = Array.isArray(child.material)
            ? child.material[0]
            : child.material;
          if (!diamondMat) return;

          applyDiamondShaderProps(diamondMat);
          applyDiamondWhiteColor(diamondMat);
          child.renderOrder = DIAMOND_GEM.renderOrder;
          diamondMat.userData = {
            ...diamondMat.userData,
            __isDiamond: true,
            diamondPluginApplied: true,
            __properlyLoaded: true,
          };
        };

        const clearDiamondFlags = (root: any) => {
          if (!root?.traverse) return;
          root.traverse((child: any) => {
            if (!child.isMesh) return;
            const materials = Array.isArray(child.material)
              ? child.material
              : [child.material];
            materials.forEach((mat: any) => {
              if (!mat?.userData) return;
              delete mat.userData.diamondPluginApplied;
              delete mat.userData.__processed;
              delete mat.userData.__properlyLoaded;
            });
          });
        };

        const setHeadShankVisible = (visible: boolean) => {
          if (currentHeadRef.current) currentHeadRef.current.visible = visible;
          if (currentShankRef.current) currentShankRef.current.visible = visible;
        };

        const applyFinalRingVisibility = () => {
          setHeadShankVisible(true);
          currentBandRefs.current.forEach((band, index) => {
            if (!band) return;
            const fileExists = !!currentBandFileRefs.current[index];
            band.visible = index < matchingBandCountSafe && fileExists;
          });

          // Enforce current position, rotation, and scale
          const { x: curPx, y: curPy, z: curPz } = ringPositionRef.current;
          const { x: curDegX, y: curDegY, z: curDegZ } = ringRotationRef.current;
          const curRx = degToRad(curDegX);
          const curRy = degToRad(curDegY);
          const curRz = degToRad(curDegZ);
          const curScaleMult = props.ringTransform?.scale ?? RING_SCALE_MULTIPLIER;

          if (currentHeadRef.current) {
            currentHeadRef.current.position.set(curPx, curPy, curPz);
            currentHeadRef.current.rotation.set(curRx, curRy, curRz, "XYZ");
            const baseH = typeof headData?.scale === "number" ? headData.scale : 0.17;
            const finalH = baseH * curScaleMult;
            currentHeadRef.current.scale.set(finalH, finalH, finalH);
          }
          if (currentShankRef.current) {
            currentShankRef.current.position.set(curPx, curPy, curPz);
            currentShankRef.current.rotation.set(curRx, curRy, curRz, "XYZ");
            const baseS = typeof shankData?.scale === "number" ? shankData.scale : 0.17;
            const finalS = baseS * curScaleMult;
            currentShankRef.current.scale.set(finalS, finalS, finalS);
          }
          alignRingHeadToShank(currentHeadRef.current, currentShankRef.current);
        };

        const revealViewerAfterFirstLoad = () => {
          if (initialRevealDoneRef.current) return;
          initialRevealDoneRef.current = true;
          setIsViewerRevealed(true);
          try {
            window.parent?.postMessage?.("VIEWER_READY", "*");
          } catch {
            /* ignore cross-origin postMessage errors */
          }
        };

        const getRingRoots = () =>
          [
            currentHeadRef.current,
            currentShankRef.current,
            ...currentBandRefs.current,
          ].filter(Boolean);

        let pendingHeadContainer: any = null;
        let pendingShankContainer: any = null;
        let headShankSwapPrepared = false;

        const getRingRootsForBake = () =>
          [
            pendingHeadContainer ?? currentHeadRef.current,
            pendingShankContainer ?? currentShankRef.current,
            ...currentBandRefs.current,
          ].filter(Boolean);

        const refreshAllRingDiamonds = async (options?: {
          roots?: any[];
          hideHeadShankDuringBake?: boolean;
          restoreHeadShankVisibility?: boolean;
          fastFirstLoad?: boolean;
          skipEnvironmentReload?: boolean;
        }) => {
          const diamondPlugin = diamondPluginRef.current;
          if (!diamondPlugin?.makeDiamond && !diamondPlugin?.makeDiamondMesh) {
            return;
          }

          const roots = options?.roots ?? getRingRoots();
          if (roots.length === 0) return;

          const restoreHeadShankVisibility =
            options?.restoreHeadShankVisibility ?? true;
          const hideHeadShankDuringBake =
            options?.hideHeadShankDuringBake ?? true;
          if (hideHeadShankDuringBake) {
            setHeadShankVisible(false);
          }
          roots.forEach((root) => clearDiamondFlags(root));

          const collectDiamondMeshes = () => {
            const meshes: any[] = [];
            roots.forEach((root) => {
              root.traverse((child: any) => {
                if (isDiamondMesh(child)) meshes.push(child);
              });
            });
            return meshes;
          };

          const fastFirstLoad = options?.fastFirstLoad ?? false;
          const bakeConcurrency = fastFirstLoad
            ? FIRST_LOAD_DIAMOND_BAKE_CONCURRENCY
            : DIAMOND_BAKE_CONCURRENCY;

          const bakeMeshList = async (meshes: any[]) => {
            const bakeOne = async (child: any) => {
              const container = findPartContainerForMesh(child, roots);
              const fileUrl = (container as any)?.__sourceFileUrl as
                | string
                | undefined;
              const cacheKey = getDiamondBakeCacheKey(child, fileUrl, false);
              try {
                await bakeDiamondOnMesh(diamondPlugin, child, cacheKey, fastFirstLoad);
              } catch (error) {
                console.warn(
                  `[refreshAllRingDiamonds] bake failed for "${child.name}"`,
                  error,
                );
              }
            };

            for (let i = 0; i < meshes.length; i += bakeConcurrency) {
              const chunk = meshes.slice(i, i + bakeConcurrency);
              await Promise.all(chunk.map(bakeOne));
              if (!fastFirstLoad) {
                viewer.setDirty?.();
              }
            }
          };

          const getPendingDiamondMeshes = (meshes: any[]) =>
            meshes.filter((child) => {
              const mat = getMeshPrimaryMaterial(child);
              return mat && !isDiamondMaterialType(mat);
            });

          const bakeAllDiamondMeshesInRoots = async () => {
            let diamondMeshes = collectDiamondMeshes();
            console.log(
              `[refreshAllRingDiamonds] Baking ${diamondMeshes.length} diamond meshes on ${roots.length} part(s)`,
            );
            if (diamondMeshes.length === 0) return;

            await bakeMeshList(diamondMeshes);

            for (let attempt = 0; attempt < 3; attempt++) {
              const pending = getPendingDiamondMeshes(diamondMeshes);
              if (pending.length === 0) break;
              console.log(
                `[refreshAllRingDiamonds] Retry ${attempt + 1}: ${pending.length} meshes pending`,
              );
              await bakeMeshList(pending);
            }

            const rescanned = collectDiamondMeshes();
            const stillPending = getPendingDiamondMeshes(rescanned);
            if (stillPending.length > 0) {
              console.log(
                `[refreshAllRingDiamonds] Final pass: ${stillPending.length} meshes pending`,
              );
              await bakeMeshList(stillPending);
            }
          };

          await bakeAllDiamondMeshesInRoots();

          roots.forEach((root) => {
            applyDiamondMaterialRuntimeSettings(root);
            root.traverse?.((child: any) => {
              if (!isDiamondMesh(child)) return;
              const materials = Array.isArray(child.material)
                ? child.material
                : [child.material];
              materials.forEach((m: any) => {
                if (m) applyDiamondWhiteColor(m);
              });
            });
          });

          if (options?.skipEnvironmentReload) {
            refreshDiamondPluginEnvOnly(
              diamondPlugin,
              diamondEnvironmentAssetRef.current,
            );
            diamondPlugin.refreshEnvMaps?.();
          } else {
            await applyCustomEnvironmentRef.current?.();
            refreshDiamondPluginEnvOnly(
              diamondPlugin,
              diamondEnvironmentAssetRef.current,
            );
            diamondPlugin.refreshEnvMaps?.();
          }
          if (hideHeadShankDuringBake && restoreHeadShankVisibility) {
            setHeadShankVisible(true);
          }
          syncShankOnlyContactShadowCasting();
          viewer.setDirty?.();
        };

        const disposeObject = (obj: any) => {
          if (!obj) return;
          obj.parent?.remove?.(obj);
        };

        const disposePendingContainers = (...containers: any[]) => {
          containers.forEach((container) => {
            if (!container) return;
            disposeObject(container);
          });
        };

        const setBandVisibility = (count: number) => {
          currentBandRefs.current.forEach((band, index) => {
            if (!band) return;
            const fileExists = !!currentBandFileRefs.current[index];
            band.visible = index < count && fileExists;
          });
        };

        const incomingShankFile = shankData?.file || null;
        const incomingHeadFile = headData?.file || null;
        const incomingBandFile1 = bandData?.[0]?.file || null;
        const incomingBandFile2 = bandData?.[1]?.file || null;

        const updateHead = incomingHeadFile !== currentHeadFileRef.current;
        const updateShank = incomingShankFile !== currentShankFileRef.current;
        const updateBand1 = incomingBandFile1 !== currentBandFileRefs.current[0];
        const updateBand2 = incomingBandFile2 !== currentBandFileRefs.current[1];

        const matchingBandCountSafe = Math.max(
          0,
          Math.min(2, Number(matchingBandCount) || 0),
        );
        const matchingBandCountChanged =
          matchingBandCountSafe !== lastMatchingBandCountRef.current;

        console.log("loadModels called with:", {
          headDataFile: incomingHeadFile,
          shankDataFile: incomingShankFile,
          bandFile1: incomingBandFile1,
          bandFile2: incomingBandFile2,
          matchingBandCount: matchingBandCountSafe,
          updateHead,
          updateShank,
          updateBand1,
          updateBand2,
          loadId,
        });

        if (
          !updateShank &&
          !updateHead &&
          !updateBand1 &&
          !updateBand2 &&
          !matchingBandCountChanged
        ) {
          if (metalHex || headMetalHex || shankMetalHex) {
            const defaultColor = metalHex || METAL_COLORS_SRGB.white_gold;
            if (headMetalHex)
              applyColorToModel(currentHeadRef.current, headMetalHex);
            else applyColorToModel(currentHeadRef.current, defaultColor);

            if (shankMetalHex)
              applyColorToModel(currentShankRef.current, shankMetalHex);
            else applyColorToModel(currentShankRef.current, defaultColor);

            currentBandRefs.current.forEach((band) => {
              if (!band) return;
              if (shankMetalHex) applyColorToModel(band, shankMetalHex);
              else applyColorToModel(band, defaultColor);
            });

            viewer.setDirty?.();
          }

          await refreshAllRingDiamonds({ hideHeadShankDuringBake: false });
          console.log("No model updates needed, only colors applied if any.");
          return;
        }

        if (
          !updateShank &&
          !updateHead &&
          !updateBand1 &&
          !updateBand2 &&
          matchingBandCountChanged
        ) {
          setBandVisibility(matchingBandCountSafe);
          lastMatchingBandCountRef.current = matchingBandCountSafe;
          viewer.setDirty?.();
          return;
        }

        let previousShank: any = null;
        let previousHead: any = null;
        let headShankSmoothSwapDone = false;

        const disposePreviousHeadShank = () => {
          if (
            updateShank &&
            previousShank &&
            previousShank !== currentShankRef.current
          ) {
            console.log("Disposing previous shank");
            if (previousShank.parent) previousShank.parent.remove(previousShank);
            disposeObject(previousShank);
            previousShank = null;
          }
          if (
            updateHead &&
            previousHead &&
            previousHead !== currentHeadRef.current
          ) {
            console.log("Disposing previous head");
            if (previousHead.parent) previousHead.parent.remove(previousHead);
            disposeObject(previousHead);
            previousHead = null;
          }
        };

        if (updateHead || updateShank) {
          previousShank = currentShankRef.current;
          previousHead = currentHeadRef.current;
        }

        if (updateBand1 && currentBandRefs.current[0]) {
          console.log("Disposing old matching band 1:", currentBandFileRefs.current[0]);
          if (currentBandRefs.current[0].parent) {
            currentBandRefs.current[0].parent.remove(currentBandRefs.current[0]);
          }
          disposeObject(currentBandRefs.current[0]);
          currentBandRefs.current[0] = null;
          currentBandFileRefs.current[0] = null;
          currentBandBaseZRefs.current[0] = null;
        }
        if (updateBand2 && currentBandRefs.current[1]) {
          console.log("Disposing old matching band 2:", currentBandFileRefs.current[1]);
          if (currentBandRefs.current[1].parent) {
            currentBandRefs.current[1].parent.remove(currentBandRefs.current[1]);
          }
          disposeObject(currentBandRefs.current[1]);
          currentBandRefs.current[1] = null;
          currentBandFileRefs.current[1] = null;
          currentBandBaseZRefs.current[1] = null;
        }

        if (loadId !== loadIdRef.current) {
          console.log("Aborted before load due to new load request");
          return;
        }

        const partCaches: PartMeshCaches = {
          head: headModelCacheRef.current,
          shank: shankModelCacheRef.current,
          band: bandModelCacheRef.current,
        };

        const loadPart = async (
          variant: any,
          loadType: PartLoadType,
        ): Promise<any | null> => {
          if (!variant?.file) return null;
          if (loadId !== loadIdRef.current) return null;

          const fileUrl = variant.file;
          const loadKey = getPartLoadKey(loadType, fileUrl);
          const targetCache = getPartModelCache(loadType, partCaches);
          const Object3DCtor = object3dRef.current;
          if (!Object3DCtor) return null;

          const buildContainerFromCache = (cachedMeshes: any[]) => {
            cachedMeshes.forEach((mesh) => disableModelGltfAnimations(mesh));
            const displayMeshes = cachedMeshes.map(cloneMeshForDisplay);
            const scaleMult = props.ringTransform?.scale ?? RING_SCALE_MULTIPLIER;
            const container = buildPartContainer(
              Object3DCtor,
              variant,
              displayMeshes,
              loadType,
              fileUrl,
              ringRotationRef.current,
              ringPositionRef.current,
              scaleMult,
            );
            (container as any).__loadedFromCache = true;
            console.log(`[loadPart] Cache hit ${loadKey} (${displayMeshes.length} meshes)`);
            return container;
          };

          const cachedMeshes = getValidCachedMeshes(targetCache, fileUrl);
          if (cachedMeshes) {
            if (loadId !== loadIdRef.current) return null;
            return buildContainerFromCache(cachedMeshes);
          }

          const inFlight = partLoadInFlightRef.current.get(loadKey);
          if (inFlight) {
            console.log(`[loadPart] Awaiting in-flight load ${loadKey}`);
            await inFlight;
            if (loadId !== loadIdRef.current) return null;
            const warmed = getValidCachedMeshes(targetCache, fileUrl);
            if (!warmed) return null;
            return buildContainerFromCache(warmed);
          }

          console.log(`[loadPart] Network load ${loadKey}`);
          const cached = await ensurePartMeshesCached(
            viewer,
            loadType,
            fileUrl,
            partCaches,
            partLoadInFlightRef,
            { loadId, loadIdRef },
          );
          if (loadId !== loadIdRef.current) return null;
          if (!cached) {
            console.error(`[loadPart] No meshes after import ${loadKey}`);
            return null;
          }

          const warmedMeshes = getValidCachedMeshes(targetCache, fileUrl);
          if (!warmedMeshes) return null;

          const container = buildContainerFromCache(warmedMeshes);
          (container as any).__loadedFromCache = false;
          console.log(`[loadPart] Network ready ${loadKey} (${warmedMeshes.length} meshes)`);
          return container;
        };

        const [
          newShankContainer,
          newHeadContainer,
          newBandContainer1,
          newBandContainer2,
        ] = await Promise.all([
          updateShank && shankData?.file
            ? loadPart(shankData, "shank")
            : Promise.resolve(null),
          updateHead && headData?.file
            ? loadPart(headData, "head")
            : Promise.resolve(null),
          updateBand1 && bandData?.[0]?.file
            ? loadPart(bandData[0], "band")
            : Promise.resolve(null),
          updateBand2 && bandData?.[1]?.file
            ? loadPart(bandData[1], "band")
            : Promise.resolve(null),
        ]);

        if (loadId !== loadIdRef.current) {
          console.log("Aborted after parallel part load - loadId changed");
          disposePendingContainers(
            newShankContainer,
            newHeadContainer,
            newBandContainer1,
            newBandContainer2,
          );
          return;
        }

        const headShankLoadFailed =
          (updateShank && !!shankData?.file && !newShankContainer) ||
          (updateHead && !!headData?.file && !newHeadContainer);
        if (headShankLoadFailed) {
          console.warn("[loadModels] Head/shank GLB load failed — keeping previous models");
          disposePendingContainers(newShankContainer, newHeadContainer);
          return;
        }

        const targetHeadHex =
          headMetalHex || metalHex || METAL_COLORS_SRGB.white_gold;
        const targetShankHex =
          shankMetalHex || metalHex || METAL_COLORS_SRGB.white_gold;

        const commitHeadShankSwap = () => {
          if (!headShankSwapPrepared) return;

          const scene = viewer.scene;

          const instantSwapPart = (
            previous: any,
            pending: any,
            onCommitted: (container: any) => void,
          ) => {
            if (!pending) return;
            pending.visible = false;
            if (previous && previous !== pending) {
              previous.visible = false;
              if (previous.parent) previous.parent.remove(previous);
              disposeObject(previous);
            }
            if (!pending.parent) scene.add(pending);
            pending.visible = true;
            onCommitted(pending);
          };

          if (pendingShankContainer) {
            instantSwapPart(previousShank, pendingShankContainer, (container) => {
              currentShankRef.current = container;
              currentShankFileRef.current = shankData!.file;
            });
            pendingShankContainer = null;
            previousShank = null;
          }

          if (pendingHeadContainer) {
            instantSwapPart(previousHead, pendingHeadContainer, (container) => {
              currentHeadRef.current = container;
              currentHeadFileRef.current = headData!.file;
            });
            pendingHeadContainer = null;
            previousHead = null;
          }

          headShankSwapPrepared = false;
          headShankSmoothSwapDone = true;

          // Re-enforce live position, rotation, and scale on both parts
          const { x: curPx, y: curPy, z: curPz } = ringPositionRef.current;
          const { x: curDegX, y: curDegY, z: curDegZ } = ringRotationRef.current;
          const curRx = degToRad(curDegX);
          const curRy = degToRad(curDegY);
          const curRz = degToRad(curDegZ);
          const curScaleMult = props.ringTransform?.scale ?? RING_SCALE_MULTIPLIER;

          if (currentHeadRef.current) {
            currentHeadRef.current.position.set(curPx, curPy, curPz);
            currentHeadRef.current.rotation.set(curRx, curRy, curRz, "XYZ");
            const baseH = typeof headData?.scale === "number" ? headData.scale : 0.17;
            const finalH = baseH * curScaleMult;
            currentHeadRef.current.scale.set(finalH, finalH, finalH);
          }
          if (currentShankRef.current) {
            currentShankRef.current.position.set(curPx, curPy, curPz);
            currentShankRef.current.rotation.set(curRx, curRy, curRz, "XYZ");
            const baseS = typeof shankData?.scale === "number" ? shankData.scale : 0.17;
            const finalS = baseS * curScaleMult;
            currentShankRef.current.scale.set(finalS, finalS, finalS);
          }

          alignRingHeadToShank(currentHeadRef.current, currentShankRef.current);
          syncEngraving();
          syncShankOnlyContactShadowCasting();
          viewer.renderer?.refreshPipeline?.();
          viewer.setDirty?.();
        };

        const prepareHeadShankSwap = async () => {
          if (!newShankContainer && !newHeadContainer) return;

          const scene = viewer.scene;
          const { x: px, y: py, z: pz } = ringPositionRef.current;
          const { x: degX, y: degY, z: degZ } = ringRotationRef.current;
          const rx = degToRad(degX);
          const ry = degToRad(degY);
          const rz = degToRad(degZ);
          const scaleMult = props.ringTransform?.scale ?? RING_SCALE_MULTIPLIER;

          if (newShankContainer) {
            newShankContainer.visible = false;
            newShankContainer.position.set(px, py, pz);
            newShankContainer.rotation.set(rx, ry, rz, "XYZ");
            const baseS = typeof shankData?.scale === "number" ? shankData.scale : 0.17;
            const finalS = baseS * scaleMult;
            newShankContainer.scale.set(finalS, finalS, finalS);
            applyColorToModel(newShankContainer, targetShankHex);
            lastShankHexRef.current = targetShankHex;
            if (deferRingVisibility) {
              scene.add(newShankContainer);
              currentShankRef.current = newShankContainer;
              currentShankFileRef.current = shankData!.file;
            } else {
              if (!newShankContainer.parent) {
                scene.add(newShankContainer);
              }
              pendingShankContainer = newShankContainer;
            }
          }

          if (newHeadContainer) {
            newHeadContainer.visible = false;
            newHeadContainer.position.set(px, py, pz);
            newHeadContainer.rotation.set(rx, ry, rz, "XYZ");
            const baseH = typeof headData?.scale === "number" ? headData.scale : 0.17;
            const finalH = baseH * scaleMult;
            newHeadContainer.scale.set(finalH, finalH, finalH);
            applyColorToModel(newHeadContainer, targetHeadHex);
            lastHeadHexRef.current = targetHeadHex;
            if (deferRingVisibility) {
              scene.add(newHeadContainer);
              currentHeadRef.current = newHeadContainer;
              currentHeadFileRef.current = headData!.file;
            } else {
              if (!newHeadContainer.parent) {
                scene.add(newHeadContainer);
              }
              pendingHeadContainer = newHeadContainer;
            }
          }

          if (loadId !== loadIdRef.current) {
            disposePendingContainers(newShankContainer, newHeadContainer);
            pendingHeadContainer = null;
            pendingShankContainer = null;
            headShankSwapPrepared = false;
            return;
          }

          if (deferRingVisibility) {
            disposePreviousHeadShank();
            headShankSmoothSwapDone = true;
          } else {
            headShankSwapPrepared = true;
          }
        };

        if ((updateHead || updateShank) && (newHeadContainer || newShankContainer)) {
          await prepareHeadShankSwap();
          if (loadId !== loadIdRef.current) {
            disposePendingContainers(pendingShankContainer, pendingHeadContainer);
            return;
          }
          if (!headShankSwapPrepared && !headShankSmoothSwapDone) return;
        }

        if (newBandContainer1 || newBandContainer2 || updateBand1 || updateBand2) {
          const scene = viewer.scene;
          const posY = ringPositionRef.current.y;

          const setBandPlacement = (
            container: any,
            index: number,
            posZ?: number,
          ) => {
            if (!container) return;
            const { x, y, z } = ringRotationRef.current;
            container.rotation.set(degToRad(x), degToRad(y), degToRad(z), "XYZ");
            const baseZ =
              typeof posZ === "number" ? posZ : container.position.z || 0;
            currentBandBaseZRefs.current[index] = baseZ;
            const offset = getBandOffset(index, x);
            container.position.y = posY + offset.y;
            container.position.z = baseZ + offset.z;
          };

          if (newBandContainer1) {
            setBandPlacement(newBandContainer1, 0, bandData?.[0]?.posZ);
            scene.add(newBandContainer1);
            currentBandRefs.current[0] = newBandContainer1;
            currentBandFileRefs.current[0] = bandData?.[0]?.file || null;
            console.log("Matching band 1 updated successfully:", bandData?.[0]?.file);
          } else if (updateBand1 && !bandData?.[0]?.file) {
            currentBandRefs.current[0] = null;
            currentBandFileRefs.current[0] = null;
            currentBandBaseZRefs.current[0] = null;
          }

          if (newBandContainer2) {
            setBandPlacement(newBandContainer2, 1, bandData?.[1]?.posZ);
            scene.add(newBandContainer2);
            currentBandRefs.current[1] = newBandContainer2;
            currentBandFileRefs.current[1] = bandData?.[1]?.file || null;
            console.log("Matching band 2 updated successfully:", bandData?.[1]?.file);
          } else if (updateBand2 && !bandData?.[1]?.file) {
            currentBandRefs.current[1] = null;
            currentBandFileRefs.current[1] = null;
            currentBandBaseZRefs.current[1] = null;
          }
        }

        if (loadId !== loadIdRef.current) return;

        if (!headShankSmoothSwapDone && currentHeadRef.current) {
          const headColorChanged = targetHeadHex !== lastHeadHexRef.current;
          if ((updateHead || headColorChanged) && !pendingHeadContainer) {
            applyColorToModel(currentHeadRef.current, targetHeadHex);
            lastHeadHexRef.current = targetHeadHex;
          }
        }

        if (!headShankSmoothSwapDone && currentShankRef.current) {
          const shankColorChanged = targetShankHex !== lastShankHexRef.current;
          if ((updateShank || shankColorChanged) && !pendingShankContainer) {
            applyColorToModel(currentShankRef.current, targetShankHex);
            lastShankHexRef.current = targetShankHex;
          }
        }

        currentBandRefs.current.forEach((band, index) => {
          if (!band) return;
          if (
            updateBand1 ||
            updateBand2 ||
            updateShank ||
            targetShankHex !== lastShankHexRef.current
          ) {
            applyColorToModel(band, targetShankHex);
          }
          const fileExists = !!currentBandFileRefs.current[index];
          band.visible =
            !deferRingVisibility &&
            index < matchingBandCountSafe &&
            fileExists;
        });

        lastMatchingBandCountRef.current = matchingBandCountSafe;

        if (!headShankSwapPrepared) {
          viewer.renderer?.refreshPipeline?.();
          viewer.setDirty?.();
        }

        const ringRoots = getRingRootsForBake();
        const runFullRingDiamondRefresh = (opts?: {
          restoreHeadShankVisibility?: boolean;
        }) =>
          refreshAllRingDiamonds({
            roots: ringRoots,
            hideHeadShankDuringBake: false,
            restoreHeadShankVisibility: opts?.restoreHeadShankVisibility ?? true,
            fastFirstLoad: deferRingVisibility,
            skipEnvironmentReload:
              deferRingVisibility &&
              !!(
                metalEnvironmentAssetRef.current &&
                diamondEnvironmentAssetRef.current
              ),
          });

        if (ringRoots.length > 0) {
          if (deferRingVisibility) {
            setHeadShankVisible(false);
            currentBandRefs.current.forEach((band) => {
              if (band) band.visible = false;
            });
            await runFullRingDiamondRefresh({ restoreHeadShankVisibility: false });
            applyFinalRingVisibility();
            await initializeRingCameraRef.current?.();
            getRingRoots().forEach(prepareRingDissolve);
            revealViewerAfterFirstLoad();
            viewer.renderer?.refreshPipeline?.();
            viewer.setDirty?.();
            console.log("Load complete — metal and diamond materials applied, viewer revealed");
          } else if (headShankSwapPrepared) {
            await runFullRingDiamondRefresh({ restoreHeadShankVisibility: false });
            if (loadId !== loadIdRef.current) {
              disposePendingContainers(pendingShankContainer, pendingHeadContainer);
              return;
            }
            freezeContactShadowGroundTransform(contactShadowGroundRef.current);
            const transition = animateRingDissolve({
              outgoing: getRingRoots().filter((root) => root.visible),
              incoming: getRingRootsForBake().filter((root) =>
                root === pendingHeadContainer || root === pendingShankContainer || root.visible,
              ),
              depthMaterial: viewer.getPlugin?.(GBufferPlugin)?.material,
              onSwap: commitHeadShankSwap,
              onUpdate: () => viewer.setDirty?.(),
              onVisibilityChange: createContactShadowFade(contactShadowGroundRef.current),
              onPhaseChange: setPartTransitionPhase,
              reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
            });
            partTransitionRef.current = transition;
            try {
              const completed = await transition.finished;
              if (!completed || loadId !== loadIdRef.current) {
                disposePendingContainers(pendingShankContainer, pendingHeadContainer);
                return;
              }
            } catch (error) {
              disposePendingContainers(pendingShankContainer, pendingHeadContainer);
              throw error;
            } finally {
              if (partTransitionRef.current === transition) {
                partTransitionRef.current = null;
                setPartTransitionPhase("idle");
              }
              unfreezeContactShadowGroundTransform(contactShadowGroundRef.current, viewer);
            }
            viewer.renderer?.refreshPipeline?.();
            viewer.setDirty?.();
            console.log("Load complete — head/shank dissolve transition");
          } else {
            await runFullRingDiamondRefresh();
            console.log("Load complete");
          }
        } else if (deferRingVisibility) {
          revealViewerAfterFirstLoad();
          console.log("Load complete — viewer revealed (no ring parts)");
        } else {
          console.log("Load complete");
        }
      } catch (error) {
        console.error("Load error:", error);
      } finally {
        if (
          loadId === loadIdRef.current && viewer === viewerRef.current &&
          initialRevealDoneRef.current && previewRequest.key && previewRequest.callback &&
          currentHeadFileRef.current === headData?.file && currentShankFileRef.current === shankData?.file
        ) {
          await refreshGallery(viewer, previewRequest);
        }
        unlockViewerControls();
        if (!viewerInputLockedRef.current && loadId === loadIdRef.current) handPreviewRef.current?.resume(currentShankRef.current);
        if (!viewerInputLockedRef.current && pendingCameraViewRef.current) {
          const pendingView = pendingCameraViewRef.current;
          pendingCameraViewRef.current = null;
          (window as any).goToCameraView?.(pendingView);
        }
        const ctrl =
          cameraControlsRef.current ?? viewer.scene?.activeCamera?.controls;
        if (ctrl && !viewerInputLockedRef.current && !cameraTweenRef.current && isAutoRotatingRef.current !== false) {
          ctrl.autoRotate = true;
        }
        ensureSSRDisabled(viewer);
        viewer.setDirty?.();
        if (viewer.scene?.setDirty) viewer.scene.setDirty();
      }
    },
    [
      updateRingRotation,
      updateRingPosition,
      syncShankOnlyContactShadowCasting,
      lockViewerControls,
      unlockViewerControls,
      syncEngraving,
      refreshGallery,
    ],
  );

  loadModelsRef.current = loadModels;

  // ── Viewer initialization ──────────────────────────────────────────────────
  useEffect(() => {
    let viewerInstance: any = null;
    let isMounted = true;
    const cleanupStack: Array<() => void> = [];

    const init = async () => {
      if (!canvasRef.current) return;

      colorRef.current = Color;

      if (!isMounted) return;

      const viewer = new CoreViewerApp({
        canvas: canvasRef.current,
        useGBufferDepth: true,
        isAntialiased: ENABLE_MSAA,
      });

      await viewer.initialize({
        interactionPrompt: false,
        importPopup: false,
        ground: false,
        bloom: false,
        depthTonemap: false,
        enableDrop: false,
        caching: false,
      });

      if (!isMounted) {
        viewer.dispose?.();
        return;
      }

      const viewerAny = viewer as any;
      await disableSSRPlugin(viewerAny);
      const renderer = viewerAny.renderer;
      const isMobileDevice =
        mobileAndTabletCheck?.() || window.innerWidth <= 768;
      const renderScale = isMobileDevice ? Math.min(2, Math.max(DISPLAY_CANVAS_SCALING, window.devicePixelRatio || 1)) : 2;
      if (renderer && typeof renderer.renderScale !== "undefined") {
        renderer.renderScale = renderScale;
      } else if (renderer && typeof renderer.displayCanvasScaling !== "undefined") {
        renderer.displayCanvasScaling = renderScale;
      }

      const lutPlugin = viewerAny.getPlugin(LUTPlugin);
      if (lutPlugin) await viewerAny.removePlugin(lutPlugin);

      const interactionPromptPlugin = viewerAny.getPlugin(InteractionPromptPlugin);
      if (interactionPromptPlugin) await viewerAny.removePlugin(interactionPromptPlugin);

      const loadingScreenPlugin: any = viewerAny.getPlugin(LoadingScreenPlugin);
      if (loadingScreenPlugin) loadingScreenPlugin.showFileNames = false;

      const depthOfFieldPlugin: any = viewerAny.getPlugin(DepthOfFieldPlugin);
      if (depthOfFieldPlugin) depthOfFieldPlugin.enabled = false;

      const gltfAnimationPlugin =
        viewerAny.getPluginByType?.("GLTFAnimation") ??
        viewerAny.getPluginByType?.("GLTFAnimationPlugin");
      if (gltfAnimationPlugin) {
        disableViewerGltfAnimations(viewerAny);
        try {
          await viewerAny.removePlugin(gltfAnimationPlugin);
        } catch (error) {
          console.warn("[RingViewer] GLTFAnimationPlugin could not be removed", error);
        }
      }

      viewer.scene.setBackgroundColor?.(BACKGROUND_COLOR);

      if (!isMounted) {
        viewer.dispose?.();
        return;
      }

      viewerInstance = viewer;
      viewerRef.current = viewer;
      (window as any).__viewer = viewer;
      (window as any).__ringRefs = { currentHeadRef, currentShankRef };

      const getOrAddPlugin = async (Plugin: any, instance?: any) => {
        const existing = viewerAny.getPlugin(Plugin);
        if (existing) return existing;
        return instance
          ? viewerAny.addPlugin(instance)
          : viewerAny.addPlugin(Plugin);
      };

      let manager: any = resolveAssetManager(viewerAny);
      if (!manager) {
        manager = await viewerAny.addPlugin(AssetManagerPlugin);
      }
      managerRef.current = manager;
      await getOrAddPlugin(EXRLoadPlugin);

      const disposeEnvironmentAsset = (asset: any) => {
        if (!asset) return;
        try {
          asset.dispose?.();
        } catch (error) {
          console.warn("[RingViewer] Failed to dispose environment asset", error);
        }
      };

      const importEnvironmentAssetFromUrl = async (url: string) => {
        const importer =
          manager?.importer ||
          viewerAny?.getManager?.()?.importer ||
          viewerAny?.assetManager?.importer;
        if (importer?.importSinglePath) {
          return importer.importSinglePath(url);
        }
        throw new Error("WebGi environment importer is unavailable.");
      };

      const applyCustomEnvironmentMaps = async () => {
        const diamondPlugin = diamondPluginRef.current;
        try {
          const [metalResult, diamondResult] = await Promise.allSettled([
            importEnvironmentAssetFromUrl(CUSTOM_METAL_ENV_URL),
            importEnvironmentAssetFromUrl(CUSTOM_DIAMOND_ENV_URL),
          ]);

          if (metalResult.status === "fulfilled") {
            const metalAsset = metalResult.value;
            if (viewer.scene?.setEnvironment) {
              await viewer.scene.setEnvironment(metalAsset);
            } else if (viewer.scene) {
              viewer.scene.environment = metalAsset;
            }
            if (viewer.scene?.environment) {
              viewer.scene.environment.rotation = METAL_ENV_ROTATION;
            }
            if (viewer.scene) {
              viewer.scene.fixedEnvMapDirection = true;
            }
            viewer.scene.setBackgroundColor?.(BACKGROUND_COLOR);
            if ((viewer.scene as any).background !== undefined) {
              (viewer.scene as any).background = new Color(BACKGROUND_COLOR);
            }
            if (metalEnvironmentAssetRef.current !== metalAsset) {
              disposeEnvironmentAsset(metalEnvironmentAssetRef.current);
              metalEnvironmentAssetRef.current = metalAsset;
            }
          } else {
            console.warn("[RingViewer] Failed to load metal environment", metalResult.reason);
          }

          if (diamondResult.status === "fulfilled" && diamondPlugin) {
            const diamondAsset = diamondResult.value;
            if (diamondEnvironmentAssetRef.current !== diamondAsset) {
              disposeEnvironmentAsset(diamondEnvironmentAssetRef.current);
              diamondEnvironmentAssetRef.current = diamondAsset;
            }
            refreshDiamondPluginEnvOnly(diamondPlugin, diamondAsset);
          } else if (diamondResult.status === "rejected") {
            console.warn("[RingViewer] Failed to load diamond environment", diamondResult.reason);
          }

          viewer.setDirty?.();
        } catch (error) {
          console.warn("[RingViewer] Failed to apply custom metal/diamond environment maps", error);
        }
      };

      applyCustomEnvironmentRef.current = applyCustomEnvironmentMaps;

      const initialParams = new URLSearchParams(window.location.search);
      const initialHeadFile =
        props.headFile ||
        initialParams.get("headFile") ||
        DEFAULT_HEAD_FILE;
      const initialShankFile =
        props.shankFile ||
        initialParams.get("shankFile") ||
        DEFAULT_SHANK_FILE;
      const partMeshCaches: PartMeshCaches = {
        head: headModelCacheRef.current,
        shank: shankModelCacheRef.current,
        band: bandModelCacheRef.current,
      };
      const environmentMapsPromise = applyCustomEnvironmentMaps();
      const headShankPrefetchPromise = prefetchHeadShankMeshes(
        viewer,
        partMeshCaches,
        partLoadInFlightRef,
        initialHeadFile,
        initialShankFile,
      );

      await getOrAddPlugin(GBufferPlugin);
      ensureSSRDisabled(viewerAny);
      configureRingOcclusion(viewerAny);

      const progressivePlugin: any =
        viewerAny.getPlugin(ProgressivePlugin) ||
        (await getOrAddPlugin(
          ProgressivePlugin,
          new ProgressivePlugin(PROGRESSIVE_PLUGIN_SAMPLES),
        ));
      if (progressivePlugin) {
        progressivePlugin.maxFrameCount = PROGRESSIVE_PLUGIN_SAMPLES;
      }

      let tonemapPlugin: any = viewerAny.getPlugin(TonemapPlugin);
      if (!tonemapPlugin) {
        tonemapPlugin = await getOrAddPlugin(TonemapPlugin, new TonemapPlugin(false));
      }
      if (tonemapPlugin?.config) {
        tonemapPlugin.config.contrast = TONEMAP_CONTRAST;
        tonemapPlugin.config.saturation = TONEMAP_SATURATION;
      }

      const diamondPlugin: any = await getOrAddPlugin(DiamondPlugin);
      diamondPluginRef.current = diamondPlugin;
      syncDiamondPluginFromConfig(diamondPlugin);
      syncRefractionPassRayBounces(viewer as any);
      await Promise.all([environmentMapsPromise, headShankPrefetchPromise]);

      const light = new DirectionalLight(0xf5f5f5, 0.12);
      light.position.set(1.5, 6, 1.5);
      viewer.scene.add(light);
      viewer.scene.add(new AmbientLight(0xffffff, 1.3));

      await getOrAddPlugin(RandomizedDirectionalLightPlugin);

      const contactShadow: any = await getOrAddPlugin(ContactShadowGroundPlugin);
      contactShadowGroundRef.current = contactShadow;
      configureContactShadowGround(contactShadow);
      refreshContactShadowGround(contactShadow, viewer);

      const temporalAAPlugin: any = await getOrAddPlugin(TemporalAAPlugin);
      temporalAAPluginRef.current = temporalAAPlugin;
      if (temporalAAPlugin) {
        temporalAAPlugin.enabled = isMobileDevice || TEMPORAL_AA_ENABLED;
        if ("stableNoise" in temporalAAPlugin) {
          temporalAAPlugin.stableNoise = TEMPORAL_AA_USE_TOTAL_FRAME_COUNT;
        } else if ("useTotalFrameCount" in temporalAAPlugin) {
          temporalAAPlugin.useTotalFrameCount = TEMPORAL_AA_USE_TOTAL_FRAME_COUNT;
        }
      }

      let alignedOrbitModule: typeof import("three/examples/jsm/controls/OrbitControls.js") | undefined;
      const applyPresetCameraView = async (name: string, initial = false) => {
        const requestId = ++cameraRequestRef.current;
        const activeCamera = viewerRef.current?.scene?.activeCamera as any;
        const viewer = viewerRef.current;
        if (!activeCamera?.position) return false;
        // Gallery capture temporarily poses the real ring for each photograph.
        // Frame a requested view only after the live transforms are restored.
        if (!initial && (previewCaptureRef.current || viewerInputLockedRef.current)) {
          pendingCameraViewRef.current = name;
          return false;
        }
        pendingCameraViewRef.current = null;
        if (name === "engraving" && !engravingRef.current?.matches(engravingRequestRef.current.config)) {
          if (engravingRequestRef.current.config.length) pendingCameraViewRef.current = name;
          return false;
        }
        const revealFrame = initial ? (_immediate?: boolean) => {} : await holdViewerFrame(viewer, canvasRef.current!);
        try {
          if (requestId !== cameraRequestRef.current || viewerRef.current !== viewer) return false;
          if (!initial && (previewCaptureRef.current || viewerInputLockedRef.current)) { pendingCameraViewRef.current = name; return false; }
          cameraTweenRef.current?.kill();
          cameraTweenRef.current = null;
          const view = name === "side" ? "head" : name === "hero" ? "front" : name;
          const ground = contactShadowGroundRef.current;
          if (ground) {
            ground.visible = view !== "engraving";
            if (ground.mesh?.modelObject) ground.mesh.modelObject.visible = view !== "engraving";
          }
          const mobile = window.innerWidth <= 768;
          const baseMinDistance = mobile ? CAMERA_MIN_DISTANCE_MOBILE : CAMERA_MIN_DISTANCE_DESKTOP;
          const baseMaxDistance = mobile ? CAMERA_MAX_DISTANCE_MOBILE : CAMERA_MAX_DISTANCE_DESKTOP;
          const hero = CAMERA_PRESETS.hero;
          let handPose;
          if (view === "hand") {
            const hand = handPreviewRef.current ??= new HandPreview(viewer, manager);
            setHandPreviewStatus("loading");
            await hand.load();
            if (requestId !== cameraRequestRef.current || viewerRef.current !== viewer) return false;
            if (previewCaptureRef.current || viewerInputLockedRef.current) { pendingCameraViewRef.current = name; return false; }
            hand.show(currentShankRef.current);
            hand.setSkinTone(handSkinToneRef.current);
            handPose = hand.cameraPose(activeCamera);
            handPose.minDistance = Math.max(0.3, handPose.position.distanceTo(handPose.target) * 0.08);
            setHandPreviewStatus("ready");
          } else {
            handPreviewRef.current?.hide();
            setHandPreviewStatus("idle");
          }
          const pose = handPose ?? (view === "engraving" ? engravingRef.current?.cameraPose(activeCamera, engravingFocusPositionRef.current) : getRingCameraPose(view, currentHeadRef.current, currentShankRef.current, activeCamera)) ?? {
            position: new Vector3(hero.position.x, hero.position.y, hero.position.z),
            target: new Vector3(hero.target.x, hero.target.y, hero.target.z),
            up: new Vector3(0, 1, 0), minDistance: baseMinDistance,
          };
          // Each preset owns its orbit frame. OrbitControls caches the up-axis
          // at construction, so reusing it also reuses old drag/pan momentum.
          const controlsMode = `ring-preset-${view}`;
          {
            alignedOrbitModule ??= await import("three/examples/jsm/controls/OrbitControls.js");
            if (requestId !== cameraRequestRef.current || viewerRef.current !== viewer) return false;
            const desiredUp = pose.up.clone();
            const Orbit = alignedOrbitModule.OrbitControls;
            activeCamera.setControlsCtor(controlsMode, (object: any, element: HTMLElement) => {
              object.up.copy(desiredUp);
              const orbit = new Orbit(object, element);
              const update = orbit.update.bind(orbit) as (deltaTime?: number) => boolean;
              let lastUpdate = performance.now();
              orbit.update = () => {
                const now = performance.now();
                const delta = Math.min(0.05, Math.max(0, (now - lastUpdate) / 1000));
                lastUpdate = now;
                object.up.copy(desiredUp);
                return orbit.enabled ? update(delta) : false;
              };
              return orbit;
            }, true);
          }
          const cameraObject = activeCamera.cameraObject ?? activeCamera;
          const startPosition = activeCamera.position.clone();
          const startTarget = (activeCamera.controls?.target ?? activeCamera.target).clone();
          const startUp = cameraObject.up.clone();
          if (activeCamera.controls) {
            activeCamera.controls.autoRotate = false;
            activeCamera.controls.enabled = false;
          }
          activeCamera.target.copy(startTarget);
          // Remove the old controller while tweening; even a disabled orbit
          // controller can apply its cached deltas when WebGI calls update().
          activeCamera.setCameraOptions({ controlsMode: "", controlsEnabled: true }, false);
          cameraControlsRef.current = null;

          const setCameraPose = (position: Vector3, target: Vector3, up: Vector3) => {
            cameraObject.up.copy(up);
            activeCamera.position.copy(position);
            activeCamera.target.copy(target);
            activeCamera.positionUpdated?.(false);
            activeCamera.targetUpdated?.(false);
            cameraObject.lookAt(target);
            cameraObject.updateMatrixWorld();
            activeCamera.setDirty?.();
            viewer?.setDirty?.();
          };
          const rebuildControls = (position: Vector3, target: Vector3, minDistance: number) => {
            // Set the canonical up-axis BEFORE constructing the fresh controls.
            setCameraPose(position, target, pose.up);
            activeCamera.setCameraOptions({ controlsMode, controlsEnabled: true }, false);
            const controls = activeCamera.controls;
            cameraControlsRef.current = controls;
            controls.enabled = false;
            controls.autoRotate = false;
            controls.enableDamping = false;
            controls.enableZoom = true;
            controls.enableRotate = true;
            controls.enablePan = true;
            controls.screenSpacePanning = true;
            controls.rotateSpeed = view === "hand" ? 0.55 : mobile ? 0.65 : 0.8;
            controls.panSpeed = mobile ? 0.65 : 1;
            controls.zoomSpeed = view === "hand" ? 2.6 : mobile ? 1.4 : 2.0;
            controls.zoomToCursor = view === "hand";
            controls.autoRotateSpeed = CAMERA_AUTO_ROTATE_SPEED;
            controls.dampingFactor = 0.07;
            controls.smoothZoom = true;
            controls.smoothTime = 0.08;
            controls.minPolarAngle = view === "hand" ? 0.08 : 0.001;
            controls.maxPolarAngle = Math.PI - controls.minPolarAngle;
            controls.minDistance = minDistance;
            controls.maxDistance = Math.max(baseMaxDistance, position.distanceTo(target) * (view === "hand" ? 3 : 1));
            // WebGI resets camera.up when enabling controls. Restore the
            // preset frame and target before the first synchronization update.
            setCameraPose(position, target, pose.up);
            controls.update?.();
            controls.saveState?.();
            controls.enableDamping = true;
            controls.enabled = !viewerInputLockedRef.current;
            controls.autoRotate = isAutoRotatingRef.current && !viewerInputLockedRef.current;
            activeCamera.setDirty?.();
          };
          if (initial) {
            rebuildControls(pose.position, pose.target, pose.minDistance);
            // Gallery capture preserves the current canvas pixels. Make sure
            // those pixels already use the final fit before showing the ring.
            await Promise.race([viewer.doOnce("postRender"), new Promise(resolve => setTimeout(resolve, 250))]);
            if (!isMounted || requestId !== cameraRequestRef.current || viewerRef.current !== viewer) return false;
            initialCameraReadyRef.current = true;
            return true;
          }
          const progress = { value: 0 };
          const position = startPosition.clone();
          const target = startTarget.clone();
          const up = startUp.clone();
          const startRotation = cameraObject.quaternion.clone();
          const endRotation = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(pose.position, pose.target, pose.up));
          const rotation = startRotation.clone();
          const startDistance = Math.max(0.001, startPosition.distanceTo(startTarget));
          const endDistance = Math.max(0.001, pose.position.distanceTo(pose.target));
          const updateCamera = () => {
            target.lerpVectors(startTarget, pose.target, progress.value);
            // Travel around the target while zooming, rather than cutting
            // through the ring/hand when two views face opposite directions.
            rotation.slerpQuaternions(startRotation, endRotation, progress.value);
            const distance = startDistance * (endDistance / startDistance) ** progress.value;
            position.set(0, 0, 1).applyQuaternion(rotation).multiplyScalar(distance).add(target);
            up.set(0, 1, 0).applyQuaternion(rotation);
            setCameraPose(position, target, up);
          };
          updateCamera();
          // Compile/render the newly shown hand behind the frame guard first.
          // Starting the tween before that work finishes can skip its movement.
          await Promise.race([viewer.doOnce("postRender"), new Promise(resolve => setTimeout(resolve, 250))]);
          if (!isMounted || requestId !== cameraRequestRef.current || viewerRef.current !== viewer) return false;
          if (previewCaptureRef.current || viewerInputLockedRef.current) { pendingCameraViewRef.current = name; return false; }
          revealFrame(true);
          cameraTweenRef.current = gsap.to(progress, {
            value: 1, duration: 0.85, ease: "power2.inOut", onUpdate: updateCamera,
            onComplete: () => {
              cameraTweenRef.current = null;
              rebuildControls(pose.position, pose.target, pose.minDistance);
              revealFrame();
            },
            onInterrupt: () => {
              cameraTweenRef.current = null;
              if (isMounted && viewerRef.current === viewer && requestId === cameraRequestRef.current) {
                rebuildControls(activeCamera.position.clone(), activeCamera.target.clone(), Math.min(pose.minDistance, activeCamera.position.distanceTo(activeCamera.target)));
              }
              revealFrame();
            },
          });

          return true;
        } finally { revealFrame(); }
      };

      initializeRingCameraRef.current = async () => { await applyPresetCameraView("front", true); };

      (window as any).goToCameraView = async (name: string) => {
        if (!name) return;
        try { await applyPresetCameraView(name); }
        catch (error) {
          console.warn("Viewer view could not be opened", error);
          if (isMounted && viewerRef.current === viewer && name === "hand") setHandPreviewStatus("error");
        }
      };
      cleanupStack.push(() => { cameraRequestRef.current++; clearViewerFrames(canvasRef.current); handPreviewRef.current?.dispose(); handPreviewRef.current = null; cameraTweenRef.current?.kill(); cameraTweenRef.current = null; pendingCameraViewRef.current = null; delete (window as any).goToCameraView; });

      object3dRef.current = Object3D;

      renderer?.refreshPipeline?.();
      ensureSSRDisabled(viewerAny);
      viewer.setDirty?.();

      const cameraView = viewer.scene.activeCamera;
      cameraView.userData.minNearPlane = 0.01;
      const controls = cameraView?.controls as any;
      activeCameraRef.current = cameraView ?? null;
      cameraControlsRef.current = controls ?? null;

      // Set initial default hero camera viewpoint and target
      const heroPreset = CAMERA_PRESETS.hero;
      cameraView.position.set(heroPreset.position.x, heroPreset.position.y, heroPreset.position.z);
      if (typeof cameraView.positionUpdated === "function") cameraView.positionUpdated();
      if (controls) {
        controls.target.set(heroPreset.target.x, heroPreset.target.y, heroPreset.target.z);
        if (cameraView.target?.set) {
          cameraView.target.set(heroPreset.target.x, heroPreset.target.y, heroPreset.target.z);
        }
        if (typeof cameraView.targetUpdated === "function") cameraView.targetUpdated();
        controls.update?.();
      }

      if (controls) {
        const isMobile = window.innerWidth <= 768;
        const minDist = isMobile ? CAMERA_MIN_DISTANCE_MOBILE : CAMERA_MIN_DISTANCE_DESKTOP;
        const maxDist = isMobile ? CAMERA_MAX_DISTANCE_MOBILE : CAMERA_MAX_DISTANCE_DESKTOP;

        try { controls.enableZoom = true; } catch (e) {}
        try { controls.minDistance = minDist; } catch (e) {}
        try { controls.maxDistance = maxDist; } catch (e) {}
        try { controls.enableDamping = true; } catch (e) {}
        try { controls.dampingFactor = 0.07; } catch (e) {}
        try { controls.smoothZoom = true; } catch (e) {}
        try { controls.smoothTime = 0.08; } catch (e) {}
        try { controls.zoomSpeed = isMobile ? 1.4 : 2.0; } catch (e) {}
        try {
          controls.autoRotate = isAutoRotatingRef.current !== false;
          controls.autoRotateSpeed = CAMERA_AUTO_ROTATE_SPEED;
        } catch (e) {}

        // Continuous smooth auto-rotation animation frame tick
        let autoRotateFrameId: number;
        const tickAutoRotate = () => {
          const currentControls: any = cameraView?.controls;
          const rotate = isAutoRotatingRef.current && !viewerInputLockedRef.current && !cameraTweenRef.current;
          if (currentControls) currentControls.autoRotate = rotate;
          if (currentControls && rotate) {
            // WebGI updates controls once in postFrame. A second update here
            // doubles rotation and makes its speed depend on rendering load.
            viewer.setDirty?.();
          }
          autoRotateFrameId = requestAnimationFrame(tickAutoRotate);
        };
        autoRotateFrameId = requestAnimationFrame(tickAutoRotate);
        cleanupStack.push(() => cancelAnimationFrame(autoRotateFrameId));
      }

      const isMobile = window.innerWidth <= 768;
      const CONTROL_MIN_DISTANCE = isMobile ? CAMERA_MIN_DISTANCE_MOBILE : CAMERA_MIN_DISTANCE_DESKTOP;
      const CONTROL_MAX_DISTANCE = isMobile ? CAMERA_MAX_DISTANCE_MOBILE : CAMERA_MAX_DISTANCE_DESKTOP;
      const EPS = 0.01;
      const canvasEl = canvasRef.current;
      if (canvasEl) {
        const cancelCameraTransition = () => {
          if (!cameraTweenRef.current) return;
          cameraTweenRef.current.kill();
          cameraTweenRef.current = null;
          viewer.setDirty?.();
        };
        const wheelHandler = (ev: WheelEvent) => {
          if (viewerInputLockedRef.current) {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            return;
          }
          cancelCameraTransition();
          try {
            const ctrl: any = cameraView?.controls;
            const tgt = (ctrl && (ctrl.target || ctrl._target)) || {
              x: 0,
              y: 0,
              z: 0,
            };
            const dx = cameraView.position.x - tgt.x;
            const dy = cameraView.position.y - tgt.y;
            const dz = cameraView.position.z - tgt.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (ev.deltaY < 0 && dist <= (ctrl?.minDistance ?? CONTROL_MIN_DISTANCE) + EPS) {
              ev.preventDefault();
              ev.stopImmediatePropagation();
              return;
            }
            if (ev.deltaY > 0 && dist >= (ctrl?.maxDistance ?? CONTROL_MAX_DISTANCE) - EPS) {
              ev.preventDefault();
              ev.stopImmediatePropagation();
              return;
            }
          } catch (e) {}
        };
        canvasEl.addEventListener("wheel", wheelHandler, {
          passive: false,
          capture: true,
        });
        cleanupStack.push(() =>
          canvasEl.removeEventListener("wheel", wheelHandler, { capture: true } as any),
        );

        let rightBtnDown = false;
        const onPointerDown = (e: PointerEvent) => {
          if (viewerInputLockedRef.current) {
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
          }
          cancelCameraTransition();
          if (e.button === 2 && !handPreviewRef.current?.active) {
            rightBtnDown = true;
            e.preventDefault();
            e.stopImmediatePropagation();
          }
        };
        const onPointerMove = (e: PointerEvent) => {
          if (viewerInputLockedRef.current) {
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
          }
          if (rightBtnDown) {
            e.preventDefault();
            e.stopImmediatePropagation();
          }
        };
        const onPointerUp = (e: PointerEvent) => {
          if (viewerInputLockedRef.current) {
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
          }
          if (e.button === 2) {
            rightBtnDown = false;
            e.preventDefault();
            e.stopImmediatePropagation();
          }
        };
        const onContext = (ev: Event) => { ev.preventDefault(); };

        canvasEl.addEventListener("pointerdown", onPointerDown, { passive: false, capture: true });
        canvasEl.addEventListener("pointermove", onPointerMove, { passive: false, capture: true });
        canvasEl.addEventListener("pointerup", onPointerUp, { passive: false, capture: true });
        canvasEl.addEventListener("contextmenu", onContext, { capture: true });

        cleanupStack.push(() => {
          canvasEl.removeEventListener("pointerdown", onPointerDown, { capture: true } as any);
          canvasEl.removeEventListener("pointermove", onPointerMove, { capture: true } as any);
          canvasEl.removeEventListener("pointerup", onPointerUp, { capture: true } as any);
          canvasEl.removeEventListener("contextmenu", onContext, { capture: true } as any);
        });

        if (typeof ResizeObserver !== "undefined") {
          const ro = new ResizeObserver(() => {
            try {
              viewer?.resize?.();
              viewer?.setDirty?.();
            } catch (e) {}
          });
          ro.observe(canvasEl);
          cleanupStack.push(() => ro.disconnect());
        }
      }

      if (mobileAndTabletCheck?.()) {
        cameraView?.setCameraOptions?.({ fov: CAMERA_FOV_MOBILE });
      }

      const headFile =
        props.headFile ||
        initialParams.get("headFile") ||
        DEFAULT_HEAD_FILE;
      const headScale =
        props.headScale ??
        (initialParams.get("headScale")
          ? parseFloat(initialParams.get("headScale")!)
          : 0.17);
      const headPosZ =
        props.headPosZ ??
        (initialParams.get("headPosZ")
          ? parseFloat(initialParams.get("headPosZ")!)
          : 0);
      const shankFile =
        props.shankFile ||
        initialParams.get("shankFile") ||
        DEFAULT_SHANK_FILE;
      const shankScale =
        props.shankScale ??
        (initialParams.get("shankScale")
          ? parseFloat(initialParams.get("shankScale")!)
          : 0.17);
      const shankPosZ =
        props.shankPosZ ??
        (initialParams.get("shankPosZ")
          ? parseFloat(initialParams.get("shankPosZ")!)
          : 0);
      const bandFile1 = props.bandFile1 || initialParams.get("bandFile1");
      const bandFile2 = props.bandFile2 || initialParams.get("bandFile2");
      const matchingBandCountParam =
        props.matchingBandCount !== undefined
          ? props.matchingBandCount
          : initialParams.get("matchingBandCount");
      const metalHex =
        props.metalHex ||
        initialParams.get("metalHex") ||
        DEFAULT_METAL_HEX;
      const headMetalHex =
        props.headMetalHex || initialParams.get("headMetalHex") || metalHex;
      const shankMetalHex =
        props.shankMetalHex || initialParams.get("shankMetalHex") || metalHex;

      const headData = {
        file: headFile,
        scale: headScale,
        posZ: headPosZ,
        name: "head",
      };
      const shankData = {
        file: shankFile,
        scale: shankScale,
        posZ: shankPosZ,
        name: "shank",
      };
      const matchingBandCount = Math.max(
        0,
        Math.min(2, Number(matchingBandCountParam) || 0),
      );
      const bandData = [
        bandFile1
          ? {
              file: bandFile1,
              scale: shankScale,
              posZ: shankPosZ,
            }
          : null,
        bandFile2
          ? {
              file: bandFile2,
              scale: shankScale,
              posZ: shankPosZ,
            }
          : null,
      ];

      const errorEl = document.getElementById("error-message");
      if (errorEl) errorEl.style.display = "none";

      if (isMounted && viewerRef.current === viewer) {
        props.onLoadingChange?.(true);
        await loadModelsRef.current?.(
          viewer,
          manager,
          headData,
          shankData,
          bandData,
          matchingBandCount,
          metalHex || undefined,
          headMetalHex || undefined,
          shankMetalHex || undefined,
        );
        setIsViewerReady(true);
        props.onLoadingChange?.(false);
      }

      cleanupStack.push(() => {
        disposeEnvironmentAsset(metalEnvironmentAssetRef.current);
        metalEnvironmentAssetRef.current = null;
        disposeEnvironmentAsset(diamondEnvironmentAssetRef.current);
        diamondEnvironmentAssetRef.current = null;
        applyCustomEnvironmentRef.current = null;
        viewer.dispose?.();
      });
    };

    init();

    return () => {
      isMounted = false;
      previewCaptureRef.current?.abort();
      engravingRef.current?.dispose();
      engravingRef.current = null;
      loadIdRef.current += 1;
      partTransitionRef.current?.cancel();
      partTransitionRef.current = null;
      cleanupStack.forEach((fn) => {
        try { fn(); } catch (e) {}
      });
      if (viewerInstance) {
        viewerInstance.dispose?.();
        viewerInstance = null;
      }
      viewerRef.current = null;
      initializeRingCameraRef.current = null;
      initialCameraReadyRef.current = false;
      firstCameraPropHandledRef.current = false;
      activeCameraRef.current = null;
      cameraControlsRef.current = null;
      controlsLockDepthRef.current = 0;
      viewerInputLockedRef.current = false;
      applyCustomEnvironmentRef.current = null;
      metalEnvironmentAssetRef.current = null;
      diamondEnvironmentAssetRef.current = null;
      managerRef.current = null;
      temporalAAPluginRef.current = null;
      contactShadowGroundRef.current = null;
    };
  }, []);

  // ── Prop changes handler ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isViewerReady) return;
    if (!isInitialMountDone.current) {
      isInitialMountDone.current = true;
      return;
    }
    const viewer = viewerRef.current;
    const manager = managerRef.current;
    if (!viewer || !manager) return;

    const targetHeadFile = props.headFile || DEFAULT_HEAD_FILE;
    const targetShankFile = props.shankFile || DEFAULT_SHANK_FILE;
    const targetMetalHex = props.metalHex || DEFAULT_METAL_HEX;
    const targetHeadMetalHex = props.headMetalHex || targetMetalHex;
    const targetShankMetalHex = props.shankMetalHex || targetMetalHex;

    const headData = {
      file: targetHeadFile,
      scale: props.headScale ?? 0.17,
      posZ: props.headPosZ ?? 0,
      name: "head",
    };
    const shankData = {
      file: targetShankFile,
      scale: props.shankScale ?? 0.17,
      posZ: props.shankPosZ ?? 0,
      name: "shank",
    };
    const bandData = [
      props.bandFile1
        ? {
            file: props.bandFile1,
            scale: props.shankScale ?? 0.17,
            posZ: props.shankPosZ ?? 0,
          }
        : null,
      props.bandFile2
        ? {
            file: props.bandFile2,
            scale: props.shankScale ?? 0.17,
            posZ: props.shankPosZ ?? 0,
          }
        : null,
    ];

    let isCurrentRequest = true;
    props.onLoadingChange?.(true);
    loadModelsRef.current?.(
      viewer,
      manager,
      headData,
      shankData,
      bandData,
      props.matchingBandCount || 0,
      targetMetalHex,
      targetHeadMetalHex,
      targetShankMetalHex,
    )
      .catch((err: any) =>
        console.error("[RingViewer] Prop change load error:", err),
      )
      .finally(() => {
        if (isCurrentRequest) props.onLoadingChange?.(false);
      });
    return () => { isCurrentRequest = false; };
  }, [
    isViewerReady,
    props.headFile,
    props.shankFile,
    props.headScale,
    props.shankScale,
    props.headPosZ,
    props.shankPosZ,
    props.metalHex,
    props.headMetalHex,
    props.shankMetalHex,
    props.bandFile1,
    props.bandFile2,
    props.matchingBandCount,
  ]);

  // Engraving updates only metal shaders and photographs; diamonds stay baked.
  useEffect(() => {
    if (!isViewerReady) return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    const controller = new AbortController();
    const update = async () => {
      while (!controller.signal.aborted && viewerRef.current === viewer && (viewerInputLockedRef.current || previewCaptureRef.current || cameraTweenRef.current)) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (controller.signal.aborted || viewerRef.current !== viewer) return;
      lockViewerControls();
      props.onLoadingChange?.(true);
      try { await refreshGallery(viewer); }
      finally {
        if (viewerRef.current !== viewer) return;
        unlockViewerControls();
        props.onLoadingChange?.(false);
        if (!viewerInputLockedRef.current) handPreviewRef.current?.resume(currentShankRef.current);
        if (!viewerInputLockedRef.current && pendingCameraViewRef.current) {
          const view = pendingCameraViewRef.current;
          pendingCameraViewRef.current = null;
          (window as any).goToCameraView?.(view);
        }
      }
    };
    void update();
    return () => { controller.abort(); previewCaptureRef.current?.abort(); };
  }, [isViewerReady, props.previewKey, refreshGallery, lockViewerControls, unlockViewerControls]);

  // Generate one high-resolution photo only when its lightbox is opened.
  // Ordinary gallery updates retain their inexpensive 1200px render path.
  useEffect(() => {
    const request = props.detailPreviewRequest;
    if (!isViewerReady || !request || request.key !== props.previewKey) return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    const controller = new AbortController();
    const cacheKey = `${request.key}:${request.viewId}:${request.resolution}:${request.engravingPosition ?? ""}`;
    const cached = detailPreviewCacheRef.current.get(cacheKey);
    if (cached) {
      props.onDetailPreviewChange?.(request, cached);
      return;
    }
    const renderDetail = async () => {
      while (!controller.signal.aborted && viewerRef.current === viewer && (viewerInputLockedRef.current || previewCaptureRef.current || cameraTweenRef.current)) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (controller.signal.aborted || viewerRef.current !== viewer) return;
      lockViewerControls();
      previewCaptureRef.current = controller;
      handPreviewRef.current?.suspend();
      try {
        const roots = [currentHeadRef.current, currentShankRef.current, ...currentBandRefs.current].filter(root => root?.visible);
        const engraving = engravingRef.current;
        const [image] = await captureRingPreviews(viewer, roots, controller.signal, { viewId: request.viewId, resolution: request.resolution, engraving: engraving?.active ? { position: request.engravingPosition, cameraPose: camera => engraving.cameraPose(camera, request.engravingPosition) } : undefined });
        if (!controller.signal.aborted && viewerRef.current === viewer) {
          if (image) {
            if (detailPreviewCacheRef.current.size >= 3) detailPreviewCacheRef.current.delete(detailPreviewCacheRef.current.keys().next().value!);
            detailPreviewCacheRef.current.set(cacheKey, image);
          }
          props.onDetailPreviewChange?.(request, image ?? null);
        }
      } catch (error) {
        if (!controller.signal.aborted && viewerRef.current === viewer) {
          console.warn("Detailed ring photo could not be generated", error);
          props.onDetailPreviewChange?.(request, null);
        }
      } finally {
        if (previewCaptureRef.current === controller) previewCaptureRef.current = null;
        if (viewerRef.current === viewer) {
          unlockViewerControls();
          if (!viewerInputLockedRef.current) handPreviewRef.current?.resume(currentShankRef.current);
          if (!viewerInputLockedRef.current && pendingCameraViewRef.current) {
            const view = pendingCameraViewRef.current;
            pendingCameraViewRef.current = null;
            (window as any).goToCameraView?.(view);
          }
        }
      }
    };
    void renderDetail();
    return () => controller.abort();
  }, [isViewerReady, props.previewKey, props.detailPreviewRequest?.key, props.detailPreviewRequest?.viewId, props.detailPreviewRequest?.resolution, props.detailPreviewRequest?.engravingPosition, props.onDetailPreviewChange, lockViewerControls, unlockViewerControls]);

  // ── Camera view prop handler ───────────────────────────────────────────────
  useEffect(() => {
    if (!isViewerReady || !props.cameraView) return;
    if (!firstCameraPropHandledRef.current) {
      firstCameraPropHandledRef.current = true;
      if (initialCameraReadyRef.current && (props.cameraView === "front" || props.cameraView === "hero")) return;
    }
    (window as any).goToCameraView?.(props.cameraView);
  }, [isViewerReady, props.cameraView, props.cameraViewRevision, props.cameraView === "engraving" ? props.engravingFocusPosition : undefined]);

  // ── Auto rotate prop handler ───────────────────────────────────────────────
  useEffect(() => {
    handPreviewRef.current?.setSkinTone(props.handSkinTone ?? DEFAULT_SKIN_TONE);
  }, [props.handSkinTone]);

  useEffect(() => {
    const controls =
      cameraControlsRef.current ??
      activeCameraRef.current?.controls ??
      viewerRef.current?.scene?.activeCamera?.controls;
    if (controls) {
      controls.autoRotate = isAutoRotatingRef.current && !viewerInputLockedRef.current && !cameraTweenRef.current;
      viewerRef.current?.setDirty?.();
    }
  }, [props.isAutoRotating]);

  // ── postMessage handler ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      const data = event.data;
      if (data?.type !== "ring-selection") return;

      for (let attempt = 0; attempt < 120; attempt++) {
        if (
          viewerRef.current &&
          managerRef.current &&
          diamondPluginRef.current
        ) {
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      if (
        viewerRef.current &&
        managerRef.current &&
        diamondPluginRef.current
      ) {
        console.log("[RingViewer] Received ring-selection message:", data.payload);

        const headPayload = data.payload?.head;
        const shankPayload = data.payload?.shank;
        const metalPayload = data.payload?.metalColor;
        const matchingBandCount = Math.max(
          0,
          Math.min(2, Number(data.payload?.matchingBandCount) || 0),
        );

        if (!managerRef.current || !viewerRef.current) {
          console.warn("[RingViewer] Manager or viewer not ready");
          return;
        }

        const headData = {
          file: headPayload?.file || null,
          scale: headPayload?.scale,
          posZ: headPayload?.posZ,
          name: headPayload?.name || headPayload?.label,
        };

        const shankData = {
          file: shankPayload?.file || null,
          scale: shankPayload?.scale,
          posZ: shankPayload?.posZ,
          name: shankPayload?.name || shankPayload?.label,
        };

        const bandData = [
          {
            file:
              shankPayload?.band1Glb || shankPayload?.matchingBandFile1 || null,
            scale: shankPayload?.scale,
            posZ: shankPayload?.posZ,
            name: shankPayload?.name
              ? `${shankPayload.name}-band-1`
              : "shank-band-1",
          },
          {
            file:
              shankPayload?.band2Glb || shankPayload?.matchingBandFile2 || null,
            scale: shankPayload?.scale,
            posZ: shankPayload?.posZ,
            name: shankPayload?.name
              ? `${shankPayload.name}-band-2`
              : "shank-band-2",
          },
        ];

        const metalHex = metalPayload?.hexCode;
        const headMetalHex = metalPayload?.headHexCode;
        const shankMetalHex = metalPayload?.shankHexCode;

        console.log("[RingViewer] Calling loadModels with:", {
          headFile: headData.file,
          shankFile: shankData.file,
          bandFile1: bandData[0].file,
          bandFile2: bandData[1].file,
          matchingBandCount,
          metalHex,
          headMetalHex,
          shankMetalHex,
        });

        if (!headData.file || !shankData.file) {
          const errorEl = document.getElementById("error-message");
          if (errorEl) errorEl.style.display = "flex";
        } else {
          const errorEl = document.getElementById("error-message");
          if (errorEl) errorEl.style.display = "none";

          loadModels(
            viewerRef.current,
            managerRef.current,
            headData,
            shankData,
            bandData,
            matchingBandCount,
            metalHex,
            headMetalHex,
            shankMetalHex,
          );
        }
      } else {
        console.warn("[RingViewer] ring-selection ignored — viewer not fully ready");
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [loadModels]);

  // ── JSX ────────────────────────────────────────────────────────────────────
  return (
    <section
      className="page viewer-page"
      data-part-transition={partTransitionPhase}
      aria-busy={partTransitionPhase !== "idle"}
      style={{ width: "100%", height: "100%", position: "relative" }}
    >
      {!isViewerRevealed && (
        <div
          className="viewer-initial-loader"
          aria-label="Loading"
        >
          <div className="dot-loader">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
      )}

      <canvas
        ref={canvasRef}
        className="viewer-canvas"
        style={{
          width: "100%",
          height: "100%",
          opacity: isViewerRevealed ? 1 : 0,
          visibility: isViewerRevealed ? "visible" : "hidden",
        }}
      />

      {handPreviewStatus === "loading" && <div className="hand-preview-status" role="status">Loading hand…</div>}
      {handPreviewStatus === "error" && <div className="hand-preview-status" role="status">Hand preview unavailable. <button type="button" onClick={() => (window as any).goToCameraView?.("hand")}>Retry</button></div>}

      {showInstructions && (
        <div
          className={`interaction-instructions ${hasInteracted ? "hidden" : ""}`}
          style={{ opacity: hasInteracted ? 0 : 0.85 }}
        >
          <div className="instruction-item">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="5 9 2 12 5 15"></polyline>
              <polyline points="9 5 12 2 15 5"></polyline>
              <polyline points="19 9 22 12 19 15"></polyline>
              <polyline points="9 19 12 22 15 19"></polyline>
              <line x1="2" y1="12" x2="22" y2="12"></line>
              <line x1="12" y1="2" x2="12" y2="22"></line>
            </svg>
            <span className="instruction-text">DRAG TO ROTATE</span>
          </div>

          <div className="instruction-item">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8 10V6a2 2 0 1 1 4 0v4"></path>
              <path d="M12 10.5V7a2 2 0 1 1 4 0v3.5"></path>
              <path d="M16 11V8a2 2 0 1 1 4 0v8a8 8 0 0 1-15.1 3.5l-2.6-4.6a2 2 0 0 1 2.8-2.8l2 .9V6a2 2 0 1 1 4 0v4.5"></path>
              <path d="M4 2l-2 2 2 2"></path>
              <path d="M22 2l2 2-2 2"></path>
            </svg>
            <span className="instruction-text">SCROLL / PINCH TO ZOOM</span>
          </div>
        </div>
      )}
    </section>
  );
};

export default RingViewer;

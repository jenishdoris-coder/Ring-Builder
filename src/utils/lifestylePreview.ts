import { Box3, CanvasTexture, Color, CylinderGeometry, DataTexture, DoubleSide, LinearFilter, Matrix4, Mesh, MeshBasicMaterial, RepeatWrapping, RGBAFormat, UnsignedByteType, Vector2, Vector3, Vector4, WebGLRenderTarget } from "webgi";
import { LIFESTYLE_PHOTOS } from "../config/lifestylePhotos";
import { captureRingPreviews, type RingPreviewImage } from "./ringPreview";
import { measureRingBore } from "./ringBore";
import { isDiamondMesh } from "./meshUtils";
import type { PortraitFit } from "../config/portraitFit";
import { getRingContactShadow } from "./ringContactShadow";
import { loadPortraitEnvironment, type PortraitEnvironment } from "./portraitEnvironment";
import { DEFAULT_PORTRAIT_ENVIRONMENT } from "../config/portraitLighting";

const compositors = new WeakMap<object, ReturnType<typeof installCompositor>>();
const installCompositor = (viewer: any) => {
  const uniforms = {
    portraitEnabled: { value: 0 }, portraitSceneDepth: { value: null as any },
    portraitCameraWorld: { value: new Matrix4() }, portraitProjectionInverse: { value: new Matrix4() },
    portraitNearFar: { value: new Vector2() },
    portraitRingInverse: { value: new Matrix4() }, portraitRadius: { value: 1 }, portraitFingerRadius: { value: 1 }, portraitBandHalfWidth: { value: 0 },
    portraitSkinLinear: { value: new Color() }, portraitRoomLinear: { value: new Color() },
    portraitPhotoTexture: { value: null as CanvasTexture | null }, portraitPhotoProjection: { value: new Matrix4() }, portraitReflectionsWeight: { value: 1 },
    portraitPhotoSeat: { value: new Vector4() }, portraitPhotoAcross: { value: new Vector2() },
    portraitPhotoFrame: { value: new Vector4() },
    portraitContactMap: { value: null as DataTexture | null }, portraitContactRange: { value: new Vector2() },
  };
  const post = viewer.getPluginByType("CombinedPostPlugin");
  if (!post?.addExtension) throw new Error("The portrait compositor is unavailable.");
  const material = post.pass.passObject.material;
  material.materialExtensions = material.materialExtensions.filter((extension: any) => extension.uuid !== "ring-lifestyle-portrait");
  // A replaced extension after hot reload must bind its own uniform objects.
  const generation = viewer.__portraitCompositorGeneration = (viewer.__portraitCompositorGeneration ?? 0) + 1;
  post.addExtension({
    uuid: "ring-lifestyle-portrait", customCacheKey: `ring-lifestyle-neutral-edges-v17-${generation}`, isCompatible: () => true,
    extraUniforms: uniforms,
    parsFragmentSnippet: `uniform float portraitEnabled; uniform sampler2D portraitSceneDepth;
      uniform mat4 portraitCameraWorld; uniform mat4 portraitProjectionInverse; uniform mat4 portraitRingInverse;
      uniform vec2 portraitNearFar;
      uniform vec4 portraitPhotoSeat; uniform vec2 portraitPhotoAcross; uniform vec4 portraitPhotoFrame;
      uniform float portraitRadius; uniform float portraitFingerRadius; uniform float portraitBandHalfWidth;
      uniform sampler2D portraitContactMap; uniform vec2 portraitContactRange;`,
    shaderExtender: (shader: any) => {
      if (shader.fragmentShader.includes("float portraitPackedDepth")) return;
      shader.fragmentShader = shader.fragmentShader.replace("#glMarker", `
        if (portraitEnabled > 0.5) {
          vec2 portraitPackedDepth = texture2D(portraitSceneDepth, vUv).xy;
          float portraitDepth = pow(portraitPackedDepth.x + portraitPackedDepth.y / 255.0, 2.0);
          // WebGI's G-buffer stores linear eye depth, not perspective depth.
          float portraitDistance = mix(portraitNearFar.x, portraitNearFar.y, portraitDepth);
          float portraitClipDepth = (portraitNearFar.y + portraitNearFar.x - 2.0 * portraitNearFar.x * portraitNearFar.y / max(portraitDistance, 0.0001)) / (portraitNearFar.y - portraitNearFar.x);
          vec4 portraitWorld = portraitCameraWorld * portraitProjectionInverse * vec4(vUv * 2.0 - 1.0, portraitClipDepth, 1.0);
          vec3 portraitLocal = (portraitRingInverse * vec4(portraitWorld.xyz / portraitWorld.w, 1.0)).xyz;
          float portraitVisibility = 1.0 - step(0.99999, portraitDepth);
          // The temporary finger writes real scene depth, but no beauty colour.
          // Suppress its depth surface in the transparent ring-layer export.
          portraitVisibility *= smoothstep(portraitFingerRadius * 1.001, portraitFingerRadius * 1.005, length(portraitLocal.xz));
          float portraitShadow = 0.0;
          // Trace the actual camera ray against the finger volume. Comparing
          // local Z with a front surface is only valid for a straight-on view;
          // it clips the curved side of a tilted band into a flat metal strip.
          vec4 portraitRayNear = portraitRingInverse * portraitCameraWorld * portraitProjectionInverse * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
          vec4 portraitRayFar = portraitRingInverse * portraitCameraWorld * portraitProjectionInverse * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
          vec3 portraitRayOrigin = portraitRayNear.xyz / portraitRayNear.w;
          vec3 portraitRayDirection = normalize(portraitRayFar.xyz / portraitRayFar.w - portraitRayOrigin);
          float portraitA = dot(portraitRayDirection.xz, portraitRayDirection.xz);
          float portraitB = dot(portraitRayOrigin.xz, portraitRayDirection.xz);
          float portraitC = dot(portraitRayOrigin.xz, portraitRayOrigin.xz) - portraitFingerRadius * portraitFingerRadius;
          float portraitDiscriminant = portraitB * portraitB - portraitA * portraitC;
          if (portraitDiscriminant > 0.0 && portraitA > 0.001) {
            float portraitT = (-portraitB - sqrt(portraitDiscriminant)) / portraitA;
            vec3 portraitSurface = portraitRayOrigin + portraitT * portraitRayDirection;
            float portraitGeometryT = dot(portraitLocal - portraitRayOrigin, portraitRayDirection);
            float portraitDepthFeather = max(portraitRadius * 0.004, fwidth(portraitGeometryT) * 0.7);
            if (portraitT > 0.0 && abs(portraitSurface.y) < portraitRadius * 4.0) {
              portraitVisibility *= smoothstep(-portraitDepthFeather, portraitDepthFeather, portraitT - portraitGeometryT);
              // The real mesh supplies shadow coverage: a bypass opening or
              // split/multiple rows must not cast a solid, straight band strip.
              vec2 portraitContactUv = vec2(atan(portraitSurface.x, portraitSurface.z) / 6.28318530718 + 0.5,
                (portraitSurface.y - portraitContactRange.x) / portraitContactRange.y);
              vec2 portraitContactShape = texture2D(portraitContactMap, portraitContactUv).rg;
              float portraitContact = 0.19 * portraitContactShape.r + 0.07 * portraitContactShape.g;
              portraitContact *= step(0.0, portraitContactUv.y) * step(portraitContactUv.y, 1.0);
              float portraitSide = abs(portraitSurface.x) / portraitRadius;
              portraitShadow = portraitContact * (0.8 + 0.35 * portraitSide);
            }
          }
          // The photographed silhouette is the final occlusion boundary. A
          // circular volume alone cannot describe the finger seams in a photo.
          vec2 portraitSourceUv = portraitPhotoFrame.xy + vec2(vUv.x, 1.0 - vUv.y) * portraitPhotoFrame.z;
          float portraitAcross = abs(dot(portraitSourceUv - portraitPhotoSeat.xy, portraitPhotoAcross));
          float portraitSkinMask = 1.0 - smoothstep(portraitPhotoSeat.z - portraitPhotoSeat.w, portraitPhotoSeat.z + portraitPhotoSeat.w, portraitAcross);
          // Keep the outer return of the band visible past the skin silhouette,
          // as in the 3D-hand view. Real depth/cylinder occlusion hides its back;
          // cutting the colour layer to a 2D strip removes that curved return.
          portraitShadow *= portraitSkinMask;
          // Keep PBR metal colour to the silhouette. A screen-space side fade
          // paints grey/dull tips even on polished yellow gold.
          vec3 portraitRingColor = gl_FragColor.rgb;
          // Export only jewellery plus a translucent black contact shadow.
          // Canvas2D composites this patch over the untouched original photo,
          // avoiding a resampled rectangular skin patch and any GPU photo pass.
          float portraitAlpha = portraitVisibility + (1.0 - portraitVisibility) * portraitShadow;
          vec3 portraitStraightColor = portraitRingColor * portraitVisibility / max(portraitAlpha, 0.00001);
          gl_FragColor = vec4(portraitStraightColor, portraitAlpha);
        }
        #glMarker`);
    },
  });
  post.pass.passObject.material.setDirty();
  return uniforms;
};

const reflectedMaterials = new WeakMap<object, object>();
/** Subtle skin reflection only when the reflection ray points into the finger.
 * Preserve the metal's highlight colour and add a broad, neutral room fill. */
const installSkinReflection = (roots: any[], uniforms: ReturnType<typeof installCompositor>) => {
  for (const root of roots) root.traverse((mesh: any) => {
    if (!mesh.isMesh || isDiamondMesh(mesh)) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material?.registerMaterialExtensions || reflectedMaterials.get(material) === uniforms) continue;
      const old = material.materialExtensions?.filter((extension: any) => extension.uuid === "portrait-skin-bounce") ?? [];
      if (old.length) material.unregisterMaterialExtensions?.(old);
      let previousMode = -1;
      material.registerMaterialExtensions([{
        uuid: "portrait-skin-bounce", customCacheKey: "portrait-photo-reflection-v4", isCompatible: () => true,
        extraUniforms: {
          portraitMetalEnabled: uniforms.portraitEnabled, portraitMetalFrame: uniforms.portraitRingInverse,
          portraitMetalRadius: uniforms.portraitRadius, portraitMetalWidth: uniforms.portraitBandHalfWidth,
          portraitMetalSkin: uniforms.portraitSkinLinear,
          portraitMetalRoom: uniforms.portraitRoomLinear,
          portraitMetalPhoto: uniforms.portraitPhotoTexture, portraitMetalProjection: uniforms.portraitPhotoProjection,
          portraitMetalPhotoFrame: uniforms.portraitPhotoFrame, portraitMetalFingerRadius: uniforms.portraitFingerRadius,
          portraitMetalReflectionStrength: uniforms.portraitReflectionsWeight,
        },
        onObjectRender: () => {
          const mode = uniforms.portraitEnabled.value;
          if (mode || previousMode !== mode) material.uniformsNeedUpdate = true;
          previousMode = mode;
        },
        shaderExtender: (shader: any) => {
          if (shader.vertexShader.includes("varying vec3 vPortraitMetalPosition")) return;
          shader.vertexShader = `uniform mat4 portraitMetalFrame; varying vec3 vPortraitMetalPosition; varying vec3 vPortraitWorldPosition;\n${shader.vertexShader}`.replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n vPortraitWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\n vPortraitMetalPosition = (portraitMetalFrame * vec4(vPortraitWorldPosition, 1.0)).xyz;");
          shader.fragmentShader = `uniform float portraitMetalEnabled; uniform mat4 portraitMetalFrame; uniform float portraitMetalRadius; uniform float portraitMetalWidth; uniform vec3 portraitMetalSkin; uniform vec3 portraitMetalRoom; uniform sampler2D portraitMetalPhoto; uniform mat4 portraitMetalProjection; uniform vec4 portraitMetalPhotoFrame; uniform float portraitMetalFingerRadius; uniform float portraitMetalReflectionStrength; varying vec3 vPortraitMetalPosition; varying vec3 vPortraitWorldPosition;\n${shader.fragmentShader}`.replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
            if (portraitMetalEnabled > 0.5) {
              float portraitBandArea = 1.0 - smoothstep(portraitMetalWidth + portraitMetalRadius * 0.08, portraitMetalWidth + portraitMetalRadius * 0.25, abs(vPortraitMetalPosition.y));
              portraitBandArea *= 1.0 - smoothstep(portraitMetalRadius * 1.18, portraitMetalRadius * 1.5, length(vPortraitMetalPosition.xz));
              vec3 portraitWorldReflection = inverseTransformDirection(reflect(-normalize(vViewPosition), normal), viewMatrix);
              vec3 portraitLocalReflection = mat3(portraitMetalFrame) * portraitWorldReflection;
              vec2 portraitRadial = normalize(vPortraitMetalPosition.xz + vec2(0.00001));
              vec2 portraitReflectionRadial = normalize(portraitLocalReflection.xz + vec2(0.00001));
              float portraitSeesSkin = smoothstep(0.05, 0.65, -dot(portraitRadial, portraitReflectionRadial)) * portraitBandArea;
              // A gentle tint replaces the old broad brown/grey edge mask.
              vec3 portraitBounce = mix(vec3(1.0), vec3(0.82) + portraitMetalSkin * 0.18, portraitSeesSkin * 0.7);
              reflectedLight.indirectSpecular *= portraitBounce * portraitMetalRoom;
              // Reflect the actual photographed skin/nearby fingers into metal.
              // The nearest cylinder hit takes priority over the photo plane;
              // this is a reflection-ray test, never a dark mask on band ends.
              float portraitReflectT = -1.0;
              float portraitReflectA = dot(portraitLocalReflection.xz, portraitLocalReflection.xz);
              float portraitReflectB = dot(vPortraitMetalPosition.xz, portraitLocalReflection.xz);
              float portraitReflectC = dot(vPortraitMetalPosition.xz, vPortraitMetalPosition.xz) - portraitMetalFingerRadius * portraitMetalFingerRadius;
              float portraitReflectD = portraitReflectB * portraitReflectB - portraitReflectA * portraitReflectC;
              if (portraitReflectD > 0.0 && portraitReflectA > 0.001) {
                portraitReflectT = (-portraitReflectB - sqrt(portraitReflectD)) / portraitReflectA;
              }
              if (portraitReflectT < 0.001 && portraitWorldReflection.z < -0.08) portraitReflectT = -vPortraitWorldPosition.z / portraitWorldReflection.z;
              if (portraitReflectT > 0.001 && portraitReflectT < portraitMetalRadius * 5.0) {
                vec3 portraitReflectionHit = vPortraitWorldPosition + portraitWorldReflection * portraitReflectT;
                vec4 portraitHitClip = portraitMetalProjection * vec4(portraitReflectionHit, 1.0);
                vec2 portraitHitUv = portraitMetalPhotoFrame.xy + vec2(0.5 + 0.5 * portraitHitClip.x / portraitHitClip.w, 0.5 - 0.5 * portraitHitClip.y / portraitHitClip.w) * portraitMetalPhotoFrame.z;
                float portraitHitValid = step(0.0, portraitHitUv.x) * step(portraitHitUv.x, 1.0) * step(0.0, portraitHitUv.y) * step(portraitHitUv.y, 1.0);
                vec3 portraitPhotoRgb = texture2D(portraitMetalPhoto, clamp(portraitHitUv, vec2(0.0), vec2(1.0))).rgb;
                vec3 portraitPhotoLinear = mix(portraitPhotoRgb / 12.92, pow((portraitPhotoRgb + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), portraitPhotoRgb));
                vec3 portraitPhotoRadiance = portraitPhotoLinear * material.specularColor * 1.3;
                float portraitReflectionWeight = portraitHitValid * 0.38 * (0.6 + 0.4 * portraitSeesSkin) * portraitMetalReflectionStrength;
                reflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular, portraitPhotoRadiance, portraitReflectionWeight);
              }
              vec3 portraitWorldNormal = inverseTransformDirection(normal, viewMatrix);
              float portraitSoftWindow = 0.45 + 0.55 * max(0.0, dot(portraitWorldNormal, normalize(vec3(-0.6, 0.8, 1.0))));
              // The soft fill retains the selected metal's spectral colour.
              reflectedLight.indirectSpecular += material.specularColor * portraitMetalRoom * (0.035 * portraitSoftWindow);
            }
          `);
        },
      }]);
      reflectedMaterials.set(material, uniforms); material.needsUpdate = true;
    }
  });
};

/** Reuse the loaded environment with a portrait-only rotation and softer metal
 * highlights. Restore every property before the live frame is presented. */
const balancePortraitEnvironment = (viewer: any, roots: any[], skin: Color, test?: PortraitEnvironment) => {
  const environment = viewer.scene.environment;
  const rotation = environment?.rotation;
  if (environment && typeof rotation === "number") environment.rotation = test ? test.rotation * Math.PI / 180 : rotation + Math.PI / 12;
  const luminance = skin.r * .2126 + skin.g * .7152 + skin.b * .0722;
  const brightness = .9 + Math.min(.1, luminance * .3);
  const saved = new Map<any, { roughness: number; intensity: number }>();
  roots.forEach(root => root.traverse((mesh: any) => {
    if (!mesh.isMesh) return;
    const diamond = isDiamondMesh(mesh);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!material || saved.has(material)) continue;
      saved.set(material, { roughness: material.roughness, intensity: material.envMapIntensity });
      if (!diamond && Number.isFinite(material.roughness)) material.roughness = Math.max(.085, material.roughness);
      if (Number.isFinite(material.envMapIntensity)) material.envMapIntensity *= diamond ? Math.max(.94, brightness) : brightness * (test?.intensity ?? 1);
      material.uniformsNeedUpdate = true; material.setDirty?.();
    }
  }));
  return () => {
    if (environment && typeof rotation === "number") environment.rotation = rotation;
    for (const [material, original] of saved) {
      if (Number.isFinite(original.roughness)) material.roughness = original.roughness;
      if (Number.isFinite(original.intensity)) material.envMapIntensity = original.intensity;
      material.uniformsNeedUpdate = true; material.setDirty?.();
    }
  };
};

/** Two small, on-demand renders reuse the studio's baked diamond materials.
 * A calibrated finger volume hides the rear band without painting over skin. */
export async function captureLifestylePreview(viewer: any, roots: any[], id: string, resolution: number, signal: AbortSignal, overrides?: PortraitFit, testEnvironment?: PortraitEnvironment, importer?: any): Promise<RingPreviewImage | undefined> {
  const sourcePhoto = LIFESTYLE_PHOTOS.find(item => item.id === id);
  if (!sourcePhoto) return;
  const photo = { ...sourcePhoto, ...overrides };
  const image = new Image(); image.src = photo.image; await image.decode();
  if (signal.aborted) throw new DOMException("Portrait cancelled", "AbortError");
  const originalEnvironment = viewer.scene.environment;
  const lighting = testEnvironment ?? DEFAULT_PORTRAIT_ENVIRONMENT;
  const testAsset = lighting.url ? await loadPortraitEnvironment(viewer, importer, lighting.url) : undefined;
  if (signal.aborted) throw new DOMException("Portrait cancelled", "AbortError");
  // Keep the photograph entirely in Canvas2D; only a small transparent ring
  // layer is rendered by WebGI with its existing diamond/metal pipeline.
  const uniforms = compositors.get(viewer) ?? installCompositor(viewer); compositors.set(viewer, uniforms);
  uniforms.portraitReflectionsWeight.value = lighting.photoReflections ? 1 : 0;
  uniforms.portraitPhotoSeat.value.set(photo.center[0], photo.center[1], photo.fingerWidth / 2, 1.25 / resolution);
  uniforms.portraitPhotoAcross.value.set(Math.cos(photo.angle * Math.PI / 180), -Math.sin(photo.angle * Math.PI / 180));
  const sample = document.createElement("canvas"); sample.width = sample.height = 9;
  const skin = sample.getContext("2d")!;
  skin.drawImage(image, photo.center[0] * image.width - 4, photo.center[1] * image.height - 4, 9, 9, 0, 0, 9, 9);
  const data = skin.getImageData(0, 0, 9, 9).data;
  const rgb = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) for (let channel = 0; channel < 3; channel++) rgb[channel] += data[i + channel] / 81;
  uniforms.portraitSkinLinear.value.setStyle(`rgb(${rgb.map(Math.round).join(",")})`);
  const skinLinear = uniforms.portraitSkinLinear.value;
  const brightest = Math.max(skinLinear.r, skinLinear.g, skinLinear.b, .001);
  // Mostly neutral illumination, with a little warmth sampled from the photo.
  uniforms.portraitRoomLinear.value.setRGB(
    .94 + .06 * skinLinear.r / brightest,
    .94 + .06 * skinLinear.g / brightest,
    .94 + .06 * skinLinear.b / brightest,
  );
  installSkinReflection(roots, uniforms);
  // A tiny reflection backplate, not a new environment bake or render pass.
  const reflectionCanvas = document.createElement("canvas"); reflectionCanvas.width = reflectionCanvas.height = 256;
  reflectionCanvas.getContext("2d")!.drawImage(image, 0, 0, 256, 256);
  const reflectionTexture = new CanvasTexture(reflectionCanvas);
  reflectionTexture.flipY = false;
  reflectionTexture.minFilter = reflectionTexture.magFilter = LinearFilter;
  reflectionTexture.generateMipmaps = false;
  uniforms.portraitPhotoTexture.value = reflectionTexture;
  let restoreAppearance = () => {};
  const output = new WebGLRenderTarget(1, 1, { type: UnsignedByteType, depthBuffer: false });
  let fingerDepth: Mesh | undefined;
  let contactTexture: DataTexture | undefined;
  let crop = { left: 0, top: 0, size: 1 };
  try {
    if (testAsset) await viewer.scene.setEnvironment(testAsset);
    restoreAppearance = balancePortraitEnvironment(viewer, roots, skinLinear, lighting);
    const [result] = await captureRingPreviews(viewer, roots, signal, {
      // Only the ring patch uses WebGI. The rest of the 1600px photograph is
      // copied with Canvas2D: 512² GPU pixels instead of a full 1600² portrait.
      resolution: Math.min(512, resolution),
      customView: {
        id: photo.id, label: photo.label,
        cameraPose: (camera, posedRoots) => {
          const band = posedRoots[1];
          const { radius, halfWidth } = measureRingBore(band);
          const contact = getRingContactShadow(band, radius);
          contactTexture = new DataTexture(contact.data, contact.width, contact.height, RGBAFormat, UnsignedByteType);
          contactTexture.wrapS = RepeatWrapping;
          contactTexture.minFilter = contactTexture.magFilter = LinearFilter;
          contactTexture.generateMipmaps = false;
          contactTexture.needsUpdate = true;
          uniforms.portraitContactMap.value = contactTexture;
          uniforms.portraitContactRange.value.set(contact.minY, contact.spanY);
          const inverse = band.matrixWorld.clone().invert();
          // Local Z turn is applied before the tilts; the outer photo rotation
          // still aligns the tilted pose to the photographed finger.
          const rotation = new Matrix4().makeRotationZ(photo.angle * Math.PI / 180)
            .multiply(new Matrix4().makeRotationX(photo.tilt * Math.PI / 180))
            .multiply(new Matrix4().makeRotationY(photo.roll * Math.PI / 180))
            .multiply(new Matrix4().makeRotationZ(photo.zTurn * Math.PI / 180));
          // Occlude jewellery in the actual depth passes, preserving its bevels
          // and sidewalls instead of cutting a finished picture into a strip.
          const fingerMaterial = new MeshBasicMaterial({ color: 0x000000, colorWrite: false, depthWrite: true, depthTest: true, side: DoubleSide });
          fingerMaterial.userData.renderToDepth = true;
          fingerDepth = new Mesh(new CylinderGeometry(radius * photo.fingerRadiusScale, radius * photo.fingerRadiusScale, radius * 8, 64, 1), fingerMaterial);
          fingerDepth.name = "portrait-finger-depth";
          rotation.decompose(fingerDepth.position, fingerDepth.quaternion, fingerDepth.scale);
          fingerDepth.frustumCulled = false;
          viewer.scene.add(fingerDepth);
          const transform = new Matrix4().multiplyMatrices(rotation, inverse);
          const worlds = posedRoots.map(root => ({ root, matrix: new Matrix4().multiplyMatrices(transform, root.matrixWorld) }));
          for (const { root, matrix } of worlds) {
            root.parent?.updateWorldMatrix(true, false);
            const local = root.parent ? root.parent.matrixWorld.clone().invert().multiply(matrix) : matrix;
            local.decompose(root.position, root.quaternion, root.scale); root.updateMatrix(); root.updateWorldMatrix(false, true);
          }
          uniforms.portraitRingInverse.value.copy(rotation).invert();
          uniforms.portraitRadius.value = radius;
          uniforms.portraitFingerRadius.value = radius * photo.fingerRadiusScale;
          uniforms.portraitBandHalfWidth.value = halfWidth;
          const tangent = Math.tan(camera.fov * Math.PI / 360);
          // The measured boundaries locate the finger's projected centreline,
          // not the raised crown or the front of the band. Offsetting by the
          // dorsal contact point shifts the bore sideways on oblique photos.
          const distance = radius / (tangent * photo.fingerWidth);
          const span = 2 * distance * tangent;
          const target = new Vector3((.5 - photo.center[0]) * span, (photo.center[1] - .5) * span, 0);
          return { position: target.clone().add(new Vector3(0, 0, distance)), target, up: new Vector3(0, 1, 0), minDistance: 1 };
        },
        configureCamera: (camera, posedRoots) => {
          const bounds = new Box3();
          posedRoots.forEach(root => bounds.union(new Box3().setFromObject(root, true)));
          let minX = 1, minY = 1, maxX = 0, maxY = 0;
          const point = new Vector3();
          for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
            point.set(x, y, z).project(camera);
            const px = (point.x + 1) / 2, py = (1 - point.y) / 2;
            minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
          }
          const size = Math.min(1, Math.max(maxX - minX, maxY - minY) * 1.28 + 24 / resolution);
          crop = { size, left: Math.max(0, Math.min(1 - size, (minX + maxX - size) / 2)), top: Math.max(0, Math.min(1 - size, (minY + maxY - size) / 2)) };
          uniforms.portraitPhotoFrame.value.set(crop.left, crop.top, size, 0);
          camera.setViewOffset(resolution, resolution, crop.left * resolution, crop.top * resolution, size * resolution, size * resolution);
        },
        beforeRender: camera => {
          uniforms.portraitEnabled.value = 1;
          uniforms.portraitSceneDepth.value = viewer.getPluginByType("GBuffer").getDepthNormal();
          uniforms.portraitCameraWorld.value.copy(camera.matrixWorld);
          uniforms.portraitPhotoProjection.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
          uniforms.portraitProjectionInverse.value.copy(camera.projectionMatrixInverse);
          uniforms.portraitNearFar.value.set(camera.near, camera.far);
        },
        capture: (renderer, source) => {
          // The ordinary read-buffer export bypasses WebGI's final screen
          // compositor. Apply it explicitly into an 8-bit portrait target.
          output.setSize(source.width, source.height);
          const gpu = renderer.rendererObject;
          const post = viewer.getPluginByType("CombinedPostPlugin").pass.passObject;
          const previous = gpu.getRenderTarget(), screen = post.renderToScreen;
          try { post.renderToScreen = false; post.updateShaderProperties(viewer.getPluginByType("GBuffer")); post.reRender(gpu, output); }
          finally { post.renderToScreen = screen; gpu.setRenderTarget(previous); }
          const pixels = new Uint8Array(output.width * output.height * 4);
          gpu.readRenderTargetPixels(output, 0, 0, output.width, output.height, pixels);
          const canvas = document.createElement("canvas"); canvas.width = output.width; canvas.height = output.height;
          canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), output.width, output.height), 0, 0);
          return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Portrait encoding failed")), "image/png"));
        },
      },
    });
    if (!result) return;
    if (signal.aborted) throw new DOMException("Portrait cancelled", "AbortError");
    const patch = new Image(); patch.src = result.url; await patch.decode();
    if (signal.aborted) throw new DOMException("Portrait cancelled", "AbortError");
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = resolution;
    const context = canvas.getContext("2d")!;
    // Crop only the completed photograph. Original image/fitting coordinates
    // stay intact; the calibration tool continues to show the full photo.
    const galleryFraming = !overrides || Boolean(testEnvironment);
    if (galleryFraming && photo.flipX) { context.translate(resolution, 0); context.scale(-1, 1); }
    const displayCrop = galleryFraming ? photo.crop : { left: 0, top: 0, size: 1 };
    context.scale(1 / displayCrop.size, 1 / displayCrop.size);
    context.translate(-displayCrop.left * resolution, -displayCrop.top * resolution);
    context.drawImage(image, 0, 0, resolution, resolution);
    context.drawImage(patch, crop.left * resolution, crop.top * resolution, crop.size * resolution, crop.size * resolution);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Portrait encoding failed")), "image/webp", .98));
    const url = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
    return { ...result, url, width: resolution, height: resolution };
  } finally {
    uniforms.portraitEnabled.value = 0;
    restoreAppearance();
    if (testAsset) await viewer.scene.setEnvironment(originalEnvironment);
    uniforms.portraitPhotoTexture.value = null;
    reflectionTexture.dispose();
    uniforms.portraitContactMap.value = null;
    contactTexture?.dispose();
    if (fingerDepth) { fingerDepth.removeFromParent(); fingerDepth.geometry.dispose(); (fingerDepth.material as MeshBasicMaterial).dispose(); }
    output.dispose(); viewer.setDirty();
  }
}

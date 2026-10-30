import { Matrix4, NoColorSpace, Texture, UnsignedByteType, Vector2, Vector3, WebGLRenderTarget } from "webgi";
import { LIFESTYLE_PHOTOS } from "../config/lifestylePhotos";
import { captureRingPreviews, type RingPreviewImage } from "./ringPreview";
import { measureRingBore } from "./ringBore";

const compositors = new WeakMap<object, ReturnType<typeof installCompositor>>();
const installCompositor = (viewer: any) => {
  const uniforms = {
    portraitEnabled: { value: 0 }, portraitPhoto: { value: null as any }, portraitSceneDepth: { value: null as any },
    portraitCameraWorld: { value: new Matrix4() }, portraitProjectionInverse: { value: new Matrix4() },
    portraitNearFar: { value: new Vector2() },
    portraitRingInverse: { value: new Matrix4() }, portraitRadius: { value: 1 }, portraitBandHalfWidth: { value: 0 },
  };
  const post = viewer.getPluginByType("CombinedPostPlugin");
  if (!post?.addExtension) throw new Error("The portrait compositor is unavailable.");
  const material = post.pass.passObject.material;
  material.materialExtensions = material.materialExtensions.filter((extension: any) => extension.uuid !== "ring-lifestyle-portrait");
  // A replaced extension after hot reload must bind its own uniform objects.
  const generation = viewer.__portraitCompositorGeneration = (viewer.__portraitCompositorGeneration ?? 0) + 1;
  post.addExtension({
    uuid: "ring-lifestyle-portrait", customCacheKey: `ring-lifestyle-perspective-wrap-v6-${generation}`, isCompatible: () => true,
    extraUniforms: uniforms,
    parsFragmentSnippet: `uniform float portraitEnabled; uniform sampler2D portraitPhoto; uniform sampler2D portraitSceneDepth;
      uniform mat4 portraitCameraWorld; uniform mat4 portraitProjectionInverse; uniform mat4 portraitRingInverse;
      uniform vec2 portraitNearFar;
      uniform float portraitRadius; uniform float portraitBandHalfWidth;`,
    shaderExtender: (shader: any) => {
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
          // The rear semicircle stays behind the finger even where its outer
          // metal surface extends beyond the cylinder's lateral silhouette.
          portraitVisibility *= smoothstep(-portraitRadius * 0.02, portraitRadius * 0.01, portraitLocal.z);
          // Neighbouring fingers cover the metal as it turns into the two
          // measured finger seams. Elevated heads remain fully visible.
          float portraitNeighbour = smoothstep(portraitRadius * 0.97, portraitRadius * 1.015, abs(portraitLocal.x));
          portraitNeighbour *= 1.0 - smoothstep(portraitRadius * 0.65, portraitRadius * 1.05, portraitLocal.z);
          portraitVisibility *= 1.0 - portraitNeighbour;
          if (abs(portraitLocal.x) < portraitRadius && abs(portraitLocal.y) < portraitRadius * 3.0) {
            float portraitFingerFront = sqrt(max(0.0, portraitRadius * portraitRadius * 0.996 - portraitLocal.x * portraitLocal.x));
            portraitVisibility *= smoothstep(-portraitRadius * 0.008, portraitRadius * 0.004, portraitLocal.z - portraitFingerFront);
          }
          vec3 portraitBackground = texture2D(portraitPhoto, vUv).rgb;
          // Contact shading follows the same tilted finger surface as the band,
          // rather than a flat oval under an edge-on strip of metal.
          vec4 portraitRayNear = portraitRingInverse * portraitCameraWorld * portraitProjectionInverse * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
          vec4 portraitRayFar = portraitRingInverse * portraitCameraWorld * portraitProjectionInverse * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
          vec3 portraitRayOrigin = portraitRayNear.xyz / portraitRayNear.w;
          vec3 portraitRayDirection = normalize(portraitRayFar.xyz / portraitRayFar.w - portraitRayOrigin);
          float portraitA = dot(portraitRayDirection.xz, portraitRayDirection.xz);
          float portraitB = dot(portraitRayOrigin.xz, portraitRayDirection.xz);
          float portraitC = dot(portraitRayOrigin.xz, portraitRayOrigin.xz) - portraitRadius * portraitRadius;
          float portraitDiscriminant = portraitB * portraitB - portraitA * portraitC;
          if (portraitDiscriminant > 0.0 && portraitA > 0.001) {
            float portraitT = (-portraitB - sqrt(portraitDiscriminant)) / portraitA;
            float portraitSurfaceY = portraitRayOrigin.y + portraitT * portraitRayDirection.y;
            float portraitContact = max(abs(portraitSurfaceY) - portraitBandHalfWidth, 0.0) / (portraitRadius * 0.09);
            portraitBackground *= 1.0 - 0.14 * exp(-portraitContact * portraitContact);
          }
          gl_FragColor = vec4(mix(portraitBackground, gl_FragColor.rgb, portraitVisibility), 1.0);
        }
        #glMarker`);
    },
  });
  post.pass.passObject.material.setDirty();
  return uniforms;
};

/** Two small, on-demand renders reuse the studio's baked diamond materials.
 * A calibrated finger volume hides the rear band without painting over skin. */
export async function captureLifestylePreview(viewer: any, roots: any[], id: string, resolution: number, signal: AbortSignal): Promise<RingPreviewImage | undefined> {
  const photo = LIFESTYLE_PHOTOS.find(item => item.id === id);
  if (!photo) return;
  const image = new Image(); image.src = photo.image; await image.decode();
  if (signal.aborted) throw new DOMException("Portrait cancelled", "AbortError");
  // The extension runs after the studio's sRGB output conversion. Keep the
  // portrait's original encoded pixels so its skin tone is not tone-mapped.
  const texture = new Texture(image); texture.colorSpace = NoColorSpace; texture.needsUpdate = true; texture.flipY = true;
  const uniforms = compositors.get(viewer) ?? installCompositor(viewer); compositors.set(viewer, uniforms);
  uniforms.portraitPhoto.value = texture;
  const output = new WebGLRenderTarget(1, 1, { type: UnsignedByteType, depthBuffer: false });
  try {
    const [result] = await captureRingPreviews(viewer, roots, signal, {
      resolution,
      customView: {
        id: photo.id, label: photo.label,
        cameraPose: (camera, posedRoots) => {
          const band = posedRoots[1];
          const { radius, halfWidth } = measureRingBore(band);
          const inverse = band.matrixWorld.clone().invert();
          const rotation = new Matrix4().makeRotationZ(photo.angle * Math.PI / 180).multiply(new Matrix4().makeRotationX(photo.tilt * Math.PI / 180));
          const transform = new Matrix4().multiplyMatrices(rotation, inverse);
          const worlds = posedRoots.map(root => ({ root, matrix: new Matrix4().multiplyMatrices(transform, root.matrixWorld) }));
          for (const { root, matrix } of worlds) {
            root.parent?.updateWorldMatrix(true, false);
            const local = root.parent ? root.parent.matrixWorld.clone().invert().multiply(matrix) : matrix;
            local.decompose(root.position, root.quaternion, root.scale); root.updateMatrix(); root.updateWorldMatrix(false, true);
          }
          uniforms.portraitRingInverse.value.copy(rotation).invert();
          uniforms.portraitRadius.value = radius;
          uniforms.portraitBandHalfWidth.value = halfWidth;
          const tangent = Math.tan(camera.fov * Math.PI / 360);
          // Calibrate at the visible skin/band contact, not at the hidden bore
          // centre. This preserves the finger-to-ring scale under perspective.
          const contact = new Vector3(0, 0, radius).applyMatrix4(rotation);
          const contactDistance = radius / (tangent * photo.fingerWidth);
          const distance = contactDistance + contact.z;
          const span = 2 * contactDistance * tangent;
          const target = new Vector3(contact.x + (.5 - photo.center[0]) * span, contact.y + (photo.center[1] - .5) * span, 0);
          return { position: target.clone().add(new Vector3(0, 0, distance)), target, up: new Vector3(0, 1, 0), minDistance: 1 };
        },
        beforeRender: camera => {
          uniforms.portraitEnabled.value = 1;
          uniforms.portraitSceneDepth.value = viewer.getPluginByType("GBuffer").getDepthNormal();
          uniforms.portraitCameraWorld.value.copy(camera.matrixWorld);
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
          return canvas.toDataURL("image/png");
        },
      },
    });
    return result;
  } finally {
    uniforms.portraitEnabled.value = 0; uniforms.portraitPhoto.value = null;
    texture.dispose(); output.dispose(); viewer.setDirty();
  }
}

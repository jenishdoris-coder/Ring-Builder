import * as THREE from 'three';

const fragment = `
uniform sampler2D ringHandDepth;
uniform vec2 ringDepthSize;
uniform float ringDepthFade;
uniform float ringFeatherPixels;
uniform vec3 ringCenter;
uniform vec3 ringAxis;
uniform float ringRadius;
varying vec3 vRingOcclusionWorld;
float ringVisibility(vec3 worldPosition) {
  vec2 uv = gl_FragCoord.xy / ringDepthSize;
  float visible = 0.0;
  // A deterministic soft edge, without the pixel noise of dithering.
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    float handDepth = texture2D(ringHandDepth, uv + vec2(float(x), float(y)) * ringFeatherPixels / ringDepthSize).r;
    float weight = (x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0);
    visible += weight * (1.0 - smoothstep(0.0, ringDepthFade, gl_FragCoord.z - handDepth));
  }
  vec3 relative = worldPosition - ringCenter;
  vec3 radial = relative - ringAxis * dot(relative, ringAxis);
  // Fade exposed rear geometry too, as in the reference's turning stone.
  float rearFade = smoothstep(-0.35, 0.35, radial.z / max(ringRadius, 0.0001));
  return visible / 16.0 * rearFade;
}
`;

export class SoftRingOcclusion {
  private target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, stencilBuffer: false });
  private installed = new WeakSet<THREE.Material>();
  private size = new THREE.Vector2();
  private uniforms = {
    ringHandDepth: { value: null as THREE.DepthTexture | null },
    ringDepthSize: { value: new THREE.Vector2(1, 1) },
    ringDepthFade: { value: 0.0001 },
    ringFeatherPixels: { value: 2 },
    ringCenter: { value: new THREE.Vector3() },
    ringAxis: { value: new THREE.Vector3(0, 1, 0) },
    ringRadius: { value: 1 },
  };
  constructor() {
    this.target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.uniforms.ringHandDepth.value = this.target.depthTexture;
  }
  install(material: THREE.Material, fadeRear = true) {
    if (this.installed.has(material)) return;
    this.installed.add(material);
    const previousProgramKey = material.customProgramCacheKey.bind(material);
    material.transparent = true;
    // Jewelry is solid. Its visible fragments must occlude stones/prongs
    // behind them regardless of transparent-object sorting. Fully occluded
    // fragments discard before writing depth; shadow receivers stay blended.
    material.depthWrite = fadeRear;
    const visibilityCode = fadeRear ? fragment : fragment.replace('return visible / 16.0 * rearFade;', 'return visible / 16.0;');
    if ('isShaderMaterial' in material && material.isShaderMaterial) {
      const shaderMaterial = material as THREE.ShaderMaterial;
      Object.assign(shaderMaterial.uniforms, this.uniforms);
      shaderMaterial.vertexShader = 'varying vec3 vRingOcclusionWorld;\n' + shaderMaterial.vertexShader.replace(/}\s*$/,
        'vRingOcclusionWorld = (modelMatrix * vec4(position, 1.0)).xyz;\n}');
      shaderMaterial.fragmentShader = visibilityCode + shaderMaterial.fragmentShader.replace(/\bvoid\s+main\s*\(\s*\)/,
        'void ringMaterialMain()') + `
void main() {
  float ringAlpha = ringVisibility(vRingOcclusionWorld);
  if (ringAlpha < 0.005) discard;
  ringMaterialMain();
  gl_FragColor.a *= ringAlpha;
  if (gl_FragColor.a < 0.005) discard;
}
`;
    } else {
      const previousCompile = material.onBeforeCompile;
      material.onBeforeCompile = (shader, renderer) => {
        previousCompile.call(material, shader, renderer);
        Object.assign(shader.uniforms, this.uniforms);
        shader.vertexShader = 'varying vec3 vRingOcclusionWorld;\n' + shader.vertexShader.replace('#include <project_vertex>',
          '#include <project_vertex>\nvRingOcclusionWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        // ShadowMaterial writes gl_FragColor directly rather than using the
        // opaque chunk. Apply the same hand-depth clipping to that receiver.
        shader.fragmentShader = visibilityCode + (shader.fragmentShader.includes('#include <opaque_fragment>')
          ? shader.fragmentShader.replace('#include <opaque_fragment>',
            'diffuseColor.a *= ringVisibility(vRingOcclusionWorld); if (diffuseColor.a < 0.005) discard;\n#include <opaque_fragment>')
          : shader.fragmentShader.replace('#include <tonemapping_fragment>',
            'gl_FragColor.a *= ringVisibility(vRingOcclusionWorld); if (gl_FragColor.a < 0.005) discard;\n#include <tonemapping_fragment>'));
      };
      material.customProgramCacheKey = () => `${previousProgramKey()}|soft-ring-occlusion-v4-${fadeRear ? 'rear-fade' : 'depth-only'}`;
    }
    material.needsUpdate = true;
  }
  update(center: THREE.Vector3, axis: THREE.Vector3, worldWidth: number, pixelWidth: number, camera: THREE.OrthographicCamera) {
    this.uniforms.ringCenter.value.copy(center);
    this.uniforms.ringAxis.value.copy(axis);
    this.uniforms.ringRadius.value = worldWidth * 0.5;
    this.uniforms.ringDepthFade.value = Math.max(0.000001, worldWidth * 0.025 / (camera.far - camera.near));
    this.uniforms.ringFeatherPixels.value = Math.max(1, Math.min(4, pixelWidth * 0.025));
  }
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, masks: THREE.Object3D[]) {
    renderer.getDrawingBufferSize(this.size);
    if (this.target.width !== this.size.x || this.target.height !== this.size.y) this.target.setSize(this.size.x, this.size.y);
    this.uniforms.ringDepthSize.value.copy(this.size);
    // Depth-only meshes occupy layer 1. The main pass reads their depth with
    // a soft comparison instead of receiving the old binary hardware cut.
    for (const mask of masks) mask.traverse(object => object.layers.set(1));
    const layers = camera.layers.mask;
    const target = renderer.getRenderTarget();
    const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const shadowNeedsUpdate = renderer.shadowMap.needsUpdate;
    try {
      // Masks only need depth; updating the jewelry's shadow here doubles
      // shadow work and uses the mask camera layers instead of the main view.
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      camera.layers.set(1);
      renderer.setRenderTarget(this.target);
      renderer.render(scene, camera);
      renderer.shadowMap.autoUpdate = shadowAutoUpdate;
      renderer.shadowMap.needsUpdate = shadowNeedsUpdate;
      camera.layers.set(0);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    } finally {
      renderer.shadowMap.autoUpdate = shadowAutoUpdate;
      camera.layers.mask = layers;
      renderer.setRenderTarget(target);
    }
  }
  dispose() { this.target.dispose(); }
}

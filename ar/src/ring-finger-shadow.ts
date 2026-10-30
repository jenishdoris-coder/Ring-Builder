import * as THREE from 'three';

// Interpolate depth comparisons before filtering. The pinned Three r160
// kernel uses discrete taps; the previous patch targeted a newer shader and
// did not change it. Keep the 512px map and soften only this small receiver.
const stableShadowFilter = THREE.ShaderChunk.shadowmap_pars_fragment
  .replace('float getShadow(', `
  float fingerShadowLerp(sampler2D map, vec2 size, vec2 uv, float depth) {
    vec2 pixel = uv * size - 0.5;
    vec2 fraction = fract(pixel);
    vec2 base = (floor(pixel) + 0.5) / size;
    vec2 texel = 1.0 / size;
    return mix(mix(texture2DCompare(map, base, depth), texture2DCompare(map, base + vec2(texel.x, 0.0), depth), fraction.x),
      mix(texture2DCompare(map, base + vec2(0.0, texel.y), depth), texture2DCompare(map, base + texel, depth), fraction.x), fraction.y);
  }
  float getShadow(`)
  .replace(/#if defined\( SHADOWMAP_TYPE_PCF \)[\s\S]*?#elif defined\( SHADOWMAP_TYPE_PCF_SOFT \)/, `
    #if defined( SHADOWMAP_TYPE_PCF )
      shadow = 0.0;
      for(int y = -1; y <= 1; y++) for(int x = -1; x <= 1; x++) {
        float weight = (x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0);
        vec2 offset = vec2(float(x), float(y)) * shadowRadius * 0.6 / shadowMapSize;
        shadow += weight * fingerShadowLerp(shadowMap, shadowMapSize, shadowCoord.xy + offset, shadowCoord.z);
      }
      shadow *= 0.0625;
    #elif defined( SHADOWMAP_TYPE_PCF_SOFT )`);

// Transparent receiver: only the ring's shadow darkens the camera image.
// Its curved surface shares the finger depth mask's pose and radius.
export class RingFingerShadow {
  readonly receiver: THREE.Mesh<THREE.CylinderGeometry, THREE.ShadowMaterial>;
  // Shadow-only light: the ring's studio lighting remains independent.
  readonly light = new THREE.DirectionalLight(0xffffff, 0);
  private readonly direction = new THREE.Vector3(-0.45, 0.65, -4).normalize();
  private readonly worldDirection = new THREE.Vector3();

  constructor(mapSize = 512) {
    const light = this.light;
    this.receiver = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 64, 1, true),
      new THREE.ShadowMaterial({ opacity: 0.18, depthWrite: false, side: THREE.FrontSide }),
    );
    this.receiver.name = 'ring-finger-shadow';
    this.receiver.receiveShadow = true;
    this.receiver.visible = false;
    this.receiver.renderOrder = -1;
    this.receiver.frustumCulled = false;
    this.receiver.material.customProgramCacheKey = () => 'finger-shadow-elliptic-bilinear-v2';
    this.receiver.material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', stableShadowFilter);
      const varyings = 'varying vec2 vFingerShadowUv;\nvarying vec3 vFingerShadowNormal;\nvarying vec3 vFingerShadowLocalNormal;\n';
      shader.vertexShader = varyings + shader.vertexShader.replace('#include <project_vertex>',
        '#include <project_vertex>\nvFingerShadowUv = uv;\nvFingerShadowNormal = normalize(normalMatrix * normal);\nvFingerShadowLocalNormal = normalize(normal / vec3(0.501, 1.35, 0.471));');
      shader.fragmentShader = varyings + shader.fragmentShader.replace('#include <tonemapping_fragment>', `
        float endFade = smoothstep(0.0, 0.20, vFingerShadowUv.y)
          * smoothstep(0.0, 0.20, 1.0 - vFingerShadowUv.y);
        float edgeFade = smoothstep(0.10, 0.55, normalize(vFingerShadowNormal).z);
        // The real finger blocks light through its interior. Suppress the
        // far-side stone's shadow on the palm-facing side of this open receiver.
        float sourceFade = smoothstep(0.05, 0.40, dot(normalize(vFingerShadowLocalNormal),
          normalize(vec3(-0.45, 0.65, -4.0))));
        gl_FragColor.a *= endFade * edgeFade * sourceFade;
        #include <tonemapping_fragment>
      `);
    };
    light.castShadow = true;
    light.shadow.mapSize.set(mapSize, mapSize);
    light.shadow.radius = 6.5;
    light.shadow.bias = -0.00008;
  }

  update(x: number, y: number, orientation: THREE.Quaternion, width: number) {
    if (!Number.isFinite(x + y + width) || width <= 0) {
      this.receiver.visible = false;
      return;
    }
    this.receiver.visible = true;
    this.receiver.position.set(x, y, 0);
    this.receiver.quaternion.copy(orientation);
    // Match the depth proxy's oval cross-section with a tiny surface offset.
    // A circular receiver was wider than the finger on side/up-down turns.
    this.receiver.scale.set(width * 0.501, width * 1.35, width * 0.471);

    // Keep the source on the stone side in finger coordinates. The footprint
    // stays beside the band when the hand tilts, rather than following the camera.
    this.worldDirection.copy(this.direction).applyQuaternion(orientation);
    this.light.target.position.set(x, y, 0);
    this.light.position.copy(this.light.target.position).addScaledVector(this.worldDirection, width * 8);
    const camera = this.light.shadow.camera;
    camera.left = camera.bottom = -width * 2;
    camera.right = camera.top = width * 2;
    camera.near = width * 0.05;
    camera.far = width * 16;
    camera.updateProjectionMatrix();
    this.light.shadow.normalBias = width * 0.0015;
  }

  hide() { this.receiver.visible = false; }

  dispose() {
    this.receiver.geometry.dispose();
    this.receiver.material.dispose();
    this.light.shadow.dispose();
  }
}

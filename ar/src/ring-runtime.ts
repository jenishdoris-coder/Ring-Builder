import * as THREE from 'three';

export function isIPadDevice(userAgent: string, touchPoints: number) {
  // iPadOS desktop mode identifies itself as a Mac with multiple touch points.
  return /iPad/i.test(userAgent) || (/Macintosh/i.test(userAgent) && touchPoints > 1);
}

export function ringPixelRatio(dpr: number) {
  return Math.min(dpr || 1, 2);
}

export function diamondRayBounces(ipad: boolean) {
  return ipad ? 2 : 4;
}

export function usesFacetDiamonds(userAgent: string, touchPoints: number) {
  // Include iPad Safari's desktop UA. Choose the simpler shader before
  // compiling BVH traversal; a graphics-process failure may bypass JS errors.
  return isIPadDevice(userAgent, touchPoints) || /iPhone|iPod/i.test(userAgent);
}

export function createFallbackEnvironment() {
  // Small linear-HDR studio light map; used only if the supplied file fails.
  const data = new Float32Array(16 * 8 * 4);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) {
    const light = y < 4 && (x === 3 || x === 4 || x === 11 || x === 12) ? 3 : y < 4 ? 0.5 : 0.08;
    const offset = (y * 16 + x) * 4;
    data.set([light, light, light, 1], offset);
  }
  const texture = new THREE.DataTexture(data, 16, 8, THREE.RGBAFormat, THREE.FloatType);
  // No float filtering extension is required for this emergency map.
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.needsUpdate = true;
  return texture;
}

export async function loadOptionalEnvironment(load: () => Promise<THREE.Texture>) {
  try { return await load(); }
  catch (error) {
    console.warn('Lighting file failed; keeping the ring available with studio fallback.', error);
    return createFallbackEnvironment();
  }
}

export function createFallbackDiamondMaterial() {
  // No BVH textures or offscreen transmission pass: keep stones visible if
  // the device rejects the custom shader, while retaining the original mesh.
  return new THREE.MeshPhysicalMaterial({
    color: '#ececec', metalness: 0, roughness: 0.08,
    ior: 2.4, envMapIntensity: 1.8, clearcoat: 1,
    transparent: true, depthWrite: true,
  });
}

export function createRingMetalMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: '#d4af37', metalness: 1, roughness: 0.2,
    envMapIntensity: 1.4, side: THREE.DoubleSide,
    transparent: true, depthWrite: true,
  });
}

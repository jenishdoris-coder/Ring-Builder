// Local publishing tool only. The storefront displays the saved WebP files.
import { ACESFilmicToneMapping, Box3, BoxGeometry, Color, DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, PerspectiveCamera, PMREMGenerator, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { isDiamondMesh } from "../src/utils/meshUtils.ts";

const width = 360, height = 280;
const renderer = new WebGLRenderer({ alpha: false, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(width, height);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
const scene = new Scene();
scene.background = new Color("#ffffff");
// Dark studio walls and bright softboxes create distinct silver reflections.
const environment = new Scene();
environment.background = new Color("#8d939d");
const softboxGeometry = new BoxGeometry();
const softboxMaterial = new MeshBasicMaterial();
softboxMaterial.color.setScalar(3);
for (const [position, scale] of [
  [[-4, 1, 0], [0.1, 7, 4]], [[4, 1, -2], [0.1, 6, 3]],
  [[0, 5, 0], [5, 0.1, 5]], [[0, 1, 5], [1.7, 5, 0.1]],
  [[0, 1, -5], [3, 7, 0.1]],
]) {
  const softbox = new Mesh(softboxGeometry, softboxMaterial);
  softbox.position.fromArray(position);
  softbox.scale.fromArray(scale);
  environment.add(softbox);
}
const pmrem = new PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(environment, 0.02, 0.1, 100).texture;
softboxGeometry.dispose();
softboxMaterial.dispose();
pmrem.dispose();
const light = new DirectionalLight(0xffffff, 0.45);
light.position.set(2, 5, 4);
scene.add(light, new HemisphereLight(0xffffff, 0x404754, 0.08));
const metal = new MeshPhysicalMaterial({ color: "#d0d5dc", metalness: 1, roughness: 0.16, envMapIntensity: 1, clearcoat: 0.25, clearcoatRoughness: 0.1 });
const gem = new MeshPhysicalMaterial({ color: "#dbe3ee", metalness: 0.35, roughness: 0.035, envMapIntensity: 1.15, ior: 2.42, reflectivity: 1, clearcoat: 1, flatShading: true });
const draco = new DRACOLoader();
draco.setDecoderPath("/draco/");
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

export async function renderThumbnail(file, kind) {
  const model = (await loader.loadAsync(file)).scene;
  const holder = new Group();
  holder.add(model);
  model.traverse(mesh => {
    // CAD construction lines and cutters are authoring aids, not ring surfaces.
    if (mesh.isLine || mesh.isPoints) { mesh.visible = false; return; }
    if (!mesh.isMesh) return;
    const original = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (/channel.?cutter|ring.?rail|micro.?pave.?cut/i.test(mesh.name) || original.some(material => /creation.?curves|finger.?sizes/i.test(material.name))) { mesh.visible = false; return; }
    const isGem = isDiamondMesh(mesh);
    original.forEach(material => material.dispose());
    mesh.material = isGem ? gem : metal;
  });
  scene.add(holder);
  try {
    holder.updateWorldMatrix(true, true);
    const box = new Box3();
    holder.traverseVisible(mesh => {
      if (mesh.isMesh) { mesh.geometry.computeBoundingBox(); box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld)); }
    });
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const camera = new PerspectiveCamera(30, width / height, 0.001, 1000);
    const distance = Math.max(size.x, size.y, size.z) / (2 * Math.tan(Math.PI / 12)) * 1.25;
    camera.position.copy(center).addScaledVector(new Vector3(0.65, kind === "head" ? 0.65 : 0.25, 1).normalize(), distance);
    camera.lookAt(center);
    if (kind === "shank") {
      camera.zoom = 1.65;
      camera.lookAt(center.clone().add(new Vector3(0, size.y * 0.23, 0)));
    }
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    return await new Promise((resolve, reject) => renderer.domElement.toBlob(blob => blob ? resolve(blob) : reject(new Error("WebP encoding failed")), "image/webp", 0.92));
  } finally {
    scene.remove(holder);
    model.traverse(mesh => { if (mesh.isMesh) mesh.geometry.dispose(); });
  }
}

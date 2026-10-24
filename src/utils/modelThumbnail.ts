import { ACESFilmicToneMapping, Box3, Color, DirectionalLight, Group, HemisphereLight, MeshPhysicalMaterial, PerspectiveCamera, PMREMGenerator, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { isDiamondMesh } from "./meshUtils";
import { assetUrl } from "../config/assets";

let renderer: WebGLRenderer;
let scene: Scene;
let loader: GLTFLoader;
let metal: MeshPhysicalMaterial;
let gem: MeshPhysicalMaterial;
let queue = Promise.resolve();
const images = new Map<string, Promise<string>>();

const initialize = () => {
  if (renderer) return;
  renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(180, 140);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  scene = new Scene();
  scene.background = new Color("#ffffff");
  const environment = new RoomEnvironment();
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(environment, 0.04).texture;
  environment.dispose();
  pmrem.dispose();
  const light = new DirectionalLight(0xffffff, 3);
  light.position.set(2, 5, 4);
  scene.add(light);
  scene.add(new HemisphereLight(0xffffff, 0xdedee1, 2));
  metal = new MeshPhysicalMaterial({ color: "#d1d2d3", metalness: 0.4, roughness: 0.34 });
  gem = new MeshPhysicalMaterial({ color: "#e9edf0", metalness: 0.1, roughness: 0.12 });
  const draco = new DRACOLoader();
  draco.setDecoderPath(assetUrl("/draco/"));
  loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
};

export const getModelThumbnail = (file: string, kind: "head" | "shank"): Promise<string> => {
  const key = `${kind}:${file}`;
  const existing = images.get(key);
  if (existing) return existing;
  const request = queue.then(async () => {
    initialize();
    const model = (await loader.loadAsync(file)).scene;
    const holder = new Group();
    holder.add(model);
    model.traverse((mesh: any) => {
      if (!mesh.isMesh) return;
      const original = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const isGem = isDiamondMesh(mesh);
      original.forEach((material: any) => material.dispose());
      mesh.material = isGem ? gem : metal;
    });
    scene.add(holder);
    const box = new Box3().setFromObject(holder);
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const camera = new PerspectiveCamera(30, 180 / 140, 0.001, 1000);
    const distance = Math.max(size.x, size.y, size.z) / (2 * Math.tan(Math.PI / 12)) * 1.25;
    const direction = new Vector3(0.65, kind === "head" ? 0.65 : 0.25, 1).normalize();
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.lookAt(center);
    if (kind === "shank") {
      camera.zoom = 1.65;
      camera.lookAt(center.clone().add(new Vector3(0, size.y * 0.23, 0)));
    }
    camera.updateProjectionMatrix();
    try {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL("image/webp", 0.9);
    } finally {
      scene.remove(holder);
      model.traverse((mesh: any) => { if (mesh.isMesh) mesh.geometry.dispose(); });
    }
  });
  images.set(key, request);
  queue = request.then(() => {}, () => {});
  request.catch(() => images.delete(key));
  return request;
};

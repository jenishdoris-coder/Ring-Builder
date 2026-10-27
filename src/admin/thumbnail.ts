import { ACESFilmicToneMapping, Box3, BoxGeometry, Color, DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, PerspectiveCamera, PMREMGenerator, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { isDiamondMesh } from "../utils/meshUtils";
import { assetUrl } from "../config/assets";

/** One small render at upload time; no configurator or recurring GPU work. */
export const generateThumbnail = async (file: File, kind: "head" | "shank"): Promise<File> => {
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(480, 360); renderer.setPixelRatio(1);
  renderer.outputColorSpace = SRGBColorSpace; renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = .95;
  const scene = new Scene(); scene.background = new Color("#ffffff");
  const environment = new Scene(); environment.background = new Color("#8d939d");
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial(); material.color.setScalar(3);
  for (const [position, scale] of [[[-4,1,0],[.1,7,4]],[[4,1,-2],[.1,6,3]],[[0,5,0],[5,.1,5]],[[0,1,5],[1.7,5,.1]],[[0,1,-5],[3,7,.1]]]) {
    const box = new Mesh(geometry, material); box.position.fromArray(position); box.scale.fromArray(scale); environment.add(box);
  }
  const pmrem = new PMREMGenerator(renderer), target = pmrem.fromScene(environment, .02, .1, 100);
  scene.environment = target.texture;
  const light = new DirectionalLight(0xffffff, .45); light.position.set(2,5,4); scene.add(light, new HemisphereLight(0xffffff, 0x404754, .08));
  const metal = new MeshPhysicalMaterial({ color: "#d0d5dc", metalness: 1, roughness: .16, clearcoat: .25 });
  const gem = new MeshPhysicalMaterial({ color: "#dbe3ee", metalness: .35, roughness: .035, ior: 2.42, flatShading: true, clearcoat: 1 });
  const draco = new DRACOLoader(); draco.setDecoderPath(`${assetUrl("/draco/").replace(/\/+$/, "")}/`);
  const loader = new GLTFLoader().setDRACOLoader(draco), url = URL.createObjectURL(file);
  let model: Group | undefined;
  try {
    model = (await loader.loadAsync(url)).scene;
    model.traverse((object: any) => {
      if (object.isLine || object.isPoints) { object.visible = false; return; }
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (/channel.?cutter|ring.?rail|micro.?pave.?cut/i.test(object.name) || materials.some((item: any) => /creation.?curves|finger.?sizes/i.test(item.name))) { object.visible = false; return; }
      const diamond = isDiamondMesh(object); materials.forEach((item: any) => item.dispose()); object.material = diamond ? gem : metal;
    });
    scene.add(model); model.updateWorldMatrix(true, true);
    const bounds = new Box3(); model.traverseVisible((object: any) => { if (object.isMesh) { object.geometry.computeBoundingBox(); bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld)); } });
    if (bounds.isEmpty()) throw new Error("The model has no visible surfaces.");
    const center = bounds.getCenter(new Vector3()), size = bounds.getSize(new Vector3());
    const camera = new PerspectiveCamera(30, 4/3, .001, 10000);
    camera.position.copy(center).addScaledVector(new Vector3(.65, kind === "head" ? .65 : .25, 1).normalize(), Math.max(size.x,size.y,size.z) / (2 * Math.tan(Math.PI / 12)) * 1.25);
    if (kind === "shank") { camera.zoom = 1.65; camera.lookAt(center.clone().add(new Vector3(0,size.y*.23,0))); } else camera.lookAt(center);
    camera.updateProjectionMatrix(); renderer.render(scene, camera);
    const blob = await new Promise<Blob>((resolve, reject) => renderer.domElement.toBlob(blob => blob ? resolve(blob) : reject(new Error("Thumbnail encoding failed.")), "image/webp", .92));
    return new File([blob], `${file.name.replace(/\.glb$/i, "")}-thumbnail.webp`, { type: "image/webp" });
  } finally {
    URL.revokeObjectURL(url); model?.traverse((object: any) => { object.geometry?.dispose(); });
    draco.dispose(); metal.dispose(); gem.dispose(); geometry.dispose(); material.dispose(); target.dispose(); pmrem.dispose(); renderer.dispose(); renderer.forceContextLoss();
  }
};

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Box3, Matrix4, Vector3 } from "webgi";
import RingViewer from "../src/components/RingViewer/RingViewer";

const round = "/models/4 PRONG/4 PRONG TALON ROUND/4 PRONG TALON ROUND 2CT.glb";
const oval = "/models/4 PRONG/4 PRONG TALON OVAL/4 PRONG TALON OVAL 2CT.glb";

function InspectRing() {
  const [head, setHead] = useState(round);
  const [shank, setShank] = useState("Traditional Solitaire");
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState("");
  const inspect = () => {
    const { currentHeadRef, currentShankRef } = (window as any).__ringRefs ?? {};
    const viewer = (window as any).__viewer;
    const base = currentShankRef?.current;
    if (!base) return;
    base.updateWorldMatrix(true, true);
    const inverse = new Matrix4().copy(base.matrixWorld).invert();
    const parts = [currentHeadRef.current, base].map((root: any) => {
      root.updateWorldMatrix(true, true);
      const meshes: any[] = [];
      const bounds = new Box3();
      root.traverse((mesh: any) => {
        if (!mesh.isMesh) return;
        mesh.geometry.computeBoundingBox();
        const transform = new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
        const box = mesh.geometry.boundingBox.clone().applyMatrix4(transform);
        bounds.union(box);
        const position = mesh.geometry.attributes.position;
        const nearAxis: number[][] = [];
        const topByWidth: Record<string, number> = {};
        for (let index = 0; index < position.count; index++) {
          const vertex = new Vector3().fromBufferAttribute(position, index).applyMatrix4(transform);
          if (Math.abs(vertex.x) < 1.5) nearAxis.push(vertex.toArray());
          for (const width of [0.2, 0.5, 0.8, 1, 1.5, 2, 3]) {
            if (Math.abs(vertex.x) <= width && Math.abs(vertex.y) < 1.5) topByWidth[width] = Math.max(topByWidth[width] ?? -Infinity, vertex.z);
          }
        }
        meshes.push({ name: mesh.name, material: mesh.material?.name, min: box.min.toArray(), max: box.max.toArray(), nearAxisMinZ: Math.min(...nearAxis.map(p => p[2])), nearAxisMaxZ: Math.max(...nearAxis.map(p => p[2])), topByWidth });
      });
      return { name: root.name, file: root.__sourceFileUrl, mountOffset: root.__headMountGroup?.position.z, min: bounds.min.toArray(), max: bounds.max.toArray(), position: root.position.toArray(), rotation: root.rotation.toArray(), meshes };
    });
    const camera = viewer.scene.activeCamera;
    setMetrics(JSON.stringify({ loading, parts, camera: { position: camera.cameraObject?.position?.toArray(), controllerPosition: camera.position.toArray(), target: camera.controls?.target?.toArray(), rotation: camera.cameraObject?.quaternion?.toArray(), autoRotate: camera.controls?.autoRotate } }, null, 2));
  };
  return <>
    <div style={{ height: 650, width: 850 }}><RingViewer headFile={head} shankFile={`/models/Shank/${shank}.glb`} isAutoRotating={false} onLoadingChange={setLoading} /></div>
    <div>
      <button onClick={() => setHead(head === round ? oval : round)}>Change head</button>
      {["Traditional Solitaire", "BYPASS", "DOUBLE ROW", "French Pave", "KNIFE EDGE SHANK"].map(name => <button key={name} onClick={() => setShank(name)}>{name}</button>)}
      <button onClick={inspect}>Inspect geometry and camera</button>
      <span>{loading ? "Loading" : "Ready"}</span>
    </div>
    <pre style={{ whiteSpace: "pre-wrap" }}>{metrics}</pre>
  </>;
}
const testWindow = window as any;
testWindow.__inspectionReactRoot ??= createRoot(document.getElementById("root")!);
testWindow.__inspectionReactRoot.render(<InspectRing />);

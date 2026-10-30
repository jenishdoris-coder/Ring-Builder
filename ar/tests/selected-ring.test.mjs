import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { assembleSelectedRing, bandDimensions, readSelectedRing } from "../src/selected-ring.ts";

const selection = {head:"http://localhost:5180/head.glb",band:"http://localhost:5180/band.glb",headScale:.17,bandScale:.17,headMetal:"#c2c2c3",bandMetal:"#e8bd92",label:"Selected ring"};
const mesh = geometry => new THREE.Mesh(geometry,new THREE.MeshPhysicalMaterial({name:"Metal 01"}));
function bandScene(rows=1) {const scene=new THREE.Group();for(let row=0;row<rows;row++){const ring=mesh(new THREE.TorusGeometry(10,1,12,48));ring.rotation.x=Math.PI/2;ring.position.y=(row-(rows-1)/2)*2.5;scene.add(ring);}return scene;}
function headScene(){const scene=new THREE.Group();const base=mesh(new THREE.BoxGeometry(2,2,3));base.position.z=11;scene.add(base);return scene;}

test("current builder model, scales and separate colors are transferred",()=>{
  const params=new URLSearchParams(Object.fromEntries(Object.entries(selection).map(([key,value])=>[key,String(value)])));
  assert.deepEqual(readSelectedRing('?'+params,'http://localhost:5180'),selection);
  assert.equal(readSelectedRing('','http://localhost:5180'),null);
  assert.throws(()=>readSelectedRing('?head=https://unknown.example/a.glb&band=/b.glb','http://localhost:5180'));
  params.set('headMetal','red');assert.throws(()=>readSelectedRing('?'+params,'http://localhost:5180'));
});

test("assembly is centered on the band, closes its seat and retains each part's color",()=>{
  const scene=assembleSelectedRing(headScene(),bandScene(),selection);
  assert.ok(scene.userData.seat);assert.ok(scene.userData.innerDiameter>2.8&&scene.userData.innerDiameter<3.4);
  const head=scene.getObjectByName('head'),band=scene.getObjectByName('band');
  assert.equal(head.children[0].children[0].userData.arMetalHex,selection.headMetal);
  assert.equal(band.children[0].userData.arMetalHex,selection.bandMetal);
  assert.ok(new THREE.Box3().setFromObject(head).getCenter(new THREE.Vector3()).z<0,'setting points along AR native -Z');
  assert.ok(Math.abs(scene.userData.seat.seatZ-scene.userData.seat.baseZ-scene.userData.seat.overlap)<1e-6);
});

test("outer 3DM viewer transforms do not alter the selected ring fit",()=>{
  const head=headScene(),band=bandScene();
  head.scale.setScalar(.3);head.position.set(0,-4,0);head.rotation.x=-Math.PI/2;
  band.scale.setScalar(.13);band.rotation.x=-Math.PI/2;
  const a=assembleSelectedRing(head,band,selection),b=assembleSelectedRing(headScene(),bandScene(),selection);
  assert.equal(a.userData.innerDiameter,b.userData.innerDiameter);
  assert.equal(a.userData.seat.offsetZ,b.userData.seat.offsetZ);
});

test("one and two bands use their measured opening instead of a reference ring ratio",()=>{
  const a=assembleSelectedRing(headScene(),bandScene(1),selection),b=assembleSelectedRing(headScene(),bandScene(2),selection);
  assert.ok(Math.abs(a.userData.innerDiameter-b.userData.innerDiameter)<.01);
});

test("real Traditional Solitaire GLB yields a valid measured inner diameter",async()=>{
  const bytes=await readFile(new URL('./fixtures/traditional-solitaire.glb',import.meta.url));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const ring=assembleSelectedRing(headScene(),gltf.scene,selection);
  assert.ok(ring.userData.seat);assert.ok(ring.userData.innerDiameter>2&&ring.userData.innerDiameter<4);
});

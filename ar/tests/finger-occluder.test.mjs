import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, CylinderGeometry, MeshBasicMaterial, DoubleSide, Quaternion, Vector3, Euler, Raycaster } from 'three';
import { placeFingerOccluder } from '../src/finger-occluder.ts';
import { selectHandOcclusion } from '../src/hand-occlusion.ts';

test('the measured finger hides rear shoulders without shaving the front metal',()=>{
  const mask=new Mesh(new CylinderGeometry(1,1,1,64,1,false),new MeshBasicMaterial({side:DoubleSide}));
  placeFingerOccluder(mask,0,0,new Quaternion(),1);mask.updateMatrixWorld(true);
  const hidden=p=>{const hit=new Raycaster(new Vector3(p.x,p.y,4),new Vector3(0,0,-1)).intersectObject(mask)[0];return !!hit&&hit.point.z>p.z;};
  assert.equal(hidden(new Vector3(.49,0,-.1)),true,'rear shoulder beyond the previous inset');
  assert.equal(hidden(new Vector3(.05,0,.485)),false,'front metal must stay opaque');
  for(const rotation of [new Euler(0,.8,0),new Euler(0,-.8,0),new Euler(.7,0,.25)]){
    const q=new Quaternion().setFromEuler(rotation);placeFingerOccluder(mask,0,0,q,1);mask.updateMatrixWorld(true);
    assert.equal(hidden(new Vector3(0,0,-.54).applyQuaternion(q)),true);
    assert.equal(hidden(new Vector3(0,0,.8).applyQuaternion(q)),false);
  }
  mask.geometry.dispose();mask.material.dispose();
});

test('held mask points retain the pose they were measured in',()=>{
  const points=Array.from({length:21},(_,i)=>({x:100+i*4,y:250-i*5}));
  const pose={x:150,y:200,width:70,handScale:200,imageDepthScale:500,orientation:new Quaternion(),anchors:points,fingerLength:80,surfaceFacing:1};
  const before={width:500,height:800,mode:'environment',pose,screen:points,landmarks:points.map(p=>({...p,z:0}))};
  const noisy={...before,pose:{...pose,x:pose.x+2,orientation:new Quaternion().setFromEuler(new Euler(.04,0,0))},
    screen:points.map(p=>({x:p.x+2,y:p.y-1}))};
  const held=selectHandOcclusion(before,noisy,true,pose);
  assert.equal(held.pose,before.pose);assert.deepEqual(held.screen[13],before.screen[13]);
  assert.equal(selectHandOcclusion(before,noisy,false,pose).pose,noisy.pose);
});

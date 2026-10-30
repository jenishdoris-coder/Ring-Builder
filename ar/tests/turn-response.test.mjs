import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Quaternion, Vector3 } from 'three';
import { solveRingPose, skinAnisotropy, RingSurfaceConstraint, RingPoseFilter } from '../src/ring-tracking.ts';

const joints = Array.from({length:21},()=>[0,0,0]);
joints[0]=[0,-.055,0]; joints[5]=[.035,.005,0]; joints[9]=[.012,.013,0];
joints[13]=[-.01,.009,0]; joints[14]=[-.012,.05,0]; joints[17]=[-.032,0,0];
const skin = Array.from({length:12},(_,i)=>[-.011+(i%3-1)*.003,.018+Math.floor(i/3)*.006,.009]);
function hand(pitch,yaw) {
  const rotation=new Quaternion().setFromEuler(new Euler(pitch,yaw,.2,'ZYX'));
  const world=joints.map(p=>new Vector3(...p).applyQuaternion(rotation));
  const project=p=>({x:420+p.x*2000,y:650-p.y*2000});
  const screen=world.map(project);
  const landmarks=world.map(p=>({x:(420+p.x*2000)/900,y:(650-p.y*2000)/1600,z:-p.z*2000/900,
    worldX:p.x,worldY:-p.y,worldZ:-p.z}));
  const pose=solveRingPose(landmarks,screen,'Left',false,undefined,900);
  return {...pose,screen,rotation,axis:world[14].clone().sub(world[13]).normalize(),skin:skin.map(p=>project(new Vector3(...p).applyQuaternion(rotation)))};
}
function placement(h,orientation,previous,edgeConfidence) {
  return {x:h.screen[13].x*.47+h.screen[14].x*.53,y:h.screen[13].y*.47+h.screen[14].y*.53,
    orientation,width:40,fingerLength:h.fingerLength,handScale:h.handScale,anchors:h.anchors,surfaceFacing:h.facing,
    fingerSegment:{base:h.screen[13],tip:h.screen[14],fraction:.53},edgeConfidence,
    imageStill:false,imagePoseStable:false,imageMotion:previous?{before:previous.skin,after:h.skin}:undefined};
}

test('observed sideways turns and up/down pitches release promptly in both directions and return', t=>{
  const failures=[];
  for(const axis of ['pitch','yaw'])for(const sign of [-1,1])for(const edge of [.4,.9]) {
    const surface=new RingSurfaceConstraint(),filter=new RingPoseFilter();let previous,maxLag=0,maxReturnError=0,lagFrame=0;
    for(let frame=0;frame<=64;frame++) {
      const angle=sign*.85*Math.sin(Math.PI*Math.min(frame,48)/48);
      const h=hand(axis==='pitch'?angle:0,axis==='yaw'?angle:0);
      const target=surface.update(h.orientation,h.anchors,h.fingerLength,40,true,h.metricOrientation);
      const value=filter.update(placement(h,target,previous,edge),frame*60);
      if(frame>0&&frame<48&&value.orientation.angleTo(target)>maxLag){maxLag=value.orientation.angleTo(target);lagFrame=frame;}
      if(frame>=52)maxReturnError=Math.max(maxReturnError,value.orientation.angleTo(target));
      previous=h;
    }
    t.diagnostic(`${axis} ${sign}, edge ${edge}: max lag ${maxLag.toFixed(4)} at frame ${lagFrame}, return ${maxReturnError.toFixed(4)}`);
    if(maxLag>=.09)failures.push(`${axis} ${sign}, edge ${edge}: ${maxLag} radians of turn lag`);
    if(maxReturnError>=.035)failures.push(`${axis} ${sign}: return did not settle`);
  }
  assert.deepEqual(failures,[]);
});

test('skin foreshortening evidence excludes screen movement, roll, uniform zoom and unsupported feature rows',()=>{
  const points=Array.from({length:12},(_,i)=>({x:100+(i%3)*6,y:200+Math.floor(i/3)*8}));
  const rigid=points.map(p=>({x:300+1.3*(p.x*Math.cos(.4)-p.y*Math.sin(.4)),
    y:70+1.3*(p.x*Math.sin(.4)+p.y*Math.cos(.4))}));
  assert.ok(skinAnisotropy(points,rigid)<1e-8);
  const shortened=points.map(p=>({x:p.x+20,y:200+(p.y-200)*.97}));
  assert.ok(skinAnisotropy(points,shortened)>.025);
  const line=Array.from({length:8},(_,i)=>({x:100,y:200+i*8}));
  assert.equal(skinAnisotropy(line,line),undefined);
  const inconsistent=shortened.map((p,i)=>({x:p.x+(i===1?18:0),y:p.y}));
  assert.equal(skinAnisotropy(points,inconsistent),undefined);
});

test('image-confirmed stationary depth still wins over a smooth but unsupported inferred turn',()=>{
  const filter=new RingPoseFilter(),h=hand(0,0);
  const raw=placement(h,h.orientation,undefined,.4);
  filter.update(raw,0);
  for(let frame=1;frame<=30;frame++) {
    const noisy=hand(.14*Math.sin(frame*.2),.15*Math.sin(frame*.18));
    const value=filter.update({...raw,orientation:noisy.orientation,anchors:noisy.anchors,
      fingerLength:noisy.fingerLength,imagePoseStable:true,imageMotion:{before:h.skin,after:h.skin}},frame*60);
    assert.ok(value.orientation.angleTo(raw.orientation)<.001,'coherent model-only depth drift must remain held');
  }
});

test('steep up/down pitches preserve the observed finger axis instead of stopping near 67 degrees',()=>{
  for(const angle of [-1.35,1.35]) {
    const h=hand(angle,0),axis=new Vector3(0,1,0).applyQuaternion(h.orientation);
    assert.ok(axis.angleTo(h.axis)<.035,`pitch ${angle}: finger-axis error ${axis.angleTo(h.axis)}`);
  }
});

test('slow side turns and pitches remain attached when skin matches are temporarily unavailable',t=>{
  const failures=[];
  for(const axis of ['pitch','yaw'])for(const sign of [-1,1])for(const interval of [16,33,100]) {
    const surface=new RingSurfaceConstraint(),filter=new RingPoseFilter();let maximum=0,maxReturn=0;
    for(let time=0;time<=4200;time+=interval) {
      const angle=sign*1.15*Math.sin(Math.PI*Math.min(time,3600)/3600);
      const h=hand(axis==='pitch'?angle:0,axis==='yaw'?angle:0);
      const target=surface.update(h.orientation,h.anchors,h.fingerLength,40,true,h.metricOrientation);
      const value=filter.update(placement(h,target,undefined,.4),time);
      if(time>160&&time<3600)maximum=Math.max(maximum,value.orientation.angleTo(target));
      if(time>=4000)maxReturn=Math.max(maxReturn,value.orientation.angleTo(target));
    }
    t.diagnostic(`${axis} ${sign}, ${interval}ms: lag ${maximum.toFixed(4)}, return ${maxReturn.toFixed(4)}`);
    if(maximum>.10||maxReturn>.04)failures.push(`${axis} ${sign}, ${interval}ms: lag ${maximum}, return ${maxReturn}`);
  }
  assert.deepEqual(failures,[]);
});

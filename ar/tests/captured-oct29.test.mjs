import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Quaternion, Vector3, Matrix4 } from 'three';
import { RingPoseFilter, RingSurfaceConstraint, solveRingPose } from '../src/ring-tracking.ts';

const captures=JSON.parse(await readFile(new URL('./fixtures/oct29-alignment-jitter.json',import.meta.url),'utf8'));
function projection(c){
  const scale=Math.max(c.viewport.width/c.video.width,c.viewport.height/c.video.height);
  const width=c.video.width*scale,height=c.video.height*scale;
  const screen=c.hand.landmarks.map(p=>({x:(c.viewport.width-width)/2+p.x*width,y:p.y*height}));
  return solveRingPose(c.hand.landmarks,screen,c.hand.handedness,false,undefined,width);
}

test('cropped-hand metric depth cannot amplify the sideways setting in the actual Oct 29 captures',()=>{
  for(const c of captures){
    const pose=projection(c),axis=new Vector3(0,1,0).applyQuaternion(pose.orientation);
    assert.ok(pose.orientation.angleTo(pose.metricOrientation)>.65,'captured depth estimates disagree');
    axis.z=0;axis.normalize();const normal=new Vector3(0,0,-1);
    const front=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3().crossVectors(axis,normal),axis,normal));
    const center=pose.anchors[0];
    const reference=pose.anchors.map(p=>({x:center.x+(p.x-center.x)*1.35,y:p.y}));
    const filter=new RingSurfaceConstraint();
    filter.update(front,reference,pose.fingerLength,c.rendered.width,true,front);
    const result=filter.update(pose.orientation,pose.anchors,pose.fingerLength,c.rendered.width,true,pose.metricOrientation);
    assert.ok(result.angleTo(pose.orientation)<.02,`unreliable metric depth added ${result.angleTo(pose.orientation)} radians`);
  }
});

test('recorded patch motion transports the attachment without following the captured weak-edge bone spikes',()=>{
  // Reconstruct the saved skin similarity fits. Full feature correspondences
  // were not in v4 captures; this checks the landmark/surface coupling using
  // the measured transforms, rather than claiming to replay the camera video.
  for(const c of captures){
    const filter=new RingPoseFilter(),trace=c.trace;
    let anchors=projection(c).anchors;
    let previous;
    let maxCorrection=0;
    for(let i=0;i<trace.length;i++){
      const row=trace[i],q=new Quaternion().fromArray(row.slice(12,16)).normalize();
      const axis=new Vector3(0,1,0).applyQuaternion(q);const length=c.raw.fingerLength,xy=Math.hypot(axis.x,axis.y);
      const dx=axis.x/xy*length,dy=-axis.y/xy*length;
      const points=Array.from({length:8},(_,k)=>({x:row[4]+(k%2?1:-1)*row[3]*.15,y:row[5]+(Math.floor(k/2)-1.5)*row[3]*.25}));
      const transform=p=>({x:row[4]+(p.x-row[4])*row[20]*Math.cos(row[19])-(p.y-row[5])*row[20]*Math.sin(row[19])+row[17],
        y:row[5]+(p.x-row[4])*row[20]*Math.sin(row[19])+(p.y-row[5])*row[20]*Math.cos(row[19])+row[18]});
      const motion=i?{before:points,after:points.map(transform)}:undefined;
      if(i)anchors=anchors.map(transform);
      const raw={...c.raw,x:row[1],y:row[2],width:row[3],orientation:q,anchors,edgeConfidence:row[16],imageStill:false,
        surfaceFacing:Math.abs(new Vector3(0,0,1).applyQuaternion(q).z),imageMotion:motion,
        fingerSegment:{base:{x:row[1]-dx*.53,y:row[2]-dy*.53},tip:{x:row[1]+dx*.47,y:row[2]+dy*.47},fraction:.53}};
      const value=filter.update(raw,row[0]);
      if(previous){const transported=transform(previous);maxCorrection=Math.max(maxCorrection,Math.hypot(value.x-transported.x,value.y-transported.y));}
      previous=value;
    }
    assert.ok(maxCorrection<.8,`additional attachment shake ${maxCorrection}px`);
  }
});

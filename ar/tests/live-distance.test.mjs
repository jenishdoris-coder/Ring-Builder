import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion } from 'three';
import { FingerFitFilter, RingPoseFilter } from '../src/ring-tracking.ts';

const anchors = [{x:300,y:480},{x:360,y:350},{x:315,y:330},{x:275,y:345},{x:240,y:365}];
const magnify = factor => anchors.map(p=>({x:300+(p.x-300)*factor,y:400+(p.y-400)*factor}));
function calibrated() {
  const fit = new FingerFitFilter();
  for(const time of [0,40,80])fit.update(100,1,{width:40,offset:0,revision:time,confidence:.95,support:6},anchors,1,
    {time,frontal:true,scale:1,still:true});
  return fit;
}
const rawPose = (fit, factor=1) => ({x:300,y:400,width:fit.width,fitRevision:fit.revision,scaleObserved:fit.scaleObserved,
  orientation:new Quaternion(),anchors:magnify(factor),fingerLength:80*factor,handScale:100*factor,
  edgeConfidence:.95,imageStill:true,surfaceFacing:1});

test('clear contour and palm magnification follow distance even if skin matching reports still',()=>{
  const fit=calibrated();let value;
  for(const factor of [1.5,.65,1]){
    for(let frame=0;frame<20;frame++){
      const time=120+(factor===1.5?0:factor===.65?2000:4000)+frame*40;
      value=fit.update(100,1,{width:40*factor,offset:0,revision:time,confidence:.95,support:6},magnify(factor),1,
        {time,frontal:true,scale:1,still:true});
    }
    assert.ok(Math.abs(value.width/(40*factor)-1)<.015,`distance ${factor}: ${value.width}`);
  }
});

test('slow camera approach and retreat stay continuous through the complete fit and pose pipeline',()=>{
  const fit=calibrated(),pose=new RingPoseFilter();
  let previous=40,maxError=0,maxStep=0;
  pose.update(rawPose({width:40,revision:0}),80);
  for(let frame=1;frame<=120;frame++){
    const factor=frame<=60?1+frame*.008:1.48-(frame-60)*.011;
    const time=80+frame*40;
    const value=fit.update(100,1,{width:40*factor,offset:0,revision:time,confidence:.95,support:6},magnify(factor),1,
      {time,frontal:true,scale:1,still:true});
    const rendered=pose.update(rawPose(value,factor),time);
    if(frame>10)maxError=Math.max(maxError,Math.abs(rendered.width/(40*factor)-1));
    maxStep=Math.max(maxStep,Math.abs(rendered.width/previous-1));previous=rendered.width;
  }
  assert.ok(maxError<.055,`maximum scale lag ${maxError}`);
  assert.ok(maxStep<.04,`maximum frame jump ${maxStep}`);
});

test('changing edges cannot periodically refit a stationary palm when the skin image is still',()=>{
  const fit=calibrated();
  for(let frame=0;frame<120;frame++){
    const time=120+frame*40;
    const value=fit.update(100,1,{width:frame%30<15?46:35,offset:0,revision:time,confidence:.95,support:6},anchors,1,
      {time,frontal:true,scale:1,still:true});
    assert.equal(value.width,40);assert.equal(value.revision,0);
  }
});

test('four clear boundary sections can follow distance when the matching palm also grows',()=>{
  const fit=calibrated();let value;
  for(let frame=0;frame<15;frame++){
    const time=120+frame*50;
    value=fit.update(100,1,{width:54,offset:0,revision:time,confidence:.8,support:4},magnify(1.35),1,
      {time,frontal:true,scale:1,still:true});
  }
  assert.ok(Math.abs(value.width/54-1)<.015);
});

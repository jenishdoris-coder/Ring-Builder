import test from 'node:test';
import assert from 'node:assert/strict';
import { arRenderScale } from '../src/render-quality.ts';

test('small jewelry crops receive spatial supersampling above native pixel density',()=>{
  for(const dpr of [1,1.5,2,3]) {
    const scale=arRenderScale(128,192,dpr);
    assert.ok(scale>dpr,`DPR ${dpr}: ${scale} must supersample the ring silhouette`);
    assert.ok(scale<=4);
  }
});
test('large crops respect texture and pixel budgets without reallocating for tiny size changes',()=>{
  for(const [width,height,maxTexture] of [[384,512,4096],[1280,720,4096],[720,1280,2048]]) {
    const scale=arRenderScale(width,height,3,maxTexture);
    assert.ok(width*height*scale*scale<=1_000_000);
    assert.ok(Math.max(width,height)*scale<=maxTexture);
  }
  assert.equal(arRenderScale(128,192,2),arRenderScale(130,194,2));
});

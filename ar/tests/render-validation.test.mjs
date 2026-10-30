import test from "node:test";
import assert from "node:assert/strict";
import { inspectTransparency } from "../src/render-validation.ts";

test("an empty canvas cannot pass the AR transparency check",()=>{
  assert.equal(inspectTransparency(new Uint8ClampedArray(10*10*4),10,10).passed,false);
});
test("an opaque camera-blocking rectangle fails even with a visible ring",()=>{
  assert.equal(inspectTransparency(new Uint8ClampedArray(10*10*4).fill(255),10,10).passed,false);
});
test("a visible ring with an antialiased edge and a clear border passes",()=>{
  const data = new Uint8ClampedArray(10*10*4);
  for(let y=2;y<8;y++)for(let x=2;x<8;x++)data[(y*10+x)*4+3]=x===2?120:255;
  const result=inspectTransparency(data,10,10);
  assert.equal(result.passed,true);assert.equal(result.foreground,36);assert.equal(result.blendedEdges,6);
});

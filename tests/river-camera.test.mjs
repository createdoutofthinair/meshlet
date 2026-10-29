import test from 'node:test';
import assert from 'node:assert/strict';
import {riverCamera,TERRAIN_GRID,WATER_ALONG,WATER_ACROSS} from '../src/river/renderer.js';

test('river view has finite projection and downstream framing at all camera limits',()=>{
 for(const state of [{yaw:0,pitch:.72,distance:850},{yaw:2,pitch:-1,distance:1},{yaw:-2,pitch:2,distance:9000}]){
  const camera=riverCamera(state,1280,720);assert.ok(camera.vp.every(Number.isFinite));assert.ok(camera.eye.every(Number.isFinite));
  assert.ok(Math.hypot(...camera.eye)>=80-1e-6&&Math.hypot(...camera.eye)<=3000+1e-6);assert.ok(camera.eye[1]>0);
 }
 assert.ok(TERRAIN_GRID>=128&&WATER_ALONG>=128&&WATER_ACROSS>=32);
});

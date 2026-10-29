import test from 'node:test';
import assert from 'node:assert/strict';
import {riverCamera,riverReflectionCamera,TERRAIN_GRID,WATER_ALONG,WATER_ACROSS} from '../src/river/renderer.js';

test('river view has finite projection and downstream framing at all camera limits',()=>{
 for(const state of [{yaw:0,pitch:.72,distance:850},{yaw:2,pitch:-1,distance:1},{yaw:-2,pitch:2,distance:9000}]){
  const camera=riverCamera(state,1280,720);assert.ok(camera.vp.every(Number.isFinite));assert.ok(camera.eye.every(Number.isFinite));
  assert.ok(Math.hypot(...camera.eye)>=80-1e-6&&Math.hypot(...camera.eye)<=3000+1e-6);assert.ok(camera.eye[1]>0);
 }
 assert.ok(TERRAIN_GRID>=128&&WATER_ALONG>=128&&WATER_ACROSS>=32);
});

test('reflection camera mirrors the eye and projects the sloped water plane consistently',()=>{
 const camera=riverCamera({yaw:-.55,pitch:.58,distance:560},1280,720),slope=.004,reflection=riverReflectionCamera(camera,1280,720,slope);
 assert.ok(Math.abs((camera.eye[1]+slope*camera.eye[2])+(reflection.eye[1]+slope*reflection.eye[2]))<1e-8);
 const project=(m,p)=>{const v=[...p,1],r=[0,0,0,0];for(let i=0;i<4;i++)for(let j=0;j<4;j++)r[i]+=m[j*4+i]*v[j];return [r[0]/r[3],r[1]/r[3]];};
 for(const [x,z] of [[10,100],[-60,-200]]){const p=[x,-slope*z,z],a=project(camera.vp,p),b=project(reflection.vp,p);assert.ok(Math.abs(a[0]+b[0])<1e-6);assert.ok(Math.abs(a[1]-b[1])<1e-6);}
});

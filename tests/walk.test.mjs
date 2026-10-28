import test from 'node:test';
import assert from 'node:assert/strict';
import {RADIUS_KM,cross,dot,length,normalize} from '../src/planet/planet-math.js';
import {planetCamera} from '../src/planet/camera.js';
import {directionFromCamera,setCameraDirection,walkStep,SurfaceWalker,WALK_EYE_HEIGHT_KM} from '../src/planet/walk.js';

const distance=(a,b)=>Math.atan2(length(cross(a,b)),dot(a,b))*RADIUS_KM;
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('walking follows great circles at the same speed in all directions and latitudes',()=>{
 for(const latitude of [0,.8,1.49,Math.PI/2-1e-6,-Math.PI/2+1e-6]){
  const camera={longitude:.9,latitude},origin=directionFromCamera(camera);
  for(const [forward,strafe] of [[1,0],[0,1],[-1,0],[1,1]]){
   const target=walkStep(origin,.4,forward,strafe,.00035);
   assert.ok(Math.abs(distance(origin,target)-.00035)<1e-9,`${latitude}: ${forward}/${strafe}`);
   assert.ok(Math.abs(length(target)-1)<1e-12);
   const converted={};setCameraDirection(converted,target);
   assert.ok(distance(target,directionFromCamera(converted))<1e-8);
  }
 }
});

test('walk camera can look above the horizon while retaining a near plane at eye height',()=>{
 const camera=planetCamera({mode:'walk',longitude:.3,latitude:1.56,altitude:WALK_EYE_HEIGHT_KM,surfaceHeight:4,pitch:-.4},1280,720);
 assert.ok(dot(camera.forward,camera.radial)>0);
 assert.ok(camera.near<.0002);assert.equal(camera.clearance,WALK_EYE_HEIGHT_KM);
 assert.ok(Math.abs(length(camera.forward)-1)<1e-12);
});

test('walking waits for the rendered ground and follows probed segment heights',async()=>{
 let input={forward:0,strafe:0,fast:false},queries=[];
 const renderer={cameraState:{longitude:.8,latitude:.4,heading:.45,surfaceHeight:0},lastSelection:1,needsSelection:false,sampleRenderedSurface:direction=>new Promise(resolve=>queries.push({direction,resolve}))};
 const walker=new SurfaceWalker(renderer,()=>input);walker.start();walker.afterFrame();
 assert.equal(queries.length,1);input={forward:1,strafe:0,fast:false};walker.advance(100);
 assert.equal(renderer.cameraState.surfaceHeight,0,'motion waits for initial ground');
 queries.shift().resolve(2);await flush();assert.equal(renderer.cameraState.surfaceHeight,2);
 const start=directionFromCamera(renderer.cameraState);walker.afterFrame();assert.equal(queries.length,1);
 queries.shift().resolve(2.0002);await flush();walker.advance(200);walker.advance(310);
 assert.ok(distance(start,directionFromCamera(renderer.cameraState))>.0001);
 assert.ok(renderer.cameraState.surfaceHeight>2&&renderer.cameraState.surfaceHeight<2.0002);
 walker.advance(500);assert.ok(Math.abs(renderer.cameraState.surfaceHeight-2.0002)<1e-10);
 assert.ok(Math.abs(distance(start,directionFromCamera(renderer.cameraState))-.00035)<1e-9);
});

test('released controls and old probe results cannot move a stopped walker',async()=>{
 let input={forward:1,strafe:0,fast:false},resolve;
 const renderer={cameraState:{longitude:0,latitude:0,heading:0,surfaceHeight:1},lastSelection:1,sampleRenderedSurface:()=>new Promise(r=>{resolve=r;})};
 const walker=new SurfaceWalker(renderer,()=>input);walker.start();walker.afterFrame();walker.stop();resolve(6);await flush();
 assert.equal(renderer.cameraState.surfaceHeight,1);assert.equal(walker.active,false);
 walker.start();walker.afterFrame();resolve(1);await flush();walker.afterFrame();
 input={forward:0,strafe:0,fast:false};resolve(8);await flush();walker.advance(1000);
 assert.equal(renderer.cameraState.latitude,0);assert.equal(renderer.cameraState.surfaceHeight,1);
});

test('a terrain cache change invalidates an in-flight ground sample',async()=>{
 let resolve;
 const renderer={cameraState:{longitude:0,latitude:0,heading:0,surfaceHeight:1},generation:1,lastSelection:1,sampleRenderedSurface:()=>new Promise(r=>{resolve=r;})};
 const walker=new SurfaceWalker(renderer,()=>({forward:0,strafe:0,fast:false}));walker.start();walker.afterFrame();
 renderer.generation++;resolve(7);await flush();
 assert.equal(renderer.cameraState.surfaceHeight,1);assert.equal(walker.grounded,false);
 walker.afterFrame();resolve(2);await flush();assert.equal(renderer.cameraState.surfaceHeight,2);
});

test('a stationary walker does not repeatedly rebuild the same patch selection',async()=>{
 let calls=0;
 const renderer={cameraState:{longitude:0,latitude:0,heading:0,surfaceHeight:1},generation:1,lastSelection:100,needsSelection:false,sampleRenderedSurface:async()=>{calls++;return 1;}};
 const walker=new SurfaceWalker(renderer,()=>({forward:0,strafe:0,fast:false}));walker.start();walker.afterFrame();await flush();
 assert.equal(renderer.needsSelection,false);walker.afterFrame();await flush();assert.equal(calls,1);
});

test('walking crosses a cube-face edge without changing the step length',()=>{
 const start=normalize([1,.05,1-1e-8]),next=walkStep(start,0,0,-1,.0007);
 assert.ok(Math.abs(distance(start,next)-.0007)<1e-9);
 assert.notEqual(Math.abs(start[0])>Math.abs(start[2]),Math.abs(next[0])>Math.abs(next[2]));
});

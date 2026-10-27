import test from 'node:test';
import assert from 'node:assert/strict';
import {FACE_BASES,faceCube,faceDirection,directionToFace,makeTile,seedPlates,reversePerspective,dot,cross} from '../src/planet/planet-math.js';
import {selectPatches,neighbors} from '../src/planet/quadtree.js';
import {planetCamera} from '../src/planet/camera.js';

test('cube-face frames are outward oriented and round-trip on all faces',()=>{
 for(let f=0;f<6;f++){
  const b=FACE_BASES[f];assert.ok(dot(cross(b.u,b.v),b.c)>.99);
  for(const u of [-.9,0,.7])for(const v of [-.7,0,.8]){
   const p=faceCube(f,u,v),result=directionToFace(p);
   assert.equal(result.face,f);assert.ok(Math.abs(result.u-u)<1e-12&&Math.abs(result.v-v)<1e-12);
  }
 }
});
test('adjacent cube faces agree at every edge direction',()=>{
 for(let f=0;f<6;f++)for(let edge=0;edge<4;edge++)for(const t of [-.9,-.3,.2,.8]){
  const u=edge===0?-1:edge===1?1:t,v=edge===2?-1:edge===3?1:t;
  const nearU=edge===0?-1.000001:edge===1?1.000001:u,nearV=edge===2?-1.000001:edge===3?1.000001:v;
  const other=directionToFace(faceCube(f,nearU,nearV));assert.notEqual(other.face,f);
  const a=faceDirection(f,u,v),p=directionToFace(faceCube(f,nearU,nearV));const b=faceDirection(p.face,p.u,p.v);
  assert.ok(Math.hypot(...a.map((x,i)=>x-b[i]))<2e-6);
 }
});
test('seeded plate centers are reproducible and vary by seed',()=>{
 assert.deepEqual(seedPlates(42),seedPlates(42));assert.notDeepEqual(seedPlates(42),seedPlates(43));
 const p=seedPlates(1);for(let i=0;i<p.length;i+=4)assert.ok(Math.abs(Math.hypot(p[i],p[i+1],p[i+2])-1)<1e-6);
});
test('reversed depth maps the near plane to one and decreases with distance',()=>{
 const near=.1,m=reversePerspective(Math.PI/3,1,near);const depth=z=>(m[10]*z+m[14])/(m[11]*z+m[15]);
 assert.ok(Math.abs(depth(-near)-1)<1e-6);assert.ok(depth(-10)<depth(-1)&&depth(-10)>0);
});
test('bounded quadtree remains 2:1 balanced across visible and hidden cube edges',()=>{
 for(const cfg of [{altitude:12000,mode:'orbit'}, {altitude:50,mode:'orbit'}, {altitude:4,mode:'flyover'}]){
  const camera=planetCamera({...cfg,longitude:.8,latitude:.4},1280,720);
  const result=selectPatches(camera,{budget:180,maxDepth:16,pixelSize:12});
  assert.ok(result.visible.length>0);assert.ok(result.leaves.length<=180);
  const map=new Map(result.leaves.map(n=>[n.key,n]));
  for(const node of result.leaves)for(let edge=0;edge<4;edge++)for(const other of neighbors(map,node,edge,16))assert.ok(Math.abs(node.level-other.level)<=1,`${node.key} vs ${other.key}`);
  assert.ok(result.visible.every(n=>n.stitch>=0&&n.stitch<16));
 }
});
test('visible selection conservatively retains sampled front-facing terrain',()=>{
 for(const options of [{altitude:14000,mode:'orbit',longitude:.8,latitude:.4},{altitude:200,mode:'orbit',longitude:-2,latitude:.6},{altitude:6,mode:'flyover',longitude:1.9,latitude:.3,pitch:.2}]){
  const camera=planetCamera(options,960,600),result=selectPatches(camera,{budget:180,maxDepth:16,pixelSize:12});
  const visible=new Set(result.visible.map(n=>n.key));
  for(const node of result.leaves){
   let sampleVisible=false;
   for(const x of [0,.25,.5,.75,1])for(const y of [0,.25,.5,.75,1]){
    const dir=faceDirection(node.face,node.u+(x-.5)*node.span,node.v+(y-.5)*node.span);
    const world=dir.map(v=>v*6371),relative=world.map((v,i)=>v-camera.eye[i]);
    const z=dot(relative,camera.forward),horizontal=dot(relative,camera.right),vertical=dot(relative,camera.up);
    if(z>camera.near && Math.abs(horizontal)<=z*camera.tanX && Math.abs(vertical)<=z*camera.tanY && dot(dir,camera.eye)>=6371){sampleVisible=true;}
   }
   if(sampleVisible)assert.ok(visible.has(node.key),`Visible sampled surface incorrectly culled: ${node.key}`);
  }
 }
});
test('camera near plane follows ground clearance, not altitude above sea level',()=>{
 const camera=planetCamera({altitude:.05,surfaceHeight:6,mode:'flyover'},800,600);
 assert.ok(camera.near<=.002);assert.ok(Math.abs(camera.altitude-6.05)<1e-9);assert.equal(camera.clearance,.05);
});
test('a near-ground view can refine to level 20 within a larger budget',()=>{
 const camera=planetCamera({mode:'orbit',altitude:.03,longitude:.8,latitude:.4},1280,720);
 const result=selectPatches(camera,{budget:384,maxDepth:20,pixelSize:10});
 assert.equal(result.deepest,20);assert.ok(result.leaves.length<=384);
});

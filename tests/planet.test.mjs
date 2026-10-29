import test from 'node:test';
import assert from 'node:assert/strict';
import {FACE_BASES,faceCube,faceDirection,directionToFace,makeTile,seedPlates,reversePerspective,add,scale,normalize,dot,cross} from '../src/planet/planet-math.js';
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
  for(const node of result.visible)for(let edge=0;edge<4;edge++)if(node.edgeKeys[edge]){
   const other=map.get(node.edgeKeys[edge]);assert.ok(other);
   assert.ok(neighbors(map,node,edge,16).some(n=>n.key===other.key));
   if(node.stitch&(1<<edge)){assert.equal(node.coarseKeys[edge],other.key);assert.ok(other.level<node.level);}
   else assert.equal(other.level,node.level);
  }
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
test('walking resolves a finer ground mesh while keeping a bounded, balanced quadtree',()=>{
 for(const pitch of [.08,.3,.55]){
  const camera=planetCamera({mode:'walk',altitude:.0017,surfaceHeight:2,longitude:.8,latitude:.4,pitch,heading:.45},1217,1010);
  const result=selectPatches(camera,{budget:512,maxDepth:22,pixelSize:14}),levels=[];
  for(const y of [-.9,-.6,-.3,0,.2])for(const x of [-.8,-.4,0,.4,.8]){
   const ray=normalize(add(add(camera.forward,scale(camera.right,x*camera.tanX)),scale(camera.up,y*camera.tanY)));
   const b=dot(camera.eye,ray),radius=6373,discriminant=b*b-(dot(camera.eye,camera.eye)-radius*radius);
   if(discriminant<0||b>0)continue;
   const hit=directionToFace(add(camera.eye,scale(ray,-b-Math.sqrt(discriminant))));
   const leaf=result.leaves.find(n=>n.face===hit.face&&Math.abs(hit.u-n.u)<=n.span/2&&Math.abs(hit.v-n.v)<=n.span/2);
   assert.ok(leaf);levels.push(leaf.level);
  }
  levels.sort((a,b)=>a-b);assert.equal(result.deepest,22);assert.ok(levels[Math.floor(levels.length/2)]>=22);
  assert.ok(result.leaves.length<=512);
  const leaves=new Map(result.leaves.map(n=>[n.key,n]));
  for(const node of result.leaves)for(let edge=0;edge<4;edge++)for(const other of neighbors(leaves,node,edge,22))assert.ok(Math.abs(node.level-other.level)<=1);
 }
});
test('high mountain views refine both cube faces instead of measuring from sea level',()=>{
 for(const vector of [[-.1875,-1,-1],[1,1,.0625]])for(const surfaceHeight of [2,5.648,9]){
  const d=normalize(vector),camera=planetCamera({longitude:Math.atan2(d[2],d[0]),latitude:Math.atan2(d[1],Math.hypot(d[0],d[2])),mode:'walk',altitude:.0017,surfaceHeight,heading:.45,pitch:.2},1280,720);
  const result=selectPatches(camera,{budget:512,maxDepth:22,pixelSize:14}),focus=directionToFace(camera.focusDirection);
  const leaf=result.leaves.find(n=>n.face===focus.face&&Math.abs(focus.u-n.u)<=n.span/2&&Math.abs(focus.v-n.v)<=n.span/2);
  const faces=new Set(result.visible.filter(n=>n.level>=20).map(n=>n.face));
  assert.equal(leaf?.level,22);assert.ok(faces.size>=2);assert.ok(result.leaves.length<=512);
 }
});
test('zooming refines the viewed surface on high terrain in orbit and flyover',()=>{
 for(const mode of ['orbit','flyover']){
  const levels=[];
  for(const altitude of [2,.3,.05]){
   const camera=planetCamera({mode,altitude,surfaceHeight:7.25,longitude:-1.141034,latitude:.39478,pitch:.08,heading:.45},1280,720);
   const result=selectPatches(camera,{budget:384,maxDepth:20,pixelSize:14}),focus=directionToFace(camera.focusDirection);
   const leaf=result.leaves.find(n=>n.face===focus.face&&Math.abs(focus.u-n.u)<=n.span/2&&Math.abs(focus.v-n.v)<=n.span/2);
   assert.ok(leaf,'view center is covered');assert.ok(result.leaves.length<=384);levels.push(leaf.level);
  }
  assert.ok(levels[0]<levels[1]&&levels[1]<levels[2],`${mode}: ${levels}`);
  assert.ok(levels[2]>=(mode==='orbit'?19:15),`${mode}: ${levels}`);
 }
});
test('close orbit detail covers the view, not only the center point',()=>{
 const camera=planetCamera({mode:'orbit',altitude:.03,surfaceHeight:7.238,longitude:-1.141034,latitude:.39478},860,700);
 const result=selectPatches(camera,{budget:384,maxDepth:20,pixelSize:14}),levels=[];
 for(const y of [-.8,-.4,0,.4,.8])for(const x of [-.8,-.4,0,.4,.8]){
  const ray=normalize(add(add(camera.forward,scale(camera.right,x*camera.tanX)),scale(camera.up,y*camera.tanY)));
  const b=dot(camera.eye,ray),radius=6371+7.238,discriminant=b*b-(dot(camera.eye,camera.eye)-radius*radius);
  assert.ok(discriminant>=0);const hit=directionToFace(add(camera.eye,scale(ray,-b-Math.sqrt(discriminant))));
  const leaf=result.leaves.find(n=>n.face===hit.face&&Math.abs(hit.u-n.u)<=n.span/2&&Math.abs(hit.v-n.v)<=n.span/2);
  assert.ok(leaf);levels.push(leaf.level);
 }
 levels.sort((a,b)=>a-b);assert.ok(levels[12]>=20,`median level: ${levels[12]}`);
});
test('LOD hysteresis reduces patch churn during small repeated camera movements',()=>{
 const options={budget:180,maxDepth:16,pixelSize:12};let previous=null,stableLast=null,freshLast=null,stableChanges=0,freshChanges=0;
 for(let i=0;i<8;i++){
  const camera=planetCamera({altitude:1000*(1+(i%2)*.02),mode:'orbit',longitude:.8+(i%2)*.01,latitude:.4},960,600);
  const stable=selectPatches(camera,{...options,previousSplits:previous}),fresh=selectPatches(camera,options);
  const stableKeys=new Set(stable.visible.map(n=>n.key)),freshKeys=new Set(fresh.visible.map(n=>n.key));
  if(stableLast)for(const key of stableKeys)if(!stableLast.has(key))stableChanges++;
  if(freshLast)for(const key of freshKeys)if(!freshLast.has(key))freshChanges++;
  assert.ok(stable.leaves.length<=options.budget);
  const leaves=new Map(stable.leaves.map(n=>[n.key,n]));
  for(const node of stable.leaves)for(let edge=0;edge<4;edge++)for(const other of neighbors(leaves,node,edge,options.maxDepth))assert.ok(Math.abs(node.level-other.level)<=1);
  previous=stable.splits;stableLast=stableKeys;freshLast=freshKeys;
 }
 assert.ok(freshChanges>0&&stableChanges<freshChanges,`hysteresis ${stableChanges}, fresh ${freshChanges}`);
});
test('measured terrain error can prioritize refinement without exceeding the budget or breaking edge balance',()=>{
 const options={budget:180,maxDepth:16,pixelSize:12};
 const camera=planetCamera({altitude:1000,mode:'orbit',longitude:.8,latitude:.4},960,600);
 const baseline=selectPatches(camera,options),candidate=baseline.visible[1];
 const refined=selectPatches(camera,{...options,errorEstimates:new Map([[candidate.key,50]])});
 const children=refined.leaves.filter(n=>n.face===candidate.face&&n.level===candidate.level+1&&Math.floor(n.x/2)===candidate.x&&Math.floor(n.y/2)===candidate.y);
 assert.equal(children.length,4,'high projected residual should refine the selected patch');
 assert.ok(refined.leaves.length<=options.budget);
 const leaves=new Map(refined.leaves.map(n=>[n.key,n]));
 for(const node of refined.leaves)for(let edge=0;edge<4;edge++)for(const other of neighbors(leaves,node,edge,options.maxDepth))assert.ok(Math.abs(node.level-other.level)<=1);
});

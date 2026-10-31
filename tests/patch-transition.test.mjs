import test from 'node:test';
import assert from 'node:assert/strict';
import {makeTile} from '../src/planet/planet-math.js';
import {transitionPairs,encodeTransitionPairs,transitionSignatures} from '../src/planet/patch-transition.js';
const tile=(face,level,x,y,slot,stitch=0)=>({...makeTile(face,level,x,y),slot,stitch});

test('terrain stitch signatures retain unsigned 32-bit results',()=>{
 const nodes=[{key:'0/22/4194303/1',normalStitch:1,edgeKeys:[null,null,null,null],cornerKeys:[[],[],[],[]]}];
 assert.equal(transitionSignatures(nodes).get(nodes[0].key),3796864848);
});

test('cached stitch signatures match a full rebuild as adjacency changes',async()=>{
 const {planetCamera}=await import('../src/planet/camera.js');
 const {selectPatches}=await import('../src/planet/quadtree.js');
 const options={budget:120,pixelSize:10,includeHidden:true};
 const before=selectPatches(planetCamera({mode:'flight',altitude:50,longitude:.8,latitude:.4},960,600),options);
 const after=selectPatches(planetCamera({mode:'flight',altitude:25,longitude:.9,latitude:.4},960,600),{...options,previousLeaves:before.leaves});
 const previous={nodes:before.visible,signatures:transitionSignatures(before.visible)};
 for(const nodes of [before.visible,after.visible,after.visible.slice(1)])
  assert.deepEqual(transitionSignatures(nodes,previous),transitionSignatures(nodes));
 const modified=structuredClone(before.visible);
 modified[0].normalStitch^=1;modified[0].edgeKeys[0]=null;
 assert.deepEqual(transitionSignatures(modified,previous),transitionSignatures(modified));
 let state=12345;const random=n=>(state=(Math.imul(state,1664525)+1013904223)>>>0)%n;
 for(let iteration=0;iteration<40;iteration++){
  const nodes=structuredClone(before.visible);
  for(let change=0;change<5;change++){
   const node=nodes[random(nodes.length)];
   switch(random(4)){
    case 0:node.normalStitch^=1<<random(8);break;
    case 1:node.edgeKeys[random(4)]=random(2)?null:nodes[random(nodes.length)].key;break;
    case 2:node.cornerKeys[random(4)].push(nodes[random(nodes.length)].key);break;
    case 3:if(nodes.length>1)nodes.splice(random(nodes.length),1);
   }
  }
  assert.deepEqual(transitionSignatures(nodes,previous),transitionSignatures(nodes));
 }
});

test('transition comparisons pair actual parent and child in both directions',()=>{
 const parent=tile(1,2,1,2,5,2),children=[tile(1,3,2,4,10,1),tile(1,3,3,4,11),tile(1,3,2,5,12),tile(1,3,3,5,13)];
 for(const [old,next] of [[[parent],children],[children,[parent]]]){
  const pairs=transitionPairs(old,next);assert.equal(pairs.length,4);
  assert.deepEqual(pairs.map(p=>[p.originX,p.originY,p.scale]),[[0,0,.5],[8,0,.5],[0,8,.5],[8,8,.5]]);
  for(const p of pairs){assert.equal(p.coarse.key,parent.key);assert.equal(p.coarse.slot,5);}
  const raw=encodeTransitionPairs(pairs),u=new Uint32Array(raw),f=new Float32Array(raw);
  assert.deepEqual([...u.slice(0,4)],[10,5,1,2]);assert.deepEqual([...f.slice(4,7)],[0,0,.5]);
 }
});

test('comparison mapping supports skipped levels and ignores unrelated or unchanged patches',()=>{
 const root=tile(0,0,0,0,1),fine=tile(0,5,19,7,2,4),other=tile(1,5,19,7,3);
 const pairs=transitionPairs([root,other],[fine,other]);assert.equal(pairs.length,1);
 assert.equal(pairs[0].scale,1/32);assert.equal(pairs[0].originX,9.5);assert.equal(pairs[0].originY,3.5);
 assert.equal(transitionPairs([fine],[other]).length,0);
});

test('retained patches compare edge stitch changes in the appropriate direction',()=>{
 const old=tile(0,2,1,2,3,1),next=tile(0,2,1,2,3,2);
 const pairs=transitionPairs([old],[next]);assert.equal(pairs.length,2);
 assert.equal(pairs[0].refining,true);assert.equal(pairs[0].fine.stitch,2);assert.equal(pairs[0].coarse.stitch,1);
 assert.equal(pairs[1].refining,false);assert.equal(pairs[1].fine.stitch,1);assert.equal(pairs[1].coarse.stitch,2);
 assert.ok(pairs.every(p=>p.originX===0&&p.originY===0&&p.scale===1));
 assert.equal(transitionPairs([old],[{...old}]).length,0);
});

import {PlanetRenderer} from '../src/planet/renderer.js';
import {planetCamera} from '../src/planet/camera.js';

test('visible patches stay resident while replacements are staged or cancelled',async()=>{
 const r=Object.create(PlanetRenderer.prototype);
 Object.assign(r,{retiredSlots:new Set(),device:{queue:{onSubmittedWorkDone:async()=>{}}},budget:120,maxDepth:20,pixelSize:14,cameraState:{mode:'orbit'},generation:1,
  slotByKey:new Map(),stitchByKey:new Map(),free:Array.from({length:1024},(_,i)=>1023-i),patches:[],pending:[],normalPending:[],previousSplits:null,transitionErrors:new Map(),transition:{pixels:null,pending:0,overTarget:false,waiting:false},stats:{},stage:null});
 const a=planetCamera({mode:'orbit',altitude:14000,longitude:.8,latitude:.4},960,600);
 const b=planetCamera({mode:'orbit',altitude:500,longitude:.8,latitude:.4},960,600);
 r.select(a,100);const previous=r.patches,oldSlots=new Map(r.slotByKey);assert.ok(previous.length>0);
 r.pending=[];r.normalPending=[];r.select(b,300);assert.ok(r.stage,'new selection should be staged');
 assert.equal(r.patches,previous,'previous terrain remains drawn during preparation');assert.deepEqual(r.slotByKey,oldSlots);
 const staged=r.stage.newNodes.map(n=>n.slot);assert.ok(staged.length>0);assert.ok(staged.every(slot=>![...oldSlots.values()].includes(slot)));
 r.cancelStage();await Promise.resolve();assert.equal(r.patches,previous);assert.deepEqual(r.slotByKey,oldSlots);assert.equal(new Set(r.free).size,r.free.length);
 r.select(b,500);assert.ok(r.stage);const wanted=r.stage.nodes.map(n=>n.key);r.commitStage(600);await Promise.resolve();
 assert.deepEqual(r.patches.map(n=>n.key),wanted);assert.equal(r.stage,null);assert.equal(r.free.length,1024-r.patches.length);assert.equal(new Set(r.free).size,r.free.length);
});

test('slot pressure defers the whole replacement without losing visible coverage',()=>{
 const r=Object.create(PlanetRenderer.prototype);
 Object.assign(r,{retiredSlots:new Set(),device:{queue:{onSubmittedWorkDone:async()=>{}}},budget:120,maxDepth:20,pixelSize:14,cameraState:{mode:'orbit'},generation:1,
  slotByKey:new Map(),stitchByKey:new Map(),free:Array.from({length:1024},(_,i)=>1023-i),patches:[],pending:[],normalPending:[],previousSplits:null,transitionErrors:new Map(),transition:{pixels:null,pending:0,overTarget:false,waiting:false},stats:{},stage:null});
 const a=planetCamera({mode:'orbit',altitude:14000,longitude:.8,latitude:.4},960,600);
 const b=planetCamera({mode:'orbit',altitude:500,longitude:.8,latitude:.4},960,600);
 r.select(a,100);const oldPatches=r.patches,oldSlots=new Map(r.slotByKey);
 r.free=[];r.pending=[];r.normalPending=[];r.select(b,300);
 assert.equal(r.patches,oldPatches);assert.deepEqual(r.slotByKey,oldSlots);
 assert.deepEqual(r.free,[]);assert.equal(r.stage,null);assert.equal(r.needsSelection,true);
 assert.equal(r.transition.capacityDeferred,true);assert.ok(r.transition.pending>0);
});

test('transition groups retain each referenced slot once for splits and merges',async()=>{
 const {transitionGroups}=await import('../src/planet/patch-transition.js');
 const parent=tile(1,2,1,2,5),children=[tile(1,3,2,4,10),tile(1,3,3,4,11),tile(1,3,2,5,12),tile(1,3,3,5,13)];
 for(const [old,next,type] of [[ [parent],children,'refine'],[children,[parent],'merge']]){
  const groups=transitionGroups(old,next);assert.equal(groups.length,1);assert.equal(groups[0].type,type);
  assert.equal(groups[0].pairs.length,4);assert.deepEqual(groups[0].slots.slice().sort((a,b)=>a-b),[5,10,11,12,13]);
 }
});

test('retired slots are unavailable until the GPU fence completes',async()=>{
 let done;const fence=new Promise(resolve=>{done=resolve;});
 const r=Object.create(PlanetRenderer.prototype);
 Object.assign(r,{device:{queue:{onSubmittedWorkDone:()=>fence}},generation:3,retiredSlots:new Set(),free:[],transition:{capacityDeferred:true},needsSelection:false});
 r.retireSlots([8,9]);assert.deepEqual(r.free,[]);assert.deepEqual([...r.retiredSlots],[8,9]);
 assert.throws(()=>r.retireSlots([8]),/twice/);done();await Promise.resolve();
 assert.deepEqual(r.free,[8,9]);assert.equal(r.retiredSlots.size,0);assert.equal(r.needsSelection,true);
});

test('an old retirement fence cannot add slots to a reset cache',async()=>{
 let done;const fence=new Promise(resolve=>{done=resolve;});
 const r=Object.create(PlanetRenderer.prototype);
 Object.assign(r,{device:{queue:{onSubmittedWorkDone:()=>fence}},generation:3,retiredSlots:new Set(),free:[],transition:{}});
 r.retireSlots([8]);r.generation++;r.retiredSlots=new Set();r.free=[8];
 done();await Promise.resolve();assert.deepEqual(r.free,[8]);
});

test('morph upload maps child slots to parents, clamps factors, and disables omitted slots',async()=>{
 const {encodePatchMorphs}=await import('../src/planet/patch-transition.js');
 const parent=tile(0,1,0,0,2,1),child=tile(0,2,1,0,5,4);
 const [pair]=transitionPairs([parent],[child]);
 for(const factor of [-1,0,.25,1,2]){
  const raw=encodePatchMorphs([{pair,factor}],8),u=new Uint32Array(raw),f=new Float32Array(raw);
  assert.deepEqual([...u.slice(40,44)],[2,1,4,1]);assert.deepEqual([...f.slice(44,48)],[8,0,.5,Math.max(0,Math.min(1,factor))]);
  assert.equal(u[2*8+3],0);assert.equal(u[7*8+3],0);
 }
 assert.throws(()=>encodePatchMorphs([{pair,factor:NaN}],8),/mapping/);
 assert.throws(()=>encodePatchMorphs([{pair,factor:0},{pair,factor:1}],8),/slot/);
 assert.ok(new Uint32Array(encodePatchMorphs([],8)).every(x=>x===0));
});

test('boundary coordination links transitions across cube faces and corners',async()=>{
 const {coordinateTransitions}=await import('../src/planet/patch-transition.js');
 const a=tile(0,1,0,0,0),b=tile(2,1,0,0,1),c=tile(4,1,0,0,2);
 a.edgeKeys=[b.key];b.cornerKeys=[[c.key]];
 const children=(p,start)=>[0,1,2,3].map(i=>tile(p.face,p.level+1,p.x*2+(i%2),p.y*2+(i>>1),start+i));
 const components=coordinateTransitions([a,b,c],[...children(a,10),...children(b,20),...children(c,30)]);
 assert.equal(components.length,1);assert.equal(components[0].groups.length,3);
 assert.equal(new Set(components[0].slots).size,15);assert.deepEqual(components[0].deferredReasons,[]);
});

test('incomplete children and skipped levels cannot be silently treated as a full split',async()=>{
 const {coordinateTransitions}=await import('../src/planet/patch-transition.js');
 const a=tile(0,1,0,0,0),child=tile(0,2,0,0,1),deep=tile(0,4,0,0,2);
 assert.deepEqual(coordinateTransitions([a],[child])[0].deferredReasons,['incomplete-children']);
 assert.ok(coordinateTransitions([a],[deep])[0].deferredReasons.includes('skipped-levels'));
});

test('a retained stitch change defers its connected refinement component',async()=>{
 const {coordinateTransitions}=await import('../src/planet/patch-transition.js');
 const a=tile(0,1,0,0,0),b=tile(0,2,2,0,1,1);a.edgeKeys=[b.key];
 const children=[0,1,2,3].map(i=>tile(0,2,i%2,i>>1,10+i));
 const components=coordinateTransitions([a,b],[...children,{...b,stitch:0}]);
 assert.equal(components.length,1);assert.ok(components[0].deferredReasons.includes('stitch-change'));
});

test('stitched children request common triangulation even with an unstitched parent',async()=>{
 const {coordinateTransitions}=await import('../src/planet/patch-transition.js');
 const parent=tile(0,1,0,0,0),children=[0,1,2,3].map(i=>tile(0,2,i%2,i>>1,i+1,i===0?1:0));
 assert.deepEqual(coordinateTransitions([parent],children)[0].deferredReasons,['stitched-child']);
});

test('precomputed transition pairs and groups retain identical coordination',async()=>{
 const {transitionPairs,transitionGroups,coordinateTransitions}=await import('../src/planet/patch-transition.js');
 const {selectPatches}=await import('../src/planet/quadtree.js');const {planetCamera}=await import('../src/planet/camera.js');
 const options={budget:54,pixelSize:14,includeHidden:true};
 const previous=selectPatches(planetCamera({altitude:14000,longitude:.8,latitude:.4},960,600),options).visible;
 const next=selectPatches(planetCamera({altitude:50,longitude:2.2,latitude:-.2},960,600),{...options,previousLeaves:previous}).visible;
 const pairs=transitionPairs(previous,next),groups=transitionGroups(previous,next,pairs);
 assert.deepEqual(groups,transitionGroups(previous,next));
 assert.deepEqual(coordinateTransitions(previous,next,groups),coordinateTransitions(previous,next));
});

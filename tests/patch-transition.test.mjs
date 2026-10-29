import test from 'node:test';
import assert from 'node:assert/strict';
import {makeTile} from '../src/planet/planet-math.js';
import {transitionPairs,encodeTransitionPairs} from '../src/planet/patch-transition.js';
const tile=(face,level,x,y,slot,stitch=0)=>({...makeTile(face,level,x,y),slot,stitch});

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

test('visible patches stay resident while replacements are staged or cancelled',()=>{
 const r=Object.create(PlanetRenderer.prototype);
 Object.assign(r,{budget:120,maxDepth:20,pixelSize:14,cameraState:{mode:'orbit'},generation:1,
  slotByKey:new Map(),stitchByKey:new Map(),free:Array.from({length:1024},(_,i)=>1023-i),patches:[],pending:[],normalPending:[],previousSplits:null,transitionErrors:new Map(),transition:{pixels:null,pending:0,overTarget:false,waiting:false},stats:{},stage:null});
 const a=planetCamera({mode:'orbit',altitude:14000,longitude:.8,latitude:.4},960,600);
 const b=planetCamera({mode:'orbit',altitude:500,longitude:.8,latitude:.4},960,600);
 r.select(a,100);const previous=r.patches,oldSlots=new Map(r.slotByKey);assert.ok(previous.length>0);
 r.pending=[];r.normalPending=[];r.select(b,300);assert.ok(r.stage,'new selection should be staged');
 assert.equal(r.patches,previous,'previous terrain remains drawn during preparation');assert.deepEqual(r.slotByKey,oldSlots);
 const staged=r.stage.newNodes.map(n=>n.slot);assert.ok(staged.length>0);assert.ok(staged.every(slot=>![...oldSlots.values()].includes(slot)));
 r.cancelStage();assert.equal(r.patches,previous);assert.deepEqual(r.slotByKey,oldSlots);assert.equal(new Set(r.free).size,r.free.length);
 r.select(b,500);assert.ok(r.stage);const wanted=r.stage.nodes.map(n=>n.key);r.commitStage(600);
 assert.deepEqual(r.patches.map(n=>n.key),wanted);assert.equal(r.stage,null);assert.equal(r.free.length,1024-r.patches.length);assert.equal(new Set(r.free).size,r.free.length);
});

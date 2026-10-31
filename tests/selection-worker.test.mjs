import test from 'node:test';
import assert from 'node:assert/strict';
import {planetCamera} from '../src/planet/camera.js';
import {selectPatches} from '../src/planet/quadtree.js';
import {transitionGroups,transitionPairs} from '../src/planet/patch-transition.js';
import {buildTransitionTopology} from '../src/planet/transition-topology.js';
import {packTransitionTopology} from '../src/planet/transition-upload.js';

test('worker prepares stitched transition topology for the selected covering tree',async()=>{
 const messages=[];globalThis.self={postMessage:value=>messages.push(value)};
 try{
  await import('../src/planet/selection-worker.js');
  const options={budget:54,pixelSize:14,includeHidden:true};
  const first=selectPatches(planetCamera({altitude:14000,longitude:.8,latitude:.4},960,600),options);
  const camera=planetCamera({altitude:50,longitude:2.2,latitude:-.2},960,600);
  self.onmessage({data:{id:1,key:'test',camera,options:{...options,previousLeaves:first.leaves},previousPatches:first.visible}});
  const result=messages[0],records=[];let checked=0;
  const old=new Set(first.visible);
  for(const group of result.groupPlan)if(group.type!=='stitch'){
   assert.ok(group.pairIndices.every(i=>Number.isInteger(i)&&result.relationships[i]));
   assert.equal(group.pairs,undefined);
  }
  assert.deepEqual(result.relationships,transitionPairs(first.visible,result.result.visible).map(p=>({fineKey:p.fine.key,coarseKey:p.coarse.key,fineOld:old.has(p.fine),coarseOld:old.has(p.coarse),originX:p.originX,originY:p.originY,scale:p.scale,refining:p.refining})));
  for(const group of transitionGroups(first.visible,result.result.visible))for(const pair of group.pairs){
   if(group.type!=='stitch'&&!pair.fine.stitch&&!pair.coarse.stitch)continue;
   records.push({slot:checked,coordinates:buildTransitionTopology({mask:pair.coarse.stitch,originX:pair.originX,originY:pair.originY,scale:pair.scale},{mask:pair.fine.stitch}).coordinates});assert.equal(result.packedTopology.keys[checked],pair.fine.key);checked++;
  }
  assert.ok(checked>0);const expected=packTransitionTopology(records);assert.deepEqual(result.packedTopology.ranges,expected.ranges.subarray(0,checked*32));assert.deepEqual(result.packedTopology.coordinates,expected.coordinates);
  const errors=new Map([[first.visible[0].key,7]]);
  self.onmessage({data:{id:2,key:'test',camera,options,errorEstimates:errors}});
  self.onmessage({data:{id:3,key:'test',camera,options,errorEstimates:null}});
  assert.deepEqual(messages[2].result,messages[1].result,'omitted errors reuse the worker snapshot');
  const empty=new Map();self.onmessage({data:{id:4,key:'test',camera,options,errorEstimates:empty}});
  assert.deepEqual(messages[3].result,selectPatches(camera,{...options,errorEstimates:empty}));
  const snapshotOptions={...options,previousLeaves:first.leaves,previousSplits:first.splits};
  self.onmessage({data:{id:5,key:'test',camera,options:snapshotOptions,previousPatches:first.visible,errorEstimates:empty,snapshotPresent:true}});
  self.onmessage({data:{id:6,key:'test',camera,options,errorEstimates:null,snapshotPresent:false}});
  assert.deepEqual(messages[5].result,messages[4].result,'cached tree produces the same selection');
  assert.deepEqual(messages[5].packedTopology,messages[4].packedTopology,'cached tree produces the same transition topology');
 }finally{delete globalThis.self;}
});

test('worker stitch signatures match the shared signature calculation',async()=>{
 const messages=[];globalThis.self={postMessage:value=>messages.push(value)};
 try{
  await import('../src/planet/selection-worker.js?signature-test');
  const {transitionSignatures}=await import('../src/planet/patch-transition.js');
  const camera=planetCamera({altitude:50,longitude:2.2,latitude:-.2},960,600);
  self.onmessage({data:{id:1,key:'test',camera,options:{budget:54,pixelSize:14,includeHidden:true}}});
  assert.deepEqual(messages[0].signatures,transitionSignatures(messages[0].result.visible));
 }finally{delete globalThis.self;}
});

test('unchanged resident covering returns a compact response',async()=>{
 const messages=[];globalThis.self={postMessage:value=>messages.push(value)};
 try{
  await import('../src/planet/selection-worker.js?unchanged-test');
  const camera=planetCamera({altitude:14000,longitude:.8,latitude:.4},960,600),options={budget:54,pixelSize:14,includeHidden:true};
  const first=selectPatches(camera,options);
  self.onmessage({data:{id:1,key:'test',camera,options:{...options,previousLeaves:first.leaves,previousSplits:first.splits},previousPatches:first.visible,snapshotPresent:true,allowUnchanged:true}});
  assert.equal(messages[0].unchanged,true);assert.equal(messages[0].result,undefined);assert.equal(messages[0].leafCount,first.leaves.length);
  const changed=planetCamera({altitude:50,longitude:2.2,latitude:-.2},960,600);
  self.onmessage({data:{id:2,key:'test',camera:changed,options,snapshotPresent:false,allowUnchanged:true}});
  assert.notEqual(messages[1].unchanged,true);assert.ok(messages[1].result);
 }finally{delete globalThis.self;}
});

test('worker can omit duplicated leaves for a complete resident covering',async()=>{
 const messages=[];globalThis.self={postMessage:value=>messages.push(structuredClone(value))};
 try{
  await import('../src/planet/selection-worker.js?compact-leaves-test');
  const camera=planetCamera({altitude:50,longitude:.8,latitude:.4},960,600);
  const options={budget:54,pixelSize:14,includeHidden:true};
  self.onmessage({data:{id:1,key:'test',camera,options,compactLeaves:true}});
  const result=messages[0].result,expected=selectPatches(camera,options);
  assert.equal(result.compactLeaves,true);assert.equal(result.leaves,null);
  assert.deepEqual(result.visible.map(p=>p.key),expected.leaves.map(p=>p.key));
  result.leaves=result.visible;
  const next=selectPatches(camera,{...options,previousLeaves:result.leaves,previousSplits:result.splits,unchangedPatches:result.visible});
  assert.equal(next.unchanged,true);
 }finally{delete globalThis.self;}
});

test('worker can derive covering leaves from a complete patch snapshot',async()=>{
 const messages=[];globalThis.self={postMessage:value=>messages.push(structuredClone(value))};
 try{
  await import('../src/planet/selection-worker.js?derived-leaves-test');
  const options={budget:54,pixelSize:14,includeHidden:true};
  const oldCamera=planetCamera({altitude:14000,longitude:.8,latitude:.4},960,600);
  const camera=planetCamera({altitude:50,longitude:2.2,latitude:-.2},960,600);
  const previous=selectPatches(oldCamera,options);
  self.onmessage({data:{id:1,key:'test',camera,options:{...options,previousSplits:previous.splits},previousPatches:previous.visible,snapshotPresent:true,deriveLeaves:true}});
  const expected=selectPatches(camera,{...options,previousLeaves:previous.leaves,previousSplits:previous.splits});
  assert.deepEqual(messages[0].result.leaves.map(p=>p.key),expected.leaves.map(p=>p.key));
  assert.deepEqual(messages[0].result.visible,expected.visible);
 }finally{delete globalThis.self;}
});

test('a committed worker result can be reused as a snapshot without cloning patches',async()=>{
 const messages=[];globalThis.self={postMessage:value=>messages.push(structuredClone(value))};
 try{
  await import('../src/planet/selection-worker.js?reuse-result-test');
  const options={budget:54,pixelSize:14,includeHidden:true};
  const firstCamera=planetCamera({altitude:14000,longitude:.8,latitude:.4},960,600);
  const secondCamera=planetCamera({altitude:50,longitude:2.2,latitude:-.2},960,600);
  self.onmessage({data:{id:1,key:'test',camera:firstCamera,options,compactLeaves:true}});
  const first=messages[0].result;
  self.onmessage({data:{id:2,key:'test',camera:secondCamera,options,snapshotPresent:true,snapshotReuseId:1}});
  const reused=messages[1];
  await import('../src/planet/selection-worker.js?full-result-snapshot-test');
  self.onmessage({data:{id:3,key:'test',camera:secondCamera,options:{...options,previousSplits:first.splits},previousPatches:first.visible,snapshotPresent:true,deriveLeaves:true}});
  const full=messages[2];
  assert.deepEqual(reused.result,full.result);
  assert.deepEqual(reused.relationships,full.relationships);
  assert.deepEqual(reused.groupPlan,full.groupPlan);
  assert.deepEqual(reused.componentPlan,full.componentPlan);
  assert.deepEqual(reused.signatures,full.signatures);
  assert.deepEqual(reused.packedTopology,full.packedTopology);
  self.onmessage({data:{id:4,key:'test',camera:secondCamera,options,snapshotPresent:true,snapshotReuseId:999}});
  assert.equal(messages[3].snapshotMissing,true);
 }finally{delete globalThis.self;}
});

test('worker patch deltas reconstruct the same changed covering and transition plans',async()=>{
 const messages=[];globalThis.self={postMessage:value=>messages.push(structuredClone(value))};
 try{
  await import('../src/planet/selection-worker.js?patch-delta-test');
  const options={budget:120,pixelSize:6,includeHidden:true};
  const firstCamera=planetCamera({mode:'walk',altitude:.0017,longitude:.8,latitude:.4,pitch:.2},960,600);
  const nextCamera=planetCamera({mode:'walk',altitude:.0017,longitude:.801,latitude:.4,pitch:.2},960,600);
  const previous=selectPatches(firstCamera,options);
  const input={key:'test',camera:nextCamera,options:{...options,previousSplits:previous.splits},previousPatches:previous.visible,snapshotPresent:true,deriveLeaves:true,compactLeaves:true};
  self.onmessage({data:{...input,id:1,compactPatchDelta:true}});
  const delta=messages[0];assert.equal(delta.result.compactPatchDelta,true);
  assert.ok(delta.result.visible.some(node=>typeof node==='number'));
  delta.result.visible=delta.result.visible.map(node=>typeof node==='number'?previous.visible[node]:node);
  delete delta.result.compactPatchDelta;
  await import('../src/planet/selection-worker.js?full-patch-delta-test');
  self.onmessage({data:{...input,id:2}});
  const full=messages[1];assert.deepEqual(delta.result,full.result);
  assert.deepEqual(delta.relationships,full.relationships);assert.deepEqual(delta.componentPlan,full.componentPlan);
  assert.deepEqual(delta.signatures,full.signatures);assert.deepEqual(delta.packedTopology,full.packedTopology);
 }finally{delete globalThis.self;}
});

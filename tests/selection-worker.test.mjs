import test from 'node:test';
import assert from 'node:assert/strict';
import {planetCamera} from '../src/planet/camera.js';
import {selectPatches} from '../src/planet/quadtree.js';
import {transitionGroups} from '../src/planet/patch-transition.js';
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
  for(const group of transitionGroups(first.visible,result.result.visible))for(const pair of group.pairs){
   if(group.type!=='stitch'&&!pair.fine.stitch&&!pair.coarse.stitch)continue;
   records.push({slot:checked,coordinates:buildTransitionTopology({mask:pair.coarse.stitch,originX:pair.originX,originY:pair.originY,scale:pair.scale},{mask:pair.fine.stitch}).coordinates});assert.equal(result.packedTopology.keys[checked],pair.fine.key);checked++;
  }
  assert.ok(checked>0);const expected=packTransitionTopology(records);assert.deepEqual(result.packedTopology.ranges,expected.ranges);assert.deepEqual(result.packedTopology.coordinates,expected.coordinates);
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

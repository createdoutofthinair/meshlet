import test from 'node:test';
import assert from 'node:assert/strict';
import {planetCamera} from '../src/planet/camera.js';
import {selectPatches} from '../src/planet/quadtree.js';
import {transitionGroups} from '../src/planet/patch-transition.js';
import {buildTransitionTopology} from '../src/planet/transition-topology.js';

test('worker prepares stitched transition topology for the selected covering tree',async()=>{
 const messages=[];globalThis.self={postMessage:value=>messages.push(value)};
 try{
  await import('../src/planet/selection-worker.js');
  const options={budget:54,pixelSize:14,includeHidden:true};
  const first=selectPatches(planetCamera({altitude:14000,longitude:.8,latitude:.4},960,600),options);
  const camera=planetCamera({altitude:50,longitude:2.2,latitude:-.2},960,600);
  self.onmessage({data:{id:1,key:'test',camera,options:{...options,previousLeaves:first.leaves},previousPatches:first.visible}});
  const result=messages[0];let checked=0;
  for(const group of transitionGroups(first.visible,result.result.visible))for(const pair of group.pairs){
   if(group.type!=='stitch'&&!pair.fine.stitch&&!pair.coarse.stitch)continue;
   assert.deepEqual(result.topology.get(pair.fine.key),buildTransitionTopology({mask:pair.coarse.stitch,originX:pair.originX,originY:pair.originY,scale:pair.scale},{mask:pair.fine.stitch}).coordinates);checked++;
  }
  assert.ok(checked>0);
 }finally{delete globalThis.self;}
});

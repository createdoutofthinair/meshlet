import {selectPatches} from './quadtree.js';
import {transitionGroups} from './patch-transition.js';
import {transitionCoordinates} from './transition-topology.js';
self.onmessage=({data})=>{
 const start=performance.now();
 const result=selectPatches(data.camera,data.options);
 // Topology depends on patch identities and stitch masks, not GPU slot IDs.
 // Build it here before handing the selection back to the render thread.
 const topology=new Map();
 if(data.previousPatches?.length)for(const group of transitionGroups(data.previousPatches,result.visible))for(const pair of group.pairs){
  if(group.type!=='stitch'&&!pair.fine.stitch&&!pair.coarse.stitch)continue;
  const coordinates=transitionCoordinates({mask:pair.coarse.stitch,originX:pair.originX,originY:pair.originY,scale:pair.scale},{mask:pair.fine.stitch});
  topology.set(pair.fine.key,coordinates);
 }
 self.postMessage({id:data.id,key:data.key,camera:data.camera,result,topology,selectionMs:performance.now()-start});
};

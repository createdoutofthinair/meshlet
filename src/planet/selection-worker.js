import {selectPatches} from './quadtree.js';
import {transitionGroups} from './patch-transition.js';
import {transitionCoordinates} from './transition-topology.js';
import {packTransitionTopology} from './transition-upload.js';
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
 // Temporary indices are remapped to resident GPU slots by the renderer.
 // Transfer packed buffers without detaching the worker's topology cache.
 const keys=[...topology.keys()];let packed=null;
 try{packed=packTransitionTopology(keys.map((key,slot)=>({slot,coordinates:topology.get(key)})));}
 catch(error){if(!error.message.includes('capacity exceeded'))throw error;}
 const transfers=packed?[packed.ranges.buffer,packed.coordinates.buffer]:[];
 self.postMessage({id:data.id,key:data.key,camera:data.camera,result,topology:packed?null:topology,packedTopology:packed?{keys,ranges:packed.ranges,coordinates:packed.coordinates,vertexCount:packed.vertexCount}:null,selectionMs:performance.now()-start},transfers);
};

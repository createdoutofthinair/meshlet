import {selectPatches} from './quadtree.js';
import {transitionGroups,transitionPairs,coordinateTransitions,transitionSignatures} from './patch-transition.js';
import {transitionCoordinates} from './transition-topology.js';
import {packTransitionTopology} from './transition-upload.js';
let cachedErrors=new Map();
let cachedSelection={previousLeaves:null,previousSplits:null,previousPatches:[]};
self.onmessage=({data})=>{
 const start=performance.now();
 if(data.errorEstimates!=null)cachedErrors=data.errorEstimates;
 if(data.snapshotPresent===true)cachedSelection={previousLeaves:data.options.previousLeaves,previousSplits:data.options.previousSplits,previousPatches:data.previousPatches};
 const snapshot=data.snapshotPresent===false?cachedSelection:{previousLeaves:data.options.previousLeaves,previousSplits:data.options.previousSplits,previousPatches:data.previousPatches};
 const result=selectPatches(data.camera,{...data.options,previousLeaves:snapshot.previousLeaves,previousSplits:snapshot.previousSplits,errorEstimates:data.errorEstimates??data.options.errorEstimates??cachedErrors});
 // Topology depends on patch identities and stitch masks, not GPU slot IDs.
 // Build it here before handing the selection back to the render thread.
 const topology=new Map();
 const previous=snapshot.previousPatches||[],pairs=transitionPairs(previous,result.visible),oldNodes=new Set(previous);
 const describe=p=>({fineKey:p.fine.key,coarseKey:p.coarse.key,fineOld:oldNodes.has(p.fine),coarseOld:oldNodes.has(p.coarse),originX:p.originX,originY:p.originY,scale:p.scale,refining:p.refining});
 const relationships=pairs.map(describe),groups=transitionGroups(previous,result.visible,pairs);
 const groupPlan=groups.map(g=>({key:g.key,type:g.type,coarseKey:g.coarse.key,coarseOld:oldNodes.has(g.coarse),pairs:g.pairs.map(describe)}));
 const componentPlan=coordinateTransitions(previous,result.visible,groups).map(c=>({groupKeys:c.groups.map(g=>g.key),deferredReasons:c.deferredReasons}));
 if(previous.length)for(const group of groups)for(const pair of group.pairs){
  if(group.type!=='stitch'&&!pair.fine.stitch&&!pair.coarse.stitch)continue;
  const coordinates=transitionCoordinates({mask:pair.coarse.stitch,originX:pair.originX,originY:pair.originY,scale:pair.scale},{mask:pair.fine.stitch});
  topology.set(pair.fine.key,coordinates);
 }
 // Temporary indices are remapped to resident GPU slots by the renderer.
 // Transfer packed buffers without detaching the worker's topology cache.
 const keys=[...topology.keys()];let packed=null;
 try{if(keys.length)packed=packTransitionTopology(keys.map((key,slot)=>({slot,coordinates:topology.get(key)})));}
 catch(error){if(!error.message.includes('capacity exceeded'))throw error;}
 const transfers=packed?[packed.ranges.buffer,packed.coordinates.buffer]:[];
 self.postMessage({id:data.id,key:data.key,camera:data.camera,result,relationships,groupPlan,componentPlan,signatures:transitionSignatures(result.visible),topology:packed?null:topology,packedTopology:packed?{keys,ranges:packed.ranges,coordinates:packed.coordinates,vertexCount:packed.vertexCount}:null,selectionMs:performance.now()-start},transfers);
};

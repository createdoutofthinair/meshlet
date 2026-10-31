import {selectPatches} from './quadtree.js';
import {transitionGroups,transitionPairs,coordinateTransitions,transitionSignatures} from './patch-transition.js';
import {transitionCoordinates} from './transition-topology.js';
import {packTransitionTopology} from './transition-upload.js';
let cachedErrors=new Map();
let cachedSelection={previousLeaves:null,previousSplits:null,previousPatches:[]};
let lastSignatures=null;
let offeredSelection=null;
// transitionCoordinates returns immutable cached arrays; weak keys allow
// evicted coordinate arrays and their layouts to be collected together.
const topologyLayouts=new WeakMap();
const equalArray=(a,b)=>a?.length===b?.length&&a.every((value,i)=>value===b[i]);
function samePatch(a,b){
 return a.key===b.key&&a.face===b.face&&a.level===b.level&&a.x===b.x&&a.y===b.y&&
  a.span===b.span&&a.u===b.u&&a.v===b.v&&a.stitch===b.stitch&&a.normalStitch===b.normalStitch&&
  equalArray(a.direction,b.direction)&&equalArray(a.coarseKeys,b.coarseKeys)&&equalArray(a.edgeKeys,b.edgeKeys)&&
  a.cornerKeys.length===b.cornerKeys.length&&a.cornerKeys.every((corner,i)=>equalArray(corner,b.cornerKeys[i]));
}
self.onmessage=({data})=>{
 const start=performance.now();
 if(data.errorEstimates!=null)cachedErrors=data.errorEstimates;
 if(data.snapshotPresent===true){
  if(data.snapshotReuseId!=null){
   if(offeredSelection?.id!==data.snapshotReuseId){self.postMessage({id:data.id,key:data.key,camera:data.camera,snapshotMissing:true});return;}
   cachedSelection={...offeredSelection.snapshot};
  }else cachedSelection={previousLeaves:data.deriveLeaves?data.previousPatches:data.options.previousLeaves,previousSplits:data.options.previousSplits,previousPatches:data.previousPatches,signatures:null};
 }
 const snapshot=data.snapshotPresent===true||data.snapshotPresent===false?cachedSelection:{previousLeaves:data.options.previousLeaves,previousSplits:data.options.previousSplits,previousPatches:data.previousPatches};
 const result=selectPatches(data.camera,{...data.options,previousLeaves:snapshot.previousLeaves,previousSplits:snapshot.previousSplits,errorEstimates:data.errorEstimates??data.options.errorEstimates??cachedErrors,unchangedPatches:data.allowUnchanged?snapshot.previousPatches:null});
 if(result.unchanged){
  self.postMessage({id:data.id,key:data.key,camera:data.camera,...result,selectionMs:performance.now()-start});return;
 }
 const signatures=transitionSignatures(result.visible,lastSignatures),previous=snapshot.previousPatches||[];
 lastSignatures={nodes:result.visible,signatures};
 // Most stable complete coverings return above. Only calculate signatures for
 // the old snapshot when every new key is present. Equal patch counts alone
 // are common at the budget limit even when the covering has changed.
 const sameSize=data.allowUnchanged&&data.options.includeHidden&&previous.length>0&&result.visible.length===previous.length&&result.leaves.length===previous.length;
 let sameKeys=false;
 if(sameSize){
  snapshot.keys??=new Set(previous.map(node=>node.key));
  sameKeys=snapshot.keys.size===previous.length&&result.visible.every(node=>snapshot.keys.has(node.key));
  if(sameKeys&&!snapshot.signatures)snapshot.signatures=transitionSignatures(previous);
 }
 // A complete unchanged covering tree needs neither slot allocation nor a
 // replacement tree sent back through structured cloning.
 if(sameKeys&&
  snapshot.signatures&&result.visible.every(node=>snapshot.signatures.get(node.key)===signatures.get(node.key))){
  self.postMessage({id:data.id,key:data.key,camera:data.camera,unchanged:true,leafCount:result.leaves.length,deepest:result.deepest,selectionMs:performance.now()-start});return;
 }
 // Topology depends on patch identities and stitch masks, not GPU slot IDs.
 // Build it here before handing the selection back to the render thread.
 const topology=new Map();
 const pairs=transitionPairs(previous,result.visible),oldNodes=new Set(previous);
 const describe=p=>({fineKey:p.fine.key,coarseKey:p.coarse.key,fineOld:oldNodes.has(p.fine),coarseOld:oldNodes.has(p.coarse),originX:p.originX,originY:p.originY,scale:p.scale,refining:p.refining});
 const relationships=pairs.map(describe),groups=transitionGroups(previous,result.visible,pairs);
 // Ordinary group pairs already appear in relationships. Send indices instead
 // of cloning their descriptors a second time. Stitch groups have a special
 // synthesized pair and retain its descriptor.
 const pairIndices=new Map(pairs.map((pair,index)=>[pair,index]));
 const groupPlan=groups.map(g=>({key:g.key,type:g.type,coarseKey:g.coarse.key,coarseOld:oldNodes.has(g.coarse),
  ...(g.type==='stitch'?{pairs:g.pairs.map(describe)}:{pairIndices:g.pairs.map(p=>pairIndices.get(p))})}));
 const componentPlan=coordinateTransitions(previous,result.visible,groups).map(c=>({groupKeys:c.groups.map(g=>g.key),deferredReasons:c.deferredReasons}));
 if(previous.length)for(const group of groups)for(const pair of group.pairs){
  if(group.type!=='stitch'&&!pair.fine.stitch&&!pair.coarse.stitch)continue;
  const coordinates=transitionCoordinates({mask:pair.coarse.stitch,originX:pair.originX,originY:pair.originY,scale:pair.scale},{mask:pair.fine.stitch});
  topology.set(pair.fine.key,coordinates);
 }
 // Temporary indices are remapped to resident GPU slots by the renderer.
 // Transfer packed buffers without detaching the worker's topology cache.
 const keys=[...topology.keys()];let packed=null;
 try{if(keys.length)packed=packTransitionTopology(keys.map((key,slot)=>({slot,coordinates:topology.get(key)})),undefined,topologyLayouts,keys.length);}
 catch(error){if(!error.message.includes('capacity exceeded'))throw error;}
 const transfers=packed?[packed.ranges.buffer,packed.coordinates.buffer]:[];
 // Keep the untransferred selection so a subsequently committed result can
 // become the next snapshot without cloning its entire patch graph back.
 const compactCover=!!data.compactLeaves&&!!data.options.includeHidden&&result.leaves.length===result.visible.length;
 offeredSelection={id:data.id,snapshot:{previousLeaves:compactCover?result.visible:result.leaves,previousSplits:result.splits,previousPatches:result.visible,signatures}};
 // A complete resident covering has the same ordered nodes in both arrays.
 // The renderer can reconstruct leaves from visible nodes after cloning,
 // avoiding a second copy of every patch's geometry metadata.
 if(compactCover){result.leaves=null;result.compactLeaves=true;}
 let outputResult=result;
 if(data.compactPatchDelta&&compactCover&&previous.length){
  const indices=new Map();for(let i=0;i<previous.length;i++)indices.set(previous[i].key,i);
  const visible=result.visible.map(node=>{const index=indices.get(node.key);return index!==undefined&&samePatch(node,previous[index])?index:node;});
  outputResult={...result,visible,compactPatchDelta:true};
 }
 self.postMessage({id:data.id,key:data.key,camera:data.camera,result:outputResult,relationships,groupPlan,componentPlan,signatures,topology:packed?null:topology,packedTopology:packed?{keys,ranges:packed.ranges,coordinates:packed.coordinates,vertexCount:packed.vertexCount}:null,selectionMs:performance.now()-start},transfers);
};

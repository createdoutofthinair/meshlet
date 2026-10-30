import {RADIUS_KM,HEIGHT_LIMIT_KM,PATCH_CELLS,MAX_DEPTH,FACE_BASES,faceCube,faceDirection,directionToFace,makeTile,dot,sub,length} from './planet-math.js';

// Covering leaves include the entire planet. The renderer can request every
// leaf as a resident patch so transitions never depend on partial visibility.
function tileAt(leaves,face,u,v,maxDepth) {
 const uu=Math.min(1-Number.EPSILON,Math.max(0,(u+1)/2));
 const vv=Math.min(1-Number.EPSILON,Math.max(0,(v+1)/2));
 // A covering quadtree has no overlapping ancestor leaves. Searching from
 // the root finds the same unique leaf without probing unused deep levels.
 for(let level=0;level<=maxDepth;level++){
  const n=2**level,x=Math.floor(uu*n),y=Math.floor(vv*n);
  const node=leaves.get(`${face}/${level}/${x}/${y}`);if(node)return node;
 }
 return null;
}
export function neighbors(leaves,node,edge,maxDepth=MAX_DEPTH) {
 const half=node.span/2,eps=node.span*1e-6,found=new Map();
 for(const fraction of [-.499,-.25,0,.25,.499]) {
  let u=node.u,v=node.v;
  if(edge===0){u-=half+eps;v+=fraction*node.span;}
  if(edge===1){u+=half+eps;v+=fraction*node.span;}
  if(edge===2){v-=half+eps;u+=fraction*node.span;}
  if(edge===3){v+=half+eps;u+=fraction*node.span;}
  // Interior samples remain on the same cube face. Only crossings need the
  // cube-to-face remapping, including its exact tie-breaking at boundaries.
  let other;
  if(Math.abs(u)<1&&Math.abs(v)<1)other=tileAt(leaves,node.face,u,v,maxDepth);
  else{const f=directionToFace(faceCube(node.face,u,v));other=tileAt(leaves,f.face,f.u,f.v,maxDepth);}
  if(other && other.key!==node.key)found.set(other.key,other);
 }
 return [...found.values()];
}
function split(leaves,node,onChild=null){
 leaves.delete(node.key);
 for(let y=0;y<2;y++)for(let x=0;x<2;x++){
  const child=makeTile(node.face,node.level+1,node.x*2+x,node.y*2+y);leaves.set(child.key,child);onChild?.(child);
 }
}
function splitBalanced(leaves,node,budget,maxDepth,seen=new Set(),onChild=null) {
 if(!leaves.has(node.key)||node.level>=maxDepth||seen.has(node.key))return false;
 seen.add(node.key);
 // Splitting a level-L node creates L+1 children. Split any adjacent L-1
 // leaf first, keeping adjacent levels within one, including cube-face seams.
 for(let edge=0;edge<4;edge++)for(const other of neighbors(leaves,node,edge,maxDepth)) {
  if(other.level<node.level && !splitBalanced(leaves,other,budget,maxDepth,seen,onChild))return false;
 }
 if(leaves.size+3>budget)return false;
 split(leaves,node,onChild);return true;
}
// Maximum priority first; insertion order preserves the old Map-scan tie rule.
class CandidateHeap {
 constructor(){this.items=[];this.sequence=0;}
 better(a,b){return a.score>b.score||(a.score===b.score&&a.order<b.order);}
 push(node,score){
  const item={node,score,order:this.sequence++},a=this.items;let i=a.length;a.push(item);
  while(i>0){const p=(i-1)>>1;if(!this.better(item,a[p]))break;a[i]=a[p];i=p;}a[i]=item;
 }
 pop(){
  const a=this.items;if(!a.length)return null;const top=a[0],last=a.pop();
  if(a.length){let i=0;while(true){let child=i*2+1;if(child>=a.length)break;
   if(child+1<a.length&&this.better(a[child+1],a[child]))child++;
   if(!this.better(a[child],last))break;a[i]=a[child];i=child;}a[i]=last;}
  return top;
 }
}
// Once an ancestor has been visited, all of its ancestors were visited too.
// Shared paths need only be walked once across the complete covering tree.
function addAncestors(keys,node){
 let x=node.x,y=node.y;
 for(let level=node.level-1;level>=0;level--){
  x=Math.floor(x/2);y=Math.floor(y/2);
  const key=`${node.face}/${level}/${x}/${y}`;
  if(keys.has(key))break;
  keys.add(key);
 }
}
// Reconcile complete covering trees by at most one generation per region.
// Transactions include balancing dependencies; failed splits cannot leave a
// partially modified tree. A reduced budget is approached by safe merges.
export function intermediateLeaves(previous,target,budget,priority=()=>0){
 const original=new Map(previous.map(p=>[p.key,p])),desired=new Map(target.map(p=>[p.key,p]));
 let leaves=new Map(original);const wantsSplit=new Set();
 for(const node of target)addAncestors(wantsSplit,node);
 const coveredByTarget=node=>{
  for(let level=node.level;level>=0;level--){const scale=2**(node.level-level);if(desired.has(`${node.face}/${level}/${Math.floor(node.x/scale)}/${Math.floor(node.y/scale)}`))return true;}
  return false;
 };
 // Most candidate parents cannot merge. Defer constructing spherical tile
 // geometry until target coverage and all four resident children are known.
 const parents=new Map();for(const n of previous)if(n.level){
  const level=n.level-1,x=Math.floor(n.x/2),y=Math.floor(n.y/2),key=`${n.face}/${level}/${x}/${y}`;
  if(!parents.has(key))parents.set(key,{face:n.face,level,x,y,key});
 }
 for(const candidate of [...parents.values()].sort((a,b)=>b.level-a.level)){
  if(!coveredByTarget(candidate))continue;
  const keys=[0,1,2,3].map(i=>`${candidate.face}/${candidate.level+1}/${candidate.x*2+i%2}/${candidate.y*2+(i>>1)}`);
  if(!keys.every(k=>original.has(k)&&leaves.has(k)))continue;
  const p=makeTile(candidate.face,candidate.level,candidate.x,candidate.y);
  if([0,1,2,3].some(e=>neighbors(leaves,p,e).some(n=>n.level>p.level+1)))continue;
  for(const key of keys)leaves.delete(key);leaves.set(p.key,p);
 }
 const limit=Math.max(6,Math.floor(budget),previous.length);
 for(const node of [...previous].filter(n=>wantsSplit.has(n.key)).sort((a,b)=>priority(b)-priority(a))){
  // Every successful split adds three leaves. Once even one split cannot
  // fit, scanning and balancing the remaining candidates cannot make progress.
  if(leaves.size+3>limit)break;
  if(!leaves.has(node.key))continue;
  // Plan every coarser balancing dependency before modifying the tree. This
  // retains atomic failure without copying the entire leaf map per candidate.
  const planned=[],done=new Set(),visiting=new Set();
  const plan=n=>{
   if(!leaves.has(n.key)||done.has(n.key))return true;
   if(!original.has(n.key)||visiting.has(n.key))return false;
   visiting.add(n.key);
   for(let e=0;e<4;e++)for(const neighbor of neighbors(leaves,n,e))if(neighbor.level<n.level&&!plan(neighbor))return false;
   visiting.delete(n.key);done.add(n.key);planned.push(n);
   return leaves.size+planned.length*3<=limit;
  };
  if(plan(node))for(const n of planned)split(leaves,n);
 }
 return [...leaves.values()];
}
function score(node,camera,pixelSize=10,errorEstimates=null) {
 const center=node.direction.map(x=>x*RADIUS_KM);
 const relative=sub(center,camera.eye);
 // Cube-to-sphere is at most 1-Lipschitz in the face coordinates. This loose
 // sphere encloses the tile and the bounded terrain, and avoids false culling.
 const radius=Math.min(2*RADIUS_KM,RADIUS_KM*node.span*.9)+HEIGHT_LIMIT_KM;
 const z=dot(relative,camera.forward),x=dot(relative,camera.right),y=dot(relative,camera.up);
 if(z+radius<camera.near || Math.abs(x)>z*camera.tanX+radius*camera.selection.frustumX || Math.abs(y)>z*camera.tanY+radius*camera.selection.frustumY)return 0;
 const {eyeLength,inner,horizon}=camera.selection;
 if(eyeLength>inner){
  // The angular cutoff is identical for every tile at a level. Compare its
  // cosine directly instead of computing an inverse cosine for every tile.
  let cutoff=camera.selection.horizonCutoffs.get(node.level);
  if(cutoff===undefined){
   const angle=horizon+Math.min(Math.PI,node.span*1.5);
   cutoff=angle>=Math.PI?-Infinity:Math.cos(angle)-1e-12;
   camera.selection.horizonCutoffs.set(node.level,cutoff);
  }
  if(dot(node.direction,camera.eye)/eyeLength<cutoff)return 0;
 }
 // Projected cell size remains a coverage floor, especially while a patch has
 // not yet been measured by the GPU. A measured residual can add priority for
 // rough terrain whose visual error is large at the current distance.
 const facing=camera.facing;
 let distance=length(relative);
 // Near the ground, calculate distance to the current surface altitude on
 // every front-facing cube face. Limiting this to the face under the camera
 // makes a neighboring face appear kilometers away on high mountains.
 const basis=FACE_BASES[node.face],denom=dot(camera.radial,basis.c);
 if(camera.clearance<50&&denom>0){
  const half=node.span/2;
  const u=Math.max(node.u-half,Math.min(node.u+half,dot(camera.radial,basis.u)/denom));
  const v=Math.max(node.v-half,Math.min(node.v+half,dot(camera.radial,basis.v)/denom));
  const nearest=faceDirection(node.face,u,v).map(x=>x*(RADIUS_KM+camera.altitude-camera.clearance));
  distance=Math.min(distance,length(sub(nearest,camera.eye)));
 }
 else if(facing.face===node.face){
  const half=node.span/2;
  const u=Math.max(node.u-half,Math.min(node.u+half,facing.u));
  const v=Math.max(node.v-half,Math.min(node.v+half,facing.v));
  const nearest=faceDirection(node.face,u,v).map(x=>x*(RADIUS_KM+camera.altitude-camera.clearance));
  distance=Math.min(distance,length(sub(nearest,camera.eye)));
 }
 if(facing.face===node.face && Math.abs(facing.u-node.u)<=node.span/2 && Math.abs(facing.v-node.v)<=node.span/2 && camera.clearance<50)distance=Math.min(distance,Math.max(.001,camera.clearance));
 distance=Math.max(.001,distance);
 const projected=(RADIUS_KM*node.span/PATCH_CELLS)*camera.focalPixels/distance;
 const focus=camera.focus;
 const inFocus=focus.face===node.face && Math.abs(focus.u-node.u)<=node.span/2 && Math.abs(focus.v-node.v)<=node.span/2;
 // Prioritize the view center until it meets the same pixel target. The 2:1
 // balancing then allocates supporting levels around it; all tiles stay covered.
 const localFocus=inFocus && camera.clearance<100 && projected>pixelSize?256:1;
 // The conservative culling bound includes the full possible mountain height.
 // Near the ground that can make off-screen tiles compete with the view for
 // detail. Use a tighter estimated footprint only as a priority, never a cull.
 let viewPriority=1;
 if(camera.clearance<10){
  const estimate=node.direction.map(x=>x*(RADIUS_KM+camera.altitude-camera.clearance));
  const r=sub(estimate,camera.eye),z0=dot(r,camera.forward),x0=dot(r,camera.right),y0=dot(r,camera.up);
  const tightRadius=RADIUS_KM*node.span*.35;
  const outside=Math.max(0,-z0-tightRadius,Math.abs(x0)-z0*camera.tanX-tightRadius,Math.abs(y0)-z0*camera.tanY-tightRadius);
  viewPriority=1/(1+outside/Math.max(.001,camera.clearance)*32);
 }
 const residual=errorEstimates?.get(node.key);
 // Measurements come from actual child-versus-parent geometry. Unsampled
 // detail still uses the projected cell-size floor; no hard bound is implied.
 const projectedError=Number.isFinite(residual)?residual*camera.focalPixels/distance:0;
 const errorPriority=projectedError*pixelSize/.5;
 return Math.max(projected,Math.min(errorPriority,projected*4))*localFocus*viewPriority;
}
export function selectPatches(camera,{budget=256,maxDepth=MAX_DEPTH,pixelSize=10,previousSplits=null,hysteresis=.1,errorEstimates=null,previousLeaves=null,includeHidden=false,unchangedPatches=null}={}) {
 budget=Math.max(6,Math.floor(budget));maxDepth=Math.min(MAX_DEPTH,Math.max(0,maxDepth));
 const eyeLength=length(camera.eye),inner=RADIUS_KM-HEIGHT_LIMIT_KM,outer=RADIUS_KM+HEIGHT_LIMIT_KM;
 const selection={eyeLength,inner,horizon:eyeLength>inner?Math.acos(Math.min(1,inner/eyeLength))+Math.acos(inner/outer):0,horizonCutoffs:new Map(),frustumX:Math.hypot(1,camera.tanX),frustumY:Math.hypot(1,camera.tanY)};
 camera={...camera,selection,facing:directionToFace(camera.eye),focus:directionToFace(camera.focusDirection||camera.eye)};
 let leaves=new Map();for(let face=0;face<6;face++){const n=makeTile(face,0,0,0);leaves.set(n.key,n);}
 // A node's projected priority cannot change during one selection: the camera,
 // previous splits and error estimates are fixed. Cache it instead of repeating
 // the expensive projection and horizon tests on every balancing iteration.
 const priorities=new Map();
 const priority=node=>{
  let value=priorities.get(node.key);
  if(value===undefined){value=score(node,camera,pixelSize,errorEstimates)*(previousSplits?.has(node.key)?1+hysteresis:1);priorities.set(node.key,value);}
  return value;
 };
 // Rebuild the covering tree on every selection, but give already-split nodes
 // a small priority margin. This reduces churn at refinement thresholds without
 // time-based fading, stale coverage, or exceeding the patch budget.
 const candidates=new CandidateHeap();
 const addCandidate=node=>{if(node.level<maxDepth){const value=priority(node);if(value>pixelSize)candidates.push(node,value);}};
 for(const node of leaves.values())addCandidate(node);
 for(let iteration=0;iteration<budget;iteration++){
  let candidate;do{candidate=candidates.pop();}while(candidate&&leaves.get(candidate.node.key)!==candidate.node);
  if(!candidate || leaves.size+3>budget || !splitBalanced(leaves,candidate.node,budget,maxDepth,new Set(),addCandidate))break;
 }
 // A stable target needs no balancing or split/merge transactions. This is
 // common during steady flight and avoids cloning the covering tree repeatedly.
 if(previousLeaves?.length){
  const unchanged=previousLeaves.length===leaves.size&&previousLeaves.every(node=>leaves.has(node.key));
  if(!unchanged)leaves=new Map(intermediateLeaves(previousLeaves,[...leaves.values()],budget,priority).map(p=>[p.key,p]));
 }
 // For a complete resident covering, the same leaf keys imply the same
 // deterministic stitch graph. Skip rebuilding it when the caller retains
 // the previous patches and explicitly accepts a compact unchanged result.
 if(includeHidden&&previousLeaves?.length&&unchangedPatches?.length===leaves.size&&previousLeaves.length===leaves.size&&
  previousLeaves.every(node=>leaves.has(node.key))&&unchangedPatches.every(node=>leaves.has(node.key))){
  return {unchanged:true,leafCount:leaves.size,deepest:Math.max(...previousLeaves.map(node=>node.level),0)};
 }
 const all=[...leaves.values()];
 const visible=[];
 for(const node of all){
  if(!includeHidden&&!score(node,camera))continue;
  let stitch=0,corners=0;const coarseKeys=[null,null,null,null],edgeKeys=[null,null,null,null],adjacentEdges=[];
  for(let edge=0;edge<4;edge++){
   const adjacent=neighbors(leaves,node,edge,MAX_DEPTH);adjacentEdges.push(adjacent);
   const coarse=adjacent.find(other=>other.level<node.level);
   if(coarse){stitch|=1<<edge;coarseKeys[edge]=coarse.key;edgeKeys[edge]=coarse.key;}
   else{const peer=adjacent.find(other=>other.level===node.level);if(peer)edgeKeys[edge]=peer.key;}
  }
  // A coarse tile may meet this tile only diagonally at a shared corner. Its
  // derivative scale still needs to reach both same-level tiles at that corner.
  const half=node.span/2,eps=node.span*1e-6,cornerKeys=[];
  for(let corner=0;corner<4;corner++){
   const sx=corner&1?1:-1,sy=corner&2?1:-1;
   const u=node.u+sx*(half+eps),v=node.v+sy*(half+eps);
   let diagonal;
   if(Math.abs(u)<1&&Math.abs(v)<1)diagonal=tileAt(leaves,node.face,u,v,MAX_DEPTH);
   else{const f=directionToFace(faceCube(node.face,u,v));diagonal=tileAt(leaves,f.face,f.u,f.v,MAX_DEPTH);}
   if(diagonal && diagonal.level<node.level)corners|=1<<(corner+4);
   const around=[...adjacentEdges[sx<0?0:1],...adjacentEdges[sy<0?2:3]];
   if(diagonal)around.push(diagonal);
   cornerKeys.push([...new Set(around.filter(other=>other.key!==node.key).map(other=>other.key))].sort());
  }
  visible.push({...node,stitch,normalStitch:stitch|corners,coarseKeys,edgeKeys,cornerKeys});
 }
 const splits=new Set();
 for(const node of all)addAncestors(splits,node);
 return {leaves:all,visible,splits,deepest:Math.max(...visible.map(x=>x.level),0)};
}

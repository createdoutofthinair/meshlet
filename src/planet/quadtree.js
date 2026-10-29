import {RADIUS_KM,HEIGHT_LIMIT_KM,PATCH_CELLS,MAX_DEPTH,FACE_BASES,faceCube,faceDirection,directionToFace,makeTile,dot,sub,length} from './planet-math.js';

// Covering leaves include the entire planet. Only visible leaves become GPU
// patches; retaining invisible leaves lets us balance edges across the horizon.
function tileAt(leaves,face,u,v,maxDepth) {
 const uu=Math.min(1-Number.EPSILON,Math.max(0,(u+1)/2));
 const vv=Math.min(1-Number.EPSILON,Math.max(0,(v+1)/2));
 for(let level=maxDepth;level>=0;level--){
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
  const f=directionToFace(faceCube(node.face,u,v));
  const other=tileAt(leaves,f.face,f.u,f.v,maxDepth);
  if(other && other.key!==node.key)found.set(other.key,other);
 }
 return [...found.values()];
}
function split(leaves,node){
 leaves.delete(node.key);
 for(let y=0;y<2;y++)for(let x=0;x<2;x++){
  const child=makeTile(node.face,node.level+1,node.x*2+x,node.y*2+y);leaves.set(child.key,child);
 }
}
function splitBalanced(leaves,node,budget,maxDepth,seen=new Set()) {
 if(!leaves.has(node.key)||node.level>=maxDepth||seen.has(node.key))return false;
 seen.add(node.key);
 // Splitting a level-L node creates L+1 children. Split any adjacent L-1
 // leaf first, keeping adjacent levels within one, including cube-face seams.
 for(let edge=0;edge<4;edge++)for(const other of neighbors(leaves,node,edge,maxDepth)) {
  if(other.level<node.level && !splitBalanced(leaves,other,budget,maxDepth,seen))return false;
 }
 if(leaves.size+3>budget)return false;
 split(leaves,node);return true;
}
function score(node,camera,pixelSize=10,errorEstimates=null) {
 const center=node.direction.map(x=>x*RADIUS_KM);
 const relative=sub(center,camera.eye);
 // Cube-to-sphere is at most 1-Lipschitz in the face coordinates. This loose
 // sphere encloses the tile and the bounded terrain, and avoids false culling.
 const radius=Math.min(2*RADIUS_KM,RADIUS_KM*node.span*.9)+HEIGHT_LIMIT_KM;
 const z=dot(relative,camera.forward),x=dot(relative,camera.right),y=dot(relative,camera.up);
 if(z+radius<camera.near || Math.abs(x)>z*camera.tanX+radius*Math.hypot(1,camera.tanX) || Math.abs(y)>z*camera.tanY+radius*Math.hypot(1,camera.tanY))return 0;
 const eyeLength=length(camera.eye),inner=RADIUS_KM-HEIGHT_LIMIT_KM,outer=RADIUS_KM+HEIGHT_LIMIT_KM;
 if(eyeLength>inner){
  const angle=Math.acos(Math.max(-1,Math.min(1,dot(node.direction,camera.eye)/eyeLength)));
  const horizon=Math.acos(Math.min(1,inner/eyeLength))+Math.acos(inner/outer);
  if(angle>horizon+Math.min(Math.PI,node.span*1.5))return 0;
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
 // A residual compares this patch against its coarser representation; use
 // half as a heuristic for the next finer split. Bound its priority influence
 // to avoid a large patch reshuffle when a measurement first arrives.
 const projectedError=Number.isFinite(residual)?residual*.5*camera.focalPixels/distance:0;
 const errorPriority=projectedError*pixelSize;
 return Math.max(projected,Math.min(errorPriority,projected*1.2))*localFocus*viewPriority;
}
export function selectPatches(camera,{budget=256,maxDepth=MAX_DEPTH,pixelSize=10,previousSplits=null,hysteresis=.1,errorEstimates=null}={}) {
 budget=Math.max(6,Math.floor(budget));maxDepth=Math.min(MAX_DEPTH,Math.max(0,maxDepth));
 camera={...camera,facing:directionToFace(camera.eye),focus:directionToFace(camera.focusDirection||camera.eye)};
 const leaves=new Map();for(let face=0;face<6;face++){const n=makeTile(face,0,0,0);leaves.set(n.key,n);}
 // Rebuild the covering tree on every selection, but give already-split nodes
 // a small priority margin. This reduces churn at refinement thresholds without
 // time-based fading, stale coverage, or exceeding the patch budget.
 for(let iteration=0;iteration<budget;iteration++){
  let best=null,bestScore=pixelSize;
  for(const node of leaves.values())if(node.level<maxDepth){const s=score(node,camera,pixelSize,errorEstimates)*(previousSplits?.has(node.key)?1+hysteresis:1);if(s>bestScore){best=node;bestScore=s;}}
  if(!best || leaves.size+3>budget || !splitBalanced(leaves,best,budget,maxDepth))break;
 }
 const all=[...leaves.values()];
 const visible=[];
 for(const node of all){
  if(!score(node,camera))continue;
  let stitch=0,corners=0;const coarseKeys=[null,null,null,null],edgeKeys=[null,null,null,null],adjacentEdges=[];
  for(let edge=0;edge<4;edge++){
   const adjacent=neighbors(leaves,node,edge,maxDepth);adjacentEdges.push(adjacent);
   const coarse=adjacent.find(other=>other.level<node.level);
   if(coarse){stitch|=1<<edge;coarseKeys[edge]=coarse.key;edgeKeys[edge]=coarse.key;}
   else{const peer=adjacent.find(other=>other.level===node.level);if(peer)edgeKeys[edge]=peer.key;}
  }
  // A coarse tile may meet this tile only diagonally at a shared corner. Its
  // derivative scale still needs to reach both same-level tiles at that corner.
  const half=node.span/2,eps=node.span*1e-6,cornerKeys=[];
  for(let corner=0;corner<4;corner++){
   const sx=corner&1?1:-1,sy=corner&2?1:-1;
   const f=directionToFace(faceCube(node.face,node.u+sx*(half+eps),node.v+sy*(half+eps)));
   const diagonal=tileAt(leaves,f.face,f.u,f.v,maxDepth);
   if(diagonal && diagonal.level<node.level)corners|=1<<(corner+4);
   const around=[...adjacentEdges[sx<0?0:1],...adjacentEdges[sy<0?2:3]];
   if(diagonal)around.push(diagonal);
   cornerKeys.push([...new Set(around.filter(other=>other.key!==node.key).map(other=>other.key))].sort());
  }
  visible.push({...node,stitch,normalStitch:stitch|corners,coarseKeys,edgeKeys,cornerKeys});
 }
 const splits=new Set();
 for(const node of all)for(let level=0;level<node.level;level++){
  const scale=2**(node.level-level);splits.add(`${node.face}/${level}/${Math.floor(node.x/scale)}/${Math.floor(node.y/scale)}`);
 }
 return {leaves:all,visible,splits,deepest:Math.max(...visible.map(x=>x.level),0)};
}

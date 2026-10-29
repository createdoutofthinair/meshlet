// Match two covering quadtrees by ancestry. An overlap is either the same
// patch or an ancestor/descendant on the same cube face; no geometric search
// or rounded spherical coordinates are needed.
function ancestorIn(map,node){
 for(let level=node.level;level>=0;level--){
  const scale=2**(node.level-level),key=`${node.face}/${level}/${Math.floor(node.x/scale)}/${Math.floor(node.y/scale)}`;
  const ancestor=map.get(key);if(ancestor)return ancestor;
 }
 return null;
}
function pair(fine,coarse){
 const scale=2**(coarse.level-fine.level);
 return {fine,coarse,originX:(fine.x-coarse.x/scale)*16*scale,originY:(fine.y-coarse.y/scale)*16*scale,scale};
}
export function transitionPairs(previous,next){
 const old=new Map(previous.map(n=>[n.key,n])),fresh=new Map(next.map(n=>[n.key,n])),pairs=[];
 for(const child of next){
  const previousPatch=old.get(child.key);
  if(previousPatch){
   // A retained patch can gain or lose collapsed edge vertices as its
   // neighbours change. Compare each direction that exposes new geometry.
   if((previousPatch.stitch&~child.stitch)!==0)pairs.push({...pair(child,previousPatch),refining:true});
   if((child.stitch&~previousPatch.stitch)!==0)pairs.push({...pair(previousPatch,child),refining:false});
   continue;
  }
  const parent=ancestorIn(old,child);if(parent&&parent.level<child.level)pairs.push(pair(child,parent));
 }
 for(const child of previous){
  if(fresh.has(child.key))continue;
  const parent=ancestorIn(fresh,child);if(parent&&parent.level<child.level)pairs.push(pair(child,parent));
 }
 return pairs;
}
export function encodeTransitionPairs(pairs){
 const raw=new ArrayBuffer(pairs.length*32),u=new Uint32Array(raw),f=new Float32Array(raw);
 pairs.forEach((p,i)=>{const k=i*8;u.set([p.fine.slot,p.coarse.slot,p.fine.stitch,p.coarse.stitch],k);f.set([p.originX,p.originY,p.scale,0],k+4);});
 return raw;
}

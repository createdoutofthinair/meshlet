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
export function encodeTransitionPairs(pairs,topologySlots=null){
 const raw=new ArrayBuffer(pairs.length*32),u=new Uint32Array(raw),f=new Float32Array(raw);
 pairs.forEach((p,i)=>{const k=i*8;u.set([p.fine.slot,p.coarse.slot,p.fine.stitch,p.coarse.stitch],k);f.set([p.originX,p.originY,p.scale,topologySlots?.has(p.fine.slot)?1:0],k+4);});
 return raw;
}

// Group overlapping patches by the actual coarse surface. Stitch-only changes
// use their own group because they require a topology change at the same LOD.
export function transitionGroups(previous,next){
 const oldKeys=new Set(previous.map(p=>p.key)),newKeys=new Set(next.map(p=>p.key));
 const groups=new Map();
 for(const p of transitionPairs(previous,next)){
  const type=p.fine.level===p.coarse.level?'stitch':(oldKeys.has(p.fine.key)&&!newKeys.has(p.fine.key)?'merge':'refine');
  const key=type+'/'+p.coarse.key;
  let group=groups.get(key);
  if(!group){group={key,type,coarse:p.coarse,pairs:[],slots:new Set()};groups.set(key,group);}
  group.pairs.push(p);group.slots.add(p.fine.slot);group.slots.add(p.coarse.slot);
 }
 return [...groups.values()].map(group=>({
  ...group,slots:[...group.slots],
  pairs:group.type==='stitch'?[pair(next.find(p=>p.key===group.coarse.key),previous.find(p=>p.key===group.coarse.key))]:group.pairs
 }));
}

// Full slot-indexed upload: omitted slots are disabled, including recycled slots.
export function encodePatchMorphs(entries,capacity){
 if(!Number.isInteger(capacity)||capacity<1)throw new Error('Invalid morph capacity');
 const raw=new ArrayBuffer(capacity*32),u=new Uint32Array(raw),f=new Float32Array(raw),seen=new Set();
 for(const {pair:p,factor} of entries){
  const slot=p.fine.slot,parent=p.coarse.slot;
  if(!Number.isInteger(slot)||!Number.isInteger(parent)||slot<0||parent<0||slot>=capacity||parent>=capacity||seen.has(slot))throw new Error('Invalid or duplicate morph slot');
  if(![p.originX,p.originY,p.scale,factor].every(Number.isFinite)||p.scale<=0||p.scale>1)throw new Error('Invalid morph mapping');
  if(slot===parent&&(p.scale!==1||p.originX!==0||p.originY!==0))throw new Error('Invalid self morph mapping');
  seen.add(slot);const k=slot*8;
  u.set([parent,p.coarse.stitch,p.fine.stitch,1],k);
  f.set([p.originX,p.originY,p.scale,Math.max(0,Math.min(1,factor))],k+4);
 }
 return raw;
}

// Old and new topology both matter: neighbors can disappear, split, or change
// stitch masks. Connected groups must use a common progress value and commit
// atomically. Keys already include cube face, so cross-face links need no UV
// rounding or orientation guesses here.
export function coordinateTransitions(previous,next){
 const groups=transitionGroups(previous,next),owners=new Map(),parent=groups.map((_,i)=>i);
 const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 const join=(a,b)=>{parent[root(a)]=root(b);};
 groups.forEach((group,i)=>{
  for(const p of group.pairs)for(const node of [p.fine,p.coarse]){
   const list=owners.get(node.key)||new Set();list.add(i);owners.set(node.key,list);
  }
 });
 for(const node of [...previous,...next]){
  const own=[...(owners.get(node.key)||[])];if(!own.length)continue;
  const keys=[node.key,...(node.edgeKeys||[]),...(node.cornerKeys||[]).flat()].filter(Boolean);
  for(const key of keys)for(const other of owners.get(key)||[])for(const i of own)join(i,other);
 }
 const components=new Map();
 groups.forEach((group,i)=>{
  const id=root(i);let component=components.get(id);
  if(!component){component={groups:[],slots:new Set(),reasons:new Set()};components.set(id,component);}
  component.groups.push(group);for(const slot of group.slots)component.slots.add(slot);
  if(group.type==='stitch')component.reasons.add('stitch-change');
  else{
   const fine=new Map(group.pairs.map(p=>[p.fine.key,p.fine]));
   const immediate=[...fine.values()].every(p=>p.level===group.coarse.level+1);
   if(!immediate)component.reasons.add('skipped-levels');
   if(immediate&&fine.size!==4)component.reasons.add('incomplete-children');
   if(group.coarse.stitch)component.reasons.add('stitched-parent');
   if(group.pairs.some(p=>p.fine.stitch))component.reasons.add('stitched-child');
  }
 });
 return [...components.values()].map(c=>({groups:c.groups,slots:[...c.slots],deferredReasons:[...c.reasons].sort()}));
}

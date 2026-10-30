import test from 'node:test';
import assert from 'node:assert/strict';
import {FACE_BASES,RADIUS_KM,faceDirection,dot} from '../src/planet/planet-math.js';
import {planetCamera} from '../src/planet/camera.js';
import {selectPatches} from '../src/planet/quadtree.js';
import {transitionGroups} from '../src/planet/patch-transition.js';
import {buildTransitionTopology} from '../src/planet/transition-topology.js';
const triangles=new Map();
const cross=(a,b)=>(a[0]*b[1]-a[1]*b[0]);
function sample(node,q,mask=node.stitch){
 if(!triangles.has(mask))triangles.set(mask,buildTransitionTopology({mask},{mask}).fromTriangles);
 for(const [a,b,c] of triangles.get(mask)){
  const ab=b.map((v,i)=>v-a[i]),ac=c.map((v,i)=>v-a[i]),aq=q.map((v,i)=>v-a[i]),det=cross(ab,ac);
  const u=cross(aq,ac)/det,v=cross(ab,aq)/det;if(u< -1e-7||v< -1e-7||u+v>1+1e-7)continue;
  const points=[a,b,c].map(([x,y])=>{
   const d=faceDirection(node.face,node.u+(x/16-.5)*node.span,node.v+(y/16-.5)*node.span);
   const h=.3*Math.sin(d[0]*11)+.2*Math.cos(d[1]*7)+.1*Math.sin(d[2]*13);
   return d.map(value=>value*(RADIUS_KM+h));
  });
  return [0,1,2].map(i=>points[0][i]*(1-u-v)+points[1][i]*u+points[2][i]*v);
 }
 throw Error('Uncovered surface coordinate '+q);
}
function coordinate(node,d){
 const b=FACE_BASES[node.face],denom=dot(d,b.c);if(denom<=0)return null;
 const u=dot(d,b.u)/denom,v=dot(d,b.v)/denom;
 if(Math.abs(u)>1+1e-8||Math.abs(v)>1+1e-8)return null;
 const q=[(u-node.u)/node.span*16+8,(v-node.v)/node.span*16+8];
 return q.every(x=>x>=-1e-7&&x<=16+1e-7)?q:null;
}
function verify(previous,next){
 const groups=transitionGroups(previous,next),pairs=new Map();
 const merged=new Set(groups.filter(g=>g.type==='merge').map(g=>g.coarse.key));
 const drawn=new Map(next.filter(p=>!merged.has(p.key)).map(p=>[p.key,p]));
 for(const g of groups)for(const p of g.pairs){pairs.set(p.fine.key,{...p,merge:g.type==='merge'});if(g.type==='merge')drawn.set(p.fine.key,p.fine);}
 const surface=(node,q,t)=>{
  const p=pairs.get(node.key);if(!p)return sample(node,q);
  const fine=sample(p.fine,q),coarse=sample(p.coarse,[p.originX+q[0]*p.scale,p.originY+q[1]*p.scale]),f=p.merge?1-t:t;
  return fine.map((v,i)=>coarse[i]*(1-f)+v*f);
 };
 let checked=0,crossFace=0;
 for(const node of drawn.values())for(let edge=0;edge<4;edge++)for(const s of [0,.5,2,5,8,11,14,15.5,16]){
  const q=edge<2?[edge*16,s]:[s,(edge-2)*16];
  const d=faceDirection(node.face,node.u+(q[0]/16-.5)*node.span,node.v+(q[1]/16-.5)*node.span);
  for(const other of drawn.values()){
   if(other.key<=node.key)continue;const oq=coordinate(other,d);if(!oq)continue;
   checked++;if(other.face!==node.face)crossFace++;
   for(const t of [0,.2,.5,.8,1]){
    const a=surface(node,q,t),b=surface(other,oq,t),gap=Math.hypot(...a.map((v,i)=>v-b[i]));
    assert.ok(gap<1e-7,`seam ${node.key}/${other.key} at ${q}, factor ${t}: ${gap} km`);
   }
  }
 }
 assert.ok(checked>100);assert.ok(crossFace>0);
 return new Set(groups.map(g=>g.type));
}
test('mixed spatial morphs share edges and cube corners at every sampled factor',()=>{
 const options={budget:54,pixelSize:14,includeHidden:true};
 let previous=selectPatches(planetCamera({altitude:14000,longitude:.8,latitude:.4},960,600),options);
 const seen=new Set();
 for(const state of [{altitude:50,longitude:2.2,latitude:-.2},{altitude:100,longitude:.75,latitude:.6},{altitude:18000,longitude:-1,latitude:0}]){
  const next=selectPatches(planetCamera(state,960,600),{...options,previousLeaves:previous.leaves});
  for(const type of verify(previous.visible,next.visible))seen.add(type);
  previous=next;
 }
 assert.ok(seen.has('refine'));assert.ok(seen.has('merge'));assert.ok(seen.has('stitch'));
});

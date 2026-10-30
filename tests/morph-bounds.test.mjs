import test from 'node:test';
import assert from 'node:assert/strict';

// Independent numerical check of the conservative bound used by cull.wgsl.
// The parent endpoint may sample any triangle and any stitched parent edge.
function enclosure(fine,parents,delta){
 const spheres=[fine,...parents.map(p=>[p[0]+delta[0],p[1]+delta[1],p[2]+delta[2],p[3]])];
 const lo=[0,1,2].map(k=>Math.min(...spheres.map(s=>s[k]-s[3])));
 const hi=[0,1,2].map(k=>Math.max(...spheres.map(s=>s[k]+s[3])));
 return {center:lo.map((v,k)=>(v+hi[k])/2),radius:Math.hypot(...lo.map((v,k)=>(hi[k]-v)/2))*1.0001+.00001};
}
test('endpoint-union bound contains interpolated positions across different patch origins',()=>{
 const fine=[.3,-.2,.4,.08],parents=Array.from({length:16},(_,i)=>[i%4*.7,Math.floor(i/4)*.6,.2*Math.sin(i),.8]);
 for(const delta of [[0,0,0],[1000,-800,3],[.00001,.00002,-.00003]]){
  const bound=enclosure(fine,parents,delta);
  for(const p of parents)for(const axis of [0,1,2])for(const sign of [-1,1]){
   const a=fine.slice(0,3),b=p.slice(0,3).map((v,k)=>v+delta[k]);a[axis]+=fine[3]*sign;b[(axis+1)%3]+=p[3]*sign;
   for(let i=0;i<=32;i++){
    const t=i/32,position=a.map((v,k)=>v*t+b[k]*(1-t));
    assert.ok(Math.hypot(...position.map((v,k)=>v-bound.center[k]))<=bound.radius);
   }
  }
 }
});

test('shared patch union encloses every meshlet endpoint, including overlay bounds',()=>{
 const fine=Array.from({length:16},(_,i)=>[i*.13,Math.sin(i)*.2,Math.cos(i)*.1,.15]);
 const parents=Array.from({length:16},(_,i)=>[i*.07,Math.cos(i)*.3,Math.sin(i)*.2,.2]);
 const delta=[7,-3,.02];
 for(const overlay of [false,true])for(const meshlet of fine){
  const bound=enclosure(meshlet,[...parents,...(overlay?fine.map(v=>[v[0]-delta[0],v[1]-delta[1],v[2]-delta[2],v[3]]):[])],delta);
  for(const sphere of [meshlet,...parents.map(p=>[p[0]+delta[0],p[1]+delta[1],p[2]+delta[2],p[3]]),...(overlay?fine:[])])for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
   const p=sphere.slice(0,3);p[axis]+=sign*sphere[3];
   assert.ok(Math.hypot(...p.map((v,k)=>v-bound.center[k]))<=bound.radius);
  }
 }
});

test('self-slot stitch overlay needs only one copy of each bound',()=>{
 const spheres=Array.from({length:16},(_,i)=>[i*.13,Math.sin(i)*.2,Math.cos(i)*.1,.15]);
 for(const meshlet of spheres){
  const once=enclosure(meshlet,spheres,[0,0,0]);
  const twice=enclosure(meshlet,[...spheres,...spheres],[0,0,0]);
  assert.deepEqual(once,twice);
 }
});

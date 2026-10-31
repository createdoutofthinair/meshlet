import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTransitionTopology} from '../src/planet/transition-topology.js';
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function verify(from,to){
 const mesh=buildTransitionTopology(from,to);let area=0;
 assert.ok(mesh.triangleCount>0&&mesh.triangleCount<8192);
 for(let i=0;i<mesh.triangleCount;i++){
  const tri=[0,1,2].map(k=>[...mesh.coordinates.slice(i*6+k*2,i*6+k*2+2)]);
  const twice=cross(...tri);assert.ok(twice>0);area+=twice/2;
  for(const [faces,source] of [[mesh.fromTriangles,mesh.sources[i*2]],[mesh.toTriangles,mesh.sources[i*2+1]]]){
   const parent=faces[source];
   for(const p of tri){assert.ok(p.every(v=>v>=-1e-5&&v<=16+1e-5));for(let e=0;e<3;e++)assert.ok(cross(parent[e],parent[(e+1)%3],p)>=-1e-5);}
  }
 }
 assert.ok(Math.abs(area-256)<1e-4,'complete coverage');return mesh;
}
test('common triangulation respects every old/new stitch-mask pair',()=>{
 for(let a=0;a<16;a++)for(let b=0;b<16;b++)verify({mask:a},{mask:b});
});
test('child windows of stitched parents preserve endpoint triangle boundaries',()=>{
 for(let mask=0;mask<16;mask++)for(let q=0;q<4;q++)verify({mask,originX:(q%2)*8,originY:(q>>1)*8,scale:.5},{mask:(mask+5)%16});
});
test('spatial candidate lookup preserves skipped-level and fractional windows',()=>{
 for(const scale of [.25,.125,.37])for(const mask of [0,3,9,15]){
  verify({mask,originX:16*(1-scale),originY:0,scale},{mask:(mask+5)%16});
 }
});
test('source triangle enumeration retains stitched boundary-touching cells',()=>{
 const mesh=buildTransitionTopology({mask:1,originX:0,originY:0,scale:.5},{mask:6});
 assert.ok(mesh.fromTriangles.some(triangle=>JSON.stringify(triangle)===JSON.stringify([[0,16],[2,18],[0,20]])));
});
test('invalid surface mappings are rejected',()=>{
 for(const mapping of [{scale:0},{scale:NaN},{originX:16,scale:.5},{mask:16}])assert.throws(()=>buildTransitionTopology(mapping),/mapping/);
});

test('endpoint shading attributes remain affine over the common triangulation',()=>{
 const weights=[.2,.3,.5];
 const sample=(triangle,p,channel)=>{
  const [a,b,c]=triangle,d=cross(a,b,c),u=cross(a,p,c)/d,v=cross(a,b,p)/d;
  const values=triangle.map(([x,y])=>Math.sin(x*(channel+1)*.17)+Math.cos(y*(channel+2)*.13));
  return values[0]+(values[1]-values[0])*u+(values[2]-values[0])*v;
 };
 for(let mask=0;mask<16;mask++){
  const mesh=buildTransitionTopology({mask},{mask:(mask+7)%16});
  for(let i=0;i<mesh.triangleCount;i++){
   const tri=[0,1,2].map(k=>[...mesh.coordinates.slice(i*6+k*2,i*6+k*2+2)]);
   const q=[0,1].map(axis=>tri.reduce((s,p,k)=>s+p[axis]*weights[k],0));
   for(const [faces,index] of [[mesh.fromTriangles,mesh.sources[i*2]],[mesh.toTriangles,mesh.sources[i*2+1]]])for(let channel=0;channel<8;channel++){
    const endpoint=faces[index];
    const reconstructed=tri.reduce((sum,p,k)=>sum+sample(endpoint,p,channel)*weights[k],0);
    assert.ok(Math.abs(reconstructed-sample(endpoint,q,channel))<1e-10);
   }
  }
 }
});

test('cached coordinates preserve both endpoint mappings through eviction',async()=>{
 const {transitionCoordinates}=await import('../src/planet/transition-topology.js');
 for(let mask=0;mask<16;mask++)for(let toMask=0;toMask<5;toMask++){
  const from={mask,originX:8,originY:0,scale:.5},to={mask:toMask};
  assert.deepEqual(transitionCoordinates(from,to),buildTransitionTopology(from,to).coordinates);
 }
 const from={mask:2},to={mask:1,originX:0,originY:8,scale:.5};
 assert.deepEqual(transitionCoordinates(from,to),buildTransitionTopology(from,to).coordinates);
 assert.deepEqual(transitionCoordinates({mask:0},{mask:0}),buildTransitionTopology().coordinates);
});

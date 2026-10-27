import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {generateMesh,calculateBounds,MAX_TRIANGLES,MESHLET_BYTES} from '../src/geometry/meshlets.js';

const wasm=await readFile(new URL('../src/geometry/bounds.wasm',import.meta.url));
test('meshlets cover the entire detailed surface with bounded patch sizes',()=>{
 const mesh=generateMesh(24), meta=new DataView(mesh.meshlets);
 assert.equal(mesh.triangles,24*48*2);assert.equal(mesh.meshletCount,32);
 const visited=new Set();let expectedStart=0;
 for(let m=0;m<mesh.meshletCount;m++){
  const start=meta.getUint32(m*MESHLET_BYTES+16,true),count=meta.getUint32(m*MESHLET_BYTES+20,true);
  assert.equal(start,expectedStart);assert.equal(count,MAX_TRIANGLES);
  const unique=new Set(mesh.indices.slice(start,start+count*3));assert.ok(unique.size<=49);
  for(let i=start;i<start+count*3;i+=3){const tri=[...mesh.indices.slice(i,i+3)].sort((a,b)=>a-b).join('/');assert.ok(!visited.has(tri));visited.add(tri);}
  expectedStart+=count*3;
 }
 assert.equal(expectedStart,mesh.indices.length);assert.equal(visited.size,mesh.triangles);
});
test('WASM bounds conservatively contain every indexed vertex',async()=>{
 for(const detail of [6,24,48]){
  const mesh=await calculateBounds(generateMesh(detail),wasm), meta=new DataView(mesh.meshlets);
  for(let m=0;m<mesh.meshletCount;m++){
   const b=m*MESHLET_BYTES,c=[meta.getFloat32(b,true),meta.getFloat32(b+4,true),meta.getFloat32(b+8,true)],radius=meta.getFloat32(b+12,true);
   assert.ok(Number.isFinite(radius)&&radius>0);
   const start=meta.getUint32(b+16,true),count=meta.getUint32(b+20,true);
   for(let i=start;i<start+count*3;i++){
    const v=mesh.indices[i]*8;
    assert.ok(Math.hypot(mesh.vertices[v]-c[0],mesh.vertices[v+1]-c[1],mesh.vertices[v+2]-c[2])<=radius+1e-6,`detail ${detail} meshlet ${m}`);
   }
  }
 }
});
test('normals are finite, normalized, and detail is constrained',()=>{
 const {vertices}=generateMesh(24);
 for(let i=0;i<vertices.length;i+=8){assert.ok(Number.isFinite(vertices[i]));assert.ok(Math.abs(Math.hypot(vertices[i+4],vertices[i+5],vertices[i+6])-1)<1e-5);}
 for(const d of [0,7,193,-6])assert.throws(()=>generateMesh(d));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {generateMesh,calculateBounds,MAX_TRIANGLES,LOD_TRIANGLES,MESHLET_BYTES,PATCH} from '../src/geometry/meshlets.js';

const wasm=await readFile(new URL('../src/geometry/bounds.wasm',import.meta.url));
test('all LOD index ranges cover the same patches without gaps or overlap',()=>{
 const mesh=generateMesh(24), meta=new DataView(mesh.meshlets), width=mesh.detail*2+1, patchColumns=mesh.detail*2/PATCH;
 assert.equal(mesh.triangles,24*48*2);assert.equal(mesh.meshletCount,32);assert.deepEqual(LOD_TRIANGLES,[72,18,8]);
 const visited=new Set();let expectedStart=0;
 for(let m=0;m<mesh.meshletCount;m++){
  const x0=(m%patchColumns)*PATCH,y0=Math.floor(m/patchColumns)*PATCH;
  for(let lod=0;lod<3;lod++){
   const start=meta.getUint32(m*MESHLET_BYTES+16+lod*4,true),count=LOD_TRIANGLES[lod];
   assert.equal(start,expectedStart);
   const unique=new Set(mesh.indices.slice(start,start+count*3));assert.ok(unique.size<=49);
   for(const vertex of unique){const x=vertex%width,y=Math.floor(vertex/width);assert.ok(x>=x0&&x<=x0+PATCH&&y>=y0&&y<=y0+PATCH);}
   for(let i=start;i<start+count*3;i+=3){
    const tri=[...mesh.indices.slice(i,i+3)].sort((a,b)=>a-b).join('/');
    if(lod===0){assert.ok(!visited.has(tri));visited.add(tri);}
   }
   expectedStart+=count*3;
  }
 }
 assert.equal(expectedStart,mesh.indices.length);assert.equal(visited.size,mesh.triangles);
});
test('WASM bounds conservatively contain every indexed vertex at each LOD',async()=>{
 for(const detail of [6,24,48]){
  const mesh=await calculateBounds(generateMesh(detail),wasm), meta=new DataView(mesh.meshlets);
  for(let m=0;m<mesh.meshletCount;m++){
   const b=m*MESHLET_BYTES,c=[meta.getFloat32(b,true),meta.getFloat32(b+4,true),meta.getFloat32(b+8,true)],radius=meta.getFloat32(b+12,true);
   assert.ok(Number.isFinite(radius)&&radius>0);
   for(let lod=0;lod<3;lod++){
    const start=meta.getUint32(b+16+lod*4,true),count=LOD_TRIANGLES[lod];
    for(let i=start;i<start+count*3;i++){
     const v=mesh.indices[i]*8;
     assert.ok(Math.hypot(mesh.vertices[v]-c[0],mesh.vertices[v+1]-c[1],mesh.vertices[v+2]-c[2])<=radius+1e-6,`detail ${detail} meshlet ${m} LOD ${lod}`);
    }
   }
  }
 }
});
test('neighboring meshlets use the same edge vertices at each LOD',()=>{
 const mesh=generateMesh(24),meta=new DataView(mesh.meshlets),width=mesh.detail*2+1;
 const columns=mesh.detail*2/PATCH,rows=mesh.detail/PATCH;
 for(let lod=0;lod<3;lod++){
  const edgeFor=(m,axis,value)=>{
   const start=meta.getUint32(m*MESHLET_BYTES+16+lod*4,true);
   return [...new Set(mesh.indices.slice(start,start+LOD_TRIANGLES[lod]*3))]
    .filter(v=>axis==='x'?v%width===value:Math.floor(v/width)===value).sort((a,b)=>a-b);
  };
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
   const m=y*columns+x;
   if(x+1<columns)assert.deepEqual(edgeFor(m,'x',(x+1)*PATCH),edgeFor(m+1,'x',(x+1)*PATCH));
   if(y+1<rows)assert.deepEqual(edgeFor(m,'y',(y+1)*PATCH),edgeFor(m+columns,'y',(y+1)*PATCH));
  }
 }
});
test('normals are finite, normalized, and detail is constrained',()=>{
 const {vertices}=generateMesh(24);
 for(let i=0;i<vertices.length;i+=8){assert.ok(Number.isFinite(vertices[i]));assert.ok(Math.abs(Math.hypot(vertices[i+4],vertices[i+5],vertices[i+6])-1)<1e-5);}
 for(const d of [0,7,193,-6])assert.throws(()=>generateMesh(d));
});

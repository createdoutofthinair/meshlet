import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTransitionTopology} from '../src/planet/transition-topology.js';
import {packTransitionTopology,MORPH_RANGE_OFFSET,MORPH_COORD_OFFSET,MORPH_BUFFER_BYTES} from '../src/planet/transition-upload.js';

test('topology packing preserves complete triangles and slot/meshlet ranges',()=>{
 const source=buildTransitionTopology({mask:1},{mask:2});
 const packed=packTransitionTopology([{slot:7,coordinates:source.coordinates}]);
 assert.equal(packed.coordinates.length,source.coordinates.length);assert.equal(packed.slots.size,1);
 const canonical=a=>{const keys=[];for(let i=0;i<a.length;i+=6)keys.push([...a.slice(i,i+6)].join(','));return keys.sort();};
 assert.deepEqual(canonical(packed.coordinates),canonical(source.coordinates));
 let count=0;
 for(let i=0;i<16;i++){
  const [offset,n]=packed.ranges.slice((7*16+i)*2,(7*16+i)*2+2);count+=n;
  assert.equal(n%3,0);assert.ok(offset+n<=packed.coordinates.length/2);assert.ok(n<=packed.vertexCount);
 }
 assert.equal(count,source.coordinates.length/2);
 assert.ok(packed.ranges.slice(0,7*16*2).every(x=>x===0));
 assert.equal(MORPH_RANGE_OFFSET,1024*32);assert.equal(MORPH_COORD_OFFSET,1024*32+1024*16*8);
 assert.ok(MORPH_BUFFER_BYTES<32*1024*1024);
});
test('capacity and invalid topology are rejected before upload',()=>{
 const coordinates=new Float32Array([0,0,1,0,0,1]);
 assert.throws(()=>packTransitionTopology([{slot:0,coordinates}],2),/capacity/);
 assert.throws(()=>packTransitionTopology([{slot:0,coordinates},{slot:0,coordinates}]),/slot/);
 assert.throws(()=>packTransitionTopology([{slot:1024,coordinates}]),/slot/);
 assert.throws(()=>packTransitionTopology([{slot:0,coordinates:new Float32Array([0,0])}]),/triangle/);
 assert.throws(()=>packTransitionTopology([{slot:0,coordinates:new Float32Array([0,0,NaN,0,0,1])}]),/coordinates/);
});

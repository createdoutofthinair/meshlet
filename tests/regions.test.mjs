import test from 'node:test';
import assert from 'node:assert/strict';
import {faceDirection} from '../src/planet/planet-math.js';
import {REGION_FACE_TILES,REGION_GRID,REGION_HALO,REGION_CAPACITY,REGION_LOOKUPS,regionAt,regionsAround} from '../src/planet/regions.js';
import {PlanetRenderer} from '../src/planet/renderer.js';

test('regional simulation tiles are fixed in world coordinates and cover cube-face edges',()=>{
 assert.equal(REGION_GRID,64+1+2*REGION_HALO);assert.ok(REGION_HALO>=12);
 for(let face=0;face<6;face++)for(const [u,v] of [[0,0],[.999,0],[0,-.999],[.999,.999]]){
  const direction=faceDirection(face,u,v),tile=regionAt(direction),around=regionsAround(direction);
  assert.ok(around.some(r=>r.id===tile.id));assert.equal(new Set(around.map(r=>r.id)).size,around.length);
  assert.ok(around.every(r=>r.x>=0&&r.y>=0&&r.x<REGION_FACE_TILES&&r.y<REGION_FACE_TILES));
  if(Math.abs(u)>.998||Math.abs(v)>.998)assert.ok(around.some(r=>r.face!==tile.face),'cube-edge neighborhood includes the other face');
 }
 const corner=regionsAround([1,1,1]);assert.deepEqual(new Set(corner.map(r=>r.face)),new Set([0,2,4]));
});
test('regional cache retains the camera neighborhood and safely reuses slots',()=>{
 const r=Object.create(PlanetRenderer.prototype);
 Object.assign(r,{seed:42,regionSeed:42,erosion:1,regional:true,regions:new Map(),regionFree:Array.from({length:REGION_CAPACITY},(_,i)=>REGION_CAPACITY-1-i),regionLookup:new Uint32Array(REGION_LOOKUPS).fill(0xffffffff),regionMeta:new Uint32Array(REGION_CAPACITY*4),regionPending:[],device:{queue:{writeBuffer(){}}},world:{},regionMetaBuffer:{},regionQueueBuffer:{},patches:[],slotByKey:new Map(),stitchByKey:new Map(),lodErrors:new Map(),free:[],generation:0});
 let evictions=0;
 for(let step=0;step<24;step++){
  const angle=step*.025,radial=[Math.cos(angle),0,Math.sin(angle)],before=new Set(r.regions.keys());
  r.prepareRegions({radial,clearance:4});
  evictions+=[...before].filter(id=>!r.regions.has(id)).length;
  assert.ok(r.regions.size<=REGION_CAPACITY);assert.equal(new Set(r.regions.values()).size,r.regions.size);
  for(const tile of regionsAround(radial)){assert.ok(r.regions.has(tile.id));assert.equal(r.regionLookup[tile.id],r.regions.get(tile.id));}
  for(const id of before)if(!r.regions.has(id))assert.equal(r.regionLookup[id],0xffffffff);
 }
 assert.ok(evictions>0,'test must exercise LRU eviction');
});

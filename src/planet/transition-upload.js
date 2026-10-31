export const MORPH_CAPACITY=1024;
export const MORPH_RANGE_OFFSET=MORPH_CAPACITY*32;
export const MORPH_COORD_OFFSET=MORPH_RANGE_OFFSET+MORPH_CAPACITY*16*8;
export const MORPH_COORD_CAPACITY=2*1024*1024;
export const MORPH_BUFFER_BYTES=MORPH_COORD_OFFSET+MORPH_COORD_CAPACITY*8;

// Each bucket contains complete triangles. Ranges count vertices, not floats.
export function packTransitionTopology(records,capacity=MORPH_COORD_CAPACITY){
 const ranges=new Uint32Array(MORPH_CAPACITY*16*2),slots=new Set(),prepared=[],layouts=new WeakMap();let vertexCount=96,totalFloats=0;
 for(const {slot,coordinates} of records){
  if(!Number.isInteger(slot)||slot<0||slot>=MORPH_CAPACITY||slots.has(slot))throw new Error('Invalid topology slot');
  if(coordinates.length%6)throw new Error('Incomplete topology triangle');slots.add(slot);
  // Many patches share the same cached transition coordinates. Validate and
  // classify each shared array once during this packing operation.
  let layout=layouts.get(coordinates);
  if(!layout){
   const counts=new Uint32Array(16),buckets=new Uint8Array(coordinates.length/6);
   for(let i=0;i<coordinates.length;i+=6){
    for(let j=0;j<6;j++){const v=coordinates[i+j];if(!Number.isFinite(v)||v<0||v>16)throw new Error('Invalid topology coordinates');}
    const x=Math.min(3,Math.floor((coordinates[i]+coordinates[i+2]+coordinates[i+4])/12));
    const y=Math.min(3,Math.floor((coordinates[i+1]+coordinates[i+3]+coordinates[i+5])/12));
    const bucket=y*4+x;buckets[i/6]=bucket;counts[bucket]+=6;
   }
   layout={counts,buckets};layouts.set(coordinates,layout);
  }
  totalFloats+=coordinates.length;if(totalFloats/2>capacity)throw new Error('Transition topology capacity exceeded');
  prepared.push({slot,coordinates,...layout});
 }
 const data=new Float32Array(totalFloats);let base=0;
 for(const record of prepared){
  const offsets=new Uint32Array(16);let cursor=base;
  for(let i=0;i<16;i++){
   offsets[i]=cursor;ranges[(record.slot*16+i)*2]=cursor/2;ranges[(record.slot*16+i)*2+1]=record.counts[i]/2;
   vertexCount=Math.max(vertexCount,record.counts[i]/2);cursor+=record.counts[i];
  }
  for(let i=0;i<record.coordinates.length;i+=6){
   const bucket=record.buckets[i/6],offset=offsets[bucket];
   for(let j=0;j<6;j++)data[offset+j]=record.coordinates[i+j];
   offsets[bucket]+=6;
  }
  base=cursor;
 }
 return {ranges,coordinates:data,slots,vertexCount};
}

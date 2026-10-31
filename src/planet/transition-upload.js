export const MORPH_CAPACITY=1024;
export const MORPH_RANGE_OFFSET=MORPH_CAPACITY*32;
export const MORPH_COORD_OFFSET=MORPH_RANGE_OFFSET+MORPH_CAPACITY*16*8;
export const MORPH_COORD_CAPACITY=2*1024*1024;
export const MORPH_BUFFER_BYTES=MORPH_COORD_OFFSET+MORPH_COORD_CAPACITY*8;

// Each bucket contains complete triangles. Ranges count vertices, not floats.
export function packTransitionTopology(records,capacity=MORPH_COORD_CAPACITY){
 const ranges=new Uint32Array(MORPH_CAPACITY*16*2),data=[],slots=new Set();let vertexCount=96;
 for(const {slot,coordinates} of records){
  if(!Number.isInteger(slot)||slot<0||slot>=MORPH_CAPACITY||slots.has(slot))throw new Error('Invalid topology slot');
  if(coordinates.length%6)throw new Error('Incomplete topology triangle');slots.add(slot);
  const buckets=Array.from({length:16},()=>[]);
  for(let i=0;i<coordinates.length;i+=6){
   for(let j=0;j<6;j++){const v=coordinates[i+j];if(!Number.isFinite(v)||v<0||v>16)throw new Error('Invalid topology coordinates');}
   const x=Math.min(3,Math.floor((coordinates[i]+coordinates[i+2]+coordinates[i+4])/12));
   const y=Math.min(3,Math.floor((coordinates[i+1]+coordinates[i+3]+coordinates[i+5])/12));
   buckets[y*4+x].push(coordinates[i],coordinates[i+1],coordinates[i+2],coordinates[i+3],coordinates[i+4],coordinates[i+5]);
  }
  buckets.forEach((bucket,i)=>{
   if((data.length+bucket.length)/2>capacity)throw new Error('Transition topology capacity exceeded');
   ranges.set([data.length/2,bucket.length/2],(slot*16+i)*2);vertexCount=Math.max(vertexCount,bucket.length/2);
   for(const value of bucket)data.push(value);
  });
 }
 return {ranges,coordinates:new Float32Array(data),slots,vertexCount};
}

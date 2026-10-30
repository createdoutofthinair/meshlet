// Common parameter-space tessellation of two rendered patch surfaces. Each
// output triangle lies inside one triangle of EACH endpoint, so interpolation
// can reproduce both endpoints without cutting across a stitched diagonal.
const EPS=1e-10;
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function stitched([x,y],mask){
 if(x===0&&(mask&1)&&y%2)y--;
 if(x===16&&(mask&2)&&y%2)y--;
 if(y===0&&(mask&4)&&x%2)x--;
 if(y===16&&(mask&8)&&x%2)x--;
 return [x,y];
}
function clip(polygon,a,b){
 const out=[];
 for(let i=0;i<polygon.length;i++){
  const p=polygon[i],q=polygon[(i+1)%polygon.length],dp=cross(a,b,p),dq=cross(a,b,q);
  const pin=dp>=-EPS,qin=dq>=-EPS;
  if(pin)out.push(p);
  if(pin!==qin){const t=dp/(dp-dq);out.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}
 }
 return out.filter((p,i)=>{const q=out[(i+out.length-1)%out.length];return Math.hypot(p[0]-q[0],p[1]-q[1])>EPS;});
}
function triangles({mask=0,originX=0,originY=0,scale=1}={}){
 if(!Number.isInteger(mask)||mask<0||mask>15||![originX,originY,scale].every(Number.isFinite)||scale<=0||scale>1||originX<0||originY<0||originX+16*scale>16+EPS||originY+16*scale>16+EPS)throw new Error('Invalid transition surface mapping');
 const result=[];
 for(let y=0;y<16;y++)for(let x=0;x<16;x++){
  const points=[[x,y],[x+1,y],[x,y+1],[x+1,y+1]].map(p=>stitched(p,mask)).map(([u,v])=>[(u-originX)/scale,(v-originY)/scale]);
  for(const ids of [[0,1,2],[1,3,2]]){
   const p=ids.map(i=>points[i]);if(cross(...p)<=EPS)continue;
   const box=[Math.min(...p.map(v=>v[0])),Math.min(...p.map(v=>v[1])),Math.max(...p.map(v=>v[0])),Math.max(...p.map(v=>v[1]))];
   if(box[2]<0||box[3]<0||box[0]>16||box[1]>16)continue;
   result.push({points:p,box});
  }
 }
 return result;
}
export function buildTransitionTopology(from={},to={}){
 const old=triangles(from),next=triangles(to),coordinates=[],sources=[];
 const edges=[[[0,0],[16,0]],[[16,0],[16,16]],[[16,16],[0,16]],[[0,16],[0,0]]];
 for(let i=0;i<old.length;i++)for(let j=0;j<next.length;j++){
  const a=old[i],b=next[j];
  if(a.box[0]>=b.box[2]||a.box[2]<=b.box[0]||a.box[1]>=b.box[3]||a.box[3]<=b.box[1])continue;
  let polygon=a.points;
  for(let e=0;e<3&&polygon.length;e++)polygon=clip(polygon,b.points[e],b.points[(e+1)%3]);
  for(const [p,q] of edges)if(polygon.length)polygon=clip(polygon,p,q);
  for(let k=1;k+1<polygon.length;k++){
   const tri=[polygon[0],polygon[k],polygon[k+1]];if(cross(...tri)<=EPS)continue;
   coordinates.push(...tri.flat());sources.push(i,j);
  }
 }
 return {coordinates:new Float32Array(coordinates),sources:new Uint32Array(sources),fromTriangles:old.map(t=>t.points),toTriangles:next.map(t=>t.points),triangleCount:sources.length/2};
}

// The same few stitch/window combinations recur across many patches. Retain
// only upload coordinates, with a fixed LRU limit independent of world travel.
const coordinateCache=new Map();
export function transitionCoordinates(from,to){
 const key=JSON.stringify([from,to].map(({mask=0,originX=0,originY=0,scale=1})=>[mask,originX,originY,scale]));
 let coordinates=coordinateCache.get(key);
 if(coordinates)coordinateCache.delete(key);
 else coordinates=buildTransitionTopology(from,to).coordinates;
 coordinateCache.set(key,coordinates);
 if(coordinateCache.size>64)coordinateCache.delete(coordinateCache.keys().next().value);
 return coordinates;
}

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
 const point=(x,y)=>{const [u,v]=stitched([x,y],mask);return [(u-originX)/scale,(v-originY)/scale];};
 for(let y=0;y<16;y++)for(let x=0;x<16;x++){
  const p0=point(x,y),p1=point(x+1,y),p2=point(x,y+1),p3=point(x+1,y+1);
  for(const p of [[p0,p1,p2],[p1,p3,p2]]){
   if(cross(...p)<=EPS)continue;
   const box=[Math.min(p[0][0],p[1][0],p[2][0]),Math.min(p[0][1],p[1][1],p[2][1]),Math.max(p[0][0],p[1][0],p[2][0]),Math.max(p[0][1],p[1][1],p[2][1])];
   if(box[2]<0||box[3]<0||box[0]>16||box[1]>16)continue;
   result.push({points:p,box});
  }
 }
 return result;
}
export function buildTransitionTopology(from={},to={}){
 const old=triangles(from),next=triangles(to),coordinates=[],sources=[];
 const edges=[[[0,0],[16,0]],[[16,0],[16,16]],[[16,16],[0,16]],[[0,16],[0,0]]];
 // Intersections outside the 16x16 patch are clipped away. Index the target
 // triangle bounds by patch cell so each source triangle only tests local
 // candidates; sort indices to preserve the original deterministic order.
 const cells=Array.from({length:256},()=>[]),marks=new Uint32Array(next.length);
 const cellRange=box=>[Math.max(0,Math.floor(box[0])),Math.max(0,Math.floor(box[1])),Math.min(15,Math.ceil(box[2])-1),Math.min(15,Math.ceil(box[3])-1)];
 for(let j=0;j<next.length;j++){
  const [x0,y0,x1,y1]=cellRange(next[j].box);
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)cells[y*16+x].push(j);
 }
 for(let i=0;i<old.length;i++){
  const [x0,y0,x1,y1]=cellRange(old[i].box),candidates=[];
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)for(const j of cells[y*16+x])if(marks[j]!==i+1){marks[j]=i+1;candidates.push(j);}
  candidates.sort((a,b)=>a-b);
  for(const j of candidates){
  const a=old[i],b=next[j];
  if(a.box[0]>=b.box[2]||a.box[2]<=b.box[0]||a.box[1]>=b.box[3]||a.box[3]<=b.box[1])continue;
  let polygon=a.points;
  for(let e=0;e<3&&polygon.length;e++)polygon=clip(polygon,b.points[e],b.points[(e+1)%3]);
  for(const [p,q] of edges)if(polygon.length)polygon=clip(polygon,p,q);
  for(let k=1;k+1<polygon.length;k++){
   const a=polygon[0],b=polygon[k],c=polygon[k+1];if(cross(a,b,c)<=EPS)continue;
   coordinates.push(a[0],a[1],b[0],b[1],c[0],c[1]);sources.push(i,j);
  }
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

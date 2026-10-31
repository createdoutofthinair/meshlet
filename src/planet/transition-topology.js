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
 // Inputs are already free of adjacent duplicates. Fully contained polygons
 // survive clipping unchanged, so avoid allocating and filtering a copy.
 let inside=true;
 for(const point of polygon)if(cross(a,b,point)<-EPS){inside=false;break;}
 if(inside)return polygon;
 const out=[];
 for(let i=0;i<polygon.length;i++){
  const p=polygon[i],q=polygon[(i+1)%polygon.length],dp=cross(a,b,p),dq=cross(a,b,q);
  const pin=dp>=-EPS,qin=dq>=-EPS;
  if(pin)out.push(p);
  if(pin!==qin){const t=dp/(dp-dq);out.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}
 }
 if(!out.length)return out;
 let previous=out[out.length-1],write=0;
 for(let i=0;i<out.length;i++){
  const point=out[i];if(Math.hypot(point[0]-previous[0],point[1]-previous[1])>EPS)out[write++]=point;
  previous=point;
 }
 out.length=write;return out;
}
// Internal triangle grids recur across many old/new stitch pairings. Only the
// coordinates-only path uses this cache; public topology results remain
// independent and cannot mutate cached triangle data.
const triangleCache=new Map(),TRIANGLE_CACHE_LIMIT=96;
function triangles({mask=0,originX=0,originY=0,scale=1}={},useCache=false){
 if(!Number.isInteger(mask)||mask<0||mask>15||![originX,originY,scale].every(Number.isFinite)||scale<=0||scale>1||originX<0||originY<0||originX+16*scale>16+EPS||originY+16*scale>16+EPS)throw new Error('Invalid transition surface mapping');
 const key=useCache?JSON.stringify([mask,originX,originY,scale]):null;
 if(useCache&&triangleCache.has(key)){const cached=triangleCache.get(key);triangleCache.delete(key);triangleCache.set(key,cached);return cached;}
 const result=[];
 const point=(x,y)=>{const [u,v]=stitched([x,y],mask);return [(u-originX)/scale,(v-originY)/scale];};
 // The mapped patch window covers only this part of the source grid. Expand
 // by one cell for collapsed edge vertices and boundary-touching triangles.
 const x0=Math.max(0,Math.floor(originX)-1),y0=Math.max(0,Math.floor(originY)-1);
 const x1=Math.min(15,Math.ceil(originX+16*scale)+1),y1=Math.min(15,Math.ceil(originY+16*scale)+1);
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
  const p0=point(x,y),p1=point(x+1,y),p2=point(x,y+1),p3=point(x+1,y+1);
  for(const p of [[p0,p1,p2],[p1,p3,p2]]){
   if(cross(...p)<=EPS)continue;
   const box=[Math.min(p[0][0],p[1][0],p[2][0]),Math.min(p[0][1],p[1][1],p[2][1]),Math.max(p[0][0],p[1][0],p[2][0]),Math.max(p[0][1],p[1][1],p[2][1])];
   if(box[2]<0||box[3]<0||box[0]>16||box[1]>16)continue;
   result.push({points:p,box});
  }
 }
 if(useCache){triangleCache.set(key,result);if(triangleCache.size>TRIANGLE_CACHE_LIMIT)triangleCache.delete(triangleCache.keys().next().value);}
 return result;
}
function buildTopology(from={},to={},coordinatesOnly=false){
 const old=triangles(from,coordinatesOnly),next=triangles(to,coordinatesOnly),coordinates=[],sources=[];
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
  // Most triangles away from stitched edges coincide exactly. They are
  // already inside both surfaces and need no polygon clipping.
  if(a.box[0]>=0&&a.box[1]>=0&&a.box[2]<=16&&a.box[3]<=16&&
   a.points[0][0]===b.points[0][0]&&a.points[0][1]===b.points[0][1]&&
   a.points[1][0]===b.points[1][0]&&a.points[1][1]===b.points[1][1]&&
   a.points[2][0]===b.points[2][0]&&a.points[2][1]===b.points[2][1]){
   for(const point of a.points)coordinates.push(point[0],point[1]);if(!coordinatesOnly)sources.push(i,j);continue;
  }
  let polygon=a.points;
  for(let e=0;e<3&&polygon.length;e++)polygon=clip(polygon,b.points[e],b.points[(e+1)%3]);
  for(const [p,q] of edges)if(polygon.length)polygon=clip(polygon,p,q);
  for(let k=1;k+1<polygon.length;k++){
   const a=polygon[0],b=polygon[k],c=polygon[k+1];if(cross(a,b,c)<=EPS)continue;
   coordinates.push(a[0],a[1],b[0],b[1],c[0],c[1]);if(!coordinatesOnly)sources.push(i,j);
  }
  }
 }
 const packed=new Float32Array(coordinates);
 if(coordinatesOnly)return packed;
 return {coordinates:packed,sources:new Uint32Array(sources),fromTriangles:old.map(t=>t.points),toTriangles:next.map(t=>t.points),triangleCount:sources.length/2};
}
export function buildTransitionTopology(from={},to={}){return buildTopology(from,to);}

// Stitch/window combinations recur across patches. Bound both entry count and
// bytes so revisiting a broader set avoids churn without unbounded growth.
const coordinateCache=new Map(),COORDINATE_CACHE_ENTRIES=256,COORDINATE_CACHE_BYTES=8*1024*1024;
let coordinateCacheBytes=0;
export function transitionCoordinates(from,to){
 const key=JSON.stringify([from,to].map(({mask=0,originX=0,originY=0,scale=1})=>[mask,originX,originY,scale]));
 let coordinates=coordinateCache.get(key);
 if(coordinates){coordinateCache.delete(key);coordinateCacheBytes-=coordinates.byteLength;}
 else coordinates=buildTopology(from,to,true);
 if(coordinates.byteLength<=COORDINATE_CACHE_BYTES){
  coordinateCache.set(key,coordinates);coordinateCacheBytes+=coordinates.byteLength;
  while(coordinateCache.size>COORDINATE_CACHE_ENTRIES||coordinateCacheBytes>COORDINATE_CACHE_BYTES){
   const oldest=coordinateCache.keys().next().value;coordinateCacheBytes-=coordinateCache.get(oldest).byteLength;coordinateCache.delete(oldest);
  }
 }
 return coordinates;
}

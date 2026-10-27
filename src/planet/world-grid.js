import {faceCube,normalize} from './planet-math.js';

// One shared vertex for every point on the six cube-face grids. Edges and
// corners are identical indices, so simulation and interpolation cannot
// invent separate values on either side of a cube-face boundary.
export function buildWorldGrid(resolution=64){
 const cells=Math.floor(resolution);if(cells<2||cells>256)throw new RangeError('World-grid resolution must be between 2 and 256');
 const width=cells+1,faceIndices=new Uint32Array(6*width*width),ids=new Map(),points=[],areas=[],links=[];
 const at=(face,x,y)=>face*width*width+y*width+x;
 for(let face=0;face<6;face++)for(let y=0;y<=cells;y++)for(let x=0;x<=cells;x++){
  const u=x*2/cells-1,v=y*2/cells-1,cube=faceCube(face,u,v),key=cube.map(p=>Math.round(p*cells)).join(',');
  let index=ids.get(key);if(index===undefined){index=points.length;ids.set(key,index);points.push(normalize(cube));areas.push(0);links.push(new Set());}
  faceIndices[at(face,x,y)]=index;
  const edgeX=(x===0||x===cells)?0.5:1,edgeY=(y===0||y===cells)?0.5:1;
  areas[index]+=edgeX*edgeY/Math.pow(1+u*u+v*v,1.5);
 }
 for(let face=0;face<6;face++)for(let y=0;y<=cells;y++)for(let x=0;x<=cells;x++){
  const index=faceIndices[at(face,x,y)];
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   const xx=x+dx,yy=y+dy;if((!dx&&!dy)||xx<0||xx>cells||yy<0||yy>cells)continue;
   const other=faceIndices[at(face,xx,yy)];if(index!==other){links[index].add(other);links[other].add(index);}
  }
 }
 const directions=new Float32Array(points.length*4),neighbors=new Uint32Array(points.length*8);neighbors.fill(0xffffffff);
 points.forEach((point,i)=>{directions.set([...point,areas[i]],i*4);const adjacent=[...links[i]].sort((a,b)=>a-b);if(adjacent.length>8)throw new Error('World-grid neighbor capacity exceeded');neighbors.set(adjacent,i*8);});
 return {resolution:cells,count:points.length,directions,neighbors,faceIndices};
}

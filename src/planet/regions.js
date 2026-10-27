import {directionToFace,faceCube} from './planet-math.js';

// Fixed geographic regions; unlike render patches, their identity does not
// depend on the camera distance or the current quadtree LOD.
export const REGION_FACE_TILES=256;
export const REGION_CELLS=64;
export const REGION_HALO=14;
export const REGION_GRID=REGION_CELLS+1+REGION_HALO*2;
export const REGION_SAMPLES=(REGION_CELLS+1)**2;
export const REGION_CAPACITY=32;
export const REGION_LOOKUPS=6*REGION_FACE_TILES**2;
export const regionId=(face,x,y)=>face*REGION_FACE_TILES**2+y*REGION_FACE_TILES+x;
export function regionAt(direction){
 const f=directionToFace(direction),x=Math.min(REGION_FACE_TILES-1,Math.max(0,Math.floor((f.u+1)*REGION_FACE_TILES/2))),y=Math.min(REGION_FACE_TILES-1,Math.max(0,Math.floor((f.v+1)*REGION_FACE_TILES/2)));
 return {id:regionId(f.face,x,y),face:f.face,x,y};
}
export function regionsAround(direction,radius=1){
 const center=regionAt(direction),result=new Map([[center.id,center]]),span=2/REGION_FACE_TILES;
 for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
  const u=-1+(center.x+dx+.5)*span,v=-1+(center.y+dy+.5)*span;
  const next=regionAt(faceCube(center.face,u,v));result.set(next.id,next);
 }
 return [...result.values()];
}

export const RADIUS_KM=6371;
export const HEIGHT_LIMIT_KM=12;
export const PATCH_CELLS=16;
export const MAX_DEPTH=20;
export const FACE_BASES=[
 {c:[1,0,0],u:[0,1,0],v:[0,0,1]},
 {c:[-1,0,0],u:[0,1,0],v:[0,0,-1]},
 {c:[0,1,0],u:[1,0,0],v:[0,0,-1]},
 {c:[0,-1,0],u:[1,0,0],v:[0,0,1]},
 {c:[0,0,1],u:[1,0,0],v:[0,1,0]},
 {c:[0,0,-1],u:[-1,0,0],v:[0,1,0]},
];
export const add=(a,b)=>a.map((x,i)=>x+b[i]);
export const sub=(a,b)=>a.map((x,i)=>x-b[i]);
export const scale=(a,k)=>a.map(x=>x*k);
export const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const length=a=>Math.hypot(...a);
export const normalize=a=>{const l=length(a);return l?a.map(x=>x/l):[0,0,0];};
export function faceCube(face,u,v){const b=FACE_BASES[face];return b.c.map((x,i)=>x+u*b.u[i]+v*b.v[i]);}
export function faceDirection(face,u,v){return normalize(faceCube(face,u,v));}
export function directionToFace(p) {
 const [x,y,z]=p,ax=Math.abs(x),ay=Math.abs(y),az=Math.abs(z);
 if(ax>=ay&&ax>=az)return x>=0?{face:0,u:y/ax,v:z/ax}:{face:1,u:y/ax,v:-z/ax};
 if(ay>=ax&&ay>=az)return y>=0?{face:2,u:x/ay,v:-z/ay}:{face:3,u:x/ay,v:z/ay};
 return z>=0?{face:4,u:x/az,v:y/az}:{face:5,u:-x/az,v:y/az};
}
export function tileKey(n){return `${n.face}/${n.level}/${n.x}/${n.y}`;}
export function makeTile(face,level,x,y) {
 const span=2/2**level,u=-1+(x+.5)*span,v=-1+(y+.5)*span;
 return {face,level,x,y,span,u,v,direction:faceDirection(face,u,v),key:`${face}/${level}/${x}/${y}`};
}
// Infinite reversed-Z projection: near is 1, distant geometry tends to 0.
export function reversePerspective(fov,aspect,near) {
 const f=1/Math.tan(fov/2);
 return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,0,-1, 0,0,near,0]);
}
export function seedPlates(seed,count=16) {
 // Fibonacci-distributed centers with a seed-controlled global rotation and
 // per-plate land/ocean bias. All arithmetic is deterministic for a seed.
 let state=(seed>>>0)||0x9e3779b9;
 const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
 const yaw=random()*Math.PI*2,pitch=(random()-.5)*Math.PI;
 const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
 const values=new Float32Array(count*4);
 for(let i=0;i<count;i++){
  const y=1-2*(i+.5)/count,r=Math.sqrt(Math.max(0,1-y*y)),a=i*2.399963229728653+random()*.18;
  const x=Math.cos(a)*r,z=Math.sin(a)*r;
  const py=y*cp-z*sp,pz=y*sp+z*cp;
  values.set([x*cy+pz*sy,py,-x*sy+pz*cy,random()*.8-.4],i*4);
 }
 return values;
}

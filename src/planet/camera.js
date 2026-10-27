import {lookAt,multiply} from '../math.js';
import {RADIUS_KM,add,scale,dot,cross,normalize,reversePerspective} from './planet-math.js';
export function planetCamera({longitude=0,latitude=.25,altitude=12000,surfaceHeight=0,mode='orbit',heading=.4,pitch=.28},width,height) {
 const lat=Math.max(-1.5,Math.min(1.5,latitude)),cl=Math.cos(lat);
 const radial=[cl*Math.cos(longitude),Math.sin(lat),cl*Math.sin(longitude)];
 const east=normalize(cross([0,1,0],radial));
 const north=normalize(cross(radial,east));
 const clearance=altitude;altitude+=surfaceHeight;
 const eye=scale(radial,RADIUS_KM+altitude);
 let forward,up;
 if(mode==='flyover'){
  const tangent=add(scale(north,Math.cos(heading)),scale(east,Math.sin(heading)));
  forward=normalize(add(scale(tangent,Math.cos(pitch)),scale(radial,-Math.sin(pitch))));
  const right=normalize(cross(forward,radial));up=normalize(cross(right,forward));
 }else{forward=scale(radial,-1);up=north;}
 const right=normalize(cross(forward,up));up=normalize(cross(right,forward));
 // Approximate the center of the view on the local surface. This is used to
 // spend the bounded LOD budget where the viewer is looking, including flyover.
 const surfaceRadius=RADIUS_KM+surfaceHeight,b=dot(eye,forward),discriminant=b*b-(dot(eye,eye)-surfaceRadius*surfaceRadius);
 const focusDistance=discriminant>=0?Math.max(0,-b-Math.sqrt(discriminant)):Math.max(0,-b);
 const focusDirection=normalize(add(eye,scale(forward,focusDistance)));
 const fov=Math.PI/3,aspect=width/height,tanY=Math.tan(fov/2),tanX=tanY*aspect;
 const near=Math.max(.0001,Math.min(10,clearance*.02));
 const view=lookAt([0,0,0],forward,up),projection=reversePerspective(fov,aspect,near),vp=multiply(projection,view);
 // Four normalized side planes and reversed-Z near plane in camera-relative km.
 const row=r=>[vp[r],vp[4+r],vp[8+r],vp[12+r]];
 const r0=row(0),r1=row(1),r2=row(2),r3=row(3);
 const combine=(a,b,s)=>a.map((v,i)=>v+s*b[i]);
 const planes=[combine(r3,r0,1),combine(r3,r0,-1),combine(r3,r1,1),combine(r3,r1,-1),combine(r3,r2,-1)].map(p=>{const l=Math.hypot(p[0],p[1],p[2])||1;return p.map(v=>v/l)});
 return {eye,radial,forward,right,up,focusDirection,near,altitude,clearance,tanX,tanY,focalPixels:height/(2*tanY),vp,planes,width,height};
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWorldGrid} from '../src/planet/world-grid.js';

const add=(a,b)=>a.map((v,i)=>v+b[i]);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const scale=(a,s)=>a.map(v=>v*s);
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
const length=a=>Math.hypot(...a);
const normalize=a=>scale(a,1/length(a));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

test('the river search bound retains curved channels and pixel footprints',()=>{
 const grid=buildWorldGrid(64),none=0xffffffff;let state=0x398af123,checked=0;
 const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
 const randomTangent=(radial,magnitude)=>{
  let p=[random()*2-1,random()*2-1,random()*2-1];p=sub(p,scale(radial,dot(p,radial)));
  if(length(p)<1e-6)p=cross(radial,[0,1,0]);return scale(normalize(p),magnitude);
 };
 for(let n=0;n<5000;n++){
  const i=Math.floor(random()*grid.count),j=grid.neighbors[i*8+Math.floor(random()*8)];if(j===none)continue;
  const a=normalize(Array.from(grid.directions.subarray(i*4,i*4+3))),b=normalize(Array.from(grid.directions.subarray(j*4,j*4+3)));
  const ab=sub(b,a),segmentLength=length(ab),m0=randomTangent(a,segmentLength*.8),m1=randomTangent(b,segmentLength*.8),t=random(),t2=t*t,t3=t2*t;
  const curve=normalize(add(add(scale(a,2*t3-3*t2+1),scale(m0,t3-2*t2+t)),add(scale(b,-2*t3+3*t2),scale(m1,t3-t2))));
  const side=normalize(cross(a,b)),bend=(random()*2-1)*4.8/6371,point=normalize(add(curve,scale(side,bend)));
  const footprint=random()*5.6,radius=(.28*1.10+footprint*.5)/6371;
  const direction=normalize(add(point,randomTangent(point,radius)));
  const initialT=Math.max(0,Math.min(1,dot(sub(direction,a),ab)/dot(ab,ab)));
  const distance=length(sub(direction,add(a,scale(ab,initialT)))),bound=segmentLength*.60+(6.5+footprint*.5)/6371;
  assert.ok(distance<=bound,`river sample outside search bound: ${distance} > ${bound}`);checked++;
 }
 assert.ok(checked>4900);
});

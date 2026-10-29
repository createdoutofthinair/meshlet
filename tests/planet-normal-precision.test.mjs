import test from 'node:test';
import assert from 'node:assert/strict';
import {planetCamera} from '../src/planet/camera.js';
import {selectPatches} from '../src/planet/quadtree.js';
import {faceCube,faceDirection,FACE_BASES,normalize} from '../src/planet/planet-math.js';

// Emulate f32 arithmetic and compare the neighbor-coordinate calculation to
// the independent double-precision cube-sphere coordinates at shared vertices.
test('fine patch normal coordinates survive f32 rounding on both sides of cube edges',()=>{
 const f=Math.fround,add=(a,b)=>f(f(a)+f(b)),sub=(a,b)=>f(f(a)-f(b)),mul=(a,b)=>f(f(a)*f(b));
 let checked=0,crossFace=0,oldFailures=0,failures=0;
 for(const d of [[1,.3,1],[1,1,.3],[.3,1,1],[-1,-.3,-1],[.6,.2,.8]]){
  const p=normalize(d),camera=planetCamera({longitude:Math.atan2(p[2],p[0]),latitude:Math.atan2(p[1],Math.hypot(p[0],p[2])),mode:'walk',altitude:.0017,surfaceHeight:2,heading:.45,pitch:.2},1280,720);
  const selection=selectPatches(camera,{budget:512,maxDepth:22,pixelSize:14}),map=new Map(selection.visible.map(n=>[n.key,n]));
  for(const a of selection.visible)for(let edge=0;edge<4;edge++){
   const b=map.get(a.edgeKeys[edge]);if(!b||a.level<18)continue;
   for(let t=0;t<=16;t++){
    if(b.level<a.level&&t%2)continue;
    const x=edge===0?0:edge===1?16:t,y=edge===2?0:edge===3?16:t;
    const ac=faceCube(a.face,a.u,a.v).map(f),bc=faceCube(b.face,b.u,b.v).map(f);
    const au=FACE_BASES[a.face].u,av=FACE_BASES[a.face].v,bu=FACE_BASES[b.face].u,bv=FACE_BASES[b.face].v;
    const du=mul(x-8,a.span/16),dv=mul(y-8,a.span/16);
    const coords=old=>{
     const q=ac.map((z,k)=>old?sub(add(add(z,mul(au[k],du)),mul(av[k],dv)),bc[k]):add(add(sub(z,bc[k]),mul(au[k],du)),mul(av[k],dv)));
     const component=axis=>add(add(mul(q[0],axis[0]),mul(q[1],axis[1])),mul(q[2],axis[2]));
     return [Math.round(add(mul(component(bu),16/b.span),8)),Math.round(add(mul(component(bv),16/b.span),8))];
    };
    const expected=faceDirection(a.face,a.u+(x-8)*a.span/16,a.v+(y-8)*a.span/16);
    const wrong=([xx,yy])=>xx<0||xx>16||yy<0||yy>16||Math.hypot(...faceDirection(b.face,b.u+(xx-8)*b.span/16,b.v+(yy-8)*b.span/16).map((z,k)=>z-expected[k]))>1e-12;
    oldFailures+=Number(wrong(coords(true)));failures+=Number(wrong(coords(false)));checked++;
    if(a.face!==b.face)crossFace++;
   }
  }
 }
 assert.ok(checked>1000&&crossFace>100);assert.ok(oldFailures>0,'the previous addition order loses fine vertex coordinates');assert.equal(failures,0);
});

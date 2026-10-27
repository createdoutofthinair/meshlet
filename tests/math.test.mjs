import test from 'node:test';
import assert from 'node:assert/strict';
import {perspective,lookAt,multiply,frustumPlanes} from '../src/math.js';
const inside=(p,planes)=>planes.every(a=>a[0]*p[0]+a[1]*p[1]+a[2]*p[2]+a[3]>=0);
test('WebGPU frustum includes visible points and excludes all six outside regions',()=>{
 const planes=frustumPlanes(multiply(perspective(Math.PI/2,1,1,10),lookAt([0,0,0],[0,0,-1])));
 assert.ok(inside([0,0,-5],planes));
 for(const p of [[-7,0,-5],[7,0,-5],[0,-7,-5],[0,7,-5],[0,0,-.5],[0,0,-11],[0,0,1]])assert.equal(inside(p,planes),false,JSON.stringify(p));
});
test('look-at and projection keep the origin centered from an orbiting camera',()=>{
 const vp=multiply(perspective(Math.PI/3,1.5,.1,100),lookAt([5,5,5]));
 const clip=[vp[12],vp[13],vp[14],vp[15]];
 assert.ok(Math.abs(clip[0])<1e-6&&Math.abs(clip[1])<1e-6);
 assert.ok(clip[2]>=0 && clip[2]<=clip[3]);
});

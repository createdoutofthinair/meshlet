import test from 'node:test';
import assert from 'node:assert/strict';
// Exercise the same stable spherical intersection expressed in cloud.wgsl.
function interval(altitude,y,height){const radius=6371000,b=(radius+altitude)*y,c=(altitude-height)*(2*radius+altitude+height),d=b*b-c;return d<0?null:[-b-Math.sqrt(d),-b+Math.sqrt(d)];}
test('planet and cloud shell intersections work from ground, clouds and orbit',()=>{
 const groundUp=interval(100,1,1500);assert.ok(Math.abs(groundUp[1]-1400)<1e-5);
 const orbitDown=interval(100000,-1,3300);assert.ok(Math.abs(orbitDown[0]-96700)<1e-5);
 const inside=interval(2000,1,3300);assert.ok(inside[0]<0&&Math.abs(inside[1]-1300)<1e-5);
 assert.equal(interval(100000,1,0)[1]<0,true,'ground is behind an upward ray');
 assert.equal(interval(100000,0,3300),null,'horizontal orbit ray misses the cloud shell');
});
test('stable near root retains sub-metre detail at planetary radius',()=>{
 const f=Math.fround,r=f(6371000),alt=f(100.125),height=f(1500),b=f(r+alt),c=f(f(alt-height)*f(f(2*r)+f(alt+height)));
 const root=f(Math.sqrt(f(f(b*b)-c)));const far=f(-b-root);const near=f(c/far);
 assert.ok(Math.abs(near-1399.875)<.05,`near cloud shell was ${near}`);
});

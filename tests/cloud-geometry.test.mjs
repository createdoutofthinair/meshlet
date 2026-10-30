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

test('downward surface rays terminate at the planet before the far-side clouds',()=>{
 const ground=interval(0,-1,0);assert.equal(ground[0],0);
 const outer=interval(0,-1,8000);assert.ok(outer[1]>1e7);
 const groundDistance=ground[1]>0&&ground[0]>=0?ground[0]:Infinity;
 assert.equal(Math.min(outer[1],groundDistance),0);
});


test('the horizon remains open to nearby clouds and closes at the rendered ground',()=>{
 // At the surface, horizontal rays reach the cloud base; an artificial
 // angular fade would remove those clouds and leave a visible empty strip.
 const cloudBase=interval(1.7,0,1500);assert.ok(cloudBase[1]>100000&&cloudBase[1]<200000);
 const groundDown=interval(1.7,-.01,0);assert.ok(groundDown[0]>0&&groundDown[0]<cloudBase[1]);
 const skyUp=interval(1.7,.01,0);assert.ok(skyUp[1]<0);
});

test('the overlay uses rendered depth without an artificial horizon cloud gap',async()=>{
 const {readFile}=await import('node:fs/promises');
 const shader=await readFile(new URL('../src/planet/cloud-overlay.wgsl',import.meta.url),'utf8');
 assert.match(shader,/textureLoad\(sceneDepth/);assert.match(shader,/ground\.x>=0\.0/);assert.doesNotMatch(shader,/horizonFilter/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {PlanetRenderer} from '../src/planet/renderer.js';

// Exercise the real page controller with a deterministic stand-in for the
// GPU. Actual shader execution remains covered by the browser GPU smoke test.
class MockElement extends EventTarget {
 constructor(id=''){
  super();this.id=id;this.value='';this.textContent='';this.innerHTML='orbit hint';this.hidden=false;this.disabled=false;this.dataset={};
  const classes=new Set();this.parentElement={classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)}};
 }
 focus(){} closest(){return null;} setPointerCapture(){} querySelectorAll(){return [];}
}
class MockDocument extends EventTarget {
 constructor(){super();this.elements=new Map();this.hidden=false;this.pointerLockElement=null;}
 getElementById(id){if(!this.elements.has(id))this.elements.set(id,new MockElement(id));return this.elements.get(id);}
 exitPointerLock(){this.pointerLockElement=null;}
}
const doc=new MockDocument();globalThis.document=doc;globalThis.Element=MockElement;globalThis.window=new EventTarget();
globalThis.location={href:'https://example.test/planet.html',search:''};globalThis.history={replaceState(){}};
let animation;globalThis.requestAnimationFrame=callback=>{animation=callback;};
const cameraState={longitude:0,latitude:0,altitude:14000,surfaceHeight:0,mode:'orbit',heading:0,pitch:.3};
const renderer={cameraState,adapter:{info:{}},timing:false,seed:918273,relief:1,valleys:1,erosion:1,regional:true,rivers:true,ocean:true,generation:0,lastSelection:1,
 stats:{visiblePatches:1,deepest:20,leaves:1,generated:1,selectionMs:0},latest:{visibleMeshlets:1,gpuComputeMs:null,gpuRenderMs:null},
 invalidateTerrain(){this.generation++;},frame(){return 1;},
 async sampleTerrain(direction){return direction?new Float32Array([...direction,1]):new Float32Array([1,0,0,1]);},
 async sampleRenderedSurface(){return 1;}};
PlanetRenderer.create=async()=>renderer;
doc.getElementById('seed').value='918273';doc.getElementById('error').hidden=true;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const tick=async time=>{const callback=animation;assert.ok(callback);callback(time);await flush();};
const key=(type,code)=>{const event=new Event(type,{cancelable:true});Object.defineProperty(event,'code',{value:code});doc.dispatchEvent(event);};
await import('../src/planet/app.js');await flush();

test('page lands, walks, responds to terrain changes and returns to orbit',async()=>{
 doc.getElementById('walk').dispatchEvent(new Event('click'));await flush();
 assert.equal(cameraState.mode,'walk');assert.equal(doc.getElementById('altitude-range').disabled,true);
 assert.equal(doc.getElementById('walk-controls').hidden,false);
 await tick(100);key('keydown','KeyW');await tick(200);await tick(300);await tick(410);
 assert.ok(cameraState.latitude>0,'W moves the camera north');
 key('keyup','KeyW');await tick(420);
 doc.getElementById('seed').value='42';doc.getElementById('seed-form').dispatchEvent(new Event('submit',{cancelable:true}));await flush();
 assert.equal(renderer.seed,42);assert.equal(cameraState.mode,'walk','walk mode relands after a new seed');
 doc.getElementById('orbit').dispatchEvent(new Event('click'));
 assert.equal(cameraState.mode,'orbit');assert.equal(cameraState.altitude,14000);
 assert.equal(doc.getElementById('altitude-range').disabled,false);assert.equal(doc.getElementById('walk-controls').hidden,true);
});

test('landing over the ocean chooses a nearby dry sample',async()=>{
 cameraState.longitude=0;cameraState.latitude=0;
 renderer.sampleTerrain=async direction=>direction?new Float32Array([...direction,-3]):new Float32Array([1,0,0,-3,0,0,1,.5,0,1,0,2]);
 doc.getElementById('walk').dispatchEvent(new Event('click'));await flush();
 assert.equal(cameraState.mode,'walk');assert.ok(Math.abs(cameraState.longitude-Math.PI/2)<1e-8);
 assert.ok(Math.abs(cameraState.latitude)<1e-8);assert.equal(cameraState.surfaceHeight,.5);
});

test('landing reports when there is no sampled dry land',async()=>{
 doc.getElementById('orbit').dispatchEvent(new Event('click'));
 renderer.sampleTerrain=async direction=>direction?new Float32Array([...direction,-3]):new Float32Array([1,0,0,-3,0,0,1,-1]);
 doc.getElementById('walk').dispatchEvent(new Event('click'));await flush();
 assert.equal(cameraState.mode,'orbit');assert.equal(doc.getElementById('mode').value,'orbit');
 assert.match(doc.getElementById('walk-help').textContent,/No dry landing place/);
});

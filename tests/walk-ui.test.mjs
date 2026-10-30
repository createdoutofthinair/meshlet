import test from 'node:test';
import assert from 'node:assert/strict';
import {PlanetRenderer} from '../src/planet/renderer.js';

// Exercise the real page controller with a deterministic stand-in for the
// GPU. Actual shader execution remains covered by the browser GPU smoke test.
class MockElement extends EventTarget {
 constructor(id=''){
  super();this.id=id;this.value='';this.textContent='';this.innerHTML='orbit hint';this.hidden=false;this.disabled=false;this.dataset={};
  this.checked=false;this.attributes={};this.style={};this.clientWidth=500;this.clientHeight=150;
  const classes=new Set(),classList={add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)};
  this.classList=classList;this.parentElement={classList};
 }
 focus(){} closest(){return null;} setPointerCapture(){} querySelectorAll(){return [];} setAttribute(key,value){this.attributes[key]=value;} click(){this.dispatchEvent(new Event('click'));}
 getContext(){return {setTransform(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){},setLineDash(){}};}
}
class MockDocument extends EventTarget {
 constructor(){super();this.elements=new Map();this.created=[];this.hidden=false;this.pointerLockElement=null;}
 getElementById(id){if(!this.elements.has(id))this.elements.set(id,new MockElement(id));return this.elements.get(id);}
 createElement(tag){const element=new MockElement(tag);this.created.push(element);return element;}
 exitPointerLock(){this.pointerLockElement=null;}
}
const doc=new MockDocument();globalThis.document=doc;globalThis.Element=MockElement;globalThis.window=new EventTarget();
globalThis.location={href:'https://example.test/planet.html',search:''};globalThis.history={replaceState(){}};
let animation;globalThis.requestAnimationFrame=callback=>{animation=callback;};
const cameraState={longitude:0,latitude:0,altitude:14000,surfaceHeight:0,mode:'orbit',heading:0,pitch:.3};
const renderer={cameraState,adapter:{info:{}},timing:false,seed:918273,relief:1,valleys:1,erosion:1,regional:true,rivers:true,ocean:true,budget:384,generation:0,lastSelection:1,
 stats:{visiblePatches:1,deepest:20,leaves:1,generated:1,selectionMs:0},latest:{visibleMeshlets:1,gpuComputeMs:null,gpuRenderMs:null},
 invalidateTerrain(){this.generation++;},frame(){return 1;},
 async sampleTerrain(direction){return direction?new Float32Array([...direction,1]):new Float32Array([1,0,0,1]);},
 async sampleRenderedSurface(){return 1;}};
PlanetRenderer.create=async()=>renderer;
doc.getElementById('seed').value='918273';doc.getElementById('error').hidden=true;doc.getElementById('planet-inspector').hidden=true;doc.getElementById('inspect-color').value='none';doc.getElementById('inspect-opacity').value='75';doc.getElementById('inspect-metric').value='frame';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const tick=async time=>{const callback=animation;assert.ok(callback);callback(time);await flush();};
const key=(type,code)=>{const event=new Event(type,{cancelable:true});Object.defineProperty(event,'code',{value:code});doc.dispatchEvent(event);};
await import('../src/planet/app.js');await flush();

test('page lands, walks, responds to terrain changes and returns to orbit',async()=>{
 doc.getElementById('walk').dispatchEvent(new Event('click'));await flush();
 assert.equal(cameraState.mode,'walk');assert.equal(doc.getElementById('altitude-range').disabled,true);
 assert.equal(renderer.budget,384,'walking keeps the selected patch budget');
 assert.equal(doc.getElementById('walk-controls').hidden,false);
 await tick(100);key('keydown','KeyW');await tick(200);await tick(300);await tick(410);
 assert.ok(cameraState.latitude>0,'W moves the camera north');
 key('keyup','KeyW');await tick(420);
 doc.getElementById('seed').value='42';doc.getElementById('seed-form').dispatchEvent(new Event('submit',{cancelable:true}));await flush();
 assert.equal(renderer.seed,42);assert.equal(doc.getElementById('river-link').href,'./river.html?seed=42');assert.equal(cameraState.mode,'walk','walk mode relands after a new seed');
 doc.getElementById('orbit').dispatchEvent(new Event('click'));
 assert.equal(cameraState.mode,'orbit');assert.equal(cameraState.altitude,14000);
 assert.equal(renderer.budget,384);
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

test('a patch budget chosen while walking remains selected after returning to orbit',async()=>{
 renderer.sampleTerrain=async direction=>new Float32Array([...(direction||[1,0,0]),1]);
 doc.getElementById('walk').dispatchEvent(new Event('click'));await flush();
 doc.getElementById('quality').value='240';doc.getElementById('quality').dispatchEvent(new Event('change'));
 assert.equal(renderer.budget,240);doc.getElementById('orbit').dispatchEvent(new Event('click'));assert.equal(renderer.budget,240);
});

test('inspector opens, controls real renderer overlays and can pause its graph',async()=>{
 const element=id=>doc.getElementById(id),change=id=>element(id).dispatchEvent(new Event('change'));
 element('inspect-open').dispatchEvent(new Event('click'));assert.equal(element('planet-inspector').hidden,false);assert.equal(element('inspect-open').attributes['aria-expanded'],'true');
 element('inspect-color').value='lod';change('inspect-color');assert.equal(renderer.lodColors,true);assert.equal(renderer.patchColors,false);
 element('inspect-color').value='meshlet';change('inspect-color');assert.equal(renderer.meshletColors,true);assert.equal(renderer.lodColors,false);
 element('inspect-patch-lines').checked=true;change('inspect-patch-lines');element('inspect-meshlet-lines').checked=true;change('inspect-meshlet-lines');
 assert.equal(renderer.patchLines,true);assert.equal(renderer.meshletLines,true);
 element('inspect-opacity').value='40';element('inspect-opacity').dispatchEvent(new Event('input'));assert.equal(renderer.debugOpacity,.4);
 element('inspect-pause').dispatchEvent(new Event('click'));assert.equal(element('inspect-pause').textContent,'RESUME');
 element('inspect-pause').dispatchEvent(new Event('click'));assert.equal(element('inspect-pause').textContent,'PAUSE');
 element('inspect-export').dispatchEvent(new Event('click'));const link=doc.created.at(-1),exported=await (await fetch(link.href)).json();
 assert.equal(link.download,'planet-inspector.json');assert.equal(exported.settings.colorOverlay,'meshlet');assert.equal(exported.settings.meshletLines,true);assert.ok(exported.samples.length>0);
 element('inspect-close').dispatchEvent(new Event('click'));assert.equal(element('planet-inspector').hidden,true);assert.equal(element('inspect-open').attributes['aria-expanded'],'false');
 assert.equal(renderer.meshletColors,true,'closing the window leaves the chosen overlay visible');
});

test('tabs expose their panels and atmosphere and cloud sliders update the renderer',()=>{
 const element=id=>doc.getElementById(id);
 element('tab-atmosphere').click();assert.equal(element('panel-atmosphere').hidden,false);assert.equal(element('panel-world').hidden,true);assert.equal(element('tab-atmosphere').attributes['aria-selected'],'true');
 element('sun-elevation').value='-8';element('sun-elevation').dispatchEvent(new Event('input'));assert.equal(renderer.sunElevation,-8);assert.equal(renderer.followSun,false);assert.equal(element('sun-elevation-value').textContent,'-8°');
 element('mie-strength').value='175';element('mie-strength').dispatchEvent(new Event('input'));assert.equal(renderer.mieStrength,1.75);
 element('tab-clouds').click();element('cloud-coverage').value='36';element('cloud-coverage').dispatchEvent(new Event('input'));assert.equal(renderer.cloudCoverage,.36);
 element('cloud-density').value='135';element('cloud-density').dispatchEvent(new Event('input'));assert.equal(renderer.cloudDensity,1.35);
 element('cloud-enabled').checked=false;element('cloud-enabled').dispatchEvent(new Event('change'));assert.equal(renderer.clouds,false);
 element('cloud-quality').value='.5';element('cloud-quality').dispatchEvent(new Event('change'));assert.equal(renderer.cloudQuality,.5);
});

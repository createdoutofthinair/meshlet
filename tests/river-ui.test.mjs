import test from 'node:test';
import assert from 'node:assert/strict';
import {RiverRenderer} from '../src/river/renderer.js';
class Element extends EventTarget {
 constructor(){super();this.value='';this.hidden=false;this.checked=false;this.disabled=false;this.textContent='';}
 focus(){} setPointerCapture(){}
}
class Document extends EventTarget {
 constructor(){super();this.nodes=new Map();this.hidden=false;}
 getElementById(id){if(!this.nodes.has(id))this.nodes.set(id,new Element());return this.nodes.get(id);}
}
const document=new Document();globalThis.document=document;globalThis.window=new EventTarget();globalThis.location={href:'https://example.test/river.html',search:''};globalThis.history={replaceState(){}};
let animate;globalThis.requestAnimationFrame=fn=>{animate=fn;};
const meta={start:12,end:23,halfWidth:100,slope:.002,discharge:8,segmentLength:50000},renderer={adapter:{info:{}},seed:918273,variant:0,busy:false,width:1,metadata:meta,camera:{},frame(){return true;},async regenerate(seed,variant){this.seed=seed;this.variant=variant;return meta;}};
RiverRenderer.create=async()=>renderer;document.getElementById('seed').value='918273';document.getElementById('error').hidden=true;
const flush=()=>new Promise(resolve=>setImmediate(resolve));await import('../src/river/app.js');await flush();
test('river page selects reaches and applies controls to the GPU renderer',async()=>{
 const e=id=>document.getElementById(id);assert.equal(e('reach-overlay').textContent,'REACH 12 → 23');assert.equal(e('width-stat').textContent,'200 m');assert.ok(animate);
 e('channel').value='150';e('channel').dispatchEvent(new Event('input'));assert.equal(renderer.width,1.5);assert.equal(renderer.dirty,true);assert.equal(e('width-stat').textContent,'300 m');
 e('speed').value='175';e('speed').dispatchEvent(new Event('input'));assert.equal(renderer.speed,1.75);
 e('reflection-quality').value='1';e('reflection-quality').dispatchEvent(new Event('change'));assert.equal(renderer.reflectionScale,1);
 e('flow-arrows').checked=true;e('flow-arrows').dispatchEvent(new Event('change'));assert.equal(renderer.showFlow,true);
 e('paused').checked=true;e('paused').dispatchEvent(new Event('change'));assert.equal(renderer.paused,true);
 e('next-reach').dispatchEvent(new Event('click'));await flush();assert.equal(renderer.variant,1);
 e('seed').value='42';e('seed-form').dispatchEvent(new Event('submit',{cancelable:true}));await flush();assert.equal(renderer.seed,42);assert.equal(renderer.variant,0);assert.equal(e('planet-link').href,'./planet.html?seed=42');
});

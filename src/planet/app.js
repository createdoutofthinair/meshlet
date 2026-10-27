import {PlanetRenderer} from './renderer.js';
const $=id=>document.getElementById(id);
const ids=['view','loading','loading-title','loading-detail','error','error-message','device-status','altitude-overlay','generation-status','seed-form','seed','random','orbit','highlands','mode','altitude','altitude-range','relief','relief-value','ocean','sun-follow','quality','render-scale','culling','lod-colors','patch-lines','wireframe','fps','frame-ms','patches','depth','meshlets','triangles','selection-ms','compute-label','compute-ms','render-ms','timing-note'];
const el=Object.fromEntries(ids.map(id=>[id,$(id)]));
const MIN_ALT=.03,MAX_ALT=30000;
const fmt=n=>Math.round(n).toLocaleString('en-US');
const ms=n=>n==null?'Unavailable':`${n.toFixed(2)} ms`;
const altitudeText=km=>km>=1000?`${Math.round(km).toLocaleString('en-US')} km`:km>=1?`${km.toFixed(km<10?1:0)} km`:`${Math.round(km*1000)} m`;
const fromSlider=x=>MIN_ALT*Math.pow(MAX_ALT/MIN_ALT,Number(x)/1000);
const toSlider=x=>Math.round(1000*Math.log(x/MIN_ALT)/Math.log(MAX_ALT/MIN_ALT));
function seedNumber(value){
 if(/^\d+$/.test(value)){const n=Number(value);if(Number.isSafeInteger(n))return n>>>0;}
 let h=2166136261;for(const byte of new TextEncoder().encode(value)){h^=byte;h=Math.imul(h,16777619);}return h>>>0;
}
let renderer,previous=0,frames=[],cpuFrames=[],ready=false,findBusy=false;
function loading(show,title='Creating your world',detail='Generating terrain on the GPU'){el.loading.hidden=!show;el['loading-title'].textContent=title;el['loading-detail'].textContent=detail;}
function fail(message){loading(false);el.error.hidden=false;el['error-message'].textContent=message;el['device-status'].textContent='ENGINE ERROR';console.error(message);}
function setAltitude(km){
 if(!renderer)return;const next=Math.max(MIN_ALT,Math.min(MAX_ALT,km));
 if(renderer.cameraState.altitude>=50 && next<50){renderer.cameraState.surfaceHeight=10;renderer.lastProbeKey='';}
 if(next>=50)renderer.cameraState.surfaceHeight=0;
 renderer.cameraState.altitude=next;renderer.needsSelection=true;
 el['altitude-range'].value=String(toSlider(next));el.altitude.textContent=altitudeText(next);el['altitude-overlay'].textContent=altitudeText(next);
}
function setMode(mode){
 if(!renderer)return;
 renderer.cameraState.mode=mode;el.mode.value=mode;
 if(mode==='flyover'&&renderer.cameraState.altitude>40)setAltitude(15);
 renderer.needsSelection=true;
}
function setSeed(value){
 if(!renderer)return;
 const seed=value.trim()||'0';el.seed.value=seed;renderer.seed=seedNumber(seed);renderer.invalidateTerrain();ready=false;
 const url=new URL(location.href);url.searchParams.set('seed',seed);history.replaceState(null,'',url);
 loading(true,'Creating your world','Generating the seeded terrain on the GPU');
}
function updateTelemetry(){
 if(!renderer)return;const s=renderer.stats,t=renderer.latest;
 el.patches.textContent=fmt(s.visiblePatches);el.depth.textContent=`0–${s.deepest}`;
 if(t.visibleMeshlets!=null){el.meshlets.textContent=`${fmt(t.visibleMeshlets)} / ${fmt(s.visiblePatches*16)}`;el.triangles.textContent=fmt(t.visibleMeshlets*32);}
 el['selection-ms'].textContent=ms(s.selectionMs);el['compute-label'].textContent=t.generatedPatchesSample?'GPU generation + cull':'GPU visibility';el['compute-ms'].textContent=ms(t.gpuComputeMs);el['render-ms'].textContent=ms(t.gpuRenderMs);
 el['generation-status'].textContent=`${fmt(s.leaves)} QUADTREE LEAVES · ${fmt(s.generated)} PATCHES LAST GENERATED`;
 if(frames.length){const avg=frames.reduce((a,b)=>a+b,0)/frames.length;el.fps.textContent=(1000/avg).toFixed(1);el['frame-ms'].textContent=avg.toFixed(1);}
}
function frame(now){
 requestAnimationFrame(frame);if(!renderer||!el.error.hidden||document.hidden){previous=0;return;}
 try{
  const cpu=renderer.frame(now);
  if(cpu!=null){const delta=previous?now-previous:0;previous=now;if(delta>0&&delta<5000){frames.push(delta);if(frames.length>60)frames.shift();}cpuFrames.push(cpu);if(cpuFrames.length>60)cpuFrames.shift();}
  if(!ready&&renderer.latest.visibleMeshlets!=null){ready=true;loading(false);}
  updateTelemetry();
 }catch(error){fail(error.message);}
}
async function start(){
 const params=new URLSearchParams(location.search);if(params.has('seed'))el.seed.value=params.get('seed').slice(0,64);
 try{
  renderer=await PlanetRenderer.create(el.view,fail);renderer.seed=seedNumber(el.seed.value);renderer.invalidateTerrain();
  const info=renderer.adapter.info;const device=[info?.vendor,info?.architecture,info?.description].filter(Boolean).join(' · ');
  el['device-status'].textContent=device?`WEBGPU / ${device.toUpperCase()}`:'WEBGPU READY';
  el['timing-note'].textContent=renderer.timing?'GPU timings are asynchronous; terrain generation runs when patches change.':'GPU timestamps are unavailable on this adapter.';
  setAltitude(renderer.cameraState.altitude);requestAnimationFrame(frame);
 }catch(error){fail(error.message);}
}
el['seed-form'].addEventListener('submit',e=>{e.preventDefault();setSeed(el.seed.value);});
el.random.addEventListener('click',()=>{const value=new Uint32Array(1);crypto.getRandomValues(value);setSeed(String(value[0]));});
el.orbit.addEventListener('click',()=>{if(!renderer)return;renderer.cameraState.surfaceHeight=0;setMode('orbit');setAltitude(14000);});
el.highlands.addEventListener('click',async()=>{
 if(!renderer||findBusy)return;findBusy=true;el.highlands.disabled=true;el.highlands.textContent='SEARCHING GPU…';
 try{
  const point=await renderer.findHighlands();if(!point)return;
  const d=point.direction;renderer.cameraState.longitude=Math.atan2(d[2],d[0]);renderer.cameraState.latitude=Math.asin(Math.max(-1,Math.min(1,d[1])));
  renderer.cameraState.mode='flyover';renderer.cameraState.heading=.45;renderer.cameraState.pitch=.08;renderer.cameraState.surfaceHeight=renderer.ocean?Math.max(0,point.height):point.height;
  el.mode.value='flyover';renderer.lastProbeKey='';setAltitude(.3);renderer.needsSelection=true;
 }catch(error){fail(error.message);}finally{findBusy=false;el.highlands.disabled=false;el.highlands.textContent='FIND HIGHLANDS ↗';}
});
el.mode.addEventListener('change',()=>setMode(el.mode.value));
el['altitude-range'].addEventListener('input',()=>setAltitude(fromSlider(el['altitude-range'].value)));
el.relief.addEventListener('input',()=>{const value=Number(el.relief.value)/100;el['relief-value'].textContent=`${value.toFixed(2)}×`;});
el.relief.addEventListener('change',()=>{if(!renderer)return;renderer.relief=Number(el.relief.value)/100;renderer.invalidateTerrain();ready=false;loading(true,'Updating relief');});
el.ocean.addEventListener('change',()=>{if(!renderer)return;renderer.ocean=el.ocean.checked;renderer.invalidateTerrain();ready=false;loading(true,'Updating the surface');});
el['sun-follow'].addEventListener('change',()=>{if(renderer)renderer.followSun=el['sun-follow'].checked;});
el.quality.addEventListener('change',()=>{if(renderer){renderer.budget=Number(el.quality.value);renderer.needsSelection=true;}});
el['render-scale'].addEventListener('change',()=>{if(renderer){renderer.resolution=Number(el['render-scale'].value);renderer.needsSelection=true;}});
for(const [id,key] of [['culling','culling'],['lod-colors','lodColors'],['patch-lines','patchLines'],['wireframe','wireframe']])el[id].addEventListener('change',()=>{if(renderer)renderer[key]=el[id].checked;});
let drag=null;
el.view.addEventListener('pointerdown',event=>{if(!renderer)return;drag={x:event.clientX,y:event.clientY,look:event.shiftKey};el.view.setPointerCapture(event.pointerId);});
el.view.addEventListener('pointermove',event=>{
 if(!drag||!renderer)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y,cam=renderer.cameraState;
 if(drag.look&&cam.mode==='flyover'){cam.heading-=dx*.006;cam.pitch=Math.max(.01,Math.min(1.3,cam.pitch+dy*.005));}
 else {const scale=Math.max(.002,Math.min(1,Math.sqrt((cam.altitude+Math.max(0,cam.surfaceHeight))/6371)));cam.longitude-=dx*.005*scale;cam.latitude=Math.max(-1.5,Math.min(1.5,cam.latitude+dy*.005*scale));}
 renderer.needsSelection=true;drag={x:event.clientX,y:event.clientY,look:drag.look};
});
el.view.addEventListener('pointerup',()=>{drag=null;});el.view.addEventListener('pointercancel',()=>{drag=null;});
el.view.addEventListener('wheel',event=>{if(!renderer)return;event.preventDefault();setAltitude(renderer.cameraState.altitude*Math.exp(event.deltaY*.001));},{passive:false});
document.addEventListener('visibilitychange',()=>{previous=0;});
start();

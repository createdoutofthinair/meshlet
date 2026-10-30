import {PlanetRenderer} from './renderer.js';
import {SurfaceWalker,WALK_EYE_HEIGHT_KM,directionFromCamera,setCameraDirection,walkStep} from './walk.js';
import {PlanetInspector} from './inspector.js';
const $=id=>document.getElementById(id);
const ids=['view','loading','loading-title','loading-detail','error','error-message','device-status','altitude-overlay','clearance-label','clearance-note','planet-hint','walk-controls','flight-controls','flight-settings','flight-speed','flight-speed-value','fly','walk','walk-help','generation-status','seed-form','seed','river-link','random','orbit','highlands','find-valleys','find-rivers','mode','altitude','altitude-range','relief','relief-value','valleys','valleys-value','erosion','erosion-value','rivers','regional','biomes','ocean','sun-follow','quality','render-scale','culling','fps','frame-ms','patches','depth','meshlets','triangles','selection-ms','compute-label','compute-ms','render-ms','transition-error','transition-status','timing-note'];
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
let renderer,walker,previous=0,frames=[],cpuFrames=[],ready=false,findBusy=false,walkEpoch=0,walkLanding=false;
const inspector=new PlanetInspector(()=>renderer);
const keys=new Set(),touchWalk=new Set(),touchFlight=new Set(),orbitHint=el['planet-hint'].innerHTML;
const inputForWalk=()=>({forward:Number(keys.has('KeyW')||keys.has('ArrowUp')||(touchWalk.has('forward')||touchFlight.has('forward')))-Number(keys.has('KeyS')||keys.has('ArrowDown')||(touchWalk.has('back')||touchFlight.has('back'))),strafe:Number(keys.has('KeyD')||keys.has('ArrowRight')||(touchWalk.has('right')||touchFlight.has('right')))-Number(keys.has('KeyA')||keys.has('ArrowLeft')||(touchWalk.has('left')||touchFlight.has('left'))),fast:keys.has('ShiftLeft')||keys.has('ShiftRight')});
function loading(show,title='Creating your world',detail='Generating terrain on the GPU'){el.loading.hidden=!show;el['loading-title'].textContent=title;el['loading-detail'].textContent=detail;}
function fail(message){loading(false);el.error.hidden=false;el['error-message'].textContent=message;el['device-status'].textContent='ENGINE ERROR';console.error(message);}
function setAltitude(km){
 if(!renderer||renderer.cameraState.mode==='walk')return;const next=Math.max(MIN_ALT,Math.min(MAX_ALT,km));
 if(renderer.cameraState.altitude>=50 && next<50){renderer.cameraState.surfaceHeight=10;renderer.lastProbeKey='';}
 if(next>=50)renderer.cameraState.surfaceHeight=0;
 renderer.cameraState.altitude=next;renderer.needsSelection=true;
 el['altitude-range'].value=String(toSlider(next));el.altitude.textContent=altitudeText(next);el['altitude-overlay'].textContent=altitudeText(next);
}
function leaveWalk(){
 walkEpoch++;walkLanding=false;walker?.stop();keys.clear();touchWalk.clear();touchFlight.clear();flightGeneration++;
 if(document.pointerLockElement===el.view)document.exitPointerLock();
 el.view.parentElement.classList.remove('walking');el['walk-controls'].hidden=true;el['flight-controls'].hidden=true;el['flight-settings'].hidden=true;el['walk-help'].hidden=true;el.walk.disabled=false;el.walk.textContent='WALK ON SURFACE';
 el['altitude-range'].disabled=false;el['clearance-label'].textContent='CAMERA CLEARANCE';el['clearance-note'].textContent='above sampled surface near ground';el['planet-hint'].innerHTML=orbitHint;
}
async function enterWalk({touchdown=false}={}){
 if(!renderer||walkLanding||renderer.cameraState.mode==='walk')return;
 leaveWalk();const epoch=++walkEpoch;walkLanding=true;el.mode.value='walk';el.walk.disabled=true;el.walk.textContent='FINDING GROUND…';
 el['walk-help'].hidden=false;el['walk-help'].textContent='Finding a landing place and preparing surface detail…';
 try{
  const camera=renderer.cameraState,direction=directionFromCamera(camera);let point;
  // A change of seed or regional cache during the readback requires a fresh
  // sample. All movement is held until the rendered mesh can be sampled too.
  for(;;){
   const generation=renderer.generation,data=await renderer.sampleTerrain(direction);
   if(epoch!==walkEpoch)return;
   if(generation!==renderer.generation)continue;
   point={direction,height:data[3]};
   if(touchdown){
    const rendered=await renderer.sampleRenderedSurface(direction);if(epoch!==walkEpoch)return;
    if(rendered==null||(renderer.ocean&&rendered<=0)){el.mode.value=camera.mode;el['walk-help'].textContent='Waiting for walkable terrain at this location.';return;}
    point.height=rendered;
   }
   if(!touchdown&&renderer.ocean&&point.height<=.03){
    const candidates=await renderer.sampleTerrain();if(epoch!==walkEpoch)return;
    if(generation!==renderer.generation)continue;
    let best=-Infinity,index=-1;
    for(let i=0;i<candidates.length;i+=4){
     if(candidates[i+3]<=.05)continue;
     const score=direction[0]*candidates[i]+direction[1]*candidates[i+1]+direction[2]*candidates[i+2];
     if(score>best){best=score;index=i;}
    }
    if(index<0){el.mode.value=camera.mode;el['walk-help'].textContent='No dry landing place was found. Try another seed or turn off the flat ocean.';return;}
    point={direction:[candidates[index],candidates[index+1],candidates[index+2]],height:candidates[index+3]};
   }
   break;
  }
  setCameraDirection(camera,point.direction);camera.surfaceHeight=point.height;camera.altitude=WALK_EYE_HEIGHT_KM;
  if(camera.mode!=='flyover'&&camera.mode!=='flight')camera.pitch=.08;
  camera.pitch=Math.max(-1.35,Math.min(1.35,camera.pitch));camera.mode='walk';renderer.lastProbeKey='';renderer.lastSelection=-Infinity;renderer.needsSelection=true;
  walker.start();el.view.parentElement.classList.add('walking');el['walk-controls'].hidden=false;
  el['altitude-range'].disabled=true;el.altitude.textContent='1.7 m';el['altitude-overlay'].textContent='1.7 m';
  el['clearance-label'].textContent='EYE HEIGHT';el['clearance-note'].textContent='above the rendered surface';
  el['planet-hint'].textContent='WASD / ARROWS TO WALK  ·  SHIFT TO MOVE FASTER  ·  CLICK OR DRAG TO LOOK  ·  ESC RELEASES MOUSE';
  el['walk-help'].textContent='WASD or arrow keys to walk; hold Shift to move faster. Click the view to look around, or drag on touch. Esc releases the mouse. Choose Orbit to leave.';
 }catch(error){if(epoch===walkEpoch)fail(`Landing: ${error.message}`);}
 finally{if(epoch===walkEpoch){walkLanding=false;el.walk.disabled=false;el.walk.textContent='WALK ON SURFACE';}}
}
function setMode(mode){
 if(!renderer)return;
 if(mode==='walk'){enterWalk();return;}
 const previousMode=renderer.cameraState.mode;
 leaveWalk();
 if(mode==='flight'&&previousMode==='orbit')renderer.cameraState.pitch=1.48;
 renderer.cameraState.mode=mode;el.mode.value=mode;
 if(renderer.cameraState.altitude<MIN_ALT)setAltitude(MIN_ALT);
 if(mode==='flyover'&&renderer.cameraState.altitude>40)setAltitude(15);
 if(mode==='flight'){el.view.focus({preventScroll:true});el['flight-controls'].hidden=false;el['flight-settings'].hidden=false;el['planet-hint'].textContent='W/S FLY FORWARD / BACK · A/D STRAFE · Q/E DESCEND / ASCEND · SHIFT BOOST · DRAG TO LOOK';el['walk-help'].hidden=false;el['walk-help'].textContent='From orbit, hold W to fly toward the planet. Click the view if keyboard input is not active. Q descends, E ascends; drag or click to look. Landing on dry terrain enters walk mode.';}
 renderer.needsSelection=true;
}
function rebuildTerrain(title){
 const returnToWalk=renderer.cameraState.mode==='walk'||walkLanding;
 if(returnToWalk)setMode('flyover');
 renderer.invalidateTerrain();ready=false;loading(true,title);
 if(returnToWalk)enterWalk();
}
function setSeed(value){
 if(!renderer)return;
 const seed=value.trim()||'0';el.seed.value=seed;renderer.seed=seedNumber(seed);rebuildTerrain('Creating your world');
 el['river-link'].href=`./river.html?seed=${encodeURIComponent(seed)}`;
 const url=new URL(location.href);url.searchParams.set('seed',seed);history.replaceState(null,'',url);
}
function updateTelemetry(){
 if(!renderer)return;const s=renderer.stats,t=renderer.latest;
 el.patches.textContent=fmt(s.visiblePatches);el.depth.textContent=`0–${s.deepest}`;
 if(t.visibleMeshlets!=null){el.meshlets.textContent=`${fmt(t.visibleMeshlets)} / ${fmt(s.visiblePatches*16)}`;el.triangles.textContent=fmt(t.visibleMeshlets*32);}
 el['selection-ms'].textContent=ms(s.selectionMs);el['compute-label'].textContent=t.generatedPatchesSample?'GPU generation + cull':'GPU visibility';el['compute-ms'].textContent=ms(t.gpuComputeMs);el['render-ms'].textContent=ms(t.gpuRenderMs);
 const transition=renderer.transition;if(transition){
  el['transition-error'].textContent=transition.pixels==null?'—':`${transition.pixels.toFixed(2)} px${transition.overTarget?' · ABOVE TARGET':''}`;
  el['transition-status'].textContent=transition.waiting?'HOLDING DETAIL':renderer.stage?.state==='measuring'?'MEASURING':renderer.stage?`${transition.pending} PATCHES PENDING`:'READY';
 }
 el['generation-status'].textContent=`${fmt(s.leaves)} QUADTREE LEAVES · ${fmt(s.generated)} PATCHES LAST GENERATED`;
 if(frames.length){const avg=frames.reduce((a,b)=>a+b,0)/frames.length;el.fps.textContent=(1000/avg).toFixed(1);el['frame-ms'].textContent=avg.toFixed(1);}
}
let flightTime=0,flightProbe=false,flightGeneration=0;
function advanceFlight(now){
 const camera=renderer?.cameraState;if(!camera||camera.mode!=='flight'){flightTime=0;flightGeneration++;return;}
 const dt=flightTime?Math.min(.05,(now-flightTime)/1000):0;flightTime=now;
 if(walkLanding||flightProbe)return;
 const input=inputForWalk(),vertical=Number(keys.has('KeyE')||touchFlight.has('up'))-Number(keys.has('KeyQ')||touchFlight.has('down'));
 if(!input.forward&&!input.strafe&&!vertical)return;
 // Speed adapts continuously to clearance, permitting both orbital travel and a controlled approach.
 const surfaceSpeed=Math.max(.005,Math.min(.2,(Number(el['flight-speed'].value)||20)/1000));
 const altitude=Math.max(0,camera.altitude),altitudeBlend=Math.max(0,Math.min(1,(altitude-.1)/1.9));
 const speed=Math.max(surfaceSpeed,Math.min(1800,altitude*.5*altitudeBlend))*(input.fast?3:1);
 const travel=speed*dt,dir=directionFromCamera(camera);
 const tangentForward=input.forward*Math.cos(camera.pitch);
 const next=walkStep(dir,camera.heading,tangentForward,input.strafe,travel*Math.min(1,Math.hypot(tangentForward,input.strafe)));
 const absolute=camera.altitude+camera.surfaceHeight+travel*(vertical-input.forward*Math.sin(camera.pitch));
 // Near the surface, wait for the GPU's rendered mesh before committing motion.
 if(absolute<12){
  flightProbe=true;const epoch=flightGeneration,generation=renderer.generation;
  renderer.sampleTerrain(next).then(async data=>{
   if(epoch!==flightGeneration||camera.mode!=='flight'||generation!==renderer.generation)return;
   const terrain=data[3],floor=renderer.ocean?Math.max(0,terrain):terrain;
   let rendered=null;if(absolute-floor<.08)rendered=await renderer.sampleRenderedSurface(next);
   if(epoch!==flightGeneration||camera.mode!=='flight'||generation!==renderer.generation)return;
   const safeFloor=rendered==null?floor:renderer.ocean?Math.max(0,rendered):rendered;
   setCameraDirection(camera,next);camera.surfaceHeight=safeFloor;camera.altitude=Math.max(WALK_EYE_HEIGHT_KM,absolute-safeFloor);renderer.needsSelection=true;
   if(absolute-safeFloor<=WALK_EYE_HEIGHT_KM&&rendered!=null&&(!renderer.ocean||rendered>0))enterWalk({touchdown:true});
  }).catch(error=>fail(`Flight terrain probe: ${error.message}`)).finally(()=>{flightProbe=false;});
 }else{setCameraDirection(camera,next);camera.surfaceHeight=0;camera.altitude=Math.min(MAX_ALT,absolute);renderer.needsSelection=true;}
 el.altitude.textContent=altitudeText(camera.altitude);el['altitude-overlay'].textContent=altitudeText(camera.altitude);el['altitude-range'].value=String(toSlider(Math.max(MIN_ALT,camera.altitude)));
}
function frame(now){
 requestAnimationFrame(frame);if(!renderer||!el.error.hidden||document.hidden){previous=0;return;}
 try{
  advanceFlight(now);walker?.advance(now);
  const cpu=renderer.frame(now);
  if(cpu!=null)walker?.afterFrame();
  if(cpu!=null){const delta=previous?now-previous:0;previous=now;if(delta>0&&delta<5000){frames.push(delta);if(frames.length>60)frames.shift();}cpuFrames.push(cpu);if(cpuFrames.length>60)cpuFrames.shift();inspector.record(now,delta,cpu);}
  if(!ready&&renderer.latest.visibleMeshlets!=null){ready=true;loading(false);}
  updateTelemetry();
 }catch(error){fail(error.message);}
}
async function start(){
 const params=new URLSearchParams(location.search);if(params.has('seed'))el.seed.value=params.get('seed').slice(0,64);el['river-link'].href=`./river.html?seed=${encodeURIComponent(el.seed.value.trim()||'0')}`;
 try{
  renderer=await PlanetRenderer.create(el.view,fail);renderer.seed=seedNumber(el.seed.value);renderer.invalidateTerrain();
  walker=new SurfaceWalker(renderer,inputForWalk,error=>fail(`Walking surface probe: ${error.message}`));
  const info=renderer.adapter.info;const device=[info?.vendor,info?.architecture,info?.description].filter(Boolean).join(' · ');
  el['device-status'].textContent=device?`WEBGPU / ${device.toUpperCase()}`:'WEBGPU READY';
  el['timing-note'].textContent=renderer.timing?'GPU rendering includes terrain, ocean and clouds; terrain generation runs when patches change.':'GPU timestamps are unavailable on this adapter.';
  setAltitude(renderer.cameraState.altitude);requestAnimationFrame(frame);
 }catch(error){fail(error.message);}
}
el['seed-form'].addEventListener('submit',e=>{e.preventDefault();setSeed(el.seed.value);});
el.random.addEventListener('click',()=>{const value=new Uint32Array(1);crypto.getRandomValues(value);setSeed(String(value[0]));});
el.orbit.addEventListener('click',()=>{if(!renderer)return;renderer.cameraState.surfaceHeight=0;setMode('orbit');setAltitude(14000);});
el.walk.addEventListener('click',()=>enterWalk());
el.fly.addEventListener('click',()=>setMode('flight'));
el['flight-speed'].addEventListener('input',()=>{el['flight-speed-value'].textContent=`${el['flight-speed'].value} m/s`;});
el.highlands.addEventListener('click',async()=>{
 if(!renderer||findBusy)return;setMode('flyover');findBusy=true;el.highlands.disabled=true;el.highlands.textContent='SEARCHING…';
 try{
  const point=await renderer.findHighlands();if(!point)return;
  const d=point.direction;renderer.cameraState.longitude=Math.atan2(d[2],d[0]);renderer.cameraState.latitude=Math.asin(Math.max(-1,Math.min(1,d[1])));
  renderer.cameraState.mode='flyover';renderer.cameraState.heading=.45;renderer.cameraState.pitch=.08;
  el.mode.value='flyover';renderer.lastProbeKey='';setAltitude(.3);renderer.cameraState.surfaceHeight=renderer.ocean?Math.max(0,point.height):point.height;renderer.needsSelection=true;
 }catch(error){fail(error.message);}finally{findBusy=false;el.highlands.disabled=false;el.highlands.textContent='HIGHLANDS';}
});
el['find-valleys'].addEventListener('click',async()=>{
 if(!renderer||findBusy)return;setMode('orbit');findBusy=true;el['find-valleys'].disabled=true;el['find-valleys'].textContent='SEARCHING…';
 try{
  const point=await renderer.findValleys();if(!point)return;
  const d=point.direction;renderer.cameraState.longitude=Math.atan2(d[2],d[0]);renderer.cameraState.latitude=Math.asin(Math.max(-1,Math.min(1,d[1])));
  renderer.cameraState.mode='orbit';el.mode.value='orbit';setAltitude(4);
  renderer.cameraState.surfaceHeight=renderer.ocean?Math.max(0,point.height):point.height;renderer.lastProbeKey='';renderer.needsSelection=true;
 }catch(error){fail(error.message);}finally{findBusy=false;el['find-valleys'].disabled=false;el['find-valleys'].textContent='VALLEYS';}
});
el['find-rivers'].addEventListener('click',async()=>{
 if(!renderer||findBusy)return;setMode('orbit');findBusy=true;el['find-rivers'].disabled=true;el['find-rivers'].textContent='SEARCHING…';
 try{
  let rebuild=!renderer.rivers;
  if(renderer.erosion===0){renderer.erosion=1;el.erosion.value='100';el['erosion-value'].textContent='1.00×';rebuild=true;}
  renderer.rivers=true;el.rivers.checked=true;if(rebuild){renderer.invalidateTerrain();ready=false;loading(true,'Shaping the world');}
  const point=await renderer.findRivers();if(!point)return;
  const d=point.direction;renderer.cameraState.longitude=Math.atan2(d[2],d[0]);renderer.cameraState.latitude=Math.asin(Math.max(-1,Math.min(1,d[1])));
  renderer.cameraState.mode='orbit';el.mode.value='orbit';setAltitude(25);
  renderer.cameraState.surfaceHeight=renderer.ocean?Math.max(0,point.height):point.height;renderer.lastProbeKey='';renderer.needsSelection=true;
 }catch(error){fail(error.message);}finally{findBusy=false;el['find-rivers'].disabled=false;el['find-rivers'].textContent='RIVERS';}
});
el.mode.addEventListener('change',()=>setMode(el.mode.value));
el['altitude-range'].addEventListener('input',()=>setAltitude(fromSlider(el['altitude-range'].value)));
el.relief.addEventListener('input',()=>{const value=Number(el.relief.value)/100;el['relief-value'].textContent=`${value.toFixed(2)}×`;});
el.relief.addEventListener('change',()=>{if(!renderer)return;renderer.relief=Number(el.relief.value)/100;rebuildTerrain('Updating relief');});
el.valleys.addEventListener('input',()=>{el['valleys-value'].textContent=`${(Number(el.valleys.value)/100).toFixed(2)}×`;});
el.valleys.addEventListener('change',()=>{if(!renderer)return;renderer.valleys=Number(el.valleys.value)/100;rebuildTerrain('Shaping valleys');});
el.erosion.addEventListener('input',()=>{el['erosion-value'].textContent=`${(Number(el.erosion.value)/100).toFixed(2)}×`;});
el.erosion.addEventListener('change',()=>{if(!renderer)return;renderer.erosion=Number(el.erosion.value)/100;rebuildTerrain('Updating erosion');});
el.rivers.addEventListener('change',()=>{if(!renderer)return;renderer.rivers=el.rivers.checked;rebuildTerrain('Updating surface water');});
el.regional.addEventListener('change',()=>{if(!renderer)return;renderer.regional=el.regional.checked;rebuildTerrain('Updating drainage detail');});
el.biomes.addEventListener('change',()=>{if(renderer)renderer.biomes=el.biomes.checked;});
el.ocean.addEventListener('change',()=>{if(!renderer)return;renderer.ocean=el.ocean.checked;rebuildTerrain('Updating the surface');});
el['sun-follow'].addEventListener('change',()=>{if(renderer)renderer.followSun=el['sun-follow'].checked;});
el.quality.addEventListener('change',()=>{if(renderer){renderer.budget=Number(el.quality.value);renderer.needsSelection=true;}});
el['render-scale'].addEventListener('change',()=>{if(renderer){renderer.resolution=Number(el['render-scale'].value);renderer.needsSelection=true;}});
el.culling.addEventListener('change',()=>{if(renderer)renderer.culling=el.culling.checked;});
// Tab panels stay mounted so live settings and keyboard focus are preserved.
const tabNames=['world','atmosphere','clouds','performance'];
function activateTab(name,focus=false){
 for(const item of tabNames){const selected=item===name,tab=$(`tab-${item}`);tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;$(`panel-${item}`).hidden=!selected;if(selected&&focus)tab.focus();}
}
for(const [index,name] of tabNames.entries()){
 const tab=$(`tab-${name}`);tab.addEventListener('click',()=>activateTab(name));
 tab.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=(index+1)%tabNames.length;else if(event.key==='ArrowLeft')next=(index+tabNames.length-1)%tabNames.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabNames.length-1;else return;event.preventDefault();activateTab(tabNames[next],true);});
}
const controls=[
 ['sun-azimuth','sunAzimuth',1,value=>`${value}°`,true],['sun-elevation','sunElevation',1,value=>`${value}°`,true],
 ['sky-strength','skyStrength',.01,value=>`${value.toFixed(2)}×`],['mie-strength','mieStrength',.01,value=>`${value.toFixed(2)}×`],['halo-strength','haloStrength',.01,value=>`${value.toFixed(2)}×`],
 ['cloud-coverage','cloudCoverage',.01,value=>`${Math.round(value*100)}%`],['cloud-density','cloudDensity',.01,value=>`${value.toFixed(2)}×`],['cloud-speed','cloudSpeed',1,value=>`${value} m/s`]
];
for(const [id,property,factor,format,manualSun] of controls){
 $(id).addEventListener('input',()=>{const value=Number($(id).value)*factor;$(`${id}-value`).textContent=format(value);if(!renderer)return;renderer[property]=value;if(manualSun){renderer.followSun=false;el['sun-follow'].checked=false;}});
}
$('cloud-enabled').addEventListener('change',()=>{if(renderer)renderer.clouds=$('cloud-enabled').checked;});
$('cloud-quality').addEventListener('change',()=>{if(renderer)renderer.cloudQuality=Number($('cloud-quality').value);});
let drag=null;
function look(dx,dy){
 const camera=renderer.cameraState;camera.heading-=dx*.004;camera.pitch=Math.max(-1.35,Math.min(1.35,camera.pitch+dy*.004));renderer.needsSelection=true;
}
el.view.addEventListener('pointerdown',event=>{
 if(!renderer)return;el.view.focus({preventScroll:true});drag={x:event.clientX,y:event.clientY,look:event.shiftKey};el.view.setPointerCapture(event.pointerId);
 if(['walk','flight'].includes(renderer.cameraState.mode)&&event.pointerType==='mouse'&&event.button===0&&!document.pointerLockElement&&el.view.requestPointerLock){
  try{const request=el.view.requestPointerLock();request?.catch?.(()=>{});}catch{/* Drag remains available if pointer lock is denied. */}
 }
});
el.view.addEventListener('pointermove',event=>{
 if(!drag||!renderer)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y,cam=renderer.cameraState;
 if(cam.mode==='walk'||cam.mode==='flight'){if(document.pointerLockElement!==el.view)look(dx,dy);}
 else if(drag.look&&cam.mode==='flyover'){cam.heading-=dx*.006;cam.pitch=Math.max(.01,Math.min(1.3,cam.pitch+dy*.005));}
 else {const scale=Math.max(.002,Math.min(1,Math.sqrt((cam.altitude+Math.max(0,cam.surfaceHeight))/6371)));cam.longitude-=dx*.005*scale;cam.latitude=Math.max(-1.5,Math.min(1.5,cam.latitude+dy*.005*scale));}
 renderer.needsSelection=true;drag={x:event.clientX,y:event.clientY,look:drag.look};
});
el.view.addEventListener('pointerup',()=>{drag=null;});el.view.addEventListener('pointercancel',()=>{drag=null;});
document.addEventListener('mousemove',event=>{if(['walk','flight'].includes(renderer?.cameraState.mode)&&document.pointerLockElement===el.view)look(event.movementX,event.movementY);});
el.view.addEventListener('wheel',event=>{if(!renderer)return;event.preventDefault();if(renderer.cameraState.mode!=='walk')setAltitude(renderer.cameraState.altitude*Math.exp(event.deltaY*.001));},{passive:false});
const walkKeys=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight','KeyQ','KeyE']);
document.addEventListener('keydown',event=>{
 if(!['walk','flight'].includes(renderer?.cameraState.mode)||!walkKeys.has(event.code)||event.ctrlKey||event.metaKey||event.altKey)return;
 if(event.target instanceof Element&&event.target.closest('input,select,textarea,button,[contenteditable="true"]'))return;
 event.preventDefault();keys.add(event.code);
});
document.addEventListener('keyup',event=>keys.delete(event.code));
document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement!==el.view){drag=null;keys.clear();}});
for(const button of el['walk-controls'].querySelectorAll('button')){
 const direction=button.dataset.walk;
 button.addEventListener('pointerdown',event=>{event.preventDefault();button.setPointerCapture(event.pointerId);touchWalk.add(direction);});
 for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,()=>touchWalk.delete(direction));
}
for(const button of el['flight-controls'].querySelectorAll('button')){
 const direction=button.dataset.flight;button.addEventListener('pointerdown',event=>{event.preventDefault();button.setPointerCapture(event.pointerId);touchFlight.add(direction);});
 for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,()=>touchFlight.delete(direction));
}
window.addEventListener('blur',()=>{keys.clear();touchWalk.clear();touchFlight.clear();});
document.addEventListener('visibilitychange',()=>{previous=0;keys.clear();touchWalk.clear();touchFlight.clear();});
start();

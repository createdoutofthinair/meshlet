import {RiverRenderer} from './renderer.js';
const $=id=>document.getElementById(id);
const ids=['view','device-status','loading','loading-title','error','error-message','reach-overlay','reach-caption','status','seed-form','seed','planet-link','generate','next-reach','width-stat','slope-stat','flow-stat','nodes-stat','length-stat','fps','speed','clarity','ripples','foam','waterfall','drop','drop-value','spray','spray-value','reflection-quality','channel','depth','bank','roughness','speed-value','clarity-value','ripples-value','foam-value','channel-value','depth-value','bank-value','roughness-value','flow-arrows','paused','view-overview','view-low','view-top'];
const el=Object.fromEntries(ids.map(id=>[id,$(id)]));
let renderer,drag=null,previous=0,lastFps=0,frames=[];
function seedNumber(value){
 if(/^\d+$/.test(value)){const n=Number(value);if(Number.isSafeInteger(n))return n>>>0;}
 let h=2166136261;for(const byte of new TextEncoder().encode(value)){h^=byte;h=Math.imul(h,16777619);}return h>>>0;
}
function error(message){el.loading.hidden=true;el.error.hidden=false;el['error-message'].textContent=message;el['device-status'].textContent='ENGINE ERROR';console.error(message);}
function setBusy(busy,title='Finding a river'){
 el.loading.hidden=!busy;el['loading-title'].textContent=title;el.generate.disabled=busy;el['next-reach'].disabled=busy;
}
function updateMetadata(){
 if(!renderer?.metadata)return;const m=renderer.metadata;
 el['width-stat'].textContent=`${Math.round(Math.max(20,Math.min(280,m.halfWidth*renderer.width))*2)} m`;el['slope-stat'].textContent=`${(m.slope*100).toFixed(2)}%`;
 el['flow-stat'].textContent=m.discharge.toFixed(1);el['nodes-stat'].textContent=`${m.start} → ${m.end}`;el['length-stat'].textContent=`${(m.segmentLength/1000).toFixed(1)} km`;
 el['reach-overlay'].textContent=`REACH ${m.start} → ${m.end}`;el['reach-caption'].textContent='Water travels toward the downstream node';
 el.status.textContent=`SEED ${renderer.seed} · REACH ${renderer.variant+1} · GPU WATER`;
}
async function generate(seed,variant){
 if(!renderer||renderer.busy)return;setBusy(true,seed===renderer.seed?'Finding another reach':'Generating the drainage network');el.error.hidden=true;
 try{const result=await renderer.regenerate(seed,variant);if(!result)return;updateMetadata();const seedText=el.seed.value.trim()||'0';el['planet-link'].href=`./planet.html?seed=${encodeURIComponent(seedText)}`;const url=new URL(location.href);url.searchParams.set('seed',seedText);url.searchParams.set('reach',String(variant));history.replaceState(null,'',url);}
 catch(e){error(e.message);return;}finally{el.generate.disabled=false;el['next-reach'].disabled=false;}
 setBusy(false);
}
function frame(now){
 requestAnimationFrame(frame);if(!renderer||document.hidden||!el.error.hidden){previous=0;if(renderer)renderer.lastTime=0;return;}
 try{
  if(renderer.frame(now)){
   if(previous&&now-previous<5000){frames.push(now-previous);if(frames.length>60)frames.shift();}previous=now;
   if(now-lastFps>500&&frames.length){const average=frames.reduce((sum,x)=>sum+x,0)/frames.length;el.fps.textContent=`${(1000/average).toFixed(1)} fps`;lastFps=now;}
  }
 }catch(e){error(e.message);}
}
async function start(){
 const params=new URLSearchParams(location.search);if(params.has('seed'))el.seed.value=params.get('seed').slice(0,64);
 const parsed=Number(params.get('reach')),variant=Number.isSafeInteger(parsed)&&parsed>=0?parsed:0;
 try{
  renderer=await RiverRenderer.create(el.view,error);const info=renderer.adapter.info,device=[info?.vendor,info?.architecture,info?.description].filter(Boolean).join(' · ');
  el['device-status'].textContent=device?`WEBGPU / ${device.toUpperCase()}`:'WEBGPU READY';
  await generate(seedNumber(el.seed.value.trim()||'0'),variant);requestAnimationFrame(frame);
 }catch(e){error(e.message);}
}
el['seed-form'].addEventListener('submit',event=>{event.preventDefault();generate(seedNumber(el.seed.value.trim()||'0'),0);});
el['next-reach'].addEventListener('click',()=>{if(renderer)generate(renderer.seed,(renderer.variant+1)>>>0);});
const sliders=[
 ['speed','speed',100,'m/s',false],['clarity','clarity',100,'×',false],['ripples','ripples',100,'×',false],['foam','foam',100,'×',false],['spray','spray',100,'×',false],
 ['channel','width',100,'×',true],['depth','depth',10,'m',true],['bank','bank',10,'m',true],['roughness','roughness',100,'×',true],['drop','drop',10,'m',true]
];
for(const [id,key,divisor,unit,geometry] of sliders)el[id].addEventListener('input',()=>{
 const v=Number(el[id].value)/divisor;el[`${id}-value`].textContent=`${v.toFixed(divisor===10?1:2)}${unit==='m/s'||unit==='m'?' ':''}${unit}`;
 if(renderer){renderer[key]=v;if(geometry)renderer.dirty=true;updateMetadata();}
});
el['flow-arrows'].addEventListener('change',()=>{if(renderer)renderer.showFlow=el['flow-arrows'].checked;});
el.waterfall.addEventListener('change',()=>{if(renderer){renderer.waterfall=el.waterfall.checked;renderer.dirty=true;Object.assign(renderer.camera,renderer.waterfall?{yaw:2.8,pitch:.35,distance:270}:{yaw:-.55,pitch:.58,distance:560});}});
el['reflection-quality'].addEventListener('change',()=>{if(renderer)renderer.reflectionScale=el['reflection-quality'].value==='1'?1:.5;});
el.paused.addEventListener('change',()=>{if(renderer)renderer.paused=el.paused.checked;});
for(const [id,yaw,pitch,distance] of [['view-overview',-.55,.58,560],['view-low',-.35,.27,240],['view-top',0,1.47,850]])el[id].addEventListener('click',()=>{if(renderer)Object.assign(renderer.camera,{yaw,pitch,distance});});
el.view.addEventListener('pointerdown',event=>{if(!renderer)return;drag={x:event.clientX,y:event.clientY};el.view.setPointerCapture(event.pointerId);el.view.focus({preventScroll:true});});
el.view.addEventListener('pointermove',event=>{if(!renderer||!drag)return;renderer.camera.yaw-=(event.clientX-drag.x)*.005;renderer.camera.pitch=Math.max(.12,Math.min(1.49,renderer.camera.pitch+(event.clientY-drag.y)*.005));drag={x:event.clientX,y:event.clientY};});
for(const type of ['pointerup','pointercancel','lostpointercapture'])el.view.addEventListener(type,()=>{drag=null;});
el.view.addEventListener('wheel',event=>{if(!renderer)return;event.preventDefault();renderer.camera.distance=Math.max(80,Math.min(3000,renderer.camera.distance*Math.exp(event.deltaY*.001)));},{passive:false});
document.addEventListener('visibilitychange',()=>{previous=0;if(renderer)renderer.lastTime=0;});
start();

import { Renderer } from './gpu/renderer.js';
import { MAX_TRIANGLES } from './geometry/meshlets.js';

const $=id=>document.getElementById(id);
const el=Object.fromEntries(['view','loading','loading-title','loading-detail','error','error-message','device-status','view-label','setup-info','fps','frame-ms','fps-bar','visible','candidates','triangles','visibility-bar','visibility-percent','cpu-ms','gpu-cull','gpu-render','timing-note','benchmark','bench-result','export','grid','detail','resolution','culling','colors','reset'].map(id=>[id,$(id)]));
const fmt=n=>Math.round(n).toLocaleString('en-US');
const ms=n=>n==null?'Unavailable':`${n.toFixed(2)} ms`;
let renderer,mesh,worker,requestId=0,previous=0,frames=[],cpuFrames=[],bench=null,lastResult=null,geometryInfo=null;
const setLoading=(yes,title='Preparing geometry',detail='Building meshlets and WebAssembly bounds')=>{el.loading.hidden=!yes;el['loading-title'].textContent=title;el['loading-detail'].textContent=detail;};
const fail=message=>{setLoading(false);el.error.hidden=false;el['error-message'].textContent=message;el['device-status'].textContent='ENGINE ERROR';console.error(message);};
const average=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const percentile=(array,p)=>{if(!array.length)return null;const a=[...array].sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.ceil(a.length*p)-1)];};
function cancelBenchmark(message='Benchmark cancelled because the scene changed.') {
 if(!bench)return;bench=null;el.benchmark.disabled=false;el.benchmark.firstElementChild.textContent='RUN BENCHMARK';el['bench-result'].hidden=false;el['bench-result'].textContent=message;
}
function applyScene(reset=true) {
 if(!renderer || !mesh)return;
 try {
  renderer.setScene(mesh,Number(el.grid.value));
  if(reset)renderer.resetCamera();
  el.candidates.textContent=fmt(renderer.scene.candidates);
  el.visible.textContent='—';el.triangles.textContent='—';el['visibility-percent'].textContent='—';
  el['view-label'].textContent=`${fmt(renderer.grid*renderer.grid)} OBJECTS · ${fmt(mesh.triangles)} TRIANGLES EACH`;
  el['setup-info'].textContent=`JS GEOMETRY ${geometryInfo.geometryMs.toFixed(0)} MS · WASM BOUNDS ${geometryInfo.boundsMs.toFixed(1)} MS`;
  el.benchmark.disabled=false;
 } catch(error){fail(error.message);}
}
function prepareGeometry() {
 cancelBenchmark();setLoading(true);
 el.benchmark.disabled=true;
 worker.postMessage({id:++requestId,detail:Number(el.detail.value)});
}
function updateTelemetry() {
 if(!renderer?.scene)return;
 const {visible,gpuComputeMs,gpuRenderMs}=renderer.latest;
 if(visible!=null){
  el.visible.textContent=fmt(visible);el.triangles.textContent=fmt(visible*MAX_TRIANGLES);
  const percent=100*visible/renderer.scene.candidates;
  el['visibility-percent'].textContent=`${percent.toFixed(1)}%`;el['visibility-bar'].style.width=`${percent}%`;
 }
 el['gpu-cull'].textContent=ms(gpuComputeMs);el['gpu-render'].textContent=ms(gpuRenderMs);
 if(frames.length){const f=1000/average(frames);el.fps.textContent=f.toFixed(1);el['frame-ms'].textContent=average(frames).toFixed(1);el['fps-bar'].style.width=`${Math.min(100,f/120*100)}%`;}
 if(cpuFrames.length)el['cpu-ms'].textContent=ms(average(cpuFrames));
}
function finishBenchmark() {
 const current=bench;
 const frameAverage=average(current.frameTimes);
 const gpuCull=average(current.gpuCull),gpuRender=average(current.gpuRender);
 lastResult={schemaVersion:1,createdAt:new Date().toISOString(),configuration:{grid:renderer.grid,objects:renderer.grid**2,detail:mesh.detail,meshletsPerObject:mesh.meshletCount,candidateMeshlets:renderer.scene.candidates,trianglesPerObject:mesh.triangles,frustumCulling:renderer.culling,meshletColors:renderer.colorMeshlets,renderScale:renderer.resolution,canvasPixels:[renderer.canvas.width,renderer.canvas.height],camera:{yaw:renderer.yaw,pitch:renderer.pitch,distance:renderer.distance}},environment:{userAgent:navigator.userAgent,adapter:{vendor:renderer.adapter.info?.vendor||null,architecture:renderer.adapter.info?.architecture||null,device:renderer.adapter.info?.device||null,description:renderer.adapter.info?.description||null},timestampQuery:renderer.timing},measurement:{warmupSeconds:2,captureSeconds:10,sampledFrames:current.frameTimes.length,averageFps:frameAverage?1000/frameAverage:null,meanFrameMs:frameAverage,p95FrameMs:percentile(current.frameTimes,.95),p99FrameMs:percentile(current.frameTimes,.99),meanCpuEncodeSubmitMs:average(current.cpu),meanGpuVisibilityMs:gpuCull,meanGpuRenderMs:gpuRender,gpuSamples:current.gpuCull.length,visibleMeshlets:renderer.latest.visible},preparation:geometryInfo,notes:['Frame timing follows requestAnimationFrame and may be capped by the display refresh rate.','GPU timings are optional timestamp-query pass durations, sampled asynchronously.','Visible triangles are submitted triangle slots, including any degenerate geometry.','A software adapter is useful for correctness, not representative of hardware GPU performance.']};
 el['bench-result'].hidden=false;
 const result=lastResult.measurement;
 el['bench-result'].innerHTML=`<strong>${result.averageFps?.toFixed(1) ?? '—'} FPS average</strong> · p95 ${result.p95FrameMs?.toFixed(1) ?? '—'} ms<br>CPU ${result.meanCpuEncodeSubmitMs?.toFixed(2) ?? '—'} ms · GPU render ${result.meanGpuRenderMs?.toFixed(2) ?? 'unavailable'}${result.meanGpuRenderMs==null?'':' ms'}`;
 el.export.hidden=false;el.benchmark.disabled=false;el.benchmark.firstElementChild.textContent='RUN BENCHMARK';bench=null;
}
function frame(now) {
 requestAnimationFrame(frame);
 if(!renderer?.scene || !el.error.hidden || document.hidden){previous=now;return;}
 try {
  const dt=previous?now-previous:0;previous=now;
  const cpu=renderer.frame(now);
  if(bench && bench.canvasSize && (renderer.canvas.width!==bench.canvasSize[0] || renderer.canvas.height!==bench.canvasSize[1])) cancelBenchmark('Benchmark cancelled because the viewport changed size.');
  if(dt>0 && dt<5000){frames.push(dt);if(frames.length>60)frames.shift();}
  if(cpu!=null){cpuFrames.push(cpu);if(cpuFrames.length>60)cpuFrames.shift();}
  if(bench){
   const elapsed=(now-bench.start)/1000;
   el.benchmark.firstElementChild.textContent=elapsed<2?`WARMING UP ${Math.ceil(2-elapsed)}S`:`CAPTURING ${Math.max(0,Math.ceil(12-elapsed))}S`;
   if(elapsed>=2){
    if(dt>0 && dt<5000)bench.frameTimes.push(dt);
    if(cpu!=null)bench.cpu.push(cpu);
    const sample=renderer.latest;
    if(sample.sampleAt && sample.sampleAt!==bench.lastSample){bench.lastSample=sample.sampleAt;if(sample.gpuComputeMs!=null)bench.gpuCull.push(sample.gpuComputeMs);if(sample.gpuRenderMs!=null)bench.gpuRender.push(sample.gpuRenderMs);}
   }
   if(elapsed>=12)finishBenchmark();
  }
  updateTelemetry();
 } catch(error){fail(error.message);}
}
async function start() {
 worker=new Worker(new URL('./geometry/worker.js',import.meta.url),{type:'module'});
 worker.onmessage=({data})=>{
  if(data.id!==requestId)return;
  if(data.error){fail(`Geometry preparation failed: ${data.error}`);return;}
  mesh=data.mesh;geometryInfo={wasmLoadMs:data.wasmLoadMs,geometryMs:data.geometryMs,boundsMs:data.boundsMs};
  if(renderer){applyScene();setLoading(false);}
 };
 worker.onerror=event=>fail(`Geometry worker failed: ${event.message}`);
 prepareGeometry();
 try {
  renderer=await Renderer.create(el.view,fail);
  renderer.resolution=Number(el.resolution.value);
  renderer.culling=el.culling.checked;renderer.colorMeshlets=el.colors.checked;
  const info=renderer.adapter.info;
  const device=[info?.vendor,info?.architecture,info?.description].filter(Boolean).join(' · ');
  el['device-status'].textContent=device?`WEBGPU / ${device.toUpperCase()}`:'WEBGPU READY';
  el['timing-note'].textContent=renderer.timing?'GPU timestamps are sampled asynchronously.':'GPU timestamp queries are unavailable on this adapter.';
  if(mesh){applyScene();setLoading(false);}
  requestAnimationFrame(frame);
 } catch(error){fail(error.message);}
}
el.detail.addEventListener('change',prepareGeometry);
el.grid.addEventListener('change',()=>{cancelBenchmark();applyScene();});
el.resolution.addEventListener('change',()=>{cancelBenchmark();if(renderer)renderer.resolution=Number(el.resolution.value);});
el.culling.addEventListener('change',()=>{cancelBenchmark();if(renderer)renderer.culling=el.culling.checked;});
el.colors.addEventListener('change',()=>{cancelBenchmark();if(renderer)renderer.colorMeshlets=el.colors.checked;});
el.reset.addEventListener('click',()=>{cancelBenchmark();renderer?.resetCamera();});
el.benchmark.addEventListener('click',()=>{if(!renderer?.scene)return;el['bench-result'].hidden=true;el.export.hidden=true;el.benchmark.disabled=true;bench={start:performance.now(),frameTimes:[],cpu:[],gpuCull:[],gpuRender:[],lastSample:null,canvasSize:[renderer.canvas.width,renderer.canvas.height]};});
el.export.addEventListener('click',()=>{if(!lastResult)return;const url=URL.createObjectURL(new Blob([JSON.stringify(lastResult,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`meshlet-benchmark-${new Date().toISOString().replaceAll(':','-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
let drag=null;
el.view.addEventListener('pointerdown',event=>{if(!renderer)return;cancelBenchmark('Benchmark cancelled because the camera moved.');drag={x:event.clientX,y:event.clientY};el.view.setPointerCapture(event.pointerId);});
el.view.addEventListener('pointermove',event=>{if(!drag||!renderer)return;renderer.yaw-=(event.clientX-drag.x)*.006;renderer.pitch=Math.max(.06,Math.min(1.48,renderer.pitch+(event.clientY-drag.y)*.006));drag={x:event.clientX,y:event.clientY};});
el.view.addEventListener('pointerup',()=>{drag=null;});el.view.addEventListener('pointercancel',()=>{drag=null;});
el.view.addEventListener('wheel',event=>{if(!renderer)return;event.preventDefault();cancelBenchmark('Benchmark cancelled because the camera moved.');renderer.distance=Math.max(3,Math.min(250,renderer.distance*Math.exp(event.deltaY*.001)));},{passive:false});
document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelBenchmark('Benchmark cancelled because the page was hidden.');});
const params=new URLSearchParams(location.search);
for (const id of ['grid','detail','resolution']) { const value=params.get(id); if(value && [...el[id].options].some(option=>option.value===value)) el[id].value=value; }
start();

import {InspectorHistory,HISTORY_MS,levelCounts,graphCeiling} from './inspector-history.js';

const LEVEL_COLORS=['#1fa8cc','#3bc07a','#d9ab33','#e65c33','#ba45ad','#5c5ee6'];
const MODES={
 frame:{unit:'ms',minimum:20,reference:16.67,series:[['frameMs','Frame avg','#aeeec0'],['framePeakMs','Frame peak','#f4c579'],['cpuMs','CPU submit','#68c6dc']],note:'Frame average and peak use 250 ms of frames; CPU is submission time. Frame time includes display pacing.'},
 gpu:{unit:'ms',minimum:5,series:[['gpuComputeMs','Compute','#68c6dc'],['gpuRenderMs','Render','#efa978']],note:'GPU render time includes terrain, ocean and clouds; compute may include patch generation.'},
 lod:{unit:'px',minimum:1,reference:.5,cap:64,series:[['lodError','Last difference','#c19aee']],note:'The last measured difference remains until another transition is measured. Dashed line: 0.5 px target; values above 64 px are clipped on the graph.'},
 patches:{unit:'patches',minimum:10,series:[['patches','Active patches','#aeeec0']],note:'Selected terrain patches; GPU meshlet culling can make fewer meshlets visible.'},
 meshlets:{unit:'meshlets',minimum:100,series:[['meshlets','Visible meshlets','#68c6dc']],note:'Visible meshlets are read back asynchronously about twice per second.'}
};
const safe=x=>Number.isFinite(x)?x:null;
const value=(x,digits=2)=>Number.isFinite(x)?x.toFixed(digits):'—';

export class PlanetInspector {
 constructor(getRenderer){
  this.getRenderer=getRenderer;this.history=new InspectorHistory();this.startedAt=null;this.levelSignature='';this.drag=null;
  const ids=['planet-inspector','inspect-open','inspect-open-panel','inspect-close','inspect-drag','inspect-frame','inspect-gpu','inspect-patches','inspect-error','inspect-lod-status','inspect-recording','inspect-metric','inspect-pause','inspect-clear','inspect-export','inspect-chart','inspect-chart-legend','inspect-chart-note','inspect-color','inspect-opacity','inspect-opacity-value','inspect-patch-lines','inspect-meshlet-lines','inspect-wireframe','inspect-overlay-note','inspect-level-total','inspect-levels'];
  this.el=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)]));const e=this.el;
  e['inspect-open'].addEventListener('click',()=>this.open());
  e['inspect-open-panel'].addEventListener('click',()=>{this.open();const parent=e['planet-inspector'].parentElement;const box=parent?.getBoundingClientRect?.();if(box&&(box.bottom<0||box.top>window.innerHeight))parent.scrollIntoView({block:'nearest'});});
  e['inspect-close'].addEventListener('click',()=>this.close());
  e['inspect-pause'].addEventListener('click',()=>{this.history.setPaused(!this.history.paused);this.updateRecording();this.render(performance.now());});
  e['inspect-clear'].addEventListener('click',()=>{this.history.clear();this.render(performance.now());});
  e['inspect-export'].addEventListener('click',()=>this.export());
  e['inspect-metric'].addEventListener('change',()=>this.render(performance.now()));
  for(const id of ['inspect-color','inspect-opacity','inspect-patch-lines','inspect-meshlet-lines','inspect-wireframe'])e[id].addEventListener(id==='inspect-opacity'?'input':'change',()=>this.applyOverlays());
  e['inspect-drag'].addEventListener('pointerdown',event=>this.dragStart(event));
  e['inspect-drag'].addEventListener('pointermove',event=>this.dragMove(event));
  for(const type of ['pointerup','pointercancel','lostpointercapture'])e['inspect-drag'].addEventListener(type,()=>{this.drag=null;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!e['planet-inspector'].hidden&&!document.pointerLockElement)this.close();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)this.history.markGap();});
 }
 open(){
  const e=this.el;e['planet-inspector'].hidden=false;for(const id of ['inspect-open','inspect-open-panel'])e[id].setAttribute('aria-expanded','true');
  this.render(performance.now());e['inspect-close'].focus({preventScroll:true});
 }
 close(){const e=this.el;e['planet-inspector'].hidden=true;for(const id of ['inspect-open','inspect-open-panel'])e[id].setAttribute('aria-expanded','false');e['inspect-open'].focus({preventScroll:true});}
 updateRecording(){
  const e=this.el,paused=this.history.paused;e['inspect-pause'].textContent=paused?'RESUME':'PAUSE';e['inspect-recording'].textContent=paused?'● PAUSED':'● LIVE · 60 SEC';e['inspect-recording'].classList.toggle('paused',paused);
 }
 applyOverlays(){
  const e=this.el,r=this.getRenderer();if(!r)return;const mode=e['inspect-color'].value;
  r.lodColors=mode==='lod';r.patchColors=mode==='patch';r.meshletColors=mode==='meshlet';
  r.patchLines=e['inspect-patch-lines'].checked;r.meshletLines=e['inspect-meshlet-lines'].checked;r.wireframe=e['inspect-wireframe'].checked;
  const opacity=Math.max(0,Math.min(100,Number(e['inspect-opacity'].value)||0));r.debugOpacity=opacity/100;e['inspect-opacity-value'].textContent=`${opacity}%`;
  const active=mode!=='none'||r.patchLines||r.meshletLines||r.wireframe;
  e['inspect-overlay-note'].textContent=active?'Overlays show the terrain mesh, including the water mesh. They can affect GPU timings.':'Color and lines show the actual terrain mesh. Overlays can affect GPU timings.';
 }
 dragStart(event){
  if(event.button!==0||event.target.closest('button'))return;const e=this.el,box=e['planet-inspector'].getBoundingClientRect(),parent=e['planet-inspector'].parentElement.getBoundingClientRect();
  this.drag={x:event.clientX,y:event.clientY,left:box.left-parent.left,top:box.top-parent.top};e['inspect-drag'].setPointerCapture(event.pointerId);event.preventDefault();
 }
 dragMove(event){
  if(!this.drag)return;const win=this.el['planet-inspector'],parent=win.parentElement.getBoundingClientRect(),box=win.getBoundingClientRect();
  // Leave the header and close button within reach even on a small viewport.
  const left=Math.max(0,Math.min(Math.max(0,parent.width-box.width),this.drag.left+event.clientX-this.drag.x));
  const top=Math.max(0,Math.min(Math.max(0,parent.height-110),this.drag.top+event.clientY-this.drag.y));
  win.style.left=`${left}px`;win.style.top=`${top}px`;win.style.right='auto';win.style.maxHeight=`calc(100% - ${Math.ceil(top)+6}px)`;
 }
 record(now,frameMs,cpuMs){
  const r=this.getRenderer();if(!r)return;if(this.startedAt===null)this.startedAt=now;
  const t=r.latest||{},s=r.stats||{},transition=r.transition||{};
  const sampled=this.history.record(now,frameMs,cpuMs,{gpuComputeMs:t.gpuComputeMs,gpuRenderMs:t.gpuRenderMs,patches:s.visiblePatches,meshlets:t.visibleMeshlets,lodError:transition.pixels,lodWaiting:transition.waiting,lodOverTarget:transition.overTarget});
  if(sampled&&!this.el['planet-inspector'].hidden)this.render(now);
 }
 render(now){
  if(this.el['planet-inspector'].hidden)return;const e=this.el,r=this.getRenderer(),samples=this.history.samples,last=samples.at(-1),mode=MODES[e['inspect-metric'].value]||MODES.frame;
  e['inspect-frame'].textContent=value(last?.frameMs,1);e['inspect-gpu'].textContent=value(last?.gpuRenderMs);e['inspect-patches'].textContent=Number.isFinite(last?.patches)?Math.round(last.patches).toLocaleString('en-US'):'—';e['inspect-error'].textContent=value(last?.lodError);
  e['inspect-lod-status'].textContent=last?.lodWaiting?'px · holding detail':last?.lodOverTarget?'px · above target':'px measured';
  e['inspect-chart-note'].textContent=e['inspect-metric'].value==='gpu'&&r&&!r.timing?'GPU timestamp queries are unavailable on this adapter.':mode.note;
  e['inspect-chart-legend'].innerHTML=mode.series.map(([key,name,color])=>`<span><i style="--series-color:${color}"></i>${name} <b>${value(last?.[key],mode.unit==='ms'||mode.unit==='px'?2:0)}</b></span>`).join('');
  this.drawGraph(mode,now);this.renderLevels(r?.patches||[]);
 }
 renderLevels(patches){
  const levels=levelCounts(patches),signature=levels.map(([l,n])=>`${l}:${n}`).join('|');if(signature===this.levelSignature)return;this.levelSignature=signature;
  const total=levels.reduce((sum,[,n])=>sum+n,0),max=Math.max(1,...levels.map(([,n])=>n));
  this.el['inspect-level-total'].textContent=`${total.toLocaleString('en-US')} PATCHES`;
  this.el['inspect-levels'].innerHTML=levels.length?levels.map(([level,count])=>`<div class="inspector-level" style="--level-color:${LEVEL_COLORS[level%6]}"><i></i><span>L${level}</span><span class="inspector-level-track"><b style="width:${count/max*100}%"></b></span><strong>${count}</strong></div>`).join(''):'<span class="inspector-note">Waiting for terrain…</span>';
 }
 drawGraph(mode,now){
  const canvas=this.el['inspect-chart'],ctx=canvas.getContext('2d');if(!ctx)return;
  const width=canvas.clientWidth,height=canvas.clientHeight;if(width<1||height<1)return;
  const ratio=Math.min(window.devicePixelRatio||1,2),w=Math.round(width*ratio),h=Math.round(height*ratio);
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
  const left=45,right=10,top=12,bottom=22,plotWidth=Math.max(1,width-left-right),plotHeight=Math.max(1,height-top-bottom);
  const samples=this.history.samples,end=this.history.paused&&samples.length?samples.at(-1).at:now,start=end-HISTORY_MS;
  const visible=samples.filter(s=>s.at>=start&&s.at<=end);
  const all=visible.flatMap(s=>mode.series.map(([key])=>safe(s[key])).filter(x=>x!==null));
  const ceiling=graphCeiling(all.map(x=>Math.min(x,mode.cap||Infinity)),mode.minimum);
  ctx.font='10px system-ui, sans-serif';ctx.textAlign='right';ctx.textBaseline='middle';
  for(let i=0;i<=4;i++){
   const y=top+plotHeight*i/4,n=ceiling*(1-i/4);ctx.strokeStyle='#273d34';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(left+plotWidth,y);ctx.stroke();
   ctx.fillStyle='#88a196';ctx.fillText(n>=10?Math.round(n).toString():n.toFixed(n>=1?1:2),left-6,y);
  }
  ctx.fillStyle='#91a99a';ctx.textAlign='left';ctx.textBaseline='top';ctx.fillText(mode.unit,left,0);
  ctx.textBaseline='bottom';ctx.fillText('−60s',left,height-2);ctx.textAlign='center';ctx.fillText('−30s',left+plotWidth/2,height-2);ctx.textAlign='right';ctx.fillText(this.history.paused?'paused':'now',left+plotWidth,height-2);
  if(mode.reference&&mode.reference<=ceiling){
   const y=top+(1-mode.reference/ceiling)*plotHeight;ctx.setLineDash([4,4]);ctx.strokeStyle='#deae68';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(left+plotWidth,y);ctx.stroke();ctx.setLineDash([]);
  }
  for(const [key,,color] of mode.series){
   ctx.strokeStyle=color;ctx.lineWidth=1.6;ctx.beginPath();let drawing=false;
   for(const sample of visible){const n=safe(sample[key]);if(n===null){drawing=false;continue;}const x=left+(sample.at-start)/HISTORY_MS*plotWidth,y=top+(1-Math.min(n,ceiling)/ceiling)*plotHeight;
    if(!drawing||sample.gap)ctx.moveTo(x,y);else ctx.lineTo(x,y);drawing=true;
   }ctx.stroke();
  }
 }
 export(){
  const r=this.getRenderer(),camera=r?.cameraState,data={version:1,createdAt:new Date().toISOString(),sampleIntervalMs:250,historySeconds:60,seed:r?.seed??null,gpuTimestamps:!!r?.timing,
   camera:camera?{mode:camera.mode,altitudeKm:camera.altitude,surfaceHeightKm:camera.surfaceHeight,latitudeRadians:camera.latitude,longitudeRadians:camera.longitude,headingRadians:camera.heading,pitchRadians:camera.pitch}:null,
   settings:r?{patchBudget:r.budget,renderScale:r.resolution,culling:r.culling,relief:r.relief,valleys:r.valleys,erosion:r.erosion,ocean:r.ocean,rivers:r.rivers,colorOverlay:this.el['inspect-color'].value,overlayOpacity:r.debugOpacity,patchLines:r.patchLines,meshletLines:r.meshletLines,wireframe:r.wireframe}:null,
   samples:this.history.samples.map(({at,...s})=>({elapsedMs:Math.round(at-(this.startedAt??at)),...s}))};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='planet-inspector.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
}

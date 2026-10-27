import {RADIUS_KM,PATCH_CELLS,FACE_BASES,faceCube,seedPlates,normalize,add,scale} from './planet-math.js';
import {planetCamera} from './camera.js';
import {selectPatches} from './quadtree.js';
const BUFFER=globalThis.GPUBufferUsage;
const CAPACITY=512,GRID=21,VERTEX_BYTES=32,MESHLETS=16,PATCH_BYTES=128;
async function shader(device,code,label){
 const module=device.createShaderModule({label,code});const info=await module.getCompilationInfo();
 const errors=info.messages.filter(x=>x.type==='error');if(errors.length)throw new Error(`${label}: ${errors.map(x=>`${x.lineNum}:${x.linePos} ${x.message}`).join('; ')}`);return module;
}
export class PlanetRenderer {
 static async create(canvas,onError){
  if(!navigator.gpu)throw new Error('WebGPU is unavailable. Open the lab in a WebGPU-enabled browser on HTTPS or localhost.');
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw new Error('No WebGPU adapter was found.');
  const timing=adapter.features.has('timestamp-query')&&!new URLSearchParams(location.search).has('noTimestamps');
  const device=await adapter.requestDevice({requiredFeatures:timing?['timestamp-query']:[]});
  const context=canvas.getContext('webgpu');if(!context)throw new Error('Could not create a WebGPU canvas.');
  const renderer=new PlanetRenderer(canvas,adapter,device,context,timing,onError);await renderer.init();return renderer;
 }
 constructor(canvas,adapter,device,context,timing,onError){
  Object.assign(this,{canvas,adapter,device,context,timing,onError});this.format=navigator.gpu.getPreferredCanvasFormat();
  this.cameraState={longitude:.8,latitude:.4,altitude:14000,surfaceHeight:0,mode:'orbit',heading:.45,pitch:.3};
  this.seed=918273;this.relief=1;this.ocean=true;this.followSun=true;this.culling=true;this.lodColors=false;this.wireframe=false;this.patchLines=false;
  this.budget=384;this.pixelSize=14;this.resolution=1;this.maxDepth=20;
  this.patchBytes=new ArrayBuffer(CAPACITY*PATCH_BYTES);this.patchFloats=new Float32Array(this.patchBytes);this.patchUints=new Uint32Array(this.patchBytes);
  this.slotByKey=new Map();this.stitchByKey=new Map();this.free=Array.from({length:CAPACITY},(_,i)=>CAPACITY-1-i);this.patches=[];this.pending=[];this.normalPending=[];
  this.needsSelection=true;this.lastSelection=0;this.latest={visibleMeshlets:null,gpuComputeMs:null,gpuRenderMs:null};
  this.lastSample=0;this.pendingRead=false;this.generation=0;this.inFlight=0;this.probePending=false;this.lastProbeKey='';this.lastProbeTime=0;this.stats={leaves:0,visiblePatches:0,deepest:0,selectionMs:0,generated:0};
 }
 async init(){
  const d=this.device;d.addEventListener('uncapturederror',e=>this.onError?.(`WebGPU: ${e.error.message}`));
  d.lost.then(info=>this.onError?.(`WebGPU device lost: ${info.message||info.reason}. Reload to retry.`));
  this.context.configure({device:d,format:this.format,alphaMode:'opaque'});
  const fetchText=async p=>{const r=await fetch(new URL(p,import.meta.url));if(!r.ok)throw new Error(`Failed to load ${p}`);return r.text();};
  const [common,...sources]=await Promise.all(['./common.wgsl','./generate.wgsl','./normal.wgsl','./bounds.wgsl','./cull.wgsl','./render.wgsl'].map(fetchText));
  const labels=['Terrain generation','Terrain normals','Meshlet bounds','Meshlet culling','Planet rendering'];
  const modules=await Promise.all(sources.map((s,i)=>shader(d,common+'\n'+s,labels[i])));
  [this.generatePipe,this.normalPipe,this.boundsPipe,this.cullPipe]=await Promise.all(modules.slice(0,4).map(module=>d.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}})));
  [this.highlandsPipe,this.pointPipe]=await Promise.all(['highlands','point'].map(entryPoint=>d.createComputePipelineAsync({layout:'auto',compute:{module:modules[0],entryPoint}})));
  this.renderPipe=await d.createRenderPipelineAsync({layout:'auto',vertex:{module:modules[4],entryPoint:'vs'},fragment:{module:modules[4],entryPoint:'fs',targets:[{format:this.format}]},primitive:{topology:'triangle-list',cullMode:'back'},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'greater'}});
  const make=(label,size,usage)=>d.createBuffer({label,size,usage});
  this.uniform=make('Planet frame',208,BUFFER.UNIFORM|BUFFER.COPY_DST);
  this.patchBuffer=make('Planet patches',this.patchBytes.byteLength,BUFFER.STORAGE|BUFFER.COPY_DST);
  this.vertices=make('Cached GPU terrain vertices',CAPACITY*GRID*GRID*VERTEX_BYTES,BUFFER.STORAGE|BUFFER.COPY_SRC);
  this.bounds=make('Terrain meshlet bounds',CAPACITY*MESHLETS*16,BUFFER.STORAGE);
  this.activeBuffer=make('Active patches',CAPACITY*4,BUFFER.STORAGE|BUFFER.COPY_DST);
  this.queueBuffer=make('New patch queue',CAPACITY*4,BUFFER.STORAGE|BUFFER.COPY_DST);
  this.normalQueueBuffer=make('Patch normal update queue',CAPACITY*4,BUFFER.STORAGE|BUFFER.COPY_DST);
  this.plates=make('Seeded plate controls',16*16,BUFFER.STORAGE|BUFFER.COPY_DST);
  this.sampleBuffer=make('Terrain probe samples',6*24*24*16,BUFFER.STORAGE|BUFFER.COPY_SRC);
  this.probeInput=make('Surface probe direction',16,BUFFER.UNIFORM|BUFFER.COPY_DST);
  this.visible=make('Visible planet meshlets',CAPACITY*MESHLETS*4,BUFFER.STORAGE);
  this.indirect=make('Planet indirect draw',16,BUFFER.STORAGE|BUFFER.INDIRECT|BUFFER.COPY_DST|BUFFER.COPY_SRC);
  const bind=(pipe,resources)=>d.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:resources.map((buffer,binding)=>({binding,resource:{buffer}}))});
  this.generateBind=bind(this.generatePipe,[this.uniform,this.patchBuffer,this.vertices,this.queueBuffer,this.plates]);
  this.normalBind=bind(this.normalPipe,[this.uniform,this.patchBuffer,this.vertices,this.normalQueueBuffer]);
  this.boundsBind=bind(this.boundsPipe,[this.uniform,this.vertices,this.bounds,this.queueBuffer]);
  this.cullBind=bind(this.cullPipe,[this.uniform,this.patchBuffer,this.bounds,this.activeBuffer,this.visible,this.indirect]);
  this.renderBind=bind(this.renderPipe,[this.uniform,this.patchBuffer,this.vertices,this.visible]);
  this.highlandsBind=d.createBindGroup({layout:this.highlandsPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}},{binding:4,resource:{buffer:this.plates}},{binding:5,resource:{buffer:this.sampleBuffer}}]});
  this.pointBind=d.createBindGroup({layout:this.pointPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}},{binding:4,resource:{buffer:this.plates}},{binding:5,resource:{buffer:this.sampleBuffer}},{binding:6,resource:{buffer:this.probeInput}}]});
  if(this.timing){this.queries=d.createQuerySet({type:'timestamp',count:4});this.resolve=make('GPU timestamp resolve',32,BUFFER.QUERY_RESOLVE|BUFFER.COPY_SRC);}
  d.queue.writeBuffer(this.plates,0,seedPlates(this.seed));
 }
 invalidateTerrain(){
  this.slotByKey.clear();this.stitchByKey.clear();this.free=Array.from({length:CAPACITY},(_,i)=>CAPACITY-1-i);this.pending=[];this.normalPending=[];this.patches=[];
  this.device.queue.writeBuffer(this.plates,0,seedPlates(this.seed));this.needsSelection=true;this.generation++;this.lastProbeKey='';
  this.latest={visibleMeshlets:null,gpuComputeMs:null,gpuRenderMs:null};
  if(this.cameraState.altitude<50)this.cameraState.surfaceHeight=10;
 }
 resize(){
  const rect=this.canvas.getBoundingClientRect(),ratio=Math.min(window.devicePixelRatio||1,2)*this.resolution,max=this.device.limits.maxTextureDimension2D;
  const w=Math.min(max,Math.max(1,Math.round(rect.width*ratio))),h=Math.min(max,Math.max(1,Math.round(rect.height*ratio)));
  if(this.canvas.width!==w||this.canvas.height!==h||!this.depth){this.canvas.width=w;this.canvas.height=h;this.depth?.destroy();this.depth=this.device.createTexture({label:'Planet reverse-Z depth',size:[w,h],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT});this.needsSelection=true;}
 }
 select(camera,now){
  const start=performance.now();
  const result=selectPatches(camera,{budget:this.budget,maxDepth:this.maxDepth,pixelSize:this.pixelSize});
  const wantedNodes=new Map(result.visible.map(p=>[p.key,p])),wanted=new Set(wantedNodes.keys());
  for(const [key,slot] of this.slotByKey)if(!wanted.has(key)){this.slotByKey.delete(key);this.stitchByKey.delete(key);this.free.push(slot);}
  const pending=[],normalPending=[];
  this.patches=result.visible.map(node=>{
   const signature=`${node.normalStitch}/${node.coarseKeys.map(key=>{const coarse=wantedNodes.get(key);return coarse?`${key}:${coarse.normalStitch}`:'-';}).join(',')}`;
   let slot=this.slotByKey.get(node.key);
   if(slot===undefined){slot=this.free.pop();if(slot===undefined)throw new Error('Planet patch cache exhausted.');this.slotByKey.set(node.key,slot);pending.push(slot);normalPending.push(slot);}
   else if(this.stitchByKey.get(node.key)!==signature)normalPending.push(slot);
   this.stitchByKey.set(node.key,signature);
   return {...node,slot};
  });
  this.pending=pending;this.normalPending=normalPending;
  this.stats={leaves:result.leaves.length,visiblePatches:this.patches.length,deepest:result.deepest,selectionMs:performance.now()-start,generated:pending.length,normalUpdates:normalPending.length,reusedNormalUpdates:normalPending.length-pending.length};
  this.lastSelection=now;this.needsSelection=false;
 }
 async sampleTerrain(direction=null){
  const d=this.device,all=!direction,count=all?6*24*24:1,size=count*16;
  d.queue.writeBuffer(this.uniform,164,new Float32Array([this.relief]));
  d.queue.writeBuffer(this.uniform,184,new Uint32Array([this.seed>>>0]));
  if(direction)d.queue.writeBuffer(this.probeInput,0,new Float32Array([...direction,0]));
  const readback=d.createBuffer({size,usage:BUFFER.COPY_DST|BUFFER.MAP_READ}),encoder=d.createCommandEncoder();
  const pass=encoder.beginComputePass();pass.setPipeline(all?this.highlandsPipe:this.pointPipe);pass.setBindGroup(0,all?this.highlandsBind:this.pointBind);pass.dispatchWorkgroups(all?Math.ceil(count/64):1);pass.end();
  encoder.copyBufferToBuffer(this.sampleBuffer,0,readback,0,size);d.queue.submit([encoder.finish()]);
  try{await readback.mapAsync(GPUMapMode.READ);const data=new Float32Array(readback.getMappedRange().slice(0));readback.unmap();return data;}
  finally{readback.destroy();}
 }
 async findHighlands(){
  const generation=this.generation,data=await this.sampleTerrain();if(generation!==this.generation)return null;
  let best=0;for(let i=4;i<data.length;i+=4)if(data[i+3]>data[best+3])best=i;
  return {direction:[data[best],data[best+1],data[best+2]],height:data[best+3]};
 }
 requestSurface(camera,now){
  if(this.cameraState.altitude>=50){this.cameraState.surfaceHeight=0;return;}
  const key=[this.seed,this.relief,this.ocean,...camera.radial.map(x=>x.toFixed(7))].join('/');
  if(this.probePending || key===this.lastProbeKey || now-this.lastProbeTime<160)return;
  this.probePending=true;this.lastProbeTime=now;const generation=this.generation;
  this.sampleTerrain(camera.radial).then(data=>{
   if(generation!==this.generation)return;
   const current=planetCamera(this.cameraState,1,1).radial;
   const difference=Math.hypot(...current.map((x,i)=>x-camera.radial[i]));
   if(difference>1e-6)return;
   const height=this.ocean?Math.max(0,data[3]):data[3];
   this.cameraState.surfaceHeight=height;this.lastProbeKey=key;this.needsSelection=true;
  }).catch(e=>this.onError?.(`Terrain probe: ${e.message}`)).finally(()=>{this.probePending=false;});
 }
 frame(now){
  if(this.inFlight>=2)return null;
  const cpuStart=performance.now();this.resize();
  const camera=planetCamera(this.cameraState,this.canvas.width,this.canvas.height);
  this.requestSurface(camera,now);
  if(this.needsSelection && (now-this.lastSelection>100||!this.patches.length))this.select(camera,now);
  for(const node of this.patches){
   const i=node.slot*32,b=FACE_BASES[node.face],cube=faceCube(node.face,node.u,node.v);
   this.patchFloats.set([...cube,node.span],i);this.patchFloats.set([...b.u,0],i+4);this.patchFloats.set([...b.v,0],i+8);
   const high=node.direction.map(Math.fround),low=node.direction.map((x,k)=>x-high[k]);
   this.patchFloats.set([...high,0],i+12);this.patchFloats.set([...low,0],i+16);
   this.patchFloats.set(node.direction.map((x,k)=>x*RADIUS_KM-camera.eye[k]).concat(0),i+20);
   this.patchUints.set([node.face,node.level,node.stitch,node.normalStitch],i+24);
   this.patchUints.set(node.coarseKeys.map(key=>this.slotByKey.get(key)??0xffffffff),i+28);
  }
  const raw=new ArrayBuffer(208),f=new Float32Array(raw),u=new Uint32Array(raw);
  f.set(camera.vp,0);camera.planes.forEach((p,i)=>f.set(p,16+i*4));
  let sun=normalize([.55,.42,.72]);
  if(this.followSun){
   const low=this.cameraState.mode==='flyover';
   sun=normalize(add(add(scale(camera.radial,low ? .32 : .72),scale(camera.right,low ? .9 : .55)),scale(camera.up,low ? .22 : .25)));
  }
  f.set([...sun,0],36);f.set([RADIUS_KM,this.relief,this.ocean?1:0,0],40);
  const flags=(this.culling?1:0)|(this.lodColors?2:0)|(this.wireframe?4:0)|(this.patchLines?8:0);
  u.set([this.patches.length,this.pending.length,this.seed>>>0,flags],44);
  u.set([this.normalPending.length,0,0,0],48);
  const d=this.device;d.queue.writeBuffer(this.uniform,0,raw);d.queue.writeBuffer(this.patchBuffer,0,this.patchBytes);
  if(this.patches.length)d.queue.writeBuffer(this.activeBuffer,0,new Uint32Array(this.patches.map(p=>p.slot)));
  if(this.pending.length)d.queue.writeBuffer(this.queueBuffer,0,new Uint32Array(this.pending));
  if(this.normalPending.length)d.queue.writeBuffer(this.normalQueueBuffer,0,new Uint32Array(this.normalPending));
  d.queue.writeBuffer(this.indirect,0,new Uint32Array([96,0,0,0]));
  const generatedOnSample=this.pending.length;
  const sample=(generatedOnSample>0||now-this.lastSample>500)&&!this.pendingRead;if(sample){this.lastSample=now;this.pendingRead=true;}
  const encoder=d.createCommandEncoder({label:'Planet frame'});
  const cp=encoder.beginComputePass(sample&&this.timing?{timestampWrites:{querySet:this.queries,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}}:{});
  const dispatch=(pipe,bind,count)=>{if(count){cp.setPipeline(pipe);cp.setBindGroup(0,bind);cp.dispatchWorkgroups(Math.ceil(count/64));}};
  dispatch(this.generatePipe,this.generateBind,this.pending.length*GRID*GRID);
  dispatch(this.normalPipe,this.normalBind,this.normalPending.length*17*17);
  dispatch(this.boundsPipe,this.boundsBind,this.pending.length*MESHLETS);
  dispatch(this.cullPipe,this.cullBind,this.patches.length*MESHLETS);cp.end();
  const descriptor={colorAttachments:[{view:this.context.getCurrentTexture().createView(),clearValue:{r:.006,g:.009,b:.016,a:1},loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:this.depth.createView(),depthClearValue:0,depthLoadOp:'clear',depthStoreOp:'discard'}};
  if(sample&&this.timing)descriptor.timestampWrites={querySet:this.queries,beginningOfPassWriteIndex:2,endOfPassWriteIndex:3};
  const pass=encoder.beginRenderPass(descriptor);pass.setPipeline(this.renderPipe);pass.setBindGroup(0,this.renderBind);pass.drawIndirect(this.indirect,0);pass.end();
  let readback;if(sample){readback=d.createBuffer({size:48,usage:BUFFER.COPY_DST|BUFFER.MAP_READ});encoder.copyBufferToBuffer(this.indirect,0,readback,0,16);if(this.timing){encoder.resolveQuerySet(this.queries,0,4,this.resolve,0);encoder.copyBufferToBuffer(this.resolve,0,readback,16,32);}}
  d.queue.submit([encoder.finish()]);this.pending=[];this.normalPending=[];this.inFlight++;
  d.queue.onSubmittedWorkDone().then(()=>{this.inFlight--;}).catch(()=>{this.inFlight--;});
  if(readback){const generation=this.generation;readback.mapAsync(GPUMapMode.READ).then(()=>{
   const data=readback.getMappedRange(),visibleMeshlets=new Uint32Array(data,0,4)[1];let gpuComputeMs=null,gpuRenderMs=null;
   if(this.timing){const t=new BigUint64Array(data,16,4);if(t[1]>=t[0]&&t[3]>=t[2]){gpuComputeMs=Number(t[1]-t[0])/1e6;gpuRenderMs=Number(t[3]-t[2])/1e6;}}
   if(generation===this.generation)this.latest={visibleMeshlets,gpuComputeMs,gpuRenderMs,generatedPatchesSample:generatedOnSample};readback.unmap();
  }).catch(e=>this.onError?.(`GPU telemetry: ${e.message}`)).finally(()=>{readback.destroy();this.pendingRead=false;});}
  return performance.now()-cpuStart;
 }
}

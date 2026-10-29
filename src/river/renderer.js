import {lookAt,multiply,perspective} from '../math.js';
import {RiverWorld,checkedShader,readShader} from './world.js';

export const TERRAIN_GRID=192,WATER_ALONG=192,WATER_ACROSS=48;
const VERTEX_BYTES=48,TERRAIN_VERTICES=(TERRAIN_GRID+1)**2,TERRAIN_INDICES=TERRAIN_GRID**2*6;
const WATER_VERTICES=(WATER_ACROSS+1)*(WATER_ALONG+1),WATER_INDICES=WATER_ACROSS*WATER_ALONG*6;
const GROUPS=Math.ceil(24578/64),FRAME_BYTES=144,REACH_BYTES=80;
export function riverCamera(state,width,height){
 const p=Math.max(.12,Math.min(1.49,state.pitch)),d=Math.max(80,Math.min(3000,state.distance));
 const eye=[d*Math.cos(p)*Math.sin(state.yaw),d*Math.sin(p),-d*Math.cos(p)*Math.cos(state.yaw)];
 return {eye,vp:multiply(perspective(Math.PI/3,width/height,.5,10000),lookAt(eye,[0,0,0]))};
}
export class RiverRenderer {
 static async create(canvas,onError){
  if(!navigator.gpu)throw new Error('WebGPU is unavailable. Use a WebGPU-enabled browser over HTTPS or localhost.');
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw new Error('No WebGPU adapter was found.');
  const device=await adapter.requestDevice(),context=canvas.getContext('webgpu');if(!context)throw new Error('Could not create a WebGPU canvas.');
  const r=new RiverRenderer(canvas,adapter,device,context,onError);await r.init();return r;
 }
 constructor(canvas,adapter,device,context,onError){
  Object.assign(this,{canvas,adapter,device,context,onError});this.format=navigator.gpu.getPreferredCanvasFormat();
  this.seed=918273;this.variant=0;this.width=1;this.depth=4;this.bank=12;this.roughness=.8;this.speed=1;this.clarity=1.3;this.ripples=.8;this.foam=.45;this.showFlow=false;this.paused=false;
  this.camera={yaw:-.55,pitch:.72,distance:850};this.ready=false;this.dirty=false;this.lastTime=0;this.busy=false;this.metadata=null;this.inFlight=0;
 }
 async init(){
  const d=this.device,U=GPUBufferUsage;d.addEventListener('uncapturederror',e=>this.onError?.(`WebGPU: ${e.error.message}`));
  d.lost.then(info=>this.onError?.(`WebGPU device lost: ${info.message||info.reason}`));this.context.configure({device:d,format:this.format,alphaMode:'opaque'});
  this.world=await RiverWorld.create(d);
  const [common,shared,selection,geometry,animation,render]=await Promise.all(['../planet/common.wgsl','./shared.wgsl','./select.wgsl','./geometry.wgsl','./animate.wgsl','./render.wgsl'].map(readShader));
  const writable=shared.replace('var<storage,read> reach:','var<storage,read_write> reach:');
  const modules=await Promise.all([
   checkedShader(d,[common,writable,selection].join('\n'),'River selection'),
   checkedShader(d,[common,shared,geometry].join('\n'),'River geometry'),
   checkedShader(d,[common,shared,animation].join('\n'),'River flow'),
   checkedShader(d,[common,shared,render].join('\n'),'River rendering')
  ]);
  const selectLayout=d.createBindGroupLayout({entries:[
   {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
   {binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
   {binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
   {binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}}]});
  const selectionLayout=d.createPipelineLayout({bindGroupLayouts:[selectLayout]});
  this.selectionPipes=await Promise.all(['chooseNodes','selectReach','prepareReach'].map(entryPoint=>d.createComputePipelineAsync({layout:selectionLayout,compute:{module:modules[0],entryPoint}})));
  this.geometryPipes=await Promise.all(['makeTerrain','makeWater'].map(entryPoint=>d.createComputePipelineAsync({layout:'auto',compute:{module:modules[1],entryPoint}})));
  this.flowPipe=await d.createComputePipelineAsync({layout:'auto',compute:{module:modules[2],entryPoint:'advanceWater'}});
  const depthStencil={format:'depth32float',depthWriteEnabled:true,depthCompare:'less'};
  this.skyPipe=await d.createRenderPipelineAsync({layout:'auto',vertex:{module:modules[3],entryPoint:'skyVertex'},fragment:{module:modules[3],entryPoint:'skyFragment',targets:[{format:this.format}]},primitive:{topology:'triangle-list'},depthStencil:{format:'depth32float',depthWriteEnabled:false,depthCompare:'always'}});
  this.renderPipes=await Promise.all(['groundFragment','waterFragment'].map(entryPoint=>d.createRenderPipelineAsync({layout:'auto',vertex:{module:modules[3],entryPoint:'vertexMain'},fragment:{module:modules[3],entryPoint,targets:[{format:this.format}]},primitive:{topology:'triangle-list',cullMode:'back'},depthStencil})));
  const make=(label,size,usage)=>d.createBuffer({label,size,usage});
  this.frameBuffer=make('River view settings',FRAME_BYTES,U.UNIFORM|U.COPY_DST);this.reach=make('Selected downstream reach',REACH_BYTES,U.STORAGE|U.COPY_SRC);
  this.candidates=make('Reach selection reduction',GROUPS*8,U.STORAGE);this.motion=make('GPU water advection',16,U.STORAGE|U.COPY_DST|U.COPY_SRC);
  this.vertices=[make('Procedural river banks',TERRAIN_VERTICES*VERTEX_BYTES,U.STORAGE|U.COPY_SRC),make('Procedural river water',WATER_VERTICES*VERTEX_BYTES,U.STORAGE|U.COPY_SRC)];
  this.indices=[make('River bank triangles',TERRAIN_INDICES*4,U.STORAGE|U.INDEX|U.COPY_SRC),make('River water triangles',WATER_INDICES*4,U.STORAGE|U.INDEX|U.COPY_SRC)];
  const bind=(pipe,entries)=>d.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:entries.map(([binding,buffer])=>({binding,resource:{buffer}}))});
  this.selectionBind=d.createBindGroup({layout:selectLayout,entries:[[0,this.frameBuffer],[1,this.reach],[2,this.world.world],[3,this.candidates]].map(([binding,buffer])=>({binding,resource:{buffer}}))});
  this.geometryBinds=this.geometryPipes.map((pipe,i)=>bind(pipe,[[0,this.frameBuffer],[1,this.reach],[2,this.vertices[i]],[3,this.indices[i]]]));
  this.flowBind=bind(this.flowPipe,[[0,this.frameBuffer],[2,this.motion]]);
  this.renderBinds=this.renderPipes.map((pipe,i)=>bind(pipe,[[0,this.frameBuffer],[1,this.reach],[2,this.vertices[i]],...(i===1?[[3,this.motion]]:[])]));
 }
 resize(){
  const rect=this.canvas.getBoundingClientRect(),ratio=Math.min(window.devicePixelRatio||1,2),limit=this.device.limits.maxTextureDimension2D;
  const width=Math.max(1,Math.min(limit,Math.round(rect.width*ratio))),height=Math.max(1,Math.min(limit,Math.round(rect.height*ratio)));
  if(this.canvas.width!==width||this.canvas.height!==height||!this.depthTexture){this.canvas.width=width;this.canvas.height=height;this.depthTexture?.destroy();this.depthTexture=this.device.createTexture({label:'River depth',size:[width,height],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT});}
 }
 writeFrame(dt){
  const camera=riverCamera(this.camera,this.canvas.width||1,this.canvas.height||1),raw=new ArrayBuffer(FRAME_BYTES),f=new Float32Array(raw),u=new Uint32Array(raw);
  f.set(camera.vp,0);f.set([...camera.eye,this.paused?0:dt],16);f.set([.40,.80,-.45,this.speed],20);f.set([this.width,this.depth,this.bank,this.roughness],24);
  f.set([this.clarity,this.ripples,this.foam,this.showFlow?1:0],28);u.set([this.seed>>>0,this.variant>>>0,0,0],32);this.device.queue.writeBuffer(this.frameBuffer,0,raw);
 }
 buildGeometry(pass){
  const counts=[Math.max(TERRAIN_VERTICES,TERRAIN_INDICES),Math.max(WATER_VERTICES,WATER_INDICES)];
  for(let i=0;i<2;i++){pass.setPipeline(this.geometryPipes[i]);pass.setBindGroup(0,this.geometryBinds[i]);pass.dispatchWorkgroups(Math.ceil(counts[i]/64));}
 }
 async regenerate(seed=this.seed,variant=this.variant){
  if(this.busy)return null;this.busy=true;this.ready=false;this.seed=seed>>>0;this.variant=variant>>>0;const d=this.device;
  try{
   this.world.generate(this.seed);this.resize();this.writeFrame(0);d.queue.writeBuffer(this.motion,0,new Float32Array(4));
   const readback=d.createBuffer({size:REACH_BYTES,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   const encoder=d.createCommandEncoder({label:'Select and generate a river reach'}),pass=encoder.beginComputePass();
   for(let i=0;i<3;i++){pass.setPipeline(this.selectionPipes[i]);pass.setBindGroup(0,this.selectionBind);pass.dispatchWorkgroups(i===0?GROUPS:1);}
   this.buildGeometry(pass);pass.end();encoder.copyBufferToBuffer(this.reach,0,readback,0,REACH_BYTES);d.queue.submit([encoder.finish()]);
   try{
    await readback.mapAsync(GPUMapMode.READ);const raw=readback.getMappedRange(),f=new Float32Array(raw),u=new Uint32Array(raw);
    if(u[18]!==1)throw new Error('No valid inland river reach was found for this seed. Try another seed.');
    this.metadata={halfWidth:f[0],slope:f[1],discharge:f[2],segmentLength:f[6],filledDrop:f[7],anchor:[f[8],f[9],f[10]],downstream:[f[12],f[13],f[14]],start:u[16],end:u[17]};readback.unmap();
   }finally{readback.destroy();}
   this.ready=true;this.dirty=false;this.lastTime=0;return this.metadata;
  }finally{this.busy=false;}
 }
 frame(now){
  if(!this.ready||this.inFlight>=2)return false;this.resize();const dt=this.lastTime?Math.min(.1,Math.max(0,(now-this.lastTime)/1000)):0;this.lastTime=now;this.writeFrame(dt);
  const d=this.device,encoder=d.createCommandEncoder({label:'River view frame'}),compute=encoder.beginComputePass();
  if(this.dirty){this.buildGeometry(compute);this.dirty=false;}
  compute.setPipeline(this.flowPipe);compute.setBindGroup(0,this.flowBind);compute.dispatchWorkgroups(1);compute.end();
  const pass=encoder.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:.08,g:.13,b:.16,a:1}}],depthStencilAttachment:{view:this.depthTexture.createView(),depthLoadOp:'clear',depthStoreOp:'discard',depthClearValue:1}});
  pass.setPipeline(this.skyPipe);pass.draw(3);
  for(let i=0;i<2;i++){pass.setPipeline(this.renderPipes[i]);pass.setBindGroup(0,this.renderBinds[i]);pass.setIndexBuffer(this.indices[i],'uint32');pass.drawIndexed(i===0?TERRAIN_INDICES:WATER_INDICES);}
  pass.end();d.queue.submit([encoder.finish()]);this.inFlight++;d.queue.onSubmittedWorkDone().then(()=>{this.inFlight--;}).catch(()=>{this.inFlight--;});return true;
 }
}

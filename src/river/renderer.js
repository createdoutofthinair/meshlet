import {lookAt,multiply,perspective} from '../math.js';
import {RiverWorld,checkedShader,readShader} from './world.js';

export const TERRAIN_GRID=192,WATER_ALONG=384,WATER_ACROSS=128,RIVER_ROCKS=12;
const VERTEX_BYTES=48,TERRAIN_VERTICES=(TERRAIN_GRID+1)**2,TERRAIN_INDICES=TERRAIN_GRID**2*6;
const WATER_VERTICES=(WATER_ACROSS+1)*(WATER_ALONG+1),WATER_INDICES=WATER_ACROSS*WATER_ALONG*6;
const ROCK_VERTICES=16*10*6;
const GROUPS=Math.ceil(24578/64),FRAME_BYTES=208,REACH_BYTES=80;
export function riverCamera(state,width,height){
 const p=Math.max(.12,Math.min(1.49,state.pitch)),d=Math.max(80,Math.min(3000,state.distance));
 const eye=[d*Math.cos(p)*Math.sin(state.yaw),d*Math.sin(p),-d*Math.cos(p)*Math.cos(state.yaw)];
 return {eye,vp:multiply(perspective(Math.PI/3,width/height,.5,10000),lookAt(eye,[0,0,0]))};
}
// Reflect both the camera and its up-vector in the actual sloped water plane.
export function riverReflectionCamera(camera,width,height,slope){
 const length=Math.hypot(1,slope),normal=[0,1/length,slope/length];
 const mirror=v=>{const distance=v[0]*normal[0]+v[1]*normal[1]+v[2]*normal[2];return v.map((value,i)=>value-2*distance*normal[i]);};
 const eye=mirror(camera.eye),up=mirror([0,1,0]);
 return {eye,vp:multiply(perspective(Math.PI/3,width/height,.5,10000),lookAt(eye,[0,0,0],up))};
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
  this.seed=918273;this.variant=0;this.width=1;this.depth=4;this.bank=12;this.roughness=.8;this.speed=1;this.clarity=1.3;this.ripples=.8;this.foam=.45;this.reflectionScale=.5;this.showFlow=false;this.paused=false;
  this.camera={yaw:-.55,pitch:.58,distance:560};this.ready=false;this.dirty=false;this.lastTime=0;this.busy=false;this.metadata=null;this.inFlight=0;
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
  this.geometryPipes=await Promise.all(['makeTerrain','makeWater','makeRocks'].map(entryPoint=>d.createComputePipelineAsync({layout:'auto',compute:{module:modules[1],entryPoint}})));
  this.flowPipe=await d.createComputePipelineAsync({layout:'auto',compute:{module:modules[2],entryPoint:'advanceWater'}});
  const depthStencil={format:'depth32float',depthWriteEnabled:true,depthCompare:'less'};
  const readDepth={format:'depth32float',depthWriteEnabled:false,depthCompare:'less'};
  this.skyPipe=await d.createRenderPipelineAsync({layout:'auto',vertex:{module:modules[3],entryPoint:'skyVertex'},fragment:{module:modules[3],entryPoint:'skyFragment',targets:[{format:this.format}]},primitive:{topology:'triangle-list'},depthStencil:{format:'depth32float',depthWriteEnabled:false,depthCompare:'always'}});
  this.compositePipe=await d.createRenderPipelineAsync({layout:'auto',vertex:{module:modules[3],entryPoint:'skyVertex'},fragment:{module:modules[3],entryPoint:'compositeFragment',targets:[{format:this.format}]},primitive:{topology:'triangle-list'},depthStencil:{format:'depth32float',depthWriteEnabled:false,depthCompare:'always'}});
  this.renderPipes=await Promise.all(['groundFragment','waterFragment','reflectionFragment','rockFragment','rockReflectionFragment'].map((entryPoint,i)=>d.createRenderPipelineAsync({layout:'auto',vertex:{module:modules[3],entryPoint:i===1?'waterVertex':i>=3?'rockVertex':'vertexMain'},fragment:{module:modules[3],entryPoint,targets:[{format:this.format}]},primitive:{topology:'triangle-list',cullMode:i===2||i===4?'front':'back'},depthStencil:i===1?readDepth:depthStencil})));
  const make=(label,size,usage)=>d.createBuffer({label,size,usage});
  this.frameBuffer=make('River view settings',FRAME_BYTES,U.UNIFORM|U.COPY_DST);this.reflectionFrame=make('Reflected river camera',FRAME_BYTES,U.UNIFORM|U.COPY_DST);this.reach=make('Selected downstream reach',REACH_BYTES,U.STORAGE|U.COPY_SRC);
  this.candidates=make('Reach selection reduction',GROUPS*8,U.STORAGE);this.motion=make('GPU water advection',16,U.STORAGE|U.COPY_DST|U.COPY_SRC);
  this.rocks=make('Procedural river obstacles',RIVER_ROCKS*32,U.STORAGE|U.COPY_SRC);
  this.vertices=[make('Procedural river banks',TERRAIN_VERTICES*VERTEX_BYTES,U.STORAGE|U.COPY_SRC),make('Procedural river water',WATER_VERTICES*VERTEX_BYTES,U.STORAGE|U.COPY_SRC)];
  this.indices=[make('River bank triangles',TERRAIN_INDICES*4,U.STORAGE|U.INDEX|U.COPY_SRC),make('River water triangles',WATER_INDICES*4,U.STORAGE|U.INDEX|U.COPY_SRC)];
  const bind=(pipe,entries)=>d.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:entries.map(([binding,buffer])=>({binding,resource:{buffer}}))});
  this.selectionBind=d.createBindGroup({layout:selectLayout,entries:[[0,this.frameBuffer],[1,this.reach],[2,this.world.world],[3,this.candidates]].map(([binding,buffer])=>({binding,resource:{buffer}}))});
  this.geometryBinds=this.geometryPipes.map((pipe,i)=>bind(pipe,i===2?[[0,this.frameBuffer],[1,this.reach],[4,this.rocks]]:[[0,this.frameBuffer],[1,this.reach],[2,this.vertices[i]],[3,this.indices[i]]]));
  this.flowBind=bind(this.flowPipe,[[0,this.frameBuffer],[2,this.motion]]);
  this.renderBinds=[bind(this.renderPipes[0],[[0,this.frameBuffer],[1,this.reach],[2,this.vertices[0]]]),null,bind(this.renderPipes[2],[[0,this.reflectionFrame],[1,this.reach],[2,this.vertices[0]]]),bind(this.renderPipes[3],[[0,this.frameBuffer],[1,this.reach],[8,this.rocks]]),bind(this.renderPipes[4],[[0,this.reflectionFrame],[1,this.reach],[8,this.rocks]])];
  this.skyBinds=[bind(this.skyPipe,[[0,this.frameBuffer],[1,this.reach]]),bind(this.skyPipe,[[0,this.reflectionFrame],[1,this.reach]])];
  this.sceneSampler=d.createSampler({minFilter:'linear',magFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
 }
 resize(){
  const rect=this.canvas.getBoundingClientRect(),ratio=Math.min(window.devicePixelRatio||1,2),limit=this.device.limits.maxTextureDimension2D;
  const width=Math.max(1,Math.min(limit,Math.round(rect.width*ratio))),height=Math.max(1,Math.min(limit,Math.round(rect.height*ratio)));
  if(this.canvas.width!==width||this.canvas.height!==height||!this.depthTexture||this.allocatedReflectionScale!==this.reflectionScale){
   this.canvas.width=width;this.canvas.height=height;for(const texture of [this.depthTexture,this.sceneTexture,this.reflectionTexture,this.reflectionDepth])texture?.destroy();
   const d=this.device,T=GPUTextureUsage,reflectionSize=[Math.max(1,Math.ceil(width*this.reflectionScale)),Math.max(1,Math.ceil(height*this.reflectionScale))];this.allocatedReflectionScale=this.reflectionScale;
   this.depthTexture=d.createTexture({label:'Opaque river depth',size:[width,height],format:'depth32float',usage:T.RENDER_ATTACHMENT|T.TEXTURE_BINDING});
   this.sceneTexture=d.createTexture({label:'Riverbed and banks',size:[width,height],format:this.format,usage:T.RENDER_ATTACHMENT|T.TEXTURE_BINDING});
   this.reflectionTexture=d.createTexture({label:'Reflected riverbanks',size:reflectionSize,format:this.format,usage:T.RENDER_ATTACHMENT|T.TEXTURE_BINDING|T.COPY_SRC});
   this.reflectionDepth=d.createTexture({label:'Reflection depth',size:reflectionSize,format:'depth32float',usage:T.RENDER_ATTACHMENT});
   const sceneView=this.sceneTexture.createView(),depthView=this.depthTexture.createView(),reflectionView=this.reflectionTexture.createView();
   this.compositeBind=d.createBindGroup({layout:this.compositePipe.getBindGroupLayout(0),entries:[{binding:4,resource:sceneView}]});
   this.renderBinds[1]=d.createBindGroup({layout:this.renderPipes[1].getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.frameBuffer}},{binding:1,resource:{buffer:this.reach}},{binding:2,resource:{buffer:this.vertices[1]}},{binding:3,resource:{buffer:this.motion}},{binding:4,resource:sceneView},{binding:5,resource:depthView},{binding:6,resource:reflectionView},{binding:7,resource:this.sceneSampler},{binding:8,resource:{buffer:this.rocks}}]});
  }
 }
 writeFrame(dt){
  const camera=riverCamera(this.camera,this.canvas.width||1,this.canvas.height||1),raw=new ArrayBuffer(FRAME_BYTES),f=new Float32Array(raw),u=new Uint32Array(raw);
  const reflection=riverReflectionCamera(camera,this.canvas.width||1,this.canvas.height||1,this.metadata?.slope||0);
  f.set(camera.vp,0);f.set([...camera.eye,this.paused?0:dt],16);f.set([.40,.80,-.45,this.speed],20);f.set([this.width,this.depth,this.bank,this.roughness],24);
  f.set([this.clarity,this.ripples,this.foam,this.showFlow?1:0],28);u.set([this.seed>>>0,this.variant>>>0,this.canvas.width>>>0,this.canvas.height>>>0],32);f.set(reflection.vp,36);this.device.queue.writeBuffer(this.frameBuffer,0,raw);
  f.set(reflection.vp,0);f.set([...reflection.eye,0],16);this.device.queue.writeBuffer(this.reflectionFrame,0,raw);
 }
 buildGeometry(pass){
  const counts=[Math.max(TERRAIN_VERTICES,TERRAIN_INDICES),Math.max(WATER_VERTICES,WATER_INDICES)];
  for(let i=0;i<2;i++){pass.setPipeline(this.geometryPipes[i]);pass.setBindGroup(0,this.geometryBinds[i]);pass.dispatchWorkgroups(Math.ceil(counts[i]/64));}
  pass.setPipeline(this.geometryPipes[2]);pass.setBindGroup(0,this.geometryBinds[2]);pass.dispatchWorkgroups(1);
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
  if(!this.ready||this.inFlight>=2)return false;this.resize();const dt=this.lastTime?Math.min(1,Math.max(0,(now-this.lastTime)/1000)):0;this.lastTime=now;this.writeFrame(dt);
  const d=this.device,encoder=d.createCommandEncoder({label:'River view frame'}),compute=encoder.beginComputePass();
  if(this.dirty){this.buildGeometry(compute);this.dirty=false;}
  compute.setPipeline(this.flowPipe);compute.setBindGroup(0,this.flowBind);compute.dispatchWorkgroups(1);compute.end();
  const opaque=encoder.beginRenderPass({label:'Riverbed and banks',colorAttachments:[{view:this.sceneTexture.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:.08,g:.13,b:.16,a:1}}],depthStencilAttachment:{view:this.depthTexture.createView(),depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:1}});
  opaque.setPipeline(this.skyPipe);opaque.setBindGroup(0,this.skyBinds[0]);opaque.draw(3);opaque.setPipeline(this.renderPipes[0]);opaque.setBindGroup(0,this.renderBinds[0]);opaque.setIndexBuffer(this.indices[0],'uint32');opaque.drawIndexed(TERRAIN_INDICES);opaque.setPipeline(this.renderPipes[3]);opaque.setBindGroup(0,this.renderBinds[3]);opaque.draw(ROCK_VERTICES,RIVER_ROCKS);opaque.end();
  const reflected=encoder.beginRenderPass({label:'Riverbank reflection',colorAttachments:[{view:this.reflectionTexture.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:.08,g:.13,b:.16,a:1}}],depthStencilAttachment:{view:this.reflectionDepth.createView(),depthLoadOp:'clear',depthStoreOp:'discard',depthClearValue:1}});
  reflected.setPipeline(this.skyPipe);reflected.setBindGroup(0,this.skyBinds[1]);reflected.draw(3);reflected.setPipeline(this.renderPipes[2]);reflected.setBindGroup(0,this.renderBinds[2]);reflected.setIndexBuffer(this.indices[0],'uint32');reflected.drawIndexed(TERRAIN_INDICES);reflected.setPipeline(this.renderPipes[4]);reflected.setBindGroup(0,this.renderBinds[4]);reflected.draw(ROCK_VERTICES,RIVER_ROCKS);reflected.end();
  const pass=encoder.beginRenderPass({label:'Refractive river surface',colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:.08,g:.13,b:.16,a:1}}],depthStencilAttachment:{view:this.depthTexture.createView(),depthReadOnly:true}});
  pass.setPipeline(this.compositePipe);pass.setBindGroup(0,this.compositeBind);pass.draw(3);pass.setPipeline(this.renderPipes[1]);pass.setBindGroup(0,this.renderBinds[1]);pass.setIndexBuffer(this.indices[1],'uint32');pass.drawIndexed(WATER_INDICES);
  pass.end();d.queue.submit([encoder.finish()]);this.inFlight++;d.queue.onSubmittedWorkDone().then(()=>{this.inFlight--;}).catch(()=>{this.inFlight--;});return true;
 }
}

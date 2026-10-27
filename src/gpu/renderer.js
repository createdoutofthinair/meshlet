import { LOD_TRIANGLES } from '../geometry/meshlets.js';
import { orbitCamera } from '../math.js';

const BUFFER=globalThis.GPUBufferUsage;
const createBuffer=(device,data,usage,label)=>{
 const buffer=device.createBuffer({label,size:Math.max(4,data.byteLength),usage,mappedAtCreation:true});
 new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer || data,data.byteOffset || 0,data.byteLength));
 buffer.unmap(); return buffer;
};
async function shader(device,code,label) {
 const module=device.createShaderModule({label,code});
 const info=await module.getCompilationInfo();
 const errors=info.messages.filter(m=>m.type==='error');
 if(errors.length) throw new Error(`${label}: ${errors.map(m=>`${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`);
 return module;
}
const countsCommand=new Uint32Array(LOD_TRIANGLES.flatMap(t=>[t*3,0,0,0]));
const boundsCommand=new Uint32Array(LOD_TRIANGLES.flatMap(()=>[8,0,0,0]));

export class Renderer {
 static async create(canvas,onError) {
  if (!navigator.gpu) throw new Error('WebGPU is unavailable. Use a current WebGPU-enabled browser over HTTPS or localhost.');
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
  if(!adapter) throw new Error('No WebGPU adapter is available. Check browser and graphics driver support.');
  const timing=adapter.features.has('timestamp-query') && !new URLSearchParams(location.search).has('noTimestamps');
  const device=await adapter.requestDevice({requiredFeatures:timing?['timestamp-query']:[]});
  const context=canvas.getContext('webgpu');
  if(!context) throw new Error('Could not create the WebGPU canvas context.');
  const renderer=new Renderer(canvas,adapter,device,context,timing,onError);
  await renderer.init();
  return renderer;
 }
 constructor(canvas,adapter,device,context,timing,onError) {
  Object.assign(this,{canvas,adapter,device,context,timing,onError});
  this.format=navigator.gpu.getPreferredCanvasFormat(); this.scene=null; this.depth=null;
  this.grid=8; this.culling=true;this.colorMode=2;this.lodMode=0;
  this.meshletEdges=true;this.triangleEdges=false;this.projectedBounds=false;this.projectionScope=0;this.resolution=1;
  this.yaw=.75; this.pitch=.8; this.distance=31; this.lastSample=0; this.pendingRead=false;
  this.latest={visible:null,lodCounts:null,gpuComputeMs:null,gpuRenderMs:null}; this.generation=0;
 }
 async init() {
  const {device}=this;
  device.addEventListener('uncapturederror',event=>this.onError?.(`WebGPU: ${event.error.message}`));
  device.lost.then(info=>this.onError?.(`WebGPU device lost: ${info.message || info.reason}. Reload to retry.`));
  this.context.configure({device,format:this.format,alphaMode:'opaque'});
  const fetchText=async path=>{const r=await fetch(new URL(path,import.meta.url));if(!r.ok)throw new Error(`Failed to load ${path}`);return r.text();};
  const [common,cull,render,projection]=await Promise.all([fetchText('./common.wgsl'),fetchText('./cull.wgsl'),fetchText('./render.wgsl'),fetchText('./projection.wgsl')]);
  const [computeModule,renderModule,projectionModule]=await Promise.all([shader(device,common+'\n'+cull,'Meshlet culling'),shader(device,common+'\n'+render,'Meshlet rendering'),shader(device,common+'\n'+projection,'Projected bounds')]);
  this.computePipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:computeModule,entryPoint:'main'}});
  this.renderPipeline=await device.createRenderPipelineAsync({layout:'auto',vertex:{module:renderModule,entryPoint:'vs'},fragment:{module:renderModule,entryPoint:'fs',targets:[{format:this.format}]},primitive:{topology:'triangle-list',cullMode:'back'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
  this.projectionPipeline=await device.createRenderPipelineAsync({layout:'auto',vertex:{module:projectionModule,entryPoint:'vs'},fragment:{module:projectionModule,entryPoint:'fs',targets:[{format:this.format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'line-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'always'}});
  this.uniform=device.createBuffer({label:'Frame uniforms',size:224,usage:BUFFER.UNIFORM|BUFFER.COPY_DST});
  if(this.timing) {
   this.queries=device.createQuerySet({type:'timestamp',count:4});
   this.resolve=device.createBuffer({size:32,usage:BUFFER.QUERY_RESOLVE|BUFFER.COPY_SRC});
  }
 }
 setScene(mesh,grid) {
  const candidates=mesh.meshletCount*grid*grid;
  if(candidates>=2**30)throw new Error('Scene exceeds the meshlet identifier limit.');
  const alignment=this.device.limits.minStorageBufferOffsetAlignment;
  const strideBytes=Math.ceil(candidates*4/alignment)*alignment;
  const maxBinding=this.device.limits.maxStorageBufferBindingSize;
  for(const [label,size] of [['vertices',mesh.vertices.byteLength],['indices',mesh.indices.byteLength],['meshlets',mesh.meshlets.byteLength],['visibility lists',strideBytes*3]]) {
   if(size>maxBinding || size>this.device.limits.maxBufferSize) throw new Error(`${label} buffer exceeds this GPU's limit; select a smaller scene.`);
  }
  if(Math.ceil(candidates/64)>this.device.limits.maxComputeWorkgroupsPerDimension) throw new Error('Scene exceeds the GPU workgroup limit.');
  const d=this.device;
  const next={mesh,grid,candidates,strideBytes,
   vertices:createBuffer(d,mesh.vertices,BUFFER.STORAGE,'Vertices'),
   indices:createBuffer(d,mesh.indices,BUFFER.STORAGE,'LOD triangle indices'),
   meshlets:createBuffer(d,mesh.meshlets,BUFFER.STORAGE,'Meshlets'),
   visible:d.createBuffer({label:'Compacted meshlets by LOD',size:strideBytes*3,usage:BUFFER.STORAGE}),
   indirect:d.createBuffer({label:'GPU indirect draws by LOD',size:48,usage:BUFFER.STORAGE|BUFFER.INDIRECT|BUFFER.COPY_SRC|BUFFER.COPY_DST}),
   boundsIndirect:d.createBuffer({label:'Projected bounds indirect draws',size:48,usage:BUFFER.INDIRECT|BUFFER.COPY_DST})};
  next.computeBind=d.createBindGroup({layout:this.computePipeline.getBindGroupLayout(0),entries:[
   {binding:0,resource:{buffer:this.uniform}},{binding:1,resource:{buffer:next.meshlets}},{binding:2,resource:{buffer:next.visible}},{binding:3,resource:{buffer:next.indirect}}]});
  next.renderBinds=[];next.projectionBinds=[];
  for(let lod=0;lod<3;lod++) {
   const visible={buffer:next.visible,offset:lod*strideBytes,size:candidates*4};
   next.renderBinds.push(d.createBindGroup({layout:this.renderPipeline.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:this.uniform}},{binding:1,resource:{buffer:next.meshlets}},{binding:2,resource:visible},{binding:3,resource:{buffer:next.vertices}},{binding:4,resource:{buffer:next.indices}}]}));
   next.projectionBinds.push(d.createBindGroup({layout:this.projectionPipeline.getBindGroupLayout(0),entries:[
    {binding:0,resource:{buffer:this.uniform}},{binding:1,resource:{buffer:next.meshlets}},{binding:2,resource:visible}]}));
  }
  const old=this.scene; this.scene=next;this.grid=grid;this.generation++;
  this.latest={visible:null,lodCounts:null,gpuComputeMs:null,gpuRenderMs:null};
  if(old) d.queue.onSubmittedWorkDone().then(()=>{for(const key of ['vertices','indices','meshlets','visible','indirect','boundsIndirect'])old[key].destroy();}).catch(()=>{});
 }
 resetCamera(){this.yaw=.75;this.pitch=.8;this.distance=Math.max(16,this.grid*3.8);}
 resize() {
  const rect=this.canvas.getBoundingClientRect();
  const ratio=Math.min(window.devicePixelRatio||1,2)*this.resolution;
  const max=this.device.limits.maxTextureDimension2D;
  const width=Math.min(max,Math.max(1,Math.round(rect.width*ratio))),height=Math.min(max,Math.max(1,Math.round(rect.height*ratio)));
  if(this.canvas.width!==width || this.canvas.height!==height || !this.depth) {
   this.canvas.width=width; this.canvas.height=height;
   this.depth?.destroy();
   this.depth=this.device.createTexture({label:'Depth',size:[width,height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
  }
 }
 frame(now) {
  if(!this.scene)return;
  const cpuStart=performance.now(),{device,scene}=this;
  this.resize();
  const camera=orbitCamera(this.yaw,this.pitch,this.distance,this.canvas.width/this.canvas.height);
  const raw=new ArrayBuffer(224), floats=new Float32Array(raw), uints=new Uint32Array(raw);
  floats.set(camera.vp,0);camera.planes.forEach((p,i)=>floats.set(p,16+i*4));
  floats.set([...camera.eye,0],40);
  const flags=(this.culling?1:0)|(this.meshletEdges?2:0)|(this.triangleEdges?4:0)|(this.lodMode<<3);
  uints.set([this.grid,scene.mesh.meshletCount,scene.candidates,flags],44);
  floats.set([3.0,this.colorMode,this.canvas.height,0],48);
  const projectedObject=this.projectionScope===1?0xffffffff:Math.floor(this.grid/2)*this.grid+Math.floor(this.grid/2);
  uints.set([scene.strideBytes/4,scene.mesh.detail*2+1,projectedObject,0],52);
  device.queue.writeBuffer(this.uniform,0,raw);
  device.queue.writeBuffer(scene.indirect,0,countsCommand);
  if(this.projectedBounds)device.queue.writeBuffer(scene.boundsIndirect,0,boundsCommand);
  const sample=now-this.lastSample>500 && !this.pendingRead;
  if(sample) {this.lastSample=now;this.pendingRead=true;}
  const encoder=device.createCommandEncoder({label:'Meshlet frame'});
  const cp=encoder.beginComputePass(sample && this.timing?{timestampWrites:{querySet:this.queries,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}}:{});
  cp.setPipeline(this.computePipeline);cp.setBindGroup(0,scene.computeBind);cp.dispatchWorkgroups(Math.ceil(scene.candidates/64));cp.end();
  if(this.projectedBounds)for(let lod=0;lod<3;lod++)encoder.copyBufferToBuffer(scene.indirect,lod*16+4,scene.boundsIndirect,lod*16+4,4);
  const passDescriptor={colorAttachments:[{view:this.context.getCurrentTexture().createView(),clearValue:{r:.012,g:.019,b:.027,a:1},loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:this.depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'discard'}};
  if(sample && this.timing)passDescriptor.timestampWrites={querySet:this.queries,beginningOfPassWriteIndex:2,endOfPassWriteIndex:3};
  const pass=encoder.beginRenderPass(passDescriptor);
  pass.setPipeline(this.renderPipeline);
  for(let lod=0;lod<3;lod++){pass.setBindGroup(0,scene.renderBinds[lod]);pass.drawIndirect(scene.indirect,lod*16);}
  if(this.projectedBounds){pass.setPipeline(this.projectionPipeline);for(let lod=0;lod<3;lod++){pass.setBindGroup(0,scene.projectionBinds[lod]);pass.drawIndirect(scene.boundsIndirect,lod*16);}}
  pass.end();
  let readback;
  if(sample) {
   readback=device.createBuffer({size:80,usage:BUFFER.COPY_DST|BUFFER.MAP_READ});
   encoder.copyBufferToBuffer(scene.indirect,0,readback,0,48);
   if(this.timing){encoder.resolveQuerySet(this.queries,0,4,this.resolve,0);encoder.copyBufferToBuffer(this.resolve,0,readback,48,32);}
  }
  device.queue.submit([encoder.finish()]);
  if(readback) {
   const generation=this.generation;
   readback.mapAsync(GPUMapMode.READ).then(()=>{
    const data=readback.getMappedRange(); const commands=new Uint32Array(data,0,12),lodCounts=[commands[1],commands[5],commands[9]];
    let compute=null,render=null;
    if(this.timing) {
     const stamps=new BigUint64Array(data,48,4);
     if(stamps[1]>=stamps[0] && stamps[3]>=stamps[2]) {
      compute=Number(stamps[1]-stamps[0])/1e6;render=Number(stamps[3]-stamps[2])/1e6;
     }
    }
    if(generation===this.generation)this.latest={visible:lodCounts.reduce((a,b)=>a+b,0),lodCounts,gpuComputeMs:compute,gpuRenderMs:render,sampleAt:performance.now()};
    readback.unmap();
   }).catch(error=>this.onError?.(`GPU telemetry: ${error.message}`)).finally(()=>{readback.destroy();this.pendingRead=false;});
  }
  return performance.now()-cpuStart;
 }
}

import {buildWorldGrid} from '../planet/world-grid.js';
import {RADIUS_KM,seedPlates} from '../planet/planet-math.js';
import {REGION_CAPACITY,REGION_LOOKUPS,REGION_SAMPLES} from '../planet/regions.js';

const COUNT=24578,LOOKUP_OFFSET=COUNT*(48+17*16+4);
const VALUES_OFFSET=Math.ceil((LOOKUP_OFFSET+REGION_LOOKUPS*4)/16)*16;
const WORLD_BYTES=VALUES_OFFSET+REGION_CAPACITY*REGION_SAMPLES*16;
export async function checkedShader(device,code,label){
 const module=device.createShaderModule({label,code});const info=await module.getCompilationInfo();const errors=info.messages.filter(x=>x.type==='error');
 if(errors.length)throw new Error(`${label}: ${errors.map(x=>`${x.lineNum}:${x.linePos} ${x.message}`).join('; ')}`);return module;
}
// Revalidate even on legacy unversioned URLs so stale WGSL is not paired with new JS.
export async function readShader(path){const response=await fetch(new URL(path,import.meta.url),{cache:'no-cache'});if(!response.ok)throw new Error(`Could not load shader ${path}`);return response.text();}
export class RiverWorld {
 static async create(device){const world=new RiverWorld(device);await world.init();return world;}
 constructor(device){this.device=device;this.seed=null;}
 async init(){
  const d=this.device,U=GPUBufferUsage,make=(label,size,usage)=>d.createBuffer({label,size,usage}),grid=buildWorldGrid(64);
  this.count=grid.count;this.uniform=make('World drainage uniforms',224,U.UNIFORM|U.COPY_DST);this.plates=make('Seeded planet controls',256,U.STORAGE|U.COPY_DST);
  this.world=make('Shared planet drainage and river paths',WORLD_BYTES,U.STORAGE|U.COPY_SRC);
  this.directions=make('Drainage grid directions',grid.directions.byteLength,U.STORAGE|U.COPY_DST);
  this.neighbors=make('Drainage grid neighbors',grid.neighbors.byteLength,U.STORAGE|U.COPY_DST);
  this.flowA=make('Drainage flow A',grid.count*4,U.STORAGE);this.flowB=make('Drainage flow B',grid.count*4,U.STORAGE);
  d.queue.writeBuffer(this.directions,0,grid.directions);d.queue.writeBuffer(this.neighbors,0,grid.neighbors);
  const [common,core,curve,source]=await Promise.all(['../planet/common.wgsl','../planet/terrain-core.wgsl','../planet/river-curve.wgsl','../planet/hydrology.wgsl'].map(readShader));
  const module=await checkedShader(d,[common,core,curve,source].join('\n'),'River world drainage');
  const main=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}}]});
  const work=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}}]});
  const layout=d.createPipelineLayout({bindGroupLayouts:[main,work]});
  const names=['initialize','initializeFlood','flood','saveFlood','route','clearFlow','runoff','prepareSediment','sediment','applySediment','finish','buildRiverPaths'];
  const pipes=await Promise.all(names.map(entryPoint=>d.createComputePipelineAsync({layout,compute:{module,entryPoint}})));this.pipes=Object.fromEntries(names.map((name,i)=>[name,pipes[i]]));
  this.main=d.createBindGroup({layout:main,entries:[{binding:0,resource:{buffer:this.uniform}},{binding:4,resource:{buffer:this.plates}}]});
  this.work=[[this.flowA,this.flowB],[this.flowB,this.flowA]].map(([input,output])=>d.createBindGroup({layout:work,entries:[this.world,this.directions,this.neighbors,input,output].map((buffer,binding)=>({binding,resource:{buffer}}))}));
 }
 generate(seed){
  seed=seed>>>0;if(this.seed===seed)return false;const d=this.device;
  d.queue.writeBuffer(this.plates,0,seedPlates(seed));d.queue.writeBuffer(this.uniform,160,new Float32Array([RADIUS_KM]));d.queue.writeBuffer(this.uniform,184,new Uint32Array([seed]));
  const encoder=d.createCommandEncoder({label:'Generate seeded river network'}),pass=encoder.beginComputePass();pass.setBindGroup(0,this.main);
  const run=(name,work=0,count=this.count)=>{pass.setPipeline(this.pipes[name]);pass.setBindGroup(1,this.work[work]);pass.dispatchWorkgroups(Math.ceil(count/64));};
  const clear=()=>{run('clearFlow',0);run('clearFlow',1);};const propagate=name=>{for(let i=0;i<128;i++)run(name,i&1);};
  const fill=()=>{run('initializeFlood',1);for(let i=0;i<256;i++)run('flood',i&1);run('saveFlood');};
  run('initialize');for(let epoch=0;epoch<3;epoch++){fill();run('route');clear();propagate('runoff');run('prepareSediment');clear();propagate('sediment');run('applySediment');}
  fill();run('route');clear();propagate('runoff');run('finish');run('buildRiverPaths',0,this.count*17);pass.end();d.queue.submit([encoder.finish()]);this.seed=seed;return true;
 }
}

import {RADIUS_KM,PATCH_CELLS,FACE_BASES,faceCube,seedPlates,normalize,add,scale} from './planet-math.js';
import {planetCamera} from './camera.js';
import {selectPatches} from './quadtree.js';
import {buildWorldGrid} from './world-grid.js';
import {regionsAround,REGION_FACE_TILES,REGION_CAPACITY,REGION_GRID,REGION_SAMPLES,REGION_LOOKUPS} from './regions.js';
const BUFFER=globalThis.GPUBufferUsage;
const CAPACITY=512,GRID=21,VERTEX_BYTES=48,MESHLETS=16,PATCH_BYTES=128;
const REGION_LOOKUP_OFFSET=24578*(48+17*16+4);
const REGION_VALUES_OFFSET=Math.ceil((REGION_LOOKUP_OFFSET+REGION_LOOKUPS*4)/16)*16;
const WORLD_BYTES=REGION_VALUES_OFFSET+REGION_CAPACITY*REGION_SAMPLES*16;
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
  this.seed=918273;this.relief=1;this.valleys=1;this.erosion=1;this.regional=true;this.rivers=true;this.biomes=true;this.ocean=true;this.followSun=true;this.culling=true;this.lodColors=false;this.wireframe=false;this.patchLines=false;
  this.budget=384;this.pixelSize=14;this.resolution=1;this.maxDepth=20;
  this.patchBytes=new ArrayBuffer(CAPACITY*PATCH_BYTES);this.patchFloats=new Float32Array(this.patchBytes);this.patchUints=new Uint32Array(this.patchBytes);
  this.slotByKey=new Map();this.stitchByKey=new Map();this.free=Array.from({length:CAPACITY},(_,i)=>CAPACITY-1-i);this.patches=[];this.pending=[];this.normalPending=[];
  this.needsSelection=true;this.lastSelection=0;this.previousSplits=null;this.lodErrors=new Map();this.latest={visibleMeshlets:null,gpuComputeMs:null,gpuRenderMs:null};
  this.lastSample=0;this.pendingRead=false;this.generation=0;this.inFlight=0;this.probePending=false;this.lastProbeKey='';this.lastProbeTime=0;this.stats={leaves:0,visiblePatches:0,deepest:0,selectionMs:0,generated:0};
  this.hydrologySeed=null;
  this.regionSeed=null;this.regions=new Map();this.regionFree=Array.from({length:REGION_CAPACITY},(_,i)=>REGION_CAPACITY-1-i);
  this.regionLookup=new Uint32Array(REGION_LOOKUPS);this.regionLookup.fill(0xffffffff);
  this.regionMeta=new Uint32Array(REGION_CAPACITY*4);this.regionPending=[];
 }
 async init(){
  const d=this.device;d.addEventListener('uncapturederror',e=>this.onError?.(`WebGPU: ${e.error.message}`));
  d.lost.then(info=>this.onError?.(`WebGPU device lost: ${info.message||info.reason}. Reload to retry.`));
  this.context.configure({device:d,format:this.format,alphaMode:'opaque'});
  const fetchText=async p=>{const r=await fetch(new URL(p,import.meta.url));if(!r.ok)throw new Error(`Failed to load ${p}`);return r.text();};
  const [common,terrainCore,riverCurve,hydrologySource,worldField,riverDetailSource,regionalSource,terrainSurface,...sources]=await Promise.all(['./common.wgsl','./terrain-core.wgsl','./river-curve.wgsl','./hydrology.wgsl','./world-field.wgsl','./river-detail.wgsl','./regional-hydrology.wgsl','./terrain-surface.wgsl','./generate.wgsl','./normal.wgsl','./bounds.wgsl','./cull.wgsl','./render.wgsl','./lod-error.wgsl'].map(fetchText));
  const labels=['Terrain generation','Terrain normals','Meshlet bounds','Meshlet culling','Planet rendering','Terrain LOD residual'];
  const modules=await Promise.all(sources.map((s,i)=>shader(d,common+'\n'+(i===0||i===4?terrainCore+'\n'+riverCurve+'\n'+worldField+'\n'+terrainSurface+'\n':'')+s,labels[i])));
  [this.generatePipe,this.normalPipe,this.boundsPipe,this.cullPipe]=await Promise.all(modules.slice(0,4).map(module=>d.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}})));
  this.lodErrorPipe=await d.createComputePipelineAsync({layout:'auto',compute:{module:modules[5],entryPoint:'main'}});
  [this.highlandsPipe,this.pointPipe,this.valleyPipe,this.riverPipe]=await Promise.all(['highlands','point','valleyCandidates','riverCandidates'].map(entryPoint=>d.createComputePipelineAsync({layout:'auto',compute:{module:modules[0],entryPoint}})));
  this.renderPipe=await d.createRenderPipelineAsync({layout:'auto',vertex:{module:modules[4],entryPoint:'vs'},fragment:{module:modules[4],entryPoint:'fs',targets:[{format:this.format}]},primitive:{topology:'triangle-list',cullMode:'back'},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'greater'}});
  const make=(label,size,usage)=>d.createBuffer({label,size,usage});
  this.uniform=make('Planet frame',224,BUFFER.UNIFORM|BUFFER.COPY_DST);
  this.patchBuffer=make('Planet patches',this.patchBytes.byteLength,BUFFER.STORAGE|BUFFER.COPY_DST);
  this.vertices=make('Cached GPU terrain vertices',CAPACITY*GRID*GRID*VERTEX_BYTES,BUFFER.STORAGE|BUFFER.COPY_SRC);
  this.lodErrorBuffer=make('Measured terrain LOD residuals',CAPACITY*4,BUFFER.STORAGE|BUFFER.COPY_SRC);
  this.riverMasks=make('Cached river coverage',CAPACITY*1681*8,BUFFER.STORAGE|BUFFER.COPY_SRC);
  this.bounds=make('Terrain meshlet bounds',CAPACITY*MESHLETS*16,BUFFER.STORAGE);
  this.activeBuffer=make('Active patches',CAPACITY*4,BUFFER.STORAGE|BUFFER.COPY_DST);
  this.queueBuffer=make('New patch queue',CAPACITY*4,BUFFER.STORAGE|BUFFER.COPY_DST);
  this.normalQueueBuffer=make('Patch normal update queue',CAPACITY*4,BUFFER.STORAGE|BUFFER.COPY_DST);
  this.plates=make('Seeded plate controls',16*16,BUFFER.STORAGE|BUFFER.COPY_DST);
  const grid=buildWorldGrid(64);if(grid.count!==24578)throw new Error('Invalid world simulation grid');
  this.worldCount=grid.count;
  this.world=make('World drainage, erosion and regional simulation',WORLD_BYTES,BUFFER.STORAGE|BUFFER.COPY_SRC|BUFFER.COPY_DST);
  d.queue.writeBuffer(this.world,REGION_LOOKUP_OFFSET,this.regionLookup);
  this.regionMetaBuffer=make('Regional simulation tile metadata',this.regionMeta.byteLength,BUFFER.STORAGE|BUFFER.COPY_DST);
  this.regionQueueBuffer=make('Regional simulation tile queue',REGION_CAPACITY*4,BUFFER.STORAGE|BUFFER.COPY_DST);
  const regionStateBytes=REGION_CAPACITY*REGION_GRID*REGION_GRID*16;
  this.regionA=make('Regional water and sediment A',regionStateBytes,BUFFER.STORAGE|BUFFER.COPY_SRC);
  this.regionB=make('Regional water and sediment B',regionStateBytes,BUFFER.STORAGE|BUFFER.COPY_SRC);
  this.regionFlux=make('Regional water outflow',regionStateBytes,BUFFER.STORAGE|BUFFER.COPY_SRC);
  this.worldDirections=make('World grid directions',grid.directions.byteLength,BUFFER.STORAGE|BUFFER.COPY_DST);
  this.worldNeighbors=make('World grid neighbors',grid.neighbors.byteLength,BUFFER.STORAGE|BUFFER.COPY_DST);
  this.worldFaces=make('World grid face indices',grid.faceIndices.byteLength,BUFFER.STORAGE|BUFFER.COPY_DST);
  this.flowA=make('World flow A',grid.count*4,BUFFER.STORAGE);this.flowB=make('World flow B',grid.count*4,BUFFER.STORAGE);
  d.queue.writeBuffer(this.worldDirections,0,grid.directions);d.queue.writeBuffer(this.worldNeighbors,0,grid.neighbors);d.queue.writeBuffer(this.worldFaces,0,grid.faceIndices);
  const hydroModule=await shader(d,common+'\n'+terrainCore+'\n'+riverCurve+'\n'+hydrologySource,'World hydrology');
  const riverDetailModule=await shader(d,common+'\n'+riverCurve+'\n'+worldField+'\n'+riverDetailSource,'River coverage');
  const writableWorld=worldField.replace('var<storage,read> world:','var<storage,read_write> world:');
  const regionalModule=await shader(d,common+'\n'+terrainCore+'\n'+riverCurve+'\n'+writableWorld+'\n'+regionalSource,'Regional hydrology');
  const regionalNames=['initializeRegion','regionFlux','regionStep','finishRegion'];
  const regionalPipelines=await Promise.all(regionalNames.map(entryPoint=>d.createComputePipelineAsync({layout:'auto',compute:{module:regionalModule,entryPoint}})));
  this.regionPipes=Object.fromEntries(regionalNames.map((name,i)=>[name,regionalPipelines[i]]));
  this.riverDetailPipe=await d.createComputePipelineAsync({layout:'auto',compute:{module:riverDetailModule,entryPoint:'main'}});
  const mainLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}}]});
  const workLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}}]});
  const hydroLayout=d.createPipelineLayout({bindGroupLayouts:[mainLayout,workLayout]});
  const names=['initialize','initializeFlood','flood','saveFlood','route','clearFlow','runoff','prepareSediment','sediment','applySediment','finish','initializeLake','spreadLakeMinimum','saveLakeMinimum','markRiverPresence','buildRiverPaths'];
  const hydroPipelines=await Promise.all(names.map(entryPoint=>d.createComputePipelineAsync({layout:hydroLayout,compute:{module:hydroModule,entryPoint}})));
  this.hydroPipes=Object.fromEntries(names.map((name,i)=>[name,hydroPipelines[i]]));
  this.hydroMain=d.createBindGroup({layout:mainLayout,entries:[{binding:0,resource:{buffer:this.uniform}},{binding:4,resource:{buffer:this.plates}}]});
  this.hydroWork=[[this.flowA,this.flowB],[this.flowB,this.flowA]].map(([input,output])=>d.createBindGroup({layout:workLayout,entries:[{binding:0,resource:{buffer:this.world}},{binding:1,resource:{buffer:this.worldDirections}},{binding:2,resource:{buffer:this.worldNeighbors}},{binding:3,resource:{buffer:input}},{binding:4,resource:{buffer:output}}]}));
  this.sampleBuffer=make('Terrain probe samples',grid.count*16,BUFFER.STORAGE|BUFFER.COPY_SRC);
  this.probeInput=make('Surface probe direction',16,BUFFER.UNIFORM|BUFFER.COPY_DST);
  this.visible=make('Visible planet meshlets',CAPACITY*MESHLETS*4,BUFFER.STORAGE);
  this.indirect=make('Planet indirect draw',16,BUFFER.STORAGE|BUFFER.INDIRECT|BUFFER.COPY_DST|BUFFER.COPY_SRC);
  const bind=(pipe,resources)=>d.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:resources.map((buffer,binding)=>({binding,resource:{buffer}}))});
  const bindEntries=(pipe,entries)=>d.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:entries.map(([binding,buffer])=>({binding,resource:{buffer}}))});
  const worldEntries=[[7,this.world],[8,this.worldDirections],[9,this.worldNeighbors],[10,this.worldFaces]];
  this.regionInitBind=bindEntries(this.regionPipes.initializeRegion,[[0,this.uniform],[4,this.plates],[7,this.world],[8,this.worldDirections],[10,this.worldFaces],[12,this.regionMetaBuffer],[13,this.regionQueueBuffer],[15,this.regionA]]);
  this.regionFluxBinds=[this.regionA,this.regionB].map(input=>bindEntries(this.regionPipes.regionFlux,[[0,this.uniform],[13,this.regionQueueBuffer],[14,input],[16,this.regionFlux]]));
  this.regionStepBinds=[[this.regionA,this.regionB],[this.regionB,this.regionA]].map(([input,output])=>bindEntries(this.regionPipes.regionStep,[[0,this.uniform],[13,this.regionQueueBuffer],[14,input],[15,output],[16,this.regionFlux]]));
  this.regionFinishBind=bindEntries(this.regionPipes.finishRegion,[[0,this.uniform],[7,this.world],[13,this.regionQueueBuffer],[14,this.regionA]]);
  this.generateBind=bindEntries(this.generatePipe,[[0,this.uniform],[1,this.patchBuffer],[2,this.vertices],[3,this.queueBuffer],[4,this.plates],[7,this.world],[8,this.worldDirections],[10,this.worldFaces],[11,this.riverMasks]]);
  this.lodErrorBind=bind(this.lodErrorPipe,[this.uniform,this.vertices,this.queueBuffer,this.lodErrorBuffer]);
  this.riverDetailBind=bindEntries(this.riverDetailPipe,[[0,this.uniform],[1,this.patchBuffer],[3,this.queueBuffer],...worldEntries,[11,this.riverMasks]]);
  this.normalBind=bind(this.normalPipe,[this.uniform,this.patchBuffer,this.vertices,this.normalQueueBuffer]);
  this.boundsBind=bind(this.boundsPipe,[this.uniform,this.vertices,this.bounds,this.queueBuffer]);
  this.cullBind=bind(this.cullPipe,[this.uniform,this.patchBuffer,this.bounds,this.activeBuffer,this.visible,this.indirect]);
  this.renderBind=bindEntries(this.renderPipe,[[0,this.uniform],[1,this.patchBuffer],[2,this.vertices],[3,this.visible],[5,this.plates],...worldEntries]);
  this.highlandsBind=bindEntries(this.highlandsPipe,[[0,this.uniform],[4,this.plates],[5,this.sampleBuffer],...worldEntries]);
  this.valleyBind=d.createBindGroup({layout:this.valleyPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}},{binding:4,resource:{buffer:this.plates}},{binding:5,resource:{buffer:this.sampleBuffer}}]});
  this.pointBind=bindEntries(this.pointPipe,[[0,this.uniform],[4,this.plates],[5,this.sampleBuffer],[6,this.probeInput],...worldEntries]);
  this.riverBind=bindEntries(this.riverPipe,[[5,this.sampleBuffer],[7,this.world],[8,this.worldDirections]]);
  if(this.timing){this.queries=d.createQuerySet({type:'timestamp',count:4});this.resolve=make('GPU timestamp resolve',32,BUFFER.QUERY_RESOLVE|BUFFER.COPY_SRC);}
  d.queue.writeBuffer(this.plates,0,seedPlates(this.seed));
 }
 ensureHydrology(){
  const seed=this.seed>>>0;if(this.hydrologySeed===seed)return;
  const d=this.device;d.queue.writeBuffer(this.uniform,160,new Float32Array([RADIUS_KM]));d.queue.writeBuffer(this.uniform,184,new Uint32Array([seed]));
  const encoder=d.createCommandEncoder({label:'Seeded world drainage and erosion'}),pass=encoder.beginComputePass();pass.setBindGroup(0,this.hydroMain);
  const run=(name,work=0,count=this.worldCount)=>{pass.setPipeline(this.hydroPipes[name]);pass.setBindGroup(1,this.hydroWork[work]);pass.dispatchWorkgroups(Math.ceil(count/64));};
  const clear=()=>{run('clearFlow',0);run('clearFlow',1);};
  const propagate=name=>{for(let i=0;i<128;i++)run(name,i&1);};
  const fill=()=>{run('initializeFlood',1);for(let i=0;i<256;i++)run('flood',i&1);run('saveFlood');};
  run('initialize');
  for(let epoch=0;epoch<3;epoch++){fill();run('route');clear();propagate('runoff');run('prepareSediment');clear();propagate('sediment');run('applySediment');}
  fill();run('route');clear();propagate('runoff');run('finish');
  run('initializeLake',1);for(let i=0;i<128;i++)run('spreadLakeMinimum',i&1);run('saveLakeMinimum');
  run('markRiverPresence');run('buildRiverPaths',0,this.worldCount*17);pass.end();d.queue.submit([encoder.finish()]);this.hydrologySeed=seed;
 }
 resetPatchCache(){
  this.slotByKey.clear();this.stitchByKey.clear();this.free=Array.from({length:CAPACITY},(_,i)=>CAPACITY-1-i);this.pending=[];this.normalPending=[];this.patches=[];
  this.lodErrors.clear();
  this.needsSelection=true;this.generation++;this.lastProbeKey='';
  this.latest={visibleMeshlets:null,gpuComputeMs:null,gpuRenderMs:null};
 }
 resetRegions(){
  this.regionSeed=this.seed>>>0;this.regions.clear();this.regionFree=Array.from({length:REGION_CAPACITY},(_,i)=>REGION_CAPACITY-1-i);
  this.regionLookup.fill(0xffffffff);this.regionPending=[];
  this.device.queue.writeBuffer(this.world,REGION_LOOKUP_OFFSET,this.regionLookup);
 }
 invalidateTerrain(){
  this.resetPatchCache();if(this.regionSeed!==(this.seed>>>0))this.resetRegions();
  this.device.queue.writeBuffer(this.plates,0,seedPlates(this.seed));
  if(this.cameraState.altitude<50)this.cameraState.surfaceHeight=10;
 }
 invalidateRegionalPatches(changed){
  const around=new Map(),span=2/REGION_FACE_TILES;
  for(const r of changed){const direction=faceCube(r.face,-1+(r.x+.5)*span,-1+(r.y+.5)*span);for(const neighbor of regionsAround(direction))around.set(neighbor.id,neighbor);}
  const touched=new Set(),candidates=[...around.values()];
  for(const node of this.patches){
   const half=node.span/2;
   if(candidates.some(r=>r.face===node.face && node.u+half>=-1+r.x*span && node.u-half<=-1+(r.x+1)*span && node.v+half>=-1+r.y*span && node.v-half<=-1+(r.y+1)*span)){
    const slot=this.slotByKey.get(node.key);if(slot!==undefined){this.slotByKey.delete(node.key);this.stitchByKey.delete(node.key);this.lodErrors.delete(node.key);this.free.push(slot);touched.add(node.key);}
   }
  }
  for(const node of this.patches)if(node.edgeKeys.some(key=>touched.has(key))||node.cornerKeys.some(keys=>keys.some(key=>touched.has(key))))this.stitchByKey.delete(node.key);
  this.needsSelection=true;this.generation++;this.lastProbeKey='';this.latest={visibleMeshlets:null,gpuComputeMs:null,gpuRenderMs:null};
 }
 prepareRegions(camera){
  if(this.regionSeed!==(this.seed>>>0))this.resetRegions();
  if(camera.clearance>=50 || this.erosion<=0 || !this.regional)return false;
  const requested=regionsAround(camera.radial),protectedIds=new Set(requested.map(r=>r.id)),pending=[],changed=[];
  for(const region of requested){
   if(this.regions.has(region.id)){const slot=this.regions.get(region.id);this.regions.delete(region.id);this.regions.set(region.id,slot);continue;}
   let slot=this.regionFree.pop();
   if(slot===undefined){
    const entry=[...this.regions].find(([id])=>!protectedIds.has(id));if(!entry)throw new Error('Regional simulation cache exhausted');
    this.regions.delete(entry[0]);this.regionLookup[entry[0]]=0xffffffff;slot=entry[1];
    changed.push({face:this.regionMeta[slot*4],x:this.regionMeta[slot*4+1],y:this.regionMeta[slot*4+2]});
   }
   this.regions.set(region.id,slot);this.regionLookup[region.id]=slot;
   this.regionMeta.set([region.face,region.x,region.y,0],slot*4);pending.push(slot);changed.push(region);
  }
  if(!pending.length)return false;
  this.regionPending=pending;const d=this.device;
  d.queue.writeBuffer(this.world,REGION_LOOKUP_OFFSET,this.regionLookup);
  d.queue.writeBuffer(this.regionMetaBuffer,0,this.regionMeta);d.queue.writeBuffer(this.regionQueueBuffer,0,new Uint32Array(pending));
  this.invalidateRegionalPatches(changed);this.lastSelection=0;this.lastProbeTime=0;return true;
 }
 resize(){
  const rect=this.canvas.getBoundingClientRect(),ratio=Math.min(window.devicePixelRatio||1,2)*this.resolution,max=this.device.limits.maxTextureDimension2D;
  const w=Math.min(max,Math.max(1,Math.round(rect.width*ratio))),h=Math.min(max,Math.max(1,Math.round(rect.height*ratio)));
  if(this.canvas.width!==w||this.canvas.height!==h||!this.depth){this.canvas.width=w;this.canvas.height=h;this.depth?.destroy();this.depth=this.device.createTexture({label:'Planet reverse-Z depth',size:[w,h],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT});this.needsSelection=true;}
 }
 select(camera,now){
  const start=performance.now();
  const result=selectPatches(camera,{budget:this.budget,maxDepth:this.maxDepth,pixelSize:this.pixelSize,previousSplits:this.previousSplits,errorEstimates:this.lodErrors});
  this.previousSplits=result.splits;
  const wantedNodes=new Map(result.visible.map(p=>[p.key,p])),wanted=new Set(wantedNodes.keys());
  // Only patches touching an edge or corner can supply that vertex's normal.
  // Tracking this local graph refreshes dependent cached normals without
  // invalidating unrelated patches several tiles away.
  const signatureFor=node=>{
   let hash=(2166136261^node.normalStitch)>>>0;
   const mixKey=key=>{for(let i=0;i<key.length;i++)hash=Math.imul(hash^key.charCodeAt(i),16777619)>>>0;};
   for(const key of node.edgeKeys){
    const other=wantedNodes.get(key);if(!other){hash=Math.imul(hash^0xff,16777619)>>>0;continue;}
    mixKey(key);hash=Math.imul(hash^other.normalStitch,16777619)>>>0;
   }
   for(const corner of node.cornerKeys){
    const owners=new Set([node.key,...corner]);hash=Math.imul(hash^0x7f,16777619)>>>0;
    for(const key of [...owners].sort()){
     const other=wantedNodes.get(key);if(!other)continue;mixKey(key);hash=Math.imul(hash^other.normalStitch,16777619)>>>0;
     for(const peer of other.edgeKeys)if(owners.has(peer)&&wantedNodes.has(peer))mixKey(peer);
    }
   }
   return hash;
  };
  for(const [key,slot] of this.slotByKey)if(!wanted.has(key)){this.slotByKey.delete(key);this.stitchByKey.delete(key);this.free.push(slot);}
  const pending=[],normalPending=[];
  this.patches=result.visible.map(node=>{
   const signature=signatureFor(node);
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
 async sampleTerrain(direction=null,kind='terrain'){
  const d=this.device,all=!direction,count=all?(kind==='rivers'?this.worldCount:6*24*24):1,size=count*16;
  d.queue.writeBuffer(this.uniform,164,new Float32Array([this.relief]));
  d.queue.writeBuffer(this.uniform,172,new Float32Array([this.valleys]));
  d.queue.writeBuffer(this.uniform,184,new Uint32Array([this.seed>>>0]));
  d.queue.writeBuffer(this.uniform,208,new Float32Array([this.erosion,this.rivers?1:0,this.regional?1:0,0]));this.ensureHydrology();
  if(direction)d.queue.writeBuffer(this.probeInput,0,new Float32Array([...direction,0]));
  const readback=d.createBuffer({size,usage:BUFFER.COPY_DST|BUFFER.MAP_READ}),encoder=d.createCommandEncoder();
  const pipe=kind==='rivers'?this.riverPipe:kind==='valleys'?this.valleyPipe:this.highlandsPipe,bind=kind==='rivers'?this.riverBind:kind==='valleys'?this.valleyBind:this.highlandsBind;
  const pass=encoder.beginComputePass();pass.setPipeline(all?pipe:this.pointPipe);pass.setBindGroup(0,all?bind:this.pointBind);pass.dispatchWorkgroups(all?Math.ceil(count/64):1);pass.end();
  encoder.copyBufferToBuffer(this.sampleBuffer,0,readback,0,size);d.queue.submit([encoder.finish()]);
  try{await readback.mapAsync(GPUMapMode.READ);const data=new Float32Array(readback.getMappedRange().slice(0));readback.unmap();return data;}
  finally{readback.destroy();}
 }
 async findHighlands(){
  const generation=this.generation,data=await this.sampleTerrain();if(generation!==this.generation)return null;
  let best=0;for(let i=4;i<data.length;i+=4)if(data[i+3]>data[best+3])best=i;
  return {direction:[data[best],data[best+1],data[best+2]],height:data[best+3]};
 }
 async findValleys(){
  const generation=this.generation,data=await this.sampleTerrain(null,'valleys');if(generation!==this.generation)return null;
  let best=0;for(let i=4;i<data.length;i+=4)if(data[i+3]>data[best+3])best=i;
  const direction=[data[best],data[best+1],data[best+2]],height=await this.sampleTerrain(direction);
  return generation===this.generation?{direction,height:height[3],incision:data[best+3]}:null;
 }
 async findRivers(){
  const generation=this.generation,data=await this.sampleTerrain(null,'rivers');if(generation!==this.generation)return null;
  let best=0;for(let i=4;i<data.length;i+=4)if(data[i+3]>data[best+3])best=i;
  const direction=[data[best],data[best+1],data[best+2]],height=await this.sampleTerrain(direction);
  return generation===this.generation?{direction,height:height[3],flow:data[best+3]}:null;
 }
 requestSurface(camera,now){
  if(this.cameraState.altitude>=50){this.cameraState.surfaceHeight=0;return;}
  const key=[this.seed,this.relief,this.valleys,this.erosion,this.regional,this.rivers,this.ocean,...camera.radial.map(x=>x.toFixed(7))].join('/');
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
  const regionsChanged=this.prepareRegions(camera);
  if(!regionsChanged)this.requestSurface(camera,now);
  if(this.needsSelection && (now-this.lastSelection>100||!this.patches.length))this.select(camera,now);
  for(const node of this.patches){
   const i=node.slot*32,b=FACE_BASES[node.face],cube=faceCube(node.face,node.u,node.v);
   this.patchFloats.set([...cube,node.span],i);this.patchFloats.set([...b.u,0],i+4);this.patchFloats.set([...b.v,0],i+8);
   const high=node.direction.map(Math.fround),low=node.direction.map((x,k)=>x-high[k]);
   this.patchFloats.set([...high,0],i+12);this.patchFloats.set([...low,0],i+16);
   this.patchFloats.set(node.direction.map((x,k)=>x*RADIUS_KM-camera.eye[k]).concat(0),i+20);
   this.patchUints.set([node.face,node.level,node.stitch,node.normalStitch],i+24);
   this.patchUints.set(node.edgeKeys.map(key=>this.slotByKey.get(key)??0xffffffff),i+28);
  }
  const raw=new ArrayBuffer(224),f=new Float32Array(raw),u=new Uint32Array(raw);
  f.set(camera.vp,0);camera.planes.forEach((p,i)=>f.set(p,16+i*4));
  let sun=normalize([.55,.42,.72]);
  if(this.followSun){
   const low=this.cameraState.mode==='flyover';
   sun=normalize(add(add(scale(camera.radial,low ? .32 : .72),scale(camera.right,low ? .9 : .55)),scale(camera.up,low ? .22 : .25)));
  }
  f.set([...sun,0],36);f.set([RADIUS_KM,this.relief,this.ocean?1:0,this.valleys],40);
  const flags=(this.culling?1:0)|(this.lodColors?2:0)|(this.wireframe?4:0)|(this.patchLines?8:0)|(this.biomes?16:0);
  u.set([this.patches.length,this.pending.length,this.seed>>>0,flags],44);
  u.set([this.normalPending.length,this.regionPending.length,0,0],48);
  f.set([this.erosion,this.rivers?1:0,this.regional?1:0,0],52);
  const d=this.device;d.queue.writeBuffer(this.uniform,0,raw);d.queue.writeBuffer(this.patchBuffer,0,this.patchBytes);
  if(this.patches.length)d.queue.writeBuffer(this.activeBuffer,0,new Uint32Array(this.patches.map(p=>p.slot)));
  if(this.pending.length)d.queue.writeBuffer(this.queueBuffer,0,new Uint32Array(this.pending));
  if(this.normalPending.length)d.queue.writeBuffer(this.normalQueueBuffer,0,new Uint32Array(this.normalPending));
  d.queue.writeBuffer(this.indirect,0,new Uint32Array([96,0,0,0]));
  this.ensureHydrology();
  const generatedOnSample=this.pending.length;
  const sample=(generatedOnSample>0||now-this.lastSample>500)&&!this.pendingRead;if(sample){this.lastSample=now;this.pendingRead=true;}
  const encoder=d.createCommandEncoder({label:'Planet frame'});
  const cp=encoder.beginComputePass(sample&&this.timing?{timestampWrites:{querySet:this.queries,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}}:{});
  const dispatch=(pipe,bind,count)=>{if(count){cp.setPipeline(pipe);cp.setBindGroup(0,bind);cp.dispatchWorkgroups(Math.ceil(count/64));}};
  const regionCount=this.regionPending.length;
  if(regionCount){
   dispatch(this.regionPipes.initializeRegion,this.regionInitBind,regionCount*REGION_GRID*REGION_GRID);
   for(let i=0;i<6;i++){
    dispatch(this.regionPipes.regionFlux,this.regionFluxBinds[i&1],regionCount*REGION_GRID*REGION_GRID);
    dispatch(this.regionPipes.regionStep,this.regionStepBinds[i&1],regionCount*REGION_GRID*REGION_GRID);
   }
   dispatch(this.regionPipes.finishRegion,this.regionFinishBind,regionCount*REGION_SAMPLES);
  }
  dispatch(this.riverDetailPipe,this.riverDetailBind,this.pending.length*1681);
  dispatch(this.generatePipe,this.generateBind,this.pending.length*GRID*GRID);
  if(this.pending.length){cp.setPipeline(this.lodErrorPipe);cp.setBindGroup(0,this.lodErrorBind);cp.dispatchWorkgroups(this.pending.length);}
  dispatch(this.normalPipe,this.normalBind,this.normalPending.length*17*17);
  dispatch(this.boundsPipe,this.boundsBind,this.pending.length*MESHLETS);
  dispatch(this.cullPipe,this.cullBind,this.patches.length*MESHLETS);cp.end();
  const descriptor={colorAttachments:[{view:this.context.getCurrentTexture().createView(),clearValue:{r:.006,g:.009,b:.016,a:1},loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:this.depth.createView(),depthClearValue:0,depthLoadOp:'clear',depthStoreOp:'discard'}};
  if(sample&&this.timing)descriptor.timestampWrites={querySet:this.queries,beginningOfPassWriteIndex:2,endOfPassWriteIndex:3};
  const pass=encoder.beginRenderPass(descriptor);pass.setPipeline(this.renderPipe);pass.setBindGroup(0,this.renderBind);pass.drawIndirect(this.indirect,0);pass.end();
  const measured=sample?this.patches.map(({key,slot})=>({key,slot})):null;
  let readback;if(sample){readback=d.createBuffer({size:48+CAPACITY*4,usage:BUFFER.COPY_DST|BUFFER.MAP_READ});encoder.copyBufferToBuffer(this.indirect,0,readback,0,16);encoder.copyBufferToBuffer(this.lodErrorBuffer,0,readback,48,CAPACITY*4);if(this.timing){encoder.resolveQuerySet(this.queries,0,4,this.resolve,0);encoder.copyBufferToBuffer(this.resolve,0,readback,16,32);}}
  d.queue.submit([encoder.finish()]);this.pending=[];this.normalPending=[];this.regionPending=[];this.inFlight++;
  d.queue.onSubmittedWorkDone().then(()=>{this.inFlight--;}).catch(()=>{this.inFlight--;});
  if(readback){const generation=this.generation;readback.mapAsync(GPUMapMode.READ).then(()=>{
   const data=readback.getMappedRange(),visibleMeshlets=new Uint32Array(data,0,4)[1];let gpuComputeMs=null,gpuRenderMs=null;
   if(this.timing){const t=new BigUint64Array(data,16,4);if(t[1]>=t[0]&&t[3]>=t[2]){gpuComputeMs=Number(t[1]-t[0])/1e6;gpuRenderMs=Number(t[3]-t[2])/1e6;}}
   if(generation===this.generation){
    const residuals=new Float32Array(data,48,CAPACITY);
    for(const {key,slot} of measured){const error=residuals[slot];if(Number.isFinite(error)&&error>=0){this.lodErrors.delete(key);this.lodErrors.set(key,error);}}
    while(this.lodErrors.size>8192)this.lodErrors.delete(this.lodErrors.keys().next().value);
    this.latest={visibleMeshlets,gpuComputeMs,gpuRenderMs,generatedPatchesSample:generatedOnSample};
   }readback.unmap();
  }).catch(e=>this.onError?.(`GPU telemetry: ${e.message}`)).finally(()=>{readback.destroy();this.pendingRead=false;});}
  return performance.now()-cpuStart;
 }
}

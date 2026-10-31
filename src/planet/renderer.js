import {transitionCoordinates} from './transition-topology.js';
import {createTransitionControl,advanceTransitionControl} from './transition-control.js';
import {packTransitionTopology,MORPH_BUFFER_BYTES,MORPH_RANGE_OFFSET,MORPH_COORD_OFFSET} from './transition-upload.js';
import {RADIUS_KM,PATCH_CELLS,FACE_BASES,faceCube,directionToFace,seedPlates,normalize,add,scale,dot} from './planet-math.js';
import {planetCloudSource} from './cloud-compose.js';
import {planetCamera} from './camera.js';
import {selectPatches} from './quadtree.js';
import {transitionPairs,encodeTransitionPairs,transitionGroups,encodePatchMorphs,coordinateTransitions,transitionSignatures} from './patch-transition.js';
import {buildWorldGrid} from './world-grid.js';
import {regionsAround,REGION_CAPACITY,REGION_GRID,REGION_SAMPLES,REGION_LOOKUPS} from './regions.js';
const BUFFER=globalThis.GPUBufferUsage;
// A second set of slots lets the currently drawn patches stay resident while
// their replacements are generated and measured.
const CAPACITY=1024,GRID=21,VERTEX_BYTES=48,MESHLETS=16,PATCH_BYTES=128;
const TRANSITION_BATCH=12,TRANSITION_TARGET_PIXELS=.5;
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
  this.cameraState={longitude:.8,latitude:.4,altitude:14000,surfaceHeight:0,mode:'flight',heading:.45,pitch:1.48};
  this.seed=918273;this.relief=1;this.valleys=1;this.erosion=1;this.regional=true;this.rivers=true;this.biomes=true;this.ocean=true;this.followSun=true;this.culling=true;this.lodColors=false;this.patchColors=false;this.meshletColors=false;this.wireframe=false;this.patchLines=false;this.meshletLines=false;this.debugOpacity=.75;
  this.budget=384;this.pixelSize=6;this.resolution=1;this.maxDepth=20;
  this.patchBytes=new ArrayBuffer(CAPACITY*PATCH_BYTES);this.patchFloats=new Float32Array(this.patchBytes);this.patchUints=new Uint32Array(this.patchBytes);
  this.frameUniformData=new ArrayBuffer(224);this.frameUniformFloats=new Float32Array(this.frameUniformData);this.frameUniformUints=new Uint32Array(this.frameUniformData);
  this.cloudUniformData=new Float32Array(48);this.oceanViewData=new Float32Array(20);
  this.slotByKey=new Map();this.stitchByKey=new Map();this.free=Array.from({length:CAPACITY},(_,i)=>CAPACITY-1-i);this.patches=[];this.pending=[];this.normalPending=[];
  this.needsSelection=true;this.lastSelection=0;this.previousSplits=null;this.lodErrors=new Map();this.lodErrorVersion=0;this.selectionErrorCache=null;this.latest={visibleMeshlets:null,gpuComputeMs:null,gpuRenderMs:null};
  this.retiredSlots=new Set();this.transitionErrors=new Map();this.transitionErrorVersion=0;this.workerErrorVersion=null;this.transitionCommitId=0;this.lastTransitionCommit=null;this.stage=null;this.transition={pixels:null,pending:0,overTarget:false,waiting:false};
  this.transitionTargetPixels=TRANSITION_TARGET_PIXELS;
  this.lastSample=0;this.pendingRead=false;this.generation=0;this.surfaceRevision=0;this.inFlight=0;this.probePending=false;this.lastProbeKey='';this.lastProbeTime=0;this.stats={leaves:0,visiblePatches:0,deepest:0,selectionMs:0,generated:0};
  this.probeReadbacks=[];
  this.terrainFieldRevision=0;this.terrainPointCache=null;this.terrainPointInFlight=new Map();
  this.hydrologySeed=null;
  this.regionSeed=null;this.regions=new Map();this.regionFree=Array.from({length:REGION_CAPACITY},(_,i)=>REGION_CAPACITY-1-i);
  this.simulateRegionsForAnalysis=false;
  if(typeof Worker!=='undefined'){
   this.selectionWorker=new Worker(new URL('./selection-worker.js',import.meta.url),{type:'module'});
   this.selectionWorker.onmessage=e=>{if(e.data.result)this.workerOfferedResultId=e.data.id;if(this.selectionRequest?.id===e.data.id){this.selectionRequest=null;this.selectionResult=e.data;}};
   this.selectionWorker.onerror=e=>{this.selectionWorker?.terminate();this.selectionWorker=null;this.selectionRequest=null;this.needsSelection=true;this.onError?.(`Terrain selection worker: ${e.message}`);};
  }
  this.regionLookup=new Uint32Array(REGION_LOOKUPS);this.regionLookup.fill(0xffffffff);
  this.regionMeta=new Uint32Array(REGION_CAPACITY*4);this.regionPending=[];
 }
 async init(){
  const d=this.device;d.addEventListener('uncapturederror',e=>this.onError?.(`WebGPU: ${e.error.message}`));
  d.lost.then(info=>this.handleDeviceLoss(info));
  this.context.configure({device:d,format:this.format,alphaMode:'opaque'});
  const fetchText=async p=>{const r=await fetch(new URL(p,import.meta.url));if(!r.ok)throw new Error(`Failed to load ${p}`);return r.text();};
  const [common,terrainCore,riverCurve,hydrologySource,worldField,riverDetailSource,regionalSource,terrainSurface,walkProbeSource,patchSurface,patchMorph,...sources]=await Promise.all(['./common.wgsl','./terrain-core.wgsl','./river-curve.wgsl','./hydrology.wgsl','./world-field.wgsl','./river-detail.wgsl','./regional-hydrology.wgsl','./terrain-surface.wgsl','./walk-probe.wgsl','./patch-surface.wgsl','./patch-morph.wgsl','./generate.wgsl','./normal.wgsl','./bounds.wgsl','./cull.wgsl','./render.wgsl','./lod-error.wgsl','./transition-error.wgsl','./ocean.wgsl'].map(fetchText));
  const labels=['Terrain generation','Terrain normals','Meshlet bounds','Meshlet culling','Planet rendering','Terrain LOD residual','Terrain transition comparison','Ocean surface'];
  const modules=await Promise.all(sources.map((s,i)=>shader(d,common+'\n'+(i===0||i===1||i===4||i===7?terrainCore+'\n'+riverCurve+'\n'+worldField+'\n'+terrainSurface+'\n':'')+(i===4||i===6?patchSurface+'\n':'')+(i===4?patchMorph+'\n':'')+s,labels[i])));
  [this.generatePipe,this.normalPipe,this.boundsPipe,this.cullPipe]=await Promise.all(modules.slice(0,4).map(module=>d.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}})));
  this.lodErrorPipe=await d.createComputePipelineAsync({layout:'auto',compute:{module:modules[5],entryPoint:'main'}});
  this.transitionPipe=await d.createComputePipelineAsync({layout:'auto',compute:{module:modules[6],entryPoint:'main'}});
  const walkProbeModule=await shader(d,common+'\n'+patchSurface+'\n'+patchMorph+'\n'+walkProbeSource,'Walking surface probe');
  [this.walkProbePipe,this.walkRegularPipe]=await Promise.all(['main','regularMain'].map(entryPoint=>d.createComputePipelineAsync({layout:'auto',compute:{module:walkProbeModule,entryPoint}}))); 
  [this.highlandsPipe,this.pointPipe,this.valleyPipe,this.riverPipe]=await Promise.all(['highlands','point','valleyCandidates','riverCandidates'].map(entryPoint=>d.createComputePipelineAsync({layout:'auto',compute:{module:modules[0],entryPoint}})));
  this.renderPipe=await d.createRenderPipelineAsync({layout:'auto',vertex:{module:modules[4],entryPoint:'vs'},fragment:{module:modules[4],entryPoint:'fs',targets:[{format:this.format},{format:'r32float'}]},primitive:{topology:'triangle-list',cullMode:'back'},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'greater'}});
  // r32float can be loaded without the optional float32-filterable feature.
  this.oceanLayout=d.createBindGroupLayout({entries:[
   {binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
   ...[5,7,8,10].map(binding=>({binding,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}})),
   {binding:11,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
   {binding:12,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float',viewDimension:'2d'}}
  ]});
  this.oceanPipe=await d.createRenderPipelineAsync({layout:d.createPipelineLayout({bindGroupLayouts:[this.oceanLayout]}),vertex:{module:modules[7],entryPoint:'oceanVertex'},fragment:{module:modules[7],entryPoint:'oceanFragment',targets:[{format:this.format}]},primitive:{topology:'triangle-list'},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'always'}});
  const cloudModule=await shader(d,planetCloudSource(await fetchText('../atmosphere/atmosphere.wgsl'),await fetchText('../cloud/cloud.wgsl'),await fetchText('./cloud-overlay.wgsl')),'Planet clouds');
  this.cloudPipe=await d.createRenderPipelineAsync({layout:'auto',vertex:{module:cloudModule,entryPoint:'vertex'},fragment:{module:cloudModule,entryPoint:'planetCloud',targets:[{format:this.format,blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'triangle-list'}});
  this.cloudUniform=d.createBuffer({size:192,usage:BUFFER.UNIFORM|BUFFER.COPY_DST});this.clouds=true;this.cloudCoverage=.48;this.cloudDensity=1;this.cloudSize=2;this.cloudSpeed=8;this.cloudQuality=.8;this.skyStrength=1;this.mieStrength=1;this.haloStrength=1;this.sunAzimuth=45;this.sunElevation=30;
  const make=(label,size,usage)=>d.createBuffer({label,size,usage});
  this.uniform=make('Planet frame',224,BUFFER.UNIFORM|BUFFER.COPY_DST);
  this.oceanView=make('Camera for analytic ocean',80,BUFFER.UNIFORM|BUFFER.COPY_DST);
  this.patchBuffer=make('Planet patches',this.patchBytes.byteLength,BUFFER.STORAGE|BUFFER.COPY_DST);
  this.morphBuffer=make('Patch morph metadata',MORPH_BUFFER_BYTES,BUFFER.STORAGE|BUFFER.COPY_DST);
  this.vertices=make('Cached GPU terrain vertices',CAPACITY*GRID*GRID*VERTEX_BYTES,BUFFER.STORAGE|BUFFER.COPY_SRC);
  this.lodErrorBuffer=make('Measured terrain LOD residuals',CAPACITY*4,BUFFER.STORAGE|BUFFER.COPY_SRC);
  this.transitionPairsBuffer=make('Terrain transition pairs',CAPACITY*32,BUFFER.STORAGE|BUFFER.COPY_DST);
  this.transitionErrorBuffer=make('Measured terrain transition differences',CAPACITY*8,BUFFER.STORAGE|BUFFER.COPY_SRC);
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
  this.walkProbeInput=make('Walking surface probe',48,BUFFER.UNIFORM|BUFFER.COPY_DST);
  this.walkProbeResult=make('Walking surface result',16,BUFFER.STORAGE|BUFFER.COPY_SRC);
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
  this.transitionBind=bind(this.transitionPipe,[this.uniform,this.patchBuffer,this.vertices,this.transitionPairsBuffer,this.transitionErrorBuffer,this.morphBuffer]);
  this.riverDetailBind=bindEntries(this.riverDetailPipe,[[0,this.uniform],[1,this.patchBuffer],[3,this.queueBuffer],...worldEntries,[11,this.riverMasks]]);
  this.normalBind=bindEntries(this.normalPipe,[[0,this.uniform],[1,this.patchBuffer],[2,this.vertices],[3,this.normalQueueBuffer],[4,this.plates],[7,this.world],[8,this.worldDirections],[10,this.worldFaces]]);
  this.boundsBind=bind(this.boundsPipe,[this.uniform,this.vertices,this.bounds,this.queueBuffer]);
  this.cullBind=bind(this.cullPipe,[this.uniform,this.patchBuffer,this.bounds,this.activeBuffer,this.visible,this.indirect,this.morphBuffer]);
  this.renderBind=bindEntries(this.renderPipe,[[0,this.uniform],[1,this.patchBuffer],[2,this.vertices],[3,this.visible],[5,this.plates],[6,this.morphBuffer],...worldEntries]);
  this.highlandsBind=bindEntries(this.highlandsPipe,[[0,this.uniform],[4,this.plates],[5,this.sampleBuffer],...worldEntries]);
  this.valleyBind=d.createBindGroup({layout:this.valleyPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}},{binding:4,resource:{buffer:this.plates}},{binding:5,resource:{buffer:this.sampleBuffer}}]});
  this.pointBind=bindEntries(this.pointPipe,[[0,this.uniform],[4,this.plates],[5,this.sampleBuffer],[6,this.probeInput],...worldEntries]);
  this.walkProbeBind=bind(this.walkProbePipe,[this.patchBuffer,this.vertices,this.walkProbeInput,this.walkProbeResult,this.morphBuffer]);
  this.walkRegularBind=bind(this.walkRegularPipe,[this.patchBuffer,this.vertices,this.walkProbeInput,this.walkProbeResult,this.morphBuffer]);
  this.riverBind=bindEntries(this.riverPipe,[[5,this.sampleBuffer],[7,this.world],[8,this.worldDirections]]);
  if(this.timing){this.queries=d.createQuerySet({type:'timestamp',count:8});this.resolve=make('GPU timestamp resolve',64,BUFFER.QUERY_RESOLVE|BUFFER.COPY_SRC);}
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
  run('markRiverPresence');run('buildRiverPaths',0,this.worldCount*17);pass.end();d.queue.submit([encoder.finish()]);this.hydrologySeed=seed;this.terrainFieldRevision++;this.terrainPointCache=null;
 }
 uploadTransitionTopology(records,prepacked=null){
  let packed,firstSlot=1024,lastSlot=-1;
  for(const {slot} of records){
   if(!Number.isInteger(slot)||slot<0||slot>=1024)throw new Error('Invalid topology slot');
   firstSlot=Math.min(firstSlot,slot);lastSlot=Math.max(lastSlot,slot);
  }
  if(prepacked){
   if(prepacked.ranges.length!==prepacked.keys.length*32)throw new Error('Invalid prepared topology ranges');
   const ranges=new Uint32Array(Math.max(0,lastSlot-firstSlot+1)*32),slots=new Set(),ids=new Map(prepacked.keys.map((key,index)=>[key,index]));
   if(ids.size!==prepacked.keys.length)throw new Error('Invalid prepared topology keys');
   for(const record of records){
    const index=ids.get(record.key);if(index===undefined||slots.has(record.slot))throw new Error('Invalid prepared topology');
    ranges.set(prepacked.ranges.subarray(index*32,index*32+32),(record.slot-firstSlot)*32);slots.add(record.slot);
   }
   if(slots.size!==ids.size)throw new Error('Prepared topology does not match selection');
   packed={ranges,slots,coordinates:prepacked.coordinates,vertexCount:prepacked.vertexCount};
  }else packed=packTransitionTopology(records);
  // Only slots marked as overlays in morph metadata read their ranges. Old
  // inactive ranges can remain untouched, avoiding a full 128 KiB upload.
  if(lastSlot>=firstSlot){
   const ranges=prepacked?packed.ranges:packed.ranges.subarray(firstSlot*32,(lastSlot+1)*32);
   this.device.queue.writeBuffer(this.morphBuffer,MORPH_RANGE_OFFSET+firstSlot*128,ranges);
  }
  if(packed.coordinates.length)this.device.queue.writeBuffer(this.morphBuffer,MORPH_COORD_OFFSET,packed.coordinates);
  this.topologySlots=packed.slots;this.morphVertexCount=packed.vertexCount;
 }
 uploadMorphs(entries){
  const resident=new Set([...this.slotByKey.values(),...(this.stage?.newNodes.map(node=>node.slot)||[])]);
  for(const {pair} of entries){
   if(!resident.has(pair.fine.slot)||!resident.has(pair.coarse.slot))throw new Error('Morph references a nonresident patch');
  }
  const raw=encodePatchMorphs(entries,CAPACITY),words=new Uint32Array(raw);
  if(!entries.length){this.topologySlots=null;this.morphVertexCount=96;}
  for(const {pair} of entries)if(this.topologySlots?.has(pair.fine.slot))words[pair.fine.slot*8+2]|=16;
  this.device.queue.writeBuffer(this.morphBuffer,0,raw);
  this.morphMetadata=entries.length?raw:null;
  this.surfaceRevision++;
 }
 updateMorphProgress(stage,progress){
  // Slot ownership and mappings were checked by uploadMorphs at transition
  // start. During progress only factors change; reuse the encoded metadata.
  const values=new Float32Array(this.morphMetadata);let first=CAPACITY,last=-1;
  for(const group of stage.groups)for(const pair of group.pairs){
   const slot=pair.fine.slot;values[slot*8+7]=group.type==='merge'?1-progress:progress;
   first=Math.min(first,slot);last=Math.max(last,slot);
  }
  if(last>=first)this.device.queue.writeBuffer(this.morphBuffer,first*32,new Uint8Array(this.morphMetadata,first*32,(last-first+1)*32));
  this.surfaceRevision++;
 }
 resetPatchCache(){
  for(const buffer of this.probeReadbacks||[])buffer.destroy();this.probeReadbacks=[];
  this.telemetryReadback?.destroy();this.telemetryReadback=null;
  this.transitionReadback?.destroy();this.transitionReadback=null;this.transitionReadbackCapacity=0;
  this.slotByKey.clear();this.stitchByKey.clear();this.free=Array.from({length:CAPACITY},(_,i)=>CAPACITY-1-i);this.pending=[];this.normalPending=[];this.patches=[];
  this.lodErrors.clear();this.lodErrorVersion++;this.selectionErrorCache=null;this.retiredSlots=new Set();this.displayedPatches=null;this.coveringLeaves=null;this.topologySlots=null;this.morphVertexCount=96;this.uploadedActiveSlots=null;this.morphMetadata=null;this.patchMetadataCache=new WeakMap();this.uploadedPatchEye=null;this.preparedPatchState=null;
  if(this.morphBuffer&&!this.deviceLost)this.device.queue.writeBuffer(this.morphBuffer,0,encodePatchMorphs([],CAPACITY));
  this.transitionErrors.clear();this.transitionErrorVersion++;this.workerErrorVersion=null;this.stage=null;this.transition={pixels:null,pending:0,overTarget:false,waiting:false};
  this.selectionResult=null;this.selectionRequest=null;this.workerSelectionSnapshot=null;this.workerOfferedResultId=null;this.workerCoveringResultId=null;this.terrainPointCache=null;this.terrainPointInFlight.clear();this.reconcileSelection=false;this.needsSelection=true;this.generation++;this.surfaceRevision++;this.lastProbeKey='';this.lastFrameEye=null;this.selectionState=null;this.previousSplits=null;
  this.latest={visibleMeshlets:null,gpuComputeMs:null,gpuRenderMs:null};
 }
 handleDeviceLoss(info){
  if(this.deviceLost)return;
  this.deviceLost=true;
  // Invalidate readbacks and retirement fences without submitting more GPU work.
  this.resetPatchCache();this.needsSelection=false;
  this.onError?.(`WebGPU device lost: ${info.message||info.reason}. Reload to retry.`);
 }
 resetRegions(){
  this.terrainFieldRevision++;this.terrainPointCache=null;
  this.regionSeed=this.seed>>>0;this.regions.clear();this.regionFree=Array.from({length:REGION_CAPACITY},(_,i)=>REGION_CAPACITY-1-i);
  this.regionLookup.fill(0xffffffff);this.regionPending=[];
  this.device.queue.writeBuffer(this.world,REGION_LOOKUP_OFFSET,this.regionLookup);
 }
 invalidateTerrain(){
  if(this.deviceLost)return;
  this.resetPatchCache();if(this.regionSeed!==(this.seed>>>0))this.resetRegions();
  this.device.queue.writeBuffer(this.plates,0,seedPlates(this.seed));
  if(this.cameraState.altitude<50)this.cameraState.surfaceHeight=10;
 }
 prepareRegions(camera){
  if(this.regionSeed!==(this.seed>>>0))this.resetRegions();
  if(camera.clearance>=50 || this.erosion<=0 || !this.regional)return false;
  const requested=regionsAround(camera.radial),protectedIds=new Set(requested.map(r=>r.id)),pending=[];
  for(const region of requested){
   if(this.regions.has(region.id)){const slot=this.regions.get(region.id);this.regions.delete(region.id);this.regions.set(region.id,slot);continue;}
   let slot=this.regionFree.pop();
   if(slot===undefined){
    const entry=[...this.regions].find(([id])=>!protectedIds.has(id));if(!entry)throw new Error('Regional simulation cache exhausted');
    this.regions.delete(entry[0]);this.regionLookup[entry[0]]=0xffffffff;slot=entry[1];
   }
   this.regions.set(region.id,slot);this.regionLookup[region.id]=slot;
   this.regionMeta.set([region.face,region.x,region.y,0],slot*4);pending.push(slot);
  }
  if(!pending.length)return false;
  this.regionPending=pending;this.terrainFieldRevision++;this.terrainPointCache=null;const d=this.device;
  d.queue.writeBuffer(this.world,REGION_LOOKUP_OFFSET,this.regionLookup);
  d.queue.writeBuffer(this.regionMetaBuffer,0,this.regionMeta);d.queue.writeBuffer(this.regionQueueBuffer,0,new Uint32Array(pending));
  return true;
 }
 resize(){
  const rect=this.canvas.getBoundingClientRect(),ratio=Math.min(window.devicePixelRatio||1,2)*this.resolution,max=this.device.limits.maxTextureDimension2D;
  const w=Math.min(max,Math.max(1,Math.round(rect.width*ratio))),h=Math.min(max,Math.max(1,Math.round(rect.height*ratio)));
  if(this.canvas.width!==w||this.canvas.height!==h||!this.depth){
   this.canvas.width=w;this.canvas.height=h;this.depth?.destroy();this.waterDepth?.destroy();
   this.depth=this.device.createTexture({label:'Planet reverse-Z depth',size:[w,h],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
   this.waterDepth=this.device.createTexture({label:'Terrain depth and lake coverage',size:[w,h],format:'r32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
   this.depthView=this.depth.createView();this.waterDepthView=this.waterDepth.createView();
   this.oceanBind=this.device.createBindGroup({layout:this.oceanLayout,entries:[
    ...[[0,this.uniform],[5,this.plates],[7,this.world],[8,this.worldDirections],[10,this.worldFaces],[11,this.oceanView]].map(([binding,buffer])=>({binding,resource:{buffer}})),
    {binding:12,resource:this.waterDepthView}
   ]});
   this.cloudBind=this.device.createBindGroup({layout:this.cloudPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.cloudUniform}},{binding:1,resource:this.depthView}]});
   this.needsSelection=true;
  }
 }
 selectionErrorEstimates(){
  const version=`${this.lodErrorVersion}/${this.transitionErrorVersion}`;
  if(this.selectionErrorCache?.version===version)return this.selectionErrorCache;
  const values=new Map();for(const [key,error] of this.lodErrors||[])if(error>0)values.set(key,error);
  for(const [key,error] of this.transitionErrors||[])values.set(key,Math.max(values.get(key)||0,error));
  return this.selectionErrorCache={version,values};
 }
 select(camera,now,computed=null){
  const start=performance.now();
  const maxDepth=this.cameraState.mode==='walk'?22:this.maxDepth;
  const result=computed?.result??selectPatches(camera,{budget:Math.min(CAPACITY/2,Math.max(6,this.budget)),includeHidden:true,maxDepth,pixelSize:this.pixelSize,previousSplits:this.previousSplits,errorEstimates:this.selectionErrorEstimates().values,previousLeaves:this.coveringLeaves});
  const wantedSignatures=computed?.signatures??transitionSignatures(result.visible);
  // Reserve the whole replacement set before touching the free list. Partial
  // allocation on exhaustion must never leak slots or remove visible coverage.
  const required=result.visible.reduce((count,node)=>count+Number(!this.slotByKey.has(node.key)),0);
  if(required>this.free.length){
   this.lastSelection=now;this.needsSelection=true;
   this.transition={...this.transition,pending:required,waiting:true,capacityDeferred:true};
   return;
  }
  const slots=new Map(),signatures=new Map(),newNodes=[],normalPending=[];let topologyChanges=0;
  const nodes=result.visible.map(node=>{
   const signature=wantedSignatures.get(node.key);
   if(signature===undefined)throw new Error('Missing terrain stitch signature');
   let slot=this.slotByKey.get(node.key);
   if(slot===undefined){slot=this.free.pop();if(slot===undefined)throw new Error('Planet patch staging cache exhausted.');newNodes.push({...node,slot});normalPending.push(slot);}
   else if(this.stitchByKey.get(node.key)!==signature)topologyChanges++;
   slots.set(node.key,slot);signatures.set(node.key,signature);
   return {...node,slot};
  });
  const selectionMs=(computed?.selectionMs??0)+performance.now()-start;
  const previousEye=this.selectionState?.eye;
  this.selectionState={eye:[...camera.eye],forward:[...camera.forward],mode:this.cameraState.mode,budget:this.budget,maxDepth,pixelSize:this.pixelSize,width:camera.width,height:camera.height,generation:this.generation};
  this.lastSelection=now;this.needsSelection=false;this.reconcileSelection=false;
  if(!this.patches.length){
   this.slotByKey=slots;this.stitchByKey=signatures;this.patches=nodes;this.previousSplits=result.splits;this.coveringLeaves=result.leaves;
   this.workerCoveringResultId=computed?.id??null;
   this.pending=newNodes.map(n=>n.slot);this.normalPending=normalPending;
   this.stats={leaves:result.leaves.length,visiblePatches:nodes.length,deepest:result.deepest,selectionMs,generated:newNodes.length,normalUpdates:normalPending.length,reusedNormalUpdates:normalPending.length-newNodes.length};
   return;
  }
  if(!newNodes.length&&nodes.length===this.patches.length&&topologyChanges===0){
   this.stats={...this.stats,leaves:result.leaves.length,deepest:result.deepest,selectionMs,generated:0,normalUpdates:0,reusedNormalUpdates:0};return;
  }
  const oldNodes=new Map(this.patches.map(node=>[node.key,node])),newNodesByKey=new Map(nodes.map(node=>[node.key,node]));
  const resolvePair=p=>({fine:(p.fineOld?oldNodes:newNodesByKey).get(p.fineKey),coarse:(p.coarseOld?oldNodes:newNodesByKey).get(p.coarseKey),originX:p.originX,originY:p.originY,scale:p.scale,refining:p.refining});
  const pairs=(computed?.relationships?computed.relationships.map(resolvePair):transitionPairs(this.patches,nodes)).map(p=>{
   if(!p.fine||!p.coarse)throw new Error('Stale terrain transition relationship');
   return {...p,refining:p.refining??slots.has(p.fine.key)};
  });
  if(pairs.length>CAPACITY){
   for(const node of newNodes)this.free.push(node.slot);
   this.needsSelection=true;this.transition={...this.transition,pending:pairs.length,waiting:true,capacityDeferred:true};return;
  }
  const matched=new Set(pairs.map(p=>p.refining?p.fine.key:p.coarse.key));
  const uncovered=newNodes.some(n=>!matched.has(n.key));
  // Reuse one ancestry pass for comparison, grouping and coordination.
  let groups,components;
  if(computed?.groupPlan&&computed?.componentPlan){
   groups=computed.groupPlan.map(g=>{
    const coarse=(g.coarseOld?oldNodes:newNodesByKey).get(g.coarseKey),groupPairs=g.pairIndices?g.pairIndices.map(index=>pairs[index]):g.pairs.map(p=>{
     const pair=resolvePair(p);
     if(g.type==='stitch')delete pair.refining;
     else if(pair.fine)pair.refining=pair.refining??slots.has(pair.fine.key);
     return pair;
    });
    if(!coarse||groupPairs.some(p=>!p||!p.fine||!p.coarse))throw new Error('Stale terrain transition group');
    return {key:g.key,type:g.type,coarse,pairs:groupPairs,slots:[...new Set(groupPairs.flatMap(p=>[p.fine.slot,p.coarse.slot]))]};
   });
   const byKey=new Map(groups.map(g=>[g.key,g]));
   components=computed.componentPlan.map(c=>{
    const componentGroups=c.groupKeys.map(key=>byKey.get(key));
    if(componentGroups.some(g=>!g))throw new Error('Stale terrain transition component');
    return {groups:componentGroups,slots:[...new Set(componentGroups.flatMap(g=>g.slots))],deferredReasons:c.deferredReasons};
   });
  }else{groups=transitionGroups(this.patches,nodes,pairs);components=coordinateTransitions(this.patches,nodes,groups);}
  this.stage={components,groups,result,nodes,slots,signatures,newNodes,todo:newNodes.map(n=>n.slot),normalPending,pairs,selectionMs,state:'building',generation:this.generation,reference:camera,previousEye,nextMeasure:0,uncovered,hasRefinement:pairs.some(p=>p.refining),waitingSince:null,computedTopology:computed?.topology,packedTopology:computed?.packedTopology,workerResultId:computed?.id??null};
  this.transition={...this.transition,pending:newNodes.length,waiting:false};
 }
 canMorphTransition(stage){
  return !!stage.components?.length&&!stage.uncovered&&stage.groups.every(g=>['refine','merge','stitch'].includes(g.type))&&stage.components.every(c=>c.deferredReasons.every(r=>['stitch-change','stitched-parent','stitched-child'].includes(r)));
 }
 prepareTransitionTopology(stage){
  if(stage.topologyReady)return true;
  const records=[];
  for(const group of stage.groups)for(const pair of group.pairs){
   if(group.type!=='stitch'&&!pair.fine.stitch&&!pair.coarse.stitch)continue;
   const coordinates=stage.packedTopology?null:(stage.computedTopology?.get(pair.fine.key)??transitionCoordinates({mask:pair.coarse.stitch,originX:pair.originX,originY:pair.originY,scale:pair.scale},{mask:pair.fine.stitch}));
   records.push({key:pair.fine.key,slot:pair.fine.slot,coordinates});
  }
  if(records.length){
   try{this.uploadTransitionTopology(records,stage.packedTopology);}
   catch(error){
    if(!error.message.includes('capacity exceeded'))throw error;
    this.transition={...this.transition,capacityDeferred:true};return false;
   }
  }else{this.topologySlots=null;this.morphVertexCount=96;}
  stage.topologyReady=true;return true;
 }
 beginTransition(camera){
  const stage=this.stage;if(!this.canMorphTransition(stage)||!this.prepareTransitionTopology(stage))return false;
  const refining=stage.groups.filter(g=>g.type!=='merge'),focus=refining.length?refining:stage.groups;
  // Choose a nearby patch; averaging opposite cube faces can put the anchor
  // at the planet's center and freeze lateral travel.
  const radius=RADIUS_KM+(this.cameraState.surfaceHeight||0);
  const nearest=focus.reduce((best,g)=>{
   const distance=Math.hypot(...g.coarse.direction.map((v,i)=>v*radius-camera.eye[i]));
   return !best||distance<best.distance?{direction:g.coarse.direction,distance}:best;
  },null);
  // Draw the finest covering set at both endpoints: new children for splits,
  // existing children for merges. Target parents remain resident but hidden.
  const merging=new Set(stage.groups.filter(g=>g.type==='merge').map(g=>g.coarse.key));
  const drawn=new Map(stage.nodes.filter(p=>!merging.has(p.key)).map(p=>[p.key,p]));
  for(const group of stage.groups)if(group.type==='merge')for(const pair of group.pairs)drawn.set(pair.fine.key,pair.fine);
  stage.drawNodes=[...drawn.values()];
  const anchor=nearest.direction.map(v=>v*radius);
  stage.morph=createTransitionControl(camera,{anchor,approaching:refining.length>0,previousEye:stage.previousEye,
   endpointPixels:Math.max(stage.maxRefine||0,stage.maxMerge||0),targetPixels:this.transitionTargetPixels});
  stage.state='transitioning';this.uploadMorphs(this.transitionEntries(stage,0));
  this.transition={...this.transition,morphProgress:0,retainedParents:stage.groups.length};return true;
 }
 transitionEntries(stage,progress){
  return stage.groups.flatMap(group=>group.pairs.map(pair=>({pair,factor:group.type==='merge'?1-progress:progress})));
 }
 advanceTransition(camera,now){
  const stage=this.stage;if(stage?.state!=='transitioning'||this.surfaceReads>0)return;
  const m=stage.morph,before=m.factor,{factor,cancel}=advanceTransitionControl(m,camera,this.transitionTargetPixels);
  if(factor!==before)this.updateMorphProgress(stage,factor);
  this.transition={...this.transition,morphProgress:factor,estimatedStepPixels:m.estimatedStepPixels,estimatedEndpointPixels:m.estimatedEndpointPixels,errorLimited:m.limited};
  if(factor===1)this.commitStage(now);
  else if(cancel){this.cancelStage();this.needsSelection=true;}
 }
 retireSlots(slots){
  if(!slots.length)return;
  const generation=this.generation,retired=this.retiredSlots;
  if(new Set(slots).size!==slots.length||slots.some(slot=>retired.has(slot)))throw new Error('Patch slot retired twice');
  for(const slot of slots)retired.add(slot);
  // All commands referencing the old selection have already been submitted.
  // Keep its slots unavailable until those commands and probe copies finish.
  this.device.queue.onSubmittedWorkDone().then(()=>{
   if(this.generation!==generation||this.retiredSlots!==retired)return;
   for(const slot of slots){retired.delete(slot);this.free.push(slot);}
   if(this.transition.capacityDeferred)this.needsSelection=true;
  }).catch(error=>{if(generation===this.generation&&!this.deviceLost)this.onError?.(`Terrain slot retirement: ${error.message}`);});
 }
 cancelStage(){
  if(!this.stage)return;
  if(this.stage.state==='transitioning'){
   if(this.stage.morph.factor!==0)throw new Error('Cannot cancel a visible intermediate morph');
  }
  if(this.stage.topologyReady)this.uploadMorphs([]);
  this.retireSlots(this.stage.newNodes.map(node=>node.slot));
  this.stage=null;this.transition={...this.transition,pending:0,waiting:false,morphProgress:null,retainedParents:0,reselectionPending:false};
 }
 commitStage(now){
  const stage=this.stage;if(!stage)return;
  if(stage.state==='transitioning'){
   if(stage.morph.factor!==1)throw new Error('Cannot commit an intermediate morph');
  }
  if(stage.topologyReady)this.uploadMorphs([]);
  this.retireSlots([...this.slotByKey].filter(([key])=>!stage.slots.has(key)).map(([,slot])=>slot));
  this.lastTransitionCommit={id:++this.transitionCommitId,at:now,pairs:stage.pairs.length,refinements:stage.pairs.filter(p=>p.refining).length,merges:stage.pairs.filter(p=>!p.refining).length,maxRefinementPixels:stage.maxRefine??null,maxMergePixels:stage.maxMerge??null,maxPixels:this.transition.pixels,uncovered:stage.uncovered};
  this.slotByKey=stage.slots;this.stitchByKey=stage.signatures;this.patches=stage.nodes;this.previousSplits=stage.result.splits;this.coveringLeaves=stage.result.leaves;
  this.workerCoveringResultId=stage.workerResultId;
  // New patches were shaded while staged; world-space normals do not depend
  // on which neighboring LOD is currently selected.
  this.normalPending=[];
  this.stats={leaves:stage.result.leaves.length,visiblePatches:stage.nodes.length,deepest:stage.result.deepest,selectionMs:stage.selectionMs,generated:stage.newNodes.length,normalUpdates:stage.normalPending.length,reusedNormalUpdates:0};
  this.stage=null;this.surfaceRevision++;this.needsSelection=true;this.reconcileSelection=true;this.lastSelection=now;this.transition={...this.transition,pending:0,waiting:false,capacityDeferred:false,morphProgress:null,retainedParents:0,reselectionPending:false};
 }
 selectionSettingsChanged(camera){
  const s=this.selectionState,maxDepth=this.cameraState.mode==='walk'?22:this.maxDepth;
  return !s||s.mode!==this.cameraState.mode||s.budget!==this.budget||s.maxDepth!==maxDepth||s.pixelSize!==this.pixelSize||s.width!==camera.width||s.height!==camera.height||s.generation!==this.generation;
 }
 invalidateSelection(camera){
  const stage=this.stage;if(!stage)return;
  const settingsChanged=this.selectionSettingsChanged(camera);
  if(stage.state==='transitioning'){
   if(!settingsChanged)return;
   // Only endpoint zero can be cancelled without changing displayed geometry.
   // At intermediate factors, finish or reverse spatially before reselecting.
   if(stage.morph.factor!==0||this.surfaceReads>0){
    this.needsSelection=true;this.transition={...this.transition,reselectionPending:true};return;
   }
  }else if(!settingsChanged){
   const reference=stage.reference,ratio=camera.clearance/Math.max(.0001,reference.clearance);
   const moved=Math.hypot(...camera.eye.map((x,i)=>x-reference.eye[i]));
   const waitingWalk=this.cameraState.mode==='walk'&&stage.state==='waiting';
   const maxMove=waitingWalk ? .002 : Math.max(.05,reference.clearance*.7),maxTurn=(waitingWalk?5:20)*Math.PI/180;
   if(ratio>=.6&&ratio<=1.7&&moved<=maxMove&&dot(camera.forward,reference.forward)>=Math.cos(maxTurn))return;
  }
  this.cancelStage();this.needsSelection=true;this.lastSelection=0;
 }
 shouldSelect(camera,now){
  if(this.stage||this.selectionRequest)return false;
  if(!this.needsSelection)return false;
  if(!this.patches.length)return true;
  if(now-this.lastSelection<=100)return false;
  if(this.reconcileSelection||this.selectionSettingsChanged(camera))return true;
  const s=this.selectionState;
  if(this.cameraState.mode!=='walk'){
   const distance=Math.hypot(...camera.eye.map((x,i)=>x-s.eye[i]));
   return distance>=Math.max(.00075,Math.min(20,camera.clearance*.02))||dot(camera.forward,s.forward)<Math.cos(2*Math.PI/180);
  }
  // A full balanced selection is expensive. At walking speed, wait until the
  // camera moves 75 cm or turns five degrees; retained patches are still drawn
  // from the current camera every frame. This also limits small LOD churn.
  const distance=Math.hypot(...camera.eye.map((x,i)=>x-s.eye[i]));
  return distance>=.00075||dot(camera.forward,s.forward)<Math.cos(5*Math.PI/180);
 }
 acquireProbeReadback(size){
  if(size===16&&this.probeReadbacks.length)return this.probeReadbacks.pop();
  return this.device.createBuffer({size,usage:BUFFER.COPY_DST|BUFFER.MAP_READ});
 }
 releaseProbeReadback(buffer,size,generation,reusable){
  if(reusable&&size===16&&!this.deviceLost&&generation===this.generation&&this.probeReadbacks.length<2)this.probeReadbacks.push(buffer);
  else buffer.destroy();
 }
 async sampleTerrain(direction=null,kind='terrain'){
  if(this.deviceLost)throw new Error('WebGPU device is lost. Reload to retry.');
  if(!direction||kind!=='terrain')return this.sampleTerrainUncached(direction,kind);
  // Coalesce only identical point inputs and world revisions. Each caller gets
  // its own result array; different positions remain independent submissions.
  const point=new Float32Array([...direction,0]);
  const key=[this.generation,this.terrainFieldRevision,this.seed>>>0,this.relief,this.valleys,this.erosion,this.regional,this.rivers,...point].join('/');
  let pending=this.terrainPointInFlight.get(key);
  if(!pending){pending=this.sampleTerrainUncached(direction,kind);this.terrainPointInFlight.set(key,pending);}
  try{const data=await pending;return data?data.slice():null;}
  finally{if(this.terrainPointInFlight.get(key)===pending)this.terrainPointInFlight.delete(key);}
 }
 async sampleTerrainUncached(direction=null,kind='terrain'){
  if(this.deviceLost)throw new Error('WebGPU device is lost. Reload to retry.');
  const generation=this.generation;
  const point=direction?new Float32Array([...direction,0]):null;
  const pointKey=point&&kind==='terrain'?[generation,this.terrainFieldRevision,this.seed>>>0,this.relief,this.valleys,this.erosion,this.regional,this.rivers,...point].join('/'):null;
  if(pointKey&&this.hydrologySeed===(this.seed>>>0)&&this.terrainPointCache?.key===pointKey)return this.terrainPointCache.data.slice();
  const d=this.device,all=!direction,count=all?(kind==='rivers'?this.worldCount:6*24*24):1,size=count*16;
  d.queue.writeBuffer(this.uniform,164,new Float32Array([this.relief]));
  d.queue.writeBuffer(this.uniform,172,new Float32Array([this.valleys]));
  d.queue.writeBuffer(this.uniform,184,new Uint32Array([this.seed>>>0]));
  d.queue.writeBuffer(this.uniform,208,new Float32Array([this.erosion,this.rivers?1:0,this.regional?1:0,0]));this.ensureHydrology();
  if(point)d.queue.writeBuffer(this.probeInput,0,point);
  const fieldRevision=this.terrainFieldRevision;
  const cacheKey=pointKey?[generation,fieldRevision,this.seed>>>0,this.relief,this.valleys,this.erosion,this.regional,this.rivers,...point].join('/'):null;
  const readback=this.acquireProbeReadback(size),encoder=d.createCommandEncoder();let reusable=false;
  const pipe=kind==='rivers'?this.riverPipe:kind==='valleys'?this.valleyPipe:this.highlandsPipe,bind=kind==='rivers'?this.riverBind:kind==='valleys'?this.valleyBind:this.highlandsBind;
  const pass=encoder.beginComputePass();pass.setPipeline(all?pipe:this.pointPipe);pass.setBindGroup(0,all?bind:this.pointBind);pass.dispatchWorkgroups(all?Math.ceil(count/64):1);pass.end();
  encoder.copyBufferToBuffer(this.sampleBuffer,0,readback,0,size);d.queue.submit([encoder.finish()]);
  try{await readback.mapAsync(GPUMapMode.READ);const data=new Float32Array(readback.getMappedRange().slice(0));readback.unmap();reusable=true;
   if(generation!==this.generation||fieldRevision!==this.terrainFieldRevision)return null;
   if(cacheKey)this.terrainPointCache={key:cacheKey,data:data.slice()};return data;}
  catch(error){if(this.deviceLost||generation!==this.generation)return null;throw error;}
  finally{this.releaseProbeReadback(readback,size,generation,reusable);}
 }
 async findHighlands(){
  const generation=this.generation,data=await this.sampleTerrain();if(!data||generation!==this.generation)return null;
  let best=0;for(let i=4;i<data.length;i+=4)if(data[i+3]>data[best+3])best=i;
  return {direction:[data[best],data[best+1],data[best+2]],height:data[best+3]};
 }
 async findValleys(){
  const generation=this.generation,data=await this.sampleTerrain(null,'valleys');if(!data||generation!==this.generation)return null;
  let best=0;for(let i=4;i<data.length;i+=4)if(data[i+3]>data[best+3])best=i;
  const direction=[data[best],data[best+1],data[best+2]],height=await this.sampleTerrain(direction);
  return height&&generation===this.generation?{direction,height:height[3],incision:data[best+3]}:null;
 }
 async findRivers(){
  const generation=this.generation,data=await this.sampleTerrain(null,'rivers');if(!data||generation!==this.generation)return null;
  let best=0;for(let i=4;i<data.length;i+=4)if(data[i+3]>data[best+3])best=i;
  const direction=[data[best],data[best+1],data[best+2]],height=await this.sampleTerrain(direction);
  return height&&generation===this.generation?{direction,height:height[3],flow:data[best+3]}:null;
 }
 async sampleRenderedSurface(direction){
  const displayed=this.displayedPatches||this.patches;
  if(this.deviceLost||!this.lastFrameEye||!displayed.length)return null;
  const revision=this.surfaceRevision,generation=this.generation;
  const face=directionToFace(direction),epsilon=1e-12;
  const patch=displayed.filter(p=>p.face===face.face&&Math.abs(face.u-p.u)<=p.span/2+epsilon&&Math.abs(face.v-p.v)<=p.span/2+epsilon).sort((a,b)=>b.level-a.level)[0];
  if(!patch)return null;
  const cell=(value,center)=>Math.max(0,Math.min(PATCH_CELLS-1,Math.floor((value-center+patch.span/2)/patch.span*PATCH_CELLS)));
  // Keep the ray origin near the camera even on high mountains: subtracting
  // large sea-level coordinates in f32 would lose millimeter-scale detail.
  const reference=Math.hypot(...this.lastFrameEye)-RADIUS_KM;
  const origin=direction.map((x,i)=>x*(RADIUS_KM+reference)-this.lastFrameEye[i]);
  const raw=new ArrayBuffer(48),floats=new Float32Array(raw),uints=new Uint32Array(raw);
  floats.set([...origin,reference,...direction,0]);uints.set([patch.slot,cell(face.u,patch.u),cell(face.v,patch.v),0],8);
  const d=this.device;d.queue.writeBuffer(this.walkProbeInput,0,raw);
  const readback=this.acquireProbeReadback(16),encoder=d.createCommandEncoder({label:'Walkable terrain probe'});let reusable=false;
  const overlay=this.stage?.state==='transitioning'&&this.topologySlots?.has(patch.slot);
  const pass=encoder.beginComputePass();pass.setPipeline(overlay?this.walkProbePipe:(this.walkRegularPipe||this.walkProbePipe));pass.setBindGroup(0,overlay?this.walkProbeBind:(this.walkRegularBind||this.walkProbeBind));pass.dispatchWorkgroups(1);pass.end();
  encoder.copyBufferToBuffer(this.walkProbeResult,0,readback,0,16);d.queue.submit([encoder.finish()]);this.surfaceReads=(this.surfaceReads||0)+1;
  try{await readback.mapAsync(GPUMapMode.READ);const values=new Float32Array(readback.getMappedRange().slice(0));readback.unmap();reusable=true;return generation===this.generation&&revision===this.surfaceRevision&&values[1]>.5?values[0]:null;}
  catch(error){if(this.deviceLost||generation!==this.generation)return null;throw error;}
  finally{this.releaseProbeReadback(readback,16,generation,reusable);this.surfaceReads--;}
 }
 requestSurface(camera,now){
  if(this.cameraState.mode==='walk'||this.cameraState.mode==='flight')return;
  if(this.cameraState.altitude>=50){this.cameraState.surfaceHeight=0;return;}
  const key=[this.seed,this.relief,this.valleys,this.erosion,this.regional,this.rivers,this.ocean,...camera.radial.map(x=>x.toFixed(7))].join('/');
  if(this.probePending || key===this.lastProbeKey || now-this.lastProbeTime<160)return;
  this.probePending=true;this.lastProbeTime=now;const generation=this.generation;
  this.sampleTerrain(camera.radial).then(data=>{
   if(!data||generation!==this.generation||this.cameraState.mode==='walk')return;
   const current=planetCamera(this.cameraState,1,1).radial;
   const difference=Math.hypot(...current.map((x,i)=>x-camera.radial[i]));
   if(difference>1e-6)return;
   const height=this.ocean?Math.max(0,data[3]):data[3];
   this.cameraState.surfaceHeight=height;this.lastProbeKey=key;this.needsSelection=true;
  }).catch(e=>this.onError?.(`Terrain probe: ${e.message}`)).finally(()=>{this.probePending=false;});
 }
 frame(now){
  if(this.deviceLost||this.inFlight>=2)return null;
  const cpuStart=performance.now();this.resize();
  const camera=planetCamera(this.cameraState,this.canvas.width,this.canvas.height);
  const regionsChanged=this.simulateRegionsForAnalysis&&this.prepareRegions(camera);
  if(!regionsChanged)this.requestSurface(camera,now);
  this.invalidateSelection(camera);
  if(this.stage?.state==='ready'){
   const stage=this.stage;
   const large=Math.max(stage.maxMerge||0,stage.maxRefine||0)>this.transitionTargetPixels;
   if(!large)this.commitStage(now);
   else if(!this.beginTransition(camera)){
    stage.state='waiting';stage.nextMeasure=now+200;
    this.transition={...this.transition,waiting:true};
   }
  }
  this.advanceTransition(camera,now);
  if(this.stage?.state==='waiting'&&now>=this.stage.nextMeasure){this.stage.state='building';this.transition={...this.transition,waiting:false};}
  if(this.selectionResult){
   const ready=this.selectionResult;this.selectionResult=null;
   const current=[this.generation,this.cameraState.mode,this.budget,this.maxDepth,this.pixelSize,camera.width,camera.height].join('/');
   const movement=Math.hypot(...camera.eye.map((x,i)=>x-ready.camera.eye[i]));
   if(ready.snapshotMissing){this.workerSelectionSnapshot=null;this.workerCoveringResultId=null;this.needsSelection=true;}
   else if(!this.stage&&current===ready.key&&movement<=Math.max(.05,ready.camera.clearance*.7)&&dot(camera.forward,ready.camera.forward)>=Math.cos(20*Math.PI/180)&&
    (!ready.result?.compactPatchDelta||this.workerSelectionSnapshot?.patches===this.patches)){
    if(ready.result?.compactPatchDelta){
     ready.result.visible=ready.result.visible.map(node=>typeof node==='number'?this.patches[node]:node);
     if(ready.result.visible.some(node=>!node))throw new Error('Invalid terrain patch delta');
     delete ready.result.compactPatchDelta;
    }
    if(ready.result?.compactLeaves){ready.result.leaves=ready.result.visible;delete ready.result.compactLeaves;}
    if(ready.unchanged){
     const maxDepth=this.cameraState.mode==='walk'?22:this.maxDepth;
     this.selectionState={eye:[...ready.camera.eye],forward:[...ready.camera.forward],mode:this.cameraState.mode,budget:this.budget,maxDepth,pixelSize:this.pixelSize,width:ready.camera.width,height:ready.camera.height,generation:this.generation};
     this.lastSelection=now;this.needsSelection=false;this.reconcileSelection=false;
     this.stats={...this.stats,leaves:ready.leafCount,deepest:ready.deepest,selectionMs:ready.selectionMs,generated:0,normalUpdates:0,reusedNormalUpdates:0};
    }else this.select(ready.camera,now,ready);
   }else this.needsSelection=true;
  }
  if(this.shouldSelect(camera,now)){
   if(!this.selectionWorker)this.select(camera,now);
   else{
    const id=(this.selectionSerial=(this.selectionSerial||0)+1),key=[this.generation,this.cameraState.mode,this.budget,this.maxDepth,this.pixelSize,camera.width,camera.height].join('/');
    const cached=this.workerSelectionSnapshot;
    const snapshotPresent=!cached||cached.patches!==this.patches||cached.leaves!==this.coveringLeaves||cached.splits!==this.previousSplits;
    const options={budget:Math.min(CAPACITY/2,Math.max(6,this.budget)),includeHidden:true,maxDepth:this.cameraState.mode==='walk'?22:this.maxDepth,pixelSize:this.pixelSize};
    const snapshotReuseId=snapshotPresent&&this.workerCoveringResultId!=null&&this.workerCoveringResultId===this.workerOfferedResultId?this.workerCoveringResultId:null;
    let deriveLeaves=false;
    if(snapshotPresent){
     if(snapshotReuseId==null){
      options.previousSplits=this.previousSplits;
      deriveLeaves=!!this.coveringLeaves&&this.patches.length===this.coveringLeaves.length&&this.patches.every((p,i)=>p.key===this.coveringLeaves[i].key);
      if(!deriveLeaves)options.previousLeaves=this.coveringLeaves;
     }
     this.workerSelectionSnapshot={patches:this.patches,leaves:this.coveringLeaves,splits:this.previousSplits};
    }
    const errors=this.selectionErrorEstimates();
    const errorEstimates=this.workerErrorVersion===errors.version?null:errors.values;
    this.workerErrorVersion=errors.version;
    this.selectionRequest={id};this.selectionWorker.postMessage({id,key,camera,options,errorEstimates,snapshotPresent,snapshotReuseId,deriveLeaves,allowUnchanged:true,compactLeaves:true,compactPatchDelta:true,previousPatches:snapshotPresent&&snapshotReuseId==null?this.patches:null});
   }
  }
  const stage=this.stage;
  const drawPatches=stage?.state==='transitioning'?stage.drawNodes:this.patches;
  this.stats.visiblePatches=drawPatches.length;
  if(stage?.state==='building')this.pending=stage.todo.splice(0,TRANSITION_BATCH);
  const normals=stage?.state==='building'?[...this.normalPending,...this.pending]:this.normalPending;
  const measuredView=stage?.measurementView;
  // The endpoint geometry is fixed during a morph. An identical camera and
  // projection produce the same comparison, regardless of morph progress.
  const sameMeasuredView=!!measuredView&&camera.width===measuredView.width&&camera.height===measuredView.height&&
   camera.eye.every((value,i)=>value===measuredView.eye[i])&&camera.vp.every((value,i)=>value===measuredView.vp[i]);
  const morphMeasurement=stage?.state==='transitioning'&&!stage.measurementPending&&now>=(stage.nextMeasure||0)&&!sameMeasuredView;
  let compare=(stage?.state==='building'&&stage.todo.length===0)||morphMeasurement;
  if(compare&&!this.prepareTransitionTopology(stage)){
   compare=false;stage.state='waiting';stage.nextMeasure=now+200;this.transition={...this.transition,waiting:true};
  }
  let firstPatch=CAPACITY,lastPatch=-1;
  let patchDirty=!this.uploadedPatchEye||camera.eye.some((value,i)=>value!==this.uploadedPatchEye[i]);
  const prepared=this.preparedPatchState;
  const patchStateUnchanged=!patchDirty&&prepared?.patches===this.patches&&prepared?.slots===this.slotByKey&&
   prepared?.newNodes===(stage?.newNodes??null)&&prepared?.newSlots===(stage?.slots??null);
  const writePatch=(node,slots)=>{
   const i=node.slot*32,cache=this.patchMetadataCache||(this.patchMetadataCache=new WeakMap());
   firstPatch=Math.min(firstPatch,node.slot);lastPatch=Math.max(lastPatch,node.slot);
   if(cache.get(node)!==slots){
    patchDirty=true;
    const b=FACE_BASES[node.face],cube=faceCube(node.face,node.u,node.v);
    this.patchFloats.set([...cube,node.span],i);this.patchFloats.set([...b.u,0],i+4);this.patchFloats.set([...b.v,0],i+8);
    const high=node.direction.map(Math.fround),low=node.direction.map((x,k)=>x-high[k]);
    this.patchFloats.set([...high,0],i+12);this.patchFloats.set([...low,0],i+16);
    this.patchUints.set([node.face,node.level,node.stitch,node.normalStitch],i+24);
    this.patchUints.set(node.edgeKeys.map(key=>slots.get(key)??0xffffffff),i+28);cache.set(node,slots);
   }
   // Camera-relative coordinates still need double-precision calculation each
   // frame, even while the patch's other metadata remains unchanged.
   for(let k=0;k<3;k++)this.patchFloats[i+20+k]=node.direction[k]*RADIUS_KM-camera.eye[k];
   this.patchFloats[i+23]=0;
  };
  if(!patchStateUnchanged){
   for(const node of this.patches)writePatch(node,this.slotByKey);
   if(stage)for(const node of stage.newNodes)writePatch(node,stage.slots);
   this.preparedPatchState={patches:this.patches,slots:this.slotByKey,newNodes:stage?.newNodes??null,newSlots:stage?.slots??null};
  }
  const raw=this.frameUniformData,f=this.frameUniformFloats,u=this.frameUniformUints;
  f.set(camera.vp,0);camera.planes.forEach((p,i)=>f.set(p,16+i*4));
  const east=normalize([camera.radial[2],0,-camera.radial[0]]),north=normalize([camera.radial[1]*east[2],camera.radial[2]*east[0]-camera.radial[0]*east[2],-camera.radial[1]*east[0]]);
  let sun=normalize([.55,.42,.72]);
  if(this.followSun){
   const low=this.cameraState.mode==='flyover'||this.cameraState.mode==='walk';
   sun=normalize(add(add(scale(camera.radial,low ? .32 : .72),scale(camera.right,low ? .9 : .55)),scale(camera.up,low ? .22 : .25)));
  }
  else if(this.sunAzimuth!=null){
   const az=this.sunAzimuth*Math.PI/180,alt=this.sunElevation*Math.PI/180;
   sun=normalize(add(add(scale(north,Math.cos(az)*Math.cos(alt)),scale(east,Math.sin(az)*Math.cos(alt))),scale(camera.radial,Math.sin(alt))));
  }
  f.set([...sun,0],36);f.set([RADIUS_KM,this.relief,this.ocean?1:0,this.valleys],40);
  const separateOcean=this.ocean&&!this.lodColors&&!this.patchColors&&!this.meshletColors&&!this.wireframe&&!this.patchLines&&!this.meshletLines;
  const flags=(this.culling?1:0)|(this.lodColors?2:0)|(this.wireframe?4:0)|(this.patchLines?8:0)|(this.biomes?16:0)|(separateOcean?32:0)|(this.patchColors?64:0)|(this.meshletColors?128:0)|(this.meshletLines?256:0);
  u.set([drawPatches.length,this.pending.length,this.seed>>>0,flags],44);
  u.set([normals.length,this.regionPending.length,camera.width,camera.height],48);
  f.set([this.erosion,this.rivers?1:0,this.regional?1:0,this.debugOpacity],52);
  const d=this.device;
  this.cloudWindDistance=(this.cloudWindDistance??0)+Math.max(0,Math.min(.25,(now-(this.cloudLastTime??now))*.001))*(this.cloudSpeed??8);this.cloudLastTime=now;
  const weatherSeed=this.seed%10000,windAngle=this.cloudWindDistance/6371000;
  if(this.cloudWeatherSeed!==weatherSeed){this.cloudWeatherSeed=weatherSeed;this.cloudWeatherAxis=normalize([.08+Math.sin(weatherSeed*.07)*.08,.99,.07+Math.cos(weatherSeed*.09)*.08]);}
  const weatherAxis=this.cloudWeatherAxis;
  const cloudSun=[dot(sun,east),dot(sun,camera.radial),dot(sun,north)];
  const seedOffset=[.071,.039,.053].map(value=>Math.fround(Math.fround(weatherSeed)*Math.fround(value)));
  const cloudScale=Math.fround(Math.fround(.00028)/Math.max(.5,Math.fround(this.cloudSize??2)));
  const cloudData=this.cloudUniformData;cloudData.set([camera.width,camera.height,seedOffset[0],seedOffset[1],seedOffset[2],Math.cos(windAngle),camera.altitude*1000,this.clouds===false?0:(this.cloudCoverage??.72),this.cloudDensity??1,cloudScale,weatherSeed,Math.sin(windAngle),this.cloudSize??2,...weatherAxis],0);cloudData.set([...camera.radial,0,...east,0,...north,0,...camera.forward,camera.tanX,...camera.right,camera.tanY,...camera.up,camera.near,...cloudSun,separateOcean?1:0],16);cloudData.set([this.skyStrength??1,this.mieStrength??1,this.haloStrength??1,this.cloudQuality??.8],44);if(this.cloudUniform)d.queue.writeBuffer(this.cloudUniform,0,cloudData);
  d.queue.writeBuffer(this.uniform,0,raw);
  if(patchDirty&&lastPatch>=firstPatch){
   const offset=firstPatch*PATCH_BYTES,size=(lastPatch-firstPatch+1)*PATCH_BYTES;
   d.queue.writeBuffer(this.patchBuffer,offset,new Uint8Array(this.patchBytes,offset,size));this.uploadedPatchEye=[...camera.eye];
  }
  if(separateOcean){
   const view=this.oceanViewData;view.set([...camera.radial,camera.altitude],0);view.set([...camera.forward,camera.tanY],4);view.set([...camera.right,camera.tanX],8);view.set([...camera.up,camera.width],12);view[16]=camera.height;view[17]=camera.near;d.queue.writeBuffer(this.oceanView,0,view);
  }
  // Draw lists and their slots are immutable once published. Avoid scanning
  // every patch each frame while the same list remains active.
  const activeChanged=!this.uploadedActiveSlots||(this.uploadedActiveList!==drawPatches&&
   (this.uploadedActiveSlots.length!==drawPatches.length||drawPatches.some((p,i)=>p.slot!==this.uploadedActiveSlots[i])));
  if(activeChanged){
   this.uploadedActiveSlots=new Uint32Array(drawPatches.map(p=>p.slot));
   if(drawPatches.length)d.queue.writeBuffer(this.activeBuffer,0,this.uploadedActiveSlots);
  }
  this.uploadedActiveList=drawPatches;
  if(this.pending.length)d.queue.writeBuffer(this.queueBuffer,0,new Uint32Array(this.pending));
  if(normals.length)d.queue.writeBuffer(this.normalQueueBuffer,0,new Uint32Array(normals));
  if(compare&&stage.pairs.length&&!stage.comparisonUploaded){
   d.queue.writeBuffer(this.transitionPairsBuffer,0,encodeTransitionPairs(stage.pairs,this.topologySlots));stage.comparisonUploaded=true;
  }
  d.queue.writeBuffer(this.indirect,0,new Uint32Array([this.morphVertexCount||96,0,0,0]));
  this.ensureHydrology();
  const generatedOnSample=this.pending.length;
  const sample=((generatedOnSample>0&&!stage)||now-this.lastSample>500)&&!this.pendingRead;if(sample){this.lastSample=now;this.pendingRead=true;}
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
  dispatch(this.normalPipe,this.normalBind,normals.length*17*17);
  dispatch(this.boundsPipe,this.boundsBind,this.pending.length*MESHLETS);
  if(compare&&stage.pairs.length){cp.setPipeline(this.transitionPipe);cp.setBindGroup(0,this.transitionBind);cp.dispatchWorkgroups(stage.pairs.length);}
  dispatch(this.cullPipe,this.cullBind,drawPatches.length*MESHLETS);cp.end();
  const colorView=this.context.getCurrentTexture().createView(),depthView=this.depthView;
  const cloudActive=!!this.cloudPipe&&!this.lodColors&&!this.patchColors&&!this.meshletColors&&!this.wireframe&&!this.patchLines&&!this.meshletLines;
  const descriptor={colorAttachments:[
   {view:colorView,clearValue:{r:.006,g:.009,b:.016,a:1},loadOp:'clear',storeOp:'store'},
   {view:this.waterDepthView,clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}
  ],depthStencilAttachment:{view:depthView,depthClearValue:0,depthLoadOp:'clear',depthStoreOp:separateOcean||cloudActive?'store':'discard'}};
  if(sample&&this.timing)descriptor.timestampWrites={querySet:this.queries,beginningOfPassWriteIndex:2,endOfPassWriteIndex:3};
  const pass=encoder.beginRenderPass(descriptor);pass.setPipeline(this.renderPipe);pass.setBindGroup(0,this.renderBind);pass.drawIndirect(this.indirect,0);pass.end();
  if(separateOcean){
   const waterDescriptor={colorAttachments:[{view:colorView,loadOp:'load',storeOp:'store'}],depthStencilAttachment:{view:depthView,depthLoadOp:'load',depthStoreOp:cloudActive?'store':'discard'}};
   if(sample&&this.timing)waterDescriptor.timestampWrites={querySet:this.queries,beginningOfPassWriteIndex:4,endOfPassWriteIndex:5};
   const waterPass=encoder.beginRenderPass(waterDescriptor);waterPass.setPipeline(this.oceanPipe);waterPass.setBindGroup(0,this.oceanBind);waterPass.draw(3);waterPass.end();
  }
  if(cloudActive){const cloudDescriptor={colorAttachments:[{view:colorView,loadOp:'load',storeOp:'store'}]};if(sample&&this.timing)cloudDescriptor.timestampWrites={querySet:this.queries,beginningOfPassWriteIndex:6,endOfPassWriteIndex:7};const clouds=encoder.beginRenderPass(cloudDescriptor);clouds.setPipeline(this.cloudPipe);clouds.setBindGroup(0,this.cloudBind);clouds.draw(3);clouds.end();}
  const measured=sample?drawPatches.map(({key,slot})=>({key,slot})):null;
  let readback;if(sample){readback=this.telemetryReadback||d.createBuffer({size:80+CAPACITY*4,usage:BUFFER.COPY_DST|BUFFER.MAP_READ});this.telemetryReadback=null;encoder.copyBufferToBuffer(this.indirect,0,readback,0,16);encoder.copyBufferToBuffer(this.lodErrorBuffer,0,readback,80,CAPACITY*4);if(this.timing){encoder.resolveQuerySet(this.queries,0,8,this.resolve,0);encoder.copyBufferToBuffer(this.resolve,0,readback,16,64);}}
  let transitionRead,transitionCapacity=0;if(compare&&stage.pairs.length){
   if(!morphMeasurement)stage.state='measuring';
   stage.measurementPending=true;stage.nextMeasure=now+200;
   const readSize=stage.pairs.length*8;
   if(this.transitionReadback&&this.transitionReadbackCapacity<readSize){this.transitionReadback.destroy();this.transitionReadback=null;this.transitionReadbackCapacity=0;}
   transitionCapacity=this.transitionReadback?this.transitionReadbackCapacity:readSize;
   transitionRead=this.transitionReadback||d.createBuffer({size:readSize,usage:BUFFER.COPY_DST|BUFFER.MAP_READ});this.transitionReadback=null;this.transitionReadbackCapacity=0;
   encoder.copyBufferToBuffer(this.transitionErrorBuffer,0,transitionRead,0,stage.pairs.length*8);
  }else if(compare){stage.maxMerge=0;stage.state='ready';this.transition={...this.transition,pixels:0,pending:0,overTarget:false};}
  d.queue.submit([encoder.finish()]);this.lastFrameEye=camera.eye;this.displayedPatches=drawPatches;this.pending=[];this.normalPending=[];this.regionPending=[];this.inFlight++;
  if(stage)this.transition={...this.transition,pending:stage.todo.length};
  d.queue.onSubmittedWorkDone().then(()=>{this.inFlight--;}).catch(()=>{this.inFlight--;});
  let transitionReusable=false;
  if(transitionRead)transitionRead.mapAsync(GPUMapMode.READ).then(()=>{
   const values=new Float32Array(transitionRead.getMappedRange());let maxPixel=0,maxMerge=0,maxRefine=0;
   if(this.stage===stage&&stage.generation===this.generation){
    for(let i=0;i<stage.pairs.length;i++){
     const px=values[i*2],world=values[i*2+1],pair=stage.pairs[i];
     if(!Number.isFinite(px)||!Number.isFinite(world))throw new Error('Non-finite terrain transition measurement');
     maxPixel=Math.max(maxPixel,px);if(!pair.refining)maxMerge=Math.max(maxMerge,px);else maxRefine=Math.max(maxRefine,px);
     const previous=this.transitionErrors.get(pair.coarse.key),updated=Math.max(previous||0,world);
     if(previous!==updated){this.transitionErrors.set(pair.coarse.key,updated);this.transitionErrorVersion++;}
    }
    while(this.transitionErrors.size>8192){this.transitionErrors.delete(this.transitionErrors.keys().next().value);this.transitionErrorVersion++;}
    stage.maxMerge=maxMerge;stage.maxRefine=maxRefine;
    stage.measurementView={eye:[...camera.eye],vp:[...camera.vp],width:camera.width,height:camera.height};
    if(morphMeasurement){
     // Refresh the error budget at the current view without changing progress.
     // Near-plane crossings must not leave a permanently enormous old estimate.
     stage.morph.endpointPixels=maxPixel;stage.morph.focalPixels=camera.focalPixels;stage.morph.clearance=Math.max(.0001,camera.clearance);
    }else stage.state='ready';
    this.transition={...this.transition,pixels:maxPixel,pending:0,overTarget:maxPixel>this.transitionTargetPixels,waiting:false};
   }
   transitionRead.unmap();transitionReusable=true;
  }).catch(e=>{if(this.stage===stage){if(!morphMeasurement){this.cancelStage();this.needsSelection=true;}this.onError?.(`Terrain transition: ${e.message}`);}}).finally(()=>{stage.measurementPending=false;if(transitionReusable&&stage.generation===this.generation&&!this.deviceLost&&!this.transitionReadback){this.transitionReadback=transitionRead;this.transitionReadbackCapacity=transitionCapacity;}else transitionRead.destroy();});
  if(readback){const generation=this.generation;let reusable=false;readback.mapAsync(GPUMapMode.READ).then(()=>{
   const data=readback.getMappedRange(),visibleMeshlets=new Uint32Array(data,0,4)[1];let gpuComputeMs=null,gpuRenderMs=null,gpuTerrainMs=null,gpuOceanMs=null,gpuCloudMs=null;
   if(this.timing){const t=new BigUint64Array(data,16,8);const elapsed=(a,b)=>t[b]>=t[a]?Number(t[b]-t[a])/1e6:null;gpuComputeMs=elapsed(0,1);gpuTerrainMs=elapsed(2,3);gpuOceanMs=separateOcean?elapsed(4,5):null;gpuCloudMs=cloudActive?elapsed(6,7):null;gpuRenderMs=gpuTerrainMs==null?null:gpuTerrainMs+(gpuOceanMs??0)+(gpuCloudMs??0);}
   if(generation===this.generation){
    const residuals=new Float32Array(data,80,CAPACITY);
    for(const {key,slot} of measured){const error=residuals[slot];if(Number.isFinite(error)&&error>=0){
     const transition=this.transitionErrors.get(key)||0;
     if(Math.max(this.lodErrors.get(key)||0,transition)!==Math.max(error,transition))this.lodErrorVersion++;
     this.lodErrors.delete(key);this.lodErrors.set(key,error);
    }}
    while(this.lodErrors.size>8192){const key=this.lodErrors.keys().next().value;if((this.lodErrors.get(key)||0)>(this.transitionErrors.get(key)||0))this.lodErrorVersion++;this.lodErrors.delete(key);}
    this.latest={visibleMeshlets,gpuComputeMs,gpuRenderMs,gpuTerrainMs,gpuOceanMs,gpuCloudMs,gpuSampleAt:now,generatedPatchesSample:generatedOnSample};
   }readback.unmap();reusable=true;
  }).catch(e=>{if(generation===this.generation&&!this.deviceLost)this.onError?.(`GPU telemetry: ${e.message}`);}).finally(()=>{if(reusable&&generation===this.generation&&!this.deviceLost)this.telemetryReadback=readback;else readback.destroy();this.pendingRead=false;});}
  return performance.now()-cpuStart;
 }
}

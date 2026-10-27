import {PlanetRenderer} from '../src/planet/renderer.js';
import {REGION_CAPACITY,REGION_GRID,REGION_SAMPLES,REGION_LOOKUPS,REGION_FACE_TILES,regionAt} from '../src/planet/regions.js';
import {faceDirection} from '../src/planet/planet-math.js';
const status=document.querySelector('#status');
try{
 const canvas=document.querySelector('#source'),adapter=await navigator.gpu?.requestAdapter();if(!adapter)throw new Error('No WebGPU adapter');
 const device=await adapter.requestDevice(),errors=[],renderer=new PlanetRenderer(canvas,adapter,device,canvas.getContext('webgpu'),false,e=>errors.push(e));
 await renderer.init();renderer.seed=918273;renderer.invalidateTerrain();const highland=await renderer.findHighlands();
 renderer.resize();const color=device.createTexture({size:[canvas.width,canvas.height],format:renderer.format,usage:GPUTextureUsage.RENDER_ATTACHMENT});renderer.context={getCurrentTexture:()=>color};
 renderer.requestSurface=()=>{};renderer.budget=36;renderer.pixelSize=24;
 Object.assign(renderer.cameraState,{mode:'orbit',altitude:4,surfaceHeight:highland.height,longitude:Math.atan2(highland.direction[2],highland.direction[0]),latitude:Math.asin(highland.direction[1])});
 renderer.frame(performance.now()+1000);await device.queue.onSubmittedWorkDone();
 const slots=[...renderer.regions].map(([id,slot])=>({id,slot,face:renderer.regionMeta[slot*4],x:renderer.regionMeta[slot*4+1],y:renderer.regionMeta[slot*4+2]}));
 if(slots.length<4)throw new Error(`Regional simulation did not generate nearby tiles: ${slots.length}`);
 const lookupOffset=24578*(48+17*16+4),valuesOffset=Math.ceil((lookupOffset+REGION_LOOKUPS*4)/16)*16;
 async function copy(buffer,offset,size){const read=device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(buffer,offset,read,0,size);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const out=read.getMappedRange().slice(0);read.unmap();read.destroy();return out;}
 const all=new Float32Array(await copy(renderer.world,valuesOffset,REGION_CAPACITY*REGION_SAMPLES*16));
 let eroded=0,deposited=0,wet=0,suspended=0,maxErosion=0,maxDeposit=0,maxSediment=0,best=null;
 for(const {slot} of slots)for(let i=0;i<REGION_SAMPLES;i++){
  const o=(slot*REGION_SAMPLES+i)*4,delta=all[o],sediment=all[o+1],water=all[o+2];
  if(![delta,sediment,water].every(Number.isFinite)||sediment<0||water<0||Math.abs(delta)>.013)throw new Error(`Invalid regional output: ${JSON.stringify({slot,i,delta,sediment,water})}`);
  if(delta<-.000001)eroded++;if(delta>.000001)deposited++;if(water>.000001)wet++;if(sediment>.000001)suspended++;
  maxErosion=Math.max(maxErosion,-delta);maxDeposit=Math.max(maxDeposit,delta);maxSediment=Math.max(maxSediment,sediment);
  const x=i%65,y=Math.floor(i/65);if(x>=16&&x<=48&&y>=16&&y<=48&&(!best||Math.abs(delta)>Math.abs(best.delta)))best={slot,i,x,y,delta};
 }
 let matched=0,maxBoundary=0;
 for(const a of slots)for(const b of slots)if(a.face===b.face&&a.x+1===b.x&&a.y===b.y){
  for(let y=0;y<=64;y++)for(let k=0;k<3;k++){
   const x=(a.slot*REGION_SAMPLES+y*65+64)*4+k,z=(b.slot*REGION_SAMPLES+y*65)*4+k;
   matched++;maxBoundary=Math.max(maxBoundary,Math.abs(all[x]-all[z]));
  }
 }
 for(const a of slots)for(const b of slots)if(a.face===b.face&&a.y+1===b.y&&a.x===b.x){
  for(let x=0;x<=64;x++)for(let k=0;k<3;k++){
   const y=(a.slot*REGION_SAMPLES+64*65+x)*4+k,z=(b.slot*REGION_SAMPLES+x)*4+k;
   matched++;maxBoundary=Math.max(maxBoundary,Math.abs(all[y]-all[z]));
  }
 }
 if(eroded<100||deposited<10||suspended<100||wet<100||matched<100||maxBoundary>.000001)throw new Error(`Regional erosion/transport or overlapping boundaries failed: ${JSON.stringify({eroded,deposited,suspended,wet,matched,maxBoundary,maxErosion,maxDeposit,maxSediment})}`);
 const slot=slots[0].slot,chunk=REGION_GRID*REGION_GRID*16;
 const state=new Float32Array(await copy(renderer.regionA,slot*chunk,chunk)),previous=new Float32Array(await copy(renderer.regionB,slot*chunk,chunk)),outflow=new Float32Array(await copy(renderer.regionFlux,slot*chunk,chunk));
 let massChange=0,maxFluxExcess=0;
 for(let i=0;i<state.length;i+=4){
  massChange+=state[i]+state[i+2]-state[i+3];const sent=outflow[i]+outflow[i+1]+outflow[i+2]+outflow[i+3];maxFluxExcess=Math.max(maxFluxExcess,sent-previous[i+1]);
  if(!Number.isFinite(state[i])||!Number.isFinite(state[i+1])||!Number.isFinite(state[i+2])||state[i+1]<0||state[i+2]<0)throw new Error(`Invalid simulated state at ${i/4}`);
 }
 if(Math.abs(massChange)>.01||maxFluxExcess>.000001)throw new Error(`Material or water accounting failed: ${JSON.stringify({massChange,maxFluxExcess})}`);
 // The simulated displacement must be used by the actual terrain probe.
 const region=slots.find(r=>r.slot===best.slot),u=-1+2*(region.x+best.x/64)/REGION_FACE_TILES,v=-1+2*(region.y+best.y/64)/REGION_FACE_TILES;
 const direction=faceDirection(region.face,u,v);renderer.regional=false;const without=await renderer.sampleTerrain(direction);
 renderer.regional=true;const withRegion=await renderer.sampleTerrain(direction);
 const probeChange=withRegion[3]-without[3];if(Math.abs(probeChange)<.0001)throw new Error(`Regional simulation did not change terrain: ${JSON.stringify({best,probeChange})}`);
 // Repeat the same seed with different cache slots; results must not depend
 // on allocation order or on which part of the world was visited first.
 renderer.resetRegions();renderer.regionFree.reverse();renderer.invalidateTerrain();renderer.cameraState.surfaceHeight=highland.height;renderer.lastSelection=0;
 renderer.frame(performance.now()+3000);await device.queue.onSubmittedWorkDone();
 const again=new Uint32Array(await copy(renderer.world,valuesOffset,REGION_CAPACITY*REGION_SAMPLES*16)),original=new Uint32Array(all.buffer);
 for(const {id,slot:oldSlot} of slots){const newSlot=renderer.regions.get(id);if(newSlot===undefined)throw new Error(`Region ${id} was not regenerated`);
  for(let i=0;i<REGION_SAMPLES*4;i++)if(original[oldSlot*REGION_SAMPLES*4+i]!==again[newSlot*REGION_SAMPLES*4+i])throw new Error(`Regional simulation depended on cache slot for region ${id}, sample ${i}`);
 }
 // Load regions on both sides of an actual cube-face edge, then inspect the
 // sampled displacement just to either side of the boundary.
 const edge=[-1,-.921875,1],edgeLength=Math.hypot(...edge);for(let i=0;i<3;i++)edge[i]/=edgeLength;
 const edgeHeight=await renderer.sampleTerrain(edge);Object.assign(renderer.cameraState,{altitude:4,surfaceHeight:edgeHeight[3],longitude:Math.atan2(edge[2],edge[0]),latitude:Math.asin(edge[1])});
 renderer.needsSelection=true;renderer.lastSelection=0;renderer.frame(performance.now()+5000);await device.queue.onSubmittedWorkDone();
 const edgeTiles=[regionAt([-1.000001,-.921875,1]),regionAt([-.999999,-.921875,1])];
 if(edgeTiles[0].face===edgeTiles[1].face||edgeTiles.some(r=>!renderer.regions.has(r.id)))throw new Error(`Cube-edge regional tiles were not loaded on both faces: ${JSON.stringify(edgeTiles)}`);
 const [common,curve,field]=await Promise.all(['common.wgsl','river-curve.wgsl','world-field.wgsl'].map(p=>fetch(`../src/planet/${p}`).then(r=>r.text())));
 const module=device.createShaderModule({code:common+'\n'+curve+'\n'+field+`
 @group(0) @binding(5) var<storage,read_write> samples:array<vec4<f32>>;
 @compute @workgroup_size(1) fn edgeTest(@builtin(global_invocation_id) gid:vec3<u32>){
  if(gid.x>=3u){return;}let shift=(f32(gid.x)-1.0)*.000001;
  samples[gid.x]=regionalSimulation(normalize(vec3<f32>(-1.0+shift,-.921875,1.0)));
 }`});
 const pipe=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'edgeTest'}});
 const bind=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:5,resource:{buffer:renderer.sampleBuffer}},{binding:7,resource:{buffer:renderer.world}}]});
 const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipe);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(3);pass.end();device.queue.submit([encoder.finish()]);
 const edgeData=new Float32Array(await copy(renderer.sampleBuffer,0,48));
 const edgeDifference=Math.max(Math.abs(edgeData[0]-edgeData[4]),Math.abs(edgeData[8]-edgeData[4]));
 if(!Number.isFinite(edgeDifference)||Math.abs(edgeData[4])<.000001||edgeDifference>.0001)throw new Error(`Regional cube-face field was empty or discontinuous: ${JSON.stringify({edge:[edgeData[0],edgeData[4],edgeData[8]],edgeDifference})}`);
 const otherSeeds=[];
 for(const seed of [1,42]){
  renderer.seed=seed;renderer.invalidateTerrain();const point=await renderer.findHighlands();
  Object.assign(renderer.cameraState,{altitude:4,surfaceHeight:point.height,longitude:Math.atan2(point.direction[2],point.direction[0]),latitude:Math.asin(point.direction[1])});
  renderer.lastSelection=0;renderer.frame(performance.now()+7000);await device.queue.onSubmittedWorkDone();
  const values=new Float32Array(await copy(renderer.world,valuesOffset,REGION_CAPACITY*REGION_SAMPLES*16));let changed=0,transported=0;
  for(const tileSlot of renderer.regions.values())for(let i=0;i<REGION_SAMPLES;i++){
   const o=(tileSlot*REGION_SAMPLES+i)*4,d=values[o],s=values[o+1],w=values[o+2];
   if(![d,s,w].every(Number.isFinite)||Math.abs(d)>.013||s<0||w<0)throw new Error(`Invalid regional state for seed ${seed}`);
   if(Math.abs(d)>.000001)changed++;if(s>.000001)transported++;
  }
  if(changed<100||transported<100)throw new Error(`Regional simulation did not produce erosion and sediment for seed ${seed}`);
  otherSeeds.push({seed,changed,transported});
 }
 if(errors.length)throw new Error(errors.join('; '));
 const result={ok:true,regions:slots.length,eroded,deposited,wet,suspended,maxErosion,maxDeposit,maxSediment,matched,maxBoundary,massChange,maxFluxExcess,probeChange,edgeDifference,deterministic:true,otherSeeds};status.textContent=JSON.stringify(result);window.__regionalSmokeDone=result;window.__regionalRenderer=renderer;
}catch(error){status.textContent=error.stack;window.__regionalSmokeDone={ok:false,error:error.stack};}

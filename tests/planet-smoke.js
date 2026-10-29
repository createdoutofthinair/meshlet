import {PlanetRenderer} from '../src/planet/renderer.js';
import {faceDirection,directionToFace} from '../src/planet/planet-math.js';
import {buildWorldGrid} from '../src/planet/world-grid.js';
import {REGION_LOOKUPS,REGION_SAMPLES,REGION_CAPACITY,regionAt} from '../src/planet/regions.js';
const status=document.querySelector('#status');
try{
 const source=document.querySelector('#source');const adapter=await navigator.gpu?.requestAdapter();if(!adapter)throw new Error('No WebGPU adapter');
 const device=await adapter.requestDevice(),errors=[];
 const renderer=new PlanetRenderer(source,adapter,device,source.getContext('webgpu'),false,e=>errors.push(e));
 await renderer.init();window.__planetRenderer=renderer;renderer.budget=36;renderer.pixelSize=24;renderer.transitionTargetPixels=Infinity;renderer.resize();renderer.lastSample=Infinity;
 const width=source.width,height=source.height,stride=Math.ceil(width*4/256)*256;
 const color=device.createTexture({size:[width,height],format:renderer.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
 renderer.context={getCurrentTexture:()=>color};
 async function capture(){
  let now=performance.now()+1000,iterations=0;
  do{
   while(renderer.inFlight>=2)await new Promise(resolve=>setTimeout(resolve,1));
   renderer.frame(now);now+=150;await device.queue.onSubmittedWorkDone();await new Promise(resolve=>setTimeout(resolve,1));
   if(++iterations>300)throw new Error('Terrain staging failed to settle');
  }while(renderer.stage);
  const pixels=device.createBuffer({size:stride*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const commands=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const e=device.createCommandEncoder();
  e.copyTextureToBuffer({texture:color},{buffer:pixels,bytesPerRow:stride,rowsPerImage:height},[width,height]);e.copyBufferToBuffer(renderer.indirect,0,commands,0,16);device.queue.submit([e.finish()]);
  await Promise.all([pixels.mapAsync(GPUMapMode.READ),commands.mapAsync(GPUMapMode.READ)]);
  const result={pixels:new Uint8Array(pixels.getMappedRange().slice(0)),count:new Uint32Array(commands.getMappedRange().slice(0))[1],patches:renderer.patches.length};
  pixels.unmap();commands.unmap();pixels.destroy();commands.destroy();return result;
 }
 window.__planetCapture=capture;
 function difference(a,b){let n=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*stride+x*4;if(Math.max(...[0,1,2].map(k=>Math.abs(a.pixels[i+k]-b.pixels[i+k])))>2)n++;}return n;}
 const first=await capture();if(first.patches<1||first.count<1)throw new Error(`No planet geometry was rendered: ${JSON.stringify({patches:first.patches,count:first.count})}`);
 // Probe a synthetic sloped mesh using the real walking shader. The sample
 // includes all four stitched edges and a high-altitude reference value.
 const walkPatch=device.createBuffer({size:128,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
 const walkVertices=device.createBuffer({size:441*48,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
 const walkInput=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const walkOutput=device.createBuffer({size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
 const walkBind=device.createBindGroup({layout:renderer.walkProbePipe.getBindGroupLayout(0),entries:[[0,walkPatch],[1,walkVertices],[2,walkInput],[3,walkOutput]].map(([binding,buffer])=>({binding,resource:{buffer}}))});
 const walkVertexData=new Float32Array(441*12);
 for(let y=0;y<21;y++)for(let x=0;x<21;x++){
  const px=x-2,py=y-2,i=(y*21+x)*12;walkVertexData.set([px*.001,px*.0002+py*.0001,py*.001,0],i);
 }
 device.queue.writeBuffer(walkVertices,0,walkVertexData);
 for(const [x,y,stitch] of [[3.25,4.65,0],[.1,3.6,1],[15.8,7.3,2],[3.6,.1,4],[7.3,15.9,8]]){
  const patch=new Uint32Array(32);patch[26]=stitch;device.queue.writeBuffer(walkPatch,0,patch);
  const raw=new ArrayBuffer(48),f=new Float32Array(raw),u=new Uint32Array(raw);
  f.set([x*.001,0,y*.001,9,0,1,0,0]);u.set([0,Math.floor(x),Math.floor(y),0],8);device.queue.writeBuffer(walkInput,0,raw);
  const read=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();
  const pass=encoder.beginComputePass();pass.setPipeline(renderer.walkProbePipe);pass.setBindGroup(0,walkBind);pass.dispatchWorkgroups(1);pass.end();
  encoder.copyBufferToBuffer(walkOutput,0,read,0,16);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
  const values=new Float32Array(read.getMappedRange().slice(0));read.unmap();read.destroy();
  if(values[1]<.5||Math.abs(values[0]-(9+x*.0002+y*.0001))>.00001)throw new Error(`Walking mesh probe failed at ${x},${y}, stitch ${stitch}: ${[...values]}`);
 }
 walkPatch.destroy();walkVertices.destroy();walkInput.destroy();walkOutput.destroy();
 // Exercise the actual parent/child comparison on a known synthetic mesh.
 // One fine vertex is offset by .002 km, which projects to one pixel here.
 const transitionFrame=device.createBuffer({size:224,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const transitionPatches=device.createBuffer({size:256,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
 const transitionVertices=device.createBuffer({size:2*441*48,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
 const transitionPair=device.createBuffer({size:32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
 const transitionResult=device.createBuffer({size:8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
 const tf=new ArrayBuffer(224),tff=new Float32Array(tf),tfu=new Uint32Array(tf);tff[0]=tff[5]=tff[10]=tff[15]=1;tfu[50]=1000;tfu[51]=500;device.queue.writeBuffer(transitionFrame,0,tf);
 const tv=new Float32Array(2*441*12);
 for(let slot=0;slot<2;slot++)for(let y=0;y<=16;y++)for(let x=0;x<=16;x++){
  const i=(slot*441+(y+2)*21+x+2)*12;tv[i]=x*(slot?.005:.01)+(slot===1&&x===3&&y===3?.002:0);tv[i+1]=y*(slot?.005:.01);
 }
 device.queue.writeBuffer(transitionVertices,0,tv);const tp=new ArrayBuffer(32),tpu=new Uint32Array(tp),tpf=new Float32Array(tp);tpu.set([1,0,0,0]);tpf.set([0,0,.5,0],4);device.queue.writeBuffer(transitionPair,0,tp);
 const transitionBind=device.createBindGroup({layout:renderer.transitionPipe.getBindGroupLayout(0),entries:[transitionFrame,transitionPatches,transitionVertices,transitionPair,transitionResult].map((buffer,binding)=>({binding,resource:{buffer}}))});
 const transitionRead=device.createBuffer({size:8,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),transitionEncoder=device.createCommandEncoder(),transitionPass=transitionEncoder.beginComputePass();
 transitionPass.setPipeline(renderer.transitionPipe);transitionPass.setBindGroup(0,transitionBind);transitionPass.dispatchWorkgroups(1);transitionPass.end();transitionEncoder.copyBufferToBuffer(transitionResult,0,transitionRead,0,8);device.queue.submit([transitionEncoder.finish()]);
 await transitionRead.mapAsync(GPUMapMode.READ);const transitionCheck=new Float32Array(transitionRead.getMappedRange().slice(0));transitionRead.unmap();
 if(!transitionCheck.every(Number.isFinite)||Math.abs(transitionCheck[0]-1)>.01||Math.abs(transitionCheck[1]-.002)>.00001)throw new Error(`Actual parent/child comparison failed: ${[...transitionCheck]}`);
 // A flat, newly stitched edge should not report an error simply because an
 // odd vertex collapses to the preceding even vertex. Curvature must count.
 tpu.set([0,0,0,1]);tpf.set([0,0,1,0],4);device.queue.writeBuffer(transitionPair,0,tp);
 async function measureStitch(){
  const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(renderer.transitionPipe);pass.setBindGroup(0,transitionBind);pass.dispatchWorkgroups(1);pass.end();encoder.copyBufferToBuffer(transitionResult,0,transitionRead,0,8);device.queue.submit([encoder.finish()]);
  await transitionRead.mapAsync(GPUMapMode.READ);const result=new Float32Array(transitionRead.getMappedRange().slice(0));transitionRead.unmap();return result;
 }
 const flatStitch=await measureStitch();
 if(flatStitch[0]>.001||flatStitch[1]>.00001)throw new Error(`Flat stitched edge produced a false error: ${[...flatStitch]}`);
 tv[((3+2)*21+2)*12]=.002;device.queue.writeBuffer(transitionVertices,0,tv);
 const curvedStitch=await measureStitch();
 if(Math.abs(curvedStitch[0]-1)>.01||Math.abs(curvedStitch[1]-.002)>.00001)throw new Error(`Stitched-edge curvature was not measured: ${[...curvedStitch]}`);
 for(const buffer of [transitionFrame,transitionPatches,transitionVertices,transitionPair,transitionResult,transitionRead])buffer.destroy();
 renderer.culling=false;const uncull=await capture();renderer.culling=true;
 if(uncull.count!==uncull.patches*16 || first.count>uncull.count)throw new Error(`Invalid meshlet culling counts: ${first.count} / ${uncull.count}`);
 const cullingChanged=difference(first,uncull);if(cullingChanged>width*height*.02)throw new Error(`Culling changed ${cullingChanged} pixels`);
 // Check GPU-generated positions on the edges where different cube faces meet.
 const roots=renderer.patches.filter(node=>node.level===0),rootChunk=441*48;
 const rootBuffer=device.createBuffer({size:roots.length*rootChunk,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),rootEncoder=device.createCommandEncoder();
 roots.forEach((node,i)=>rootEncoder.copyBufferToBuffer(renderer.vertices,node.slot*rootChunk,rootBuffer,i*rootChunk,rootChunk));device.queue.submit([rootEncoder.finish()]);await rootBuffer.mapAsync(GPUMapMode.READ);
 const rootData=new Float32Array(rootBuffer.getMappedRange()),edges=new Map();let crossMatches=0,crossMaxKm=0;
 roots.forEach((node,i)=>{for(let y=0;y<=16;y++)for(let x=0;x<=16;x++){
  if(x!==0&&x!==16&&y!==0&&y!==16)continue;
  const direction=faceDirection(node.face,-1+x/8,-1+y/8),key=direction.map(v=>v.toFixed(6)).join(','),base=i*441*12+((y+2)*21+x+2)*12;
  const position=direction.map((_,k)=>node.direction[k]*6371+rootData[base+k]);
  if(edges.has(key)){const previous=edges.get(key);if(previous.face!==node.face){crossMatches++;crossMaxKm=Math.max(crossMaxKm,Math.hypot(...position.map((v,k)=>v-previous.position[k])));}}
  else edges.set(key,{face:node.face,position});
 }});
 // Compare the GPU's geometric residual with an independent CPU calculation
 // on the same generated vertices, including spherical curvature.
 const errorBuffer=device.createBuffer({size:512*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),errorEncoder=device.createCommandEncoder();
 errorEncoder.copyBufferToBuffer(renderer.lodErrorBuffer,0,errorBuffer,0,512*4);device.queue.submit([errorEncoder.finish()]);await errorBuffer.mapAsync(GPUMapMode.READ);
 const errorData=new Float32Array(errorBuffer.getMappedRange());let lodResidualMax=0,lodResidualDifference=0;
 for(let i=0;i<roots.length;i++){
  const p=(x,y)=>{const off=i*441*12+((y+2)*21+x+2)*12;return [rootData[off],rootData[off+1],rootData[off+2]];};let max=0;
  for(let y=0;y<=16;y++)for(let x=0;x<=16;x++){
   const oddX=x%2,oddY=y%2;if(!oddX&&!oddY)continue;
   const a=oddX?(oddY?p(x-1,y+1):p(x-1,y)):p(x,y-1);
   const b=oddX?(oddY?p(x+1,y-1):p(x+1,y)):p(x,y+1);
   max=Math.max(max,Math.hypot(...p(x,y).map((v,k)=>v-(a[k]+b[k])*.5)));
  }
  const measured=errorData[roots[i].slot];lodResidualMax=Math.max(lodResidualMax,measured);lodResidualDifference=Math.max(lodResidualDifference,Math.abs(max-measured));
  if(!Number.isFinite(measured)||Math.abs(max-measured)>Math.max(.0005,max*.0001))throw new Error(`GPU LOD residual does not match terrain vertices: ${max}/${measured}`);
 }
 errorBuffer.unmap();errorBuffer.destroy();if(lodResidualMax<=0)throw new Error('GPU LOD residual is empty');
 // The asynchronous telemetry readback feeds these measurements back into
 // subsequent selections; allow its mapping callback to complete.
 for(let i=0;i<50&&renderer.lodErrors.size<roots.length;i++)await new Promise(resolve=>setTimeout(resolve,2));
 const lodMeasurements=renderer.lodErrors.size;if(lodMeasurements<roots.length)throw new Error(`LOD measurements were not available to patch selection: ${lodMeasurements}`);
 rootBuffer.unmap();rootBuffer.destroy();if(crossMatches<100||crossMaxKm>.002)throw new Error(`Cube-face seams: ${crossMatches} matches, max ${crossMaxKm} km`);
 const highland=await renderer.findHighlands();const point=await renderer.sampleTerrain(highland.direction);
 if(Math.abs(point[3]-highland.height)>.02)throw new Error(`Highland probe disagrees with its sampled height: ${point[3]} / ${highland.height}`);
 const valley=await renderer.findValleys();
 if(!valley||valley.incision<.02||!Number.isFinite(valley.height))throw new Error(`Could not find a seeded valley: ${JSON.stringify(valley)}`);
 await renderer.sampleTerrain(highland.direction);
 // The extra detail is geometry, including at scales smaller than a float32
 // unit-vector coordinate can represent without the high/low decomposition.
 const [common,terrainCore,riverCurve,worldField,terrainSurface,generator]=await Promise.all(['common.wgsl','terrain-core.wgsl','river-curve.wgsl','world-field.wgsl','terrain-surface.wgsl','generate.wgsl'].map(p=>fetch(`../src/planet/${p}`).then(r=>r.text())));
 const [oceanSource,oceanTest]=await Promise.all([fetch('../src/planet/ocean.wgsl').then(r=>r.text()),fetch('./ocean-smoke.wgsl').then(r=>r.text())]);
 const oceanModule=device.createShaderModule({code:[common,terrainCore,riverCurve,worldField,terrainSurface,oceanSource,oceanTest].join('\n')});
 const oceanPipe=await device.createComputePipelineAsync({layout:'auto',compute:{module:oceanModule,entryPoint:'oceanIntersectionCheck'}});
 const oceanOutput=device.createBuffer({size:48,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
 const oceanBind=device.createBindGroup({layout:oceanPipe.getBindGroupLayout(0),entries:[[0,renderer.uniform],[13,oceanOutput]].map(([binding,buffer])=>({binding,resource:{buffer}}))});
 const oceanRead=device.createBuffer({size:48,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),oceanEncoder=device.createCommandEncoder(),oceanPass=oceanEncoder.beginComputePass();
 oceanPass.setPipeline(oceanPipe);oceanPass.setBindGroup(0,oceanBind);oceanPass.dispatchWorkgroups(1);oceanPass.end();oceanEncoder.copyBufferToBuffer(oceanOutput,0,oceanRead,0,48);device.queue.submit([oceanEncoder.finish()]);
 await oceanRead.mapAsync(GPUMapMode.READ);const oceanHit=new Float32Array(oceanRead.getMappedRange().slice(0));oceanRead.unmap();oceanRead.destroy();oceanOutput.destroy();
 const radius=6371,b=-(radius+100)*.8,c=100*(2*radius+100),orbitDistance=c/(-b+Math.sqrt(b*b-c));
 if(!oceanHit.every(Number.isFinite)||Math.abs(oceanHit[0]-.0017)>.000001||oceanHit[1]<.5||Math.abs(oceanHit[2]-orbitDistance)>.02||oceanHit[3]<.5||oceanHit[5]>.5||oceanHit[7]<.5||Math.abs(oceanHit[8]-.0017)>.000001||oceanHit[9]<.5||Math.abs(oceanHit[10]-1)>.0001||oceanHit[11]<.5)throw new Error(`Independent water intersection failed: ${[...oceanHit]}`);
 const detailModule=device.createShaderModule({code:common+'\n'+terrainCore+'\n'+riverCurve+'\n'+worldField+'\n'+terrainSurface+'\n'+generator+`
 @compute @workgroup_size(1) fn detailCheck(){
  let direction=normalize(probe.direction.xyz);let tangent=normalize(cross(direction,vec3<f32>(0.0,1.0,0.0)));
  let zero=vec3<f32>(0.0);let seed=frame.counts.z;let base=terrain(direction,seed);
  let a=detailedTerrain(direction,direction,zero,zero,seed)-base;
  let b=detailedTerrain(direction,direction,zero,tangent*(8.0/6371000.0),seed)-base;
  let c=localNoise(direction,zero,zero,8388608.0,seed+421u);
  let d=localNoise(direction,zero,tangent*(.5/6371000.0),8388608.0,seed+421u);
  samples[0]=vec4<f32>(a,b,c,d);
 }
 @compute @workgroup_size(1) fn materialDetailCheck(){
  let high=normalize(probe.direction.xyz);let other=high+vec3<f32>(.000015258789,-.0000076293945,.000015258789);
  let low=high-other;let delta=vec3<f32>(.000000017,-.000000011,.000000023);let zero=vec3<f32>(0.0);
  let seed=frame.counts.z+1721u;let f=8388608.0;
  let a=localNoise(high,zero,delta,f,seed);let b=localNoise(other,low,delta,f,seed);
  let g=localNoiseGradient(high,zero,delta,f,seed);
  let e=.001/f;let finite=(localNoise(high,zero,delta+vec3<f32>(e,0.0,0.0),f,seed)-localNoise(high,zero,delta-vec3<f32>(e,0.0,0.0),f,seed))/.002;
  samples[0]=vec4<f32>(a,b,g.x,abs(g.y-finite));
 }
 @compute @workgroup_size(1) fn terrainPrecisionCheck(){
  let d=normalize(probe.direction.xyz);let other=d+vec3<f32>(.000244140625,-.0001220703125,.000244140625);
  let zero=vec3<f32>(0.0);let seed=frame.counts.z;let base=terrainBase(d,seed);
  let a=terrainShapeFromBaseDetail(base,seed,frame.settings.w,d,d,zero,zero,true);
  let b=terrainShapeFromBaseDetail(base,seed,frame.settings.w,d,other,d-other,zero,true);
  let original=terrainShapeFromBase(base,seed,frame.settings.w);
  samples[0]=vec4<f32>(a.x,b.x,original.x,0.0);
 }
 @compute @workgroup_size(64) fn closeSurfaceCheck(@builtin(global_invocation_id) gid:vec3<u32>){
  if(gid.x>=401u){return;}
  let high=normalize(probe.direction.xyz);let tangent=normalize(cross(high,vec3<f32>(0.0,1.0,0.0)));
  let delta=tangent*((f32(gid.x)-200.0)*(.1/6371000.0));let d=normalize(high+delta);let zero=vec3<f32>(0.0);
  let base=terrainBase(d,frame.counts.z);
  let height=terrainShapeFromBaseDetail(base,frame.counts.z,1.0,d,high,zero,delta,true).x;
  samples[gid.x]=vec4<f32>(height,0.0,0.0,0.0);
 }
 @compute @workgroup_size(64) fn valleyCheck(@builtin(global_invocation_id) gid:vec3<u32>){
  let n=gid.x;if(n>=512u){return;}
  let p=vec3<f32>(f32(n%32u)*.137+.123,f32(n/32u)*.169+.157,f32((n*37u)%53u)*.117+.183);
  let seed=frame.counts.z;let e=.001;let g=noiseGradient(p,seed);
  let finite=vec3<f32>(noise3(p+vec3<f32>(e,0.0,0.0),seed)-noise3(p-vec3<f32>(e,0.0,0.0),seed),noise3(p+vec3<f32>(0.0,e,0.0),seed)-noise3(p-vec3<f32>(0.0,e,0.0),seed),noise3(p+vec3<f32>(0.0,0.0,e),seed)-noise3(p-vec3<f32>(0.0,0.0,e),seed))/(2.0*e);
  let down=vec3<f32>(1.0,0.0,0.0);let center=slopeChannel(p,down,seed);
  let along=slopeChannel(p+vec3<f32>(.4,0.0,0.0),down,seed);let across=slopeChannel(p+vec3<f32>(0.0,.4,0.0),down,seed);
  let error=abs(g.yzw-finite);
  samples[n]=vec4<f32>(max(error.x,max(error.y,error.z)),abs(center-along),abs(center-across),abs(g.x-noise3(p,seed)));
 }
 @compute @workgroup_size(64) fn regionalCheck(@builtin(global_invocation_id) gid:vec3<u32>){
  let n=gid.x;if(n>=6u*24u*24u){return;}
  let face=n/(24u*24u);let k=n%(24u*24u);
  let u=(f32(k%24u)+.5)/24.0*2.0-1.0;let v=(f32(k/24u)+.5)/24.0*2.0-1.0;
  let direction=normalize(facePoint(face,u,v));let sample=worldSample(direction);let profile=worldProfile(sample);
  let flow=worldDrainage(sample,direction);
  let incision=regionalIncision(sample,profile,direction,direction,vec3<f32>(0.0),vec3<f32>(0.0),profile.y,frame.counts.z);
  samples[n]=vec4<f32>(dot(flow.xyz,direction),length(flow.xyz),incision,flow.w);
 }
 @compute @workgroup_size(64) fn edgeCandidates(@builtin(global_invocation_id) gid:vec3<u32>){
  let n=gid.x;if(n>=6u*4u*64u){return;}let face=n/(4u*64u);let edge=(n/64u)%4u;
  let t=(f32(n%64u)+.5)/32.0-1.0;
  var u=t;var v=t;if(edge==0u){u=-1.0;}else if(edge==1u){u=1.0;}else if(edge==2u){v=-1.0;}else{v=1.0;}
  let direction=normalize(facePoint(face,u,v));let sample=worldSample(direction);let profile=worldProfile(sample);
  let incision=regionalIncision(sample,profile,direction,direction,vec3<f32>(0.0),vec3<f32>(0.0),profile.y,frame.counts.z);
  samples[n]=vec4<f32>(direction,incision);
 }
 @compute @workgroup_size(1) fn waterStabilityCheck(){
  let p=normalize(probe.direction.xyz);let zero=vec3<f32>(0.0);
  let baseline=surfaceBase(p,p,zero,zero,frame.counts.z,false);
  let regional=surfaceBase(p,p,zero,zero,frame.counts.z,true);
  let close=worldSurfaceWater(p,.01);let middle=worldSurfaceWater(p,3.0);let far=worldSurfaceWater(p,20.0);
  samples[0]=vec4<f32>(baseline.height,regional.height,baseline.lake,regional.lake);
  samples[1]=vec4<f32>(close.x,middle.x,far.x,0.0);
  let east=normalize(cross(p,vec3<f32>(0.0,1.0,0.0)));let north=normalize(cross(p,east));
  let a=normalize(p+east*.00004);let b=normalize(p-east*.00004);let c=normalize(p+north*.00004);let d=normalize(p-north*.00004);
  samples[2]=vec4<f32>(surfaceBase(a,a,zero,zero,frame.counts.z,false).height,surfaceBase(b,b,zero,zero,frame.counts.z,false).height,surfaceBase(c,c,zero,zero,frame.counts.z,false).height,surfaceBase(d,d,zero,zero,frame.counts.z,false).height);
 }
 @compute @workgroup_size(64) fn coastStabilityCheck(@builtin(global_invocation_id) gid:vec3<u32>){
  let n=gid.x;if(n>=6u*16u*16u){return;}let face=n/(16u*16u);let k=n%(16u*16u);
  let u=(f32(k%16u)+.5)/8.0-1.0;let v=(f32(k/16u)+.5)/8.0-1.0;
  let p=normalize(facePoint(face,u,v));let zero=vec3<f32>(0.0);let seed=frame.counts.z;
  let h=naturalHeight(terrain(p,seed),p,zero,zero,seed);
  let coast=naturalCoast(p,seed);let other=p+vec3<f32>(.000244140625,-.0001220703125,.000244140625);
  let a=surfaceBase(p,p,zero,zero,seed,false).height;
  let b=surfaceBase(p,other,p-other,zero,seed,false).height;
  samples[n]=vec4<f32>(h,coast.x,a,b);
 }
 @compute @workgroup_size(64) fn coastShapeCheck(@builtin(global_invocation_id) gid:vec3<u32>){
  let n=gid.x;if(n>=72u*72u){return;}
  let u=.2083333333+(f32(n%72u)/71.0-.5)*.06;
  let v=-.7083333333+(f32(n/72u)/71.0-.5)*.06;
  let p=normalize(facePoint(5u,u,v));samples[n]=vec4<f32>(terrain(p,frame.counts.z),0.0,0.0,0.0);
 }
 @compute @workgroup_size(1) fn lakeSeparationCheck(){
  let p=normalize(probe.direction.xyz);let lake=worldLake(worldSample(p));
  samples[0]=vec4<f32>(lake,0.0,0.0);
 }`});
 const detailPipe=await device.createComputePipelineAsync({layout:'auto',compute:{module:detailModule,entryPoint:'detailCheck'}});
 const detailBind=device.createBindGroup({layout:detailPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:renderer.uniform}},{binding:4,resource:{buffer:renderer.plates}},{binding:5,resource:{buffer:renderer.sampleBuffer}},{binding:6,resource:{buffer:renderer.probeInput}},{binding:7,resource:{buffer:renderer.world}},{binding:8,resource:{buffer:renderer.worldDirections}},{binding:9,resource:{buffer:renderer.worldNeighbors}},{binding:10,resource:{buffer:renderer.worldFaces}}]});
 const detailBuffer=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),detailEncoder=device.createCommandEncoder(),detailPass=detailEncoder.beginComputePass();
 detailPass.setPipeline(detailPipe);detailPass.setBindGroup(0,detailBind);detailPass.dispatchWorkgroups(1);detailPass.end();detailEncoder.copyBufferToBuffer(renderer.sampleBuffer,0,detailBuffer,0,16);device.queue.submit([detailEncoder.finish()]);
 await detailBuffer.mapAsync(GPUMapMode.READ);const detail=new Float32Array(detailBuffer.getMappedRange().slice(0));detailBuffer.unmap();detailBuffer.destroy();
 if(!detail.every(Number.isFinite)||Math.abs(detail[0]-detail[1])<.000001||Math.abs(detail[2]-detail[3])<.001)throw new Error(`Fine terrain samples did not vary with position: ${[...detail]}`);
 const materialPipe=await device.createComputePipelineAsync({layout:'auto',compute:{module:detailModule,entryPoint:'materialDetailCheck'}});
 const materialBind=device.createBindGroup({layout:materialPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:renderer.uniform}},{binding:5,resource:{buffer:renderer.sampleBuffer}},{binding:6,resource:{buffer:renderer.probeInput}}]});
 const materialRead=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),materialEncoder=device.createCommandEncoder(),materialPass=materialEncoder.beginComputePass();
 materialPass.setPipeline(materialPipe);materialPass.setBindGroup(0,materialBind);materialPass.dispatchWorkgroups(1);materialPass.end();materialEncoder.copyBufferToBuffer(renderer.sampleBuffer,0,materialRead,0,16);device.queue.submit([materialEncoder.finish()]);
 await materialRead.mapAsync(GPUMapMode.READ);const material=new Float32Array(materialRead.getMappedRange().slice(0));materialRead.unmap();materialRead.destroy();
 if(!material.every(Number.isFinite)||Math.abs(material[0]-material[1])>1e-4||Math.abs(material[0]-material[2])>1e-6||material[3]>.01)throw new Error(`World-anchored surface detail failed: ${[...material]}`);
 const precisionPipe=await device.createComputePipelineAsync({layout:'auto',compute:{module:detailModule,entryPoint:'terrainPrecisionCheck'}});
 const precisionBind=device.createBindGroup({layout:precisionPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:renderer.uniform}},{binding:4,resource:{buffer:renderer.plates}},{binding:5,resource:{buffer:renderer.sampleBuffer}},{binding:6,resource:{buffer:renderer.probeInput}}]});
 const precisionRead=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),precisionEncoder=device.createCommandEncoder(),precisionPass=precisionEncoder.beginComputePass();
 precisionPass.setPipeline(precisionPipe);precisionPass.setBindGroup(0,precisionBind);precisionPass.dispatchWorkgroups(1);precisionPass.end();precisionEncoder.copyBufferToBuffer(renderer.sampleBuffer,0,precisionRead,0,16);device.queue.submit([precisionEncoder.finish()]);
 await precisionRead.mapAsync(GPUMapMode.READ);const precision=new Float32Array(precisionRead.getMappedRange().slice(0));precisionRead.unmap();precisionRead.destroy();
 if(!precision.every(Number.isFinite)||Math.abs(precision[0]-precision[1])>.00001||Math.abs(precision[0]-precision[2])>.001)throw new Error(`Fine terrain varied by patch anchor: ${[...precision]}`);
 // Look for metre-high steps between samples ten centimetres apart, including
 // a geographic precision-grid boundary in the default seeded world.
 const closePipe=await device.createComputePipelineAsync({layout:'auto',compute:{module:detailModule,entryPoint:'closeSurfaceCheck'}});
 const closeBind=device.createBindGroup({layout:closePipe.getBindGroupLayout(0),entries:[[0,renderer.uniform],[4,renderer.plates],[5,renderer.sampleBuffer],[6,renderer.probeInput]].map(([binding,buffer])=>({binding,resource:{buffer}}))});
 for(const direction of [[.6417093742397793,.3894183423086504,.6607287141379383],[-.09365858024318582,-.6556100766034618,-.7492686419454866]]){
  device.queue.writeBuffer(renderer.probeInput,0,new Float32Array([...direction,0]));
  const read=device.createBuffer({size:401*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();
  pass.setPipeline(closePipe);pass.setBindGroup(0,closeBind);pass.dispatchWorkgroups(7);pass.end();encoder.copyBufferToBuffer(renderer.sampleBuffer,0,read,0,401*16);device.queue.submit([encoder.finish()]);
  await read.mapAsync(GPUMapMode.READ);const data=new Float32Array(read.getMappedRange());let maxSecond=0,meanSecond=0;
  for(let i=1;i<400;i++){
   const h=data[i*4],prev=data[(i-1)*4],next=data[(i+1)*4];if(![h,prev,next].every(Number.isFinite))throw new Error('Close terrain contains a non-finite height');
   const second=Math.abs(prev-2*h+next)*1000;maxSecond=Math.max(maxSecond,second);meanSecond+=second/399;
  }
  read.unmap();read.destroy();
  if(maxSecond>.15||meanSecond>.01)throw new Error(`Close terrain contains abrupt height steps: ${JSON.stringify({direction,maxSecond,meanSecond})}`);
 }
 const valleyPipe=await device.createComputePipelineAsync({layout:'auto',compute:{module:detailModule,entryPoint:'valleyCheck'}});
 const valleyBind=device.createBindGroup({layout:valleyPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:renderer.uniform}},{binding:5,resource:{buffer:renderer.sampleBuffer}}]});
 const valleyBuffer=device.createBuffer({size:512*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),valleyEncoder=device.createCommandEncoder(),valleyPass=valleyEncoder.beginComputePass();
 valleyPass.setPipeline(valleyPipe);valleyPass.setBindGroup(0,valleyBind);valleyPass.dispatchWorkgroups(8);valleyPass.end();valleyEncoder.copyBufferToBuffer(renderer.sampleBuffer,0,valleyBuffer,0,512*16);device.queue.submit([valleyEncoder.finish()]);await valleyBuffer.mapAsync(GPUMapMode.READ);
 const valleyData=new Float32Array(valleyBuffer.getMappedRange());let gradientError=0,scalarError=0,alongDifference=0,acrossDifference=0;
 for(let i=0;i<valleyData.length;i+=4){gradientError=Math.max(gradientError,valleyData[i]);alongDifference+=valleyData[i+1];acrossDifference+=valleyData[i+2];scalarError=Math.max(scalarError,valleyData[i+3]);}
 valleyBuffer.unmap();valleyBuffer.destroy();
 if(gradientError>.01||scalarError>1e-6||alongDifference>=acrossDifference*.8)throw new Error(`Valley field is not slope-aligned or gradient is incorrect: ${JSON.stringify({gradientError,scalarError,alongDifference,acrossDifference})}`);
 const regionalPipe=await device.createComputePipelineAsync({layout:'auto',compute:{module:detailModule,entryPoint:'regionalCheck'}});
 const regionalBind=device.createBindGroup({layout:regionalPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:renderer.uniform}},{binding:5,resource:{buffer:renderer.sampleBuffer}},{binding:7,resource:{buffer:renderer.world}},{binding:8,resource:{buffer:renderer.worldDirections}},{binding:10,resource:{buffer:renderer.worldFaces}}]});
 const regionalCount=6*24*24,regionalBuffer=device.createBuffer({size:regionalCount*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),regionalEncoder=device.createCommandEncoder(),regionalPass=regionalEncoder.beginComputePass();
 regionalPass.setPipeline(regionalPipe);regionalPass.setBindGroup(0,regionalBind);regionalPass.dispatchWorkgroups(Math.ceil(regionalCount/64));regionalPass.end();regionalEncoder.copyBufferToBuffer(renderer.sampleBuffer,0,regionalBuffer,0,regionalCount*16);device.queue.submit([regionalEncoder.finish()]);await regionalBuffer.mapAsync(GPUMapMode.READ);
 const regionalData=new Float32Array(regionalBuffer.getMappedRange());let regionalCountActive=0,regionalMax=0,regionalTangency=0;
 for(let i=0;i<regionalData.length;i+=4){
  if(![regionalData[i],regionalData[i+1],regionalData[i+2],regionalData[i+3]].every(Number.isFinite))throw new Error('Regional drainage produced non-finite data');
  if(regionalData[i+1]>.5){regionalTangency=Math.max(regionalTangency,Math.abs(regionalData[i]));if(Math.abs(regionalData[i+1]-1)>.001)throw new Error('Regional drainage direction is not normalized');}
  if(regionalData[i+2]>.001)regionalCountActive++;regionalMax=Math.max(regionalMax,regionalData[i+2]);
 }
 regionalBuffer.unmap();regionalBuffer.destroy();
 if(regionalCountActive<100||regionalMax<.01||regionalTangency>.001)throw new Error(`Regional drainage detail failed: ${JSON.stringify({regionalCountActive,regionalMax,regionalTangency})}`);
 const edgePipe=await device.createComputePipelineAsync({layout:'auto',compute:{module:detailModule,entryPoint:'edgeCandidates'}});
 const edgeBind=device.createBindGroup({layout:edgePipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:renderer.uniform}},{binding:5,resource:{buffer:renderer.sampleBuffer}},{binding:7,resource:{buffer:renderer.world}},{binding:8,resource:{buffer:renderer.worldDirections}},{binding:10,resource:{buffer:renderer.worldFaces}}]});
 const edgeCount=6*4*64,edgeBuffer=device.createBuffer({size:edgeCount*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),edgeEncoder=device.createCommandEncoder(),edgePass=edgeEncoder.beginComputePass();
 edgePass.setPipeline(edgePipe);edgePass.setBindGroup(0,edgeBind);edgePass.dispatchWorkgroups(Math.ceil(edgeCount/64));edgePass.end();edgeEncoder.copyBufferToBuffer(renderer.sampleBuffer,0,edgeBuffer,0,edgeCount*16);device.queue.submit([edgeEncoder.finish()]);await edgeBuffer.mapAsync(GPUMapMode.READ);
 const edgeData=new Float32Array(edgeBuffer.getMappedRange());let bestEdge=0;for(let i=4;i<edgeData.length;i+=4)if(edgeData[i+3]>edgeData[bestEdge+3])bestEdge=i;
 const edgeDirection=[edgeData[bestEdge],edgeData[bestEdge+1],edgeData[bestEdge+2]],edgeIncision=edgeData[bestEdge+3];edgeBuffer.unmap();edgeBuffer.destroy();
 if(edgeIncision<.001)throw new Error(`No erosion-shaped land found on a cube-face edge: ${edgeIncision}`);
 // Give a known land location a synthetic basin and a nonzero regional tile.
 // The same geographic lake and its filled surface must survive changes in
 // pixel footprint and the presence of regional terrain.
 const waterDirection=faceDirection(0,-.74609375,-.74609375),waterRegion=regionAt(waterDirection);
 await renderer.sampleTerrain(waterDirection);
 const waterLookupOffset=24578*(48+17*16+4),waterValuesOffset=Math.ceil((waterLookupOffset+REGION_LOOKUPS*4)/16)*16;
 const waterWorld=device.createBuffer({size:waterValuesOffset+REGION_CAPACITY*REGION_SAMPLES*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
 const waterCopy=device.createCommandEncoder();waterCopy.copyBufferToBuffer(renderer.world,0,waterWorld,0,waterWorld.size);device.queue.submit([waterCopy.finish()]);
 const waterGrid=buildWorldGrid(64),face=directionToFace(waterDirection);
 const gx=Math.min(63,Math.floor((face.u+1)*32)),gy=Math.min(63,Math.floor((face.v+1)*32)),start=face.face*65*65+gy*65+gx;
 const corners=[waterGrid.faceIndices[start],waterGrid.faceIndices[start+1],waterGrid.faceIndices[start+65],waterGrid.faceIndices[start+66]];
 const cell=new ArrayBuffer(48),cellF=new Float32Array(cell),cellU=new Uint32Array(cell);cellF[0]=8;cellF[1]=8;cellF[2]=4;cellF[8]=8;cellF[10]=.8;
 cellU[4]=0xffffffff;cellU[5]=new Uint32Array(new Float32Array([8.5]).buffer)[0];cellU[6]=0xffffffff;
 for(const corner of corners)device.queue.writeBuffer(waterWorld,corner*48,cell);
 device.queue.writeBuffer(waterWorld,waterLookupOffset+waterRegion.id*4,new Uint32Array([0]));
 const displaced=new Float32Array(REGION_SAMPLES*4);for(let i=0;i<REGION_SAMPLES;i++)displaced[i*4]=-.01;
 device.queue.writeBuffer(waterWorld,waterValuesOffset,displaced);
 const waterPipe=await device.createComputePipelineAsync({layout:'auto',compute:{module:detailModule,entryPoint:'waterStabilityCheck'}});
 const waterBind=device.createBindGroup({layout:waterPipe.getBindGroupLayout(0),entries:[[0,renderer.uniform],[4,renderer.plates],[5,renderer.sampleBuffer],[6,renderer.probeInput],[7,waterWorld],[8,renderer.worldDirections],[9,renderer.worldNeighbors],[10,renderer.worldFaces]].map(([binding,buffer])=>({binding,resource:{buffer}}))});
 const waterRead=device.createBuffer({size:48,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),waterEncoder=device.createCommandEncoder(),waterPass=waterEncoder.beginComputePass();
 waterPass.setPipeline(waterPipe);waterPass.setBindGroup(0,waterBind);waterPass.dispatchWorkgroups(1);waterPass.end();waterEncoder.copyBufferToBuffer(renderer.sampleBuffer,0,waterRead,0,48);device.queue.submit([waterEncoder.finish()]);
 await waterRead.mapAsync(GPUMapMode.READ);const stableWater=new Float32Array(waterRead.getMappedRange().slice(0));waterRead.unmap();waterRead.destroy();
 if(!stableWater.every(Number.isFinite)||stableWater[2]<.99||Math.abs(stableWater[0]-8.25)>1e-4||Math.abs(stableWater[0]-stableWater[1])>1e-5||Math.abs(stableWater[2]-stableWater[3])>1e-6||Math.max(Math.abs(stableWater[4]-stableWater[5]),Math.abs(stableWater[4]-stableWater[6]))>1e-6||stableWater.slice(8).some(h=>Math.abs(h-stableWater[0])>1e-4))throw new Error(`Lake changed with position, regional streaming or pixel footprint: ${[...stableWater]}`);
 // Adjacent depressions with different spill levels must not be blended into
 // one sloping lake between their cells.
 cellF[8]=7.5;cellU[5]=new Uint32Array(new Float32Array([9]).buffer)[0];
 for(const corner of [corners[1],corners[3]])device.queue.writeBuffer(waterWorld,corner*48,cell);
 const splitDirection=faceDirection(face.face,-1+2*(gx+.5)/64,-1+2*(gy+.5)/64);
 device.queue.writeBuffer(renderer.probeInput,0,new Float32Array([...splitDirection,0]));
 const splitPipe=await device.createComputePipelineAsync({layout:'auto',compute:{module:detailModule,entryPoint:'lakeSeparationCheck'}});
 const splitBind=device.createBindGroup({layout:splitPipe.getBindGroupLayout(0),entries:[[5,renderer.sampleBuffer],[6,renderer.probeInput],[7,waterWorld],[10,renderer.worldFaces]].map(([binding,buffer])=>({binding,resource:{buffer}}))});
 const splitRead=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),splitEncoder=device.createCommandEncoder(),splitPass=splitEncoder.beginComputePass();
 splitPass.setPipeline(splitPipe);splitPass.setBindGroup(0,splitBind);splitPass.dispatchWorkgroups(1);splitPass.end();splitEncoder.copyBufferToBuffer(renderer.sampleBuffer,0,splitRead,0,16);device.queue.submit([splitEncoder.finish()]);
 await splitRead.mapAsync(GPUMapMode.READ);const splitLake=new Float32Array(splitRead.getMappedRange().slice(0));splitRead.unmap();splitRead.destroy();waterWorld.destroy();
 if(!splitLake.every(Number.isFinite)||splitLake[0]>1e-5)throw new Error(`Separate basins were blended into one lake: ${[...splitLake]}`);
 const coastCount=6*16*16,coastPipe=await device.createComputePipelineAsync({layout:'auto',compute:{module:detailModule,entryPoint:'coastStabilityCheck'}});
 const coastBind=device.createBindGroup({layout:coastPipe.getBindGroupLayout(0),entries:[[0,renderer.uniform],[4,renderer.plates],[5,renderer.sampleBuffer],[7,renderer.world],[8,renderer.worldDirections],[10,renderer.worldFaces]].map(([binding,buffer])=>({binding,resource:{buffer}}))});
 const coastRead=device.createBuffer({size:coastCount*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),coastEncoder=device.createCommandEncoder(),coastPass=coastEncoder.beginComputePass();
 coastPass.setPipeline(coastPipe);coastPass.setBindGroup(0,coastBind);coastPass.dispatchWorkgroups(Math.ceil(coastCount/64));coastPass.end();coastEncoder.copyBufferToBuffer(renderer.sampleBuffer,0,coastRead,0,coastCount*16);device.queue.submit([coastEncoder.finish()]);
 await coastRead.mapAsync(GPUMapMode.READ);const coastData=new Float32Array(coastRead.getMappedRange());let coastLand=0,coastSea=0;
 for(let i=0;i<coastData.length;i+=4){
  const [h,coast,a,b]=coastData.slice(i,i+4),land=h>=0;
  if(![h,coast,a,b].every(Number.isFinite)||(coast>=0)!==land||(a>=0)!==land||(b>=0)!==land||Math.abs(a-b)>.00001)throw new Error(`Geographic coast disagrees across terrain representations at sample ${i/4}: ${[h,coast,a,b]}`);
  if(land)coastLand++;else coastSea++;
 }
 coastRead.unmap();coastRead.destroy();if(coastLand<100||coastSea<100)throw new Error(`Missing land or sea in coastline check: ${coastLand}/${coastSea}`);
 // A known coastal region used to fragment into many narrow
 // water/land transitions. Count edges in its geographic field, independent
 // of the patch LOD and of the color used to render it.
 const shapePipe=await device.createComputePipelineAsync({layout:'auto',compute:{module:detailModule,entryPoint:'coastShapeCheck'}});
 const shapeBind=device.createBindGroup({layout:shapePipe.getBindGroupLayout(0),entries:[[0,renderer.uniform],[4,renderer.plates],[5,renderer.sampleBuffer]].map(([binding,buffer])=>({binding,resource:{buffer}}))});
 const shapeRead=device.createBuffer({size:72*72*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),shapeEncoder=device.createCommandEncoder(),shapePass=shapeEncoder.beginComputePass();
 shapePass.setPipeline(shapePipe);shapePass.setBindGroup(0,shapeBind);shapePass.dispatchWorkgroups(81);shapePass.end();shapeEncoder.copyBufferToBuffer(renderer.sampleBuffer,0,shapeRead,0,72*72*16);device.queue.submit([shapeEncoder.finish()]);
 await shapeRead.mapAsync(GPUMapMode.READ);const shapeData=new Float32Array(shapeRead.getMappedRange());let landCells=0,seaCells=0,shoreEdges=0;
 for(let y=0;y<72;y++)for(let x=0;x<72;x++){
  const i=(y*72+x)*4,h=shapeData[i];if(!Number.isFinite(h))throw new Error('Coastal terrain contains a non-finite height');
  const land=h>=0;if(land)landCells++;else seaCells++;
  if(x>0&&land!==(shapeData[i-4]>=0))shoreEdges++;
  if(y>0&&land!==(shapeData[i-72*4]>=0))shoreEdges++;
 }
 shapeRead.unmap();shapeRead.destroy();
 if(landCells<1000||seaCells<1000||shoreEdges>1200)throw new Error(`Coastal terrain is excessively fragmented: ${JSON.stringify({landCells,seaCells,shoreEdges})}`);
 // The control must change the seeded land geometry, remain reproducible,
 // and leave the fully submerged seabed unchanged.
 renderer.valleys=0;const unshaped=await renderer.sampleTerrain();renderer.valleys=1;const shaped=await renderer.sampleTerrain(),shapedRepeat=await renderer.sampleTerrain();
 let valleyChanges=0,maxValleyKm=0,maxOceanChange=0,maxRepeat=0;
 for(let i=0;i<shaped.length;i+=4){const change=unshaped[i+3]-shaped[i+3];maxRepeat=Math.max(maxRepeat,Math.abs(shaped[i+3]-shapedRepeat[i+3]));if(unshaped[i+3]<-.2)maxOceanChange=Math.max(maxOceanChange,Math.abs(change));if(change>.001)valleyChanges++;maxValleyKm=Math.max(maxValleyKm,change);}
 if(valleyChanges<10||maxValleyKm<.02||maxOceanChange>1e-5||maxRepeat>1e-6)throw new Error(`Valley terrain field failed: ${JSON.stringify({valleyChanges,maxValleyKm,maxOceanChange,maxRepeat})}`);
 // Interpolating coarse erosion over fine terrain must not create artificial
 // sea-level holes in land that was above sea level before erosion.
 const savedWater={erosion:renderer.erosion,rivers:renderer.rivers,regional:renderer.regional};
 renderer.rivers=false;renderer.regional=false;renderer.erosion=0;const naturalCoast=await renderer.sampleTerrain();
 renderer.erosion=1;const erodedCoast=await renderer.sampleTerrain();let landSamples=0,landToSea=0,erosionChanged=0;
 for(let i=0;i<naturalCoast.length;i+=4){
  if(naturalCoast[i+3]>.001){landSamples++;if(erodedCoast[i+3]<0.0)landToSea++;}
  if(Math.abs(naturalCoast[i+3]-erodedCoast[i+3])>.001)erosionChanged++;
 }
 Object.assign(renderer,savedWater);
 if(landSamples<100||erosionChanged<10||landToSea)throw new Error(`Erosion damaged the coastline: ${JSON.stringify({landSamples,erosionChanged,landToSea})}`);
 const savedCamera={...renderer.cameraState},savedProbeTime=renderer.lastProbeTime;
 Object.assign(renderer.cameraState,{mode:'orbit',altitude:4,surfaceHeight:valley.height,longitude:Math.atan2(valley.direction[2],valley.direction[0]),latitude:Math.asin(valley.direction[1])});
 renderer.budget=180;renderer.pixelSize=14;renderer.lastProbeTime=Infinity;
 async function valleyVertices(strength){
  renderer.valleys=strength;renderer.invalidateTerrain();renderer.cameraState.surfaceHeight=valley.height;renderer.lastSelection=0;await capture();
  const p=directionToFace(valley.direction),node=renderer.patches.find(n=>n.face===p.face&&Math.abs(p.u-n.u)<=n.span/2&&Math.abs(p.v-n.v)<=n.span/2);
  if(!node)throw new Error('Valley view did not select its focal patch');
  const read=device.createBuffer({size:441*48,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(renderer.vertices,node.slot*441*48,read,0,441*48);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
  const data=new Float32Array(read.getMappedRange()),heights=[];for(let y=0;y<=16;y++)for(let x=0;x<=16;x++)heights.push(data[((y+2)*21+x+2)*12+3]);read.unmap();read.destroy();return {key:node.key,heights};
 }
 const verticesOff=await valleyVertices(0),verticesOn=await valleyVertices(1);
 if(verticesOff.key!==verticesOn.key)throw new Error('Valley comparison did not use the same patch');
 const geometryChange=Math.max(...verticesOff.heights.map((h,i)=>Math.abs(h-verticesOn.heights[i])));
 if(geometryChange<.005)throw new Error(`Valley control did not displace the rendered geometry: ${geometryChange} km`);
 renderer.valleys=1;renderer.lastProbeTime=savedProbeTime;Object.assign(renderer.cameraState,savedCamera);renderer.budget=36;renderer.pixelSize=24;renderer.invalidateTerrain();renderer.lastSelection=0;await capture();
 for(const seed of [1,42,0xffffffff]){
  renderer.seed=seed;renderer.invalidateTerrain();const candidate=await renderer.findValleys();
  if(!candidate||candidate.incision<.005||!Number.isFinite(candidate.height))throw new Error(`Valley search failed for seed ${seed}: ${JSON.stringify(candidate)}`);
 }
 renderer.seed=918273;renderer.invalidateTerrain();renderer.lastSelection=0;await capture();
 // A flat ocean must shade the rendered sea surface, not cavities and slopes
 // in the hidden seafloor. Exercise many patches near an actual coastline.
 const oceanCamera={...renderer.cameraState},oceanSamples=await renderer.sampleTerrain();let sea=0;
 for(let i=0;i<oceanSamples.length;i+=4)if(oceanSamples[i+3]<-.1&&Math.abs(oceanSamples[i+3]+.6)<Math.abs(oceanSamples[sea+3]+.6))sea=i;
 const seaDirection=[oceanSamples[sea],oceanSamples[sea+1],oceanSamples[sea+2]];
 Object.assign(renderer.cameraState,{mode:'orbit',altitude:100,surfaceHeight:0,longitude:Math.atan2(seaDirection[2],seaDirection[0]),latitude:Math.asin(seaDirection[1])});
 renderer.budget=180;renderer.pixelSize=10;renderer.ocean=true;renderer.invalidateTerrain();renderer.lastSelection=0;const coarseOcean=await capture();
 // Unoccluded ocean pixels are ray/sphere intersections and should retain the
 // same color even when the surrounding terrain uses a different selection.
 renderer.budget=384;renderer.pixelSize=6;renderer.needsSelection=true;renderer.lastSelection=0;const fineOcean=await capture();
 let oceanCompared=0,oceanChanged=0;const bgra=renderer.format.startsWith('bgra');
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*stride+x*4,isWater=p=>{const r=p[i+(bgra?2:0)],g=p[i+1],b=p[i+(bgra?0:2)];return g>10&&b>g*1.05&&b>r*1.4;};
  if(isWater(coarseOcean.pixels)&&isWater(fineOcean.pixels)){
   oceanCompared++;if(Math.max(...[0,1,2].map(k=>Math.abs(coarseOcean.pixels[i+k]-fineOcean.pixels[i+k])))>2)oceanChanged++;
  }
 }
 if(oceanCompared<100||oceanChanged>oceanCompared*.02)throw new Error(`Independent ocean changed with LOD: ${oceanChanged}/${oceanCompared}`);
 renderer.budget=180;renderer.pixelSize=10;renderer.needsSelection=true;renderer.lastSelection=0;await capture();
 async function inspectOcean(){
  const nodes=renderer.patches,chunk=441*48,read=device.createBuffer({size:nodes.length*chunk,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();
  nodes.forEach((node,i)=>encoder.copyBufferToBuffer(renderer.vertices,node.slot*chunk,read,i*chunk,chunk));device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
  const data=new Float32Array(read.getMappedRange());let count=0,maxCavity=0,maxNormalAngle=0;
  for(let i=0;i<nodes.length;i++)for(let y=0;y<=16;y++)for(let x=0;x<=16;x++){
   const off=i*441*12+((y+2)*21+x+2)*12;if(data[off+3]>=-.1)continue;
   const node=nodes[i],radial=faceDirection(node.face,node.u+(x-8)*node.span/16,node.v+(y-8)*node.span/16);
   const d=radial[0]*data[off+4]+radial[1]*data[off+5]+radial[2]*data[off+6];
   maxNormalAngle=Math.max(maxNormalAngle,Math.acos(Math.max(-1,Math.min(1,d)))*180/Math.PI);
   maxCavity=Math.max(maxCavity,data[off+7]);count++;
  }
  read.unmap();read.destroy();return {count,maxCavity,maxNormalAngle};
 }
 const water=await inspectOcean();
 if(water.count<100||water.maxCavity>1e-6||water.maxNormalAngle>.1)throw new Error(`Flat water has seabed shading: ${JSON.stringify(water)}`);
 // Include a rugged coastal region where the old seafloor derivatives made
 // water normals diverge by several degrees at a patch boundary.
 Object.assign(renderer.cameraState,{longitude:.806671507128508,latitude:.4727325707272136});renderer.needsSelection=true;renderer.lastSelection=0;await capture();
 const coastalWater=await inspectOcean();
 if(coastalWater.count<100||coastalWater.maxCavity>1e-6||coastalWater.maxNormalAngle>.1)throw new Error(`Coastal water has seabed shading: ${JSON.stringify(coastalWater)}`);
 renderer.ocean=false;renderer.invalidateTerrain();renderer.lastSelection=0;await capture();const exposedSeafloor=await inspectOcean();
 if(exposedSeafloor.count<100||exposedSeafloor.maxNormalAngle<.1)throw new Error(`Exposed seafloor lost terrain shading: ${JSON.stringify(exposedSeafloor)}`);
 renderer.ocean=true;Object.assign(renderer.cameraState,oceanCamera);renderer.budget=36;renderer.pixelSize=24;renderer.invalidateTerrain();renderer.lastSelection=0;await capture();
 // Exercise culling and exact shared vertices in a refined, mixed-LOD view.
 const original={...renderer.cameraState};renderer.budget=180;renderer.pixelSize=10;renderer.cameraState.altitude=100;renderer.invalidateTerrain();
 const near=await capture();renderer.culling=false;const nearUnculled=await capture();renderer.culling=true;
 if(!(near.count>0 && near.count<nearUnculled.count && nearUnculled.count===near.patches*16))throw new Error(`Refined culling counts are incorrect: ${near.count}/${nearUnculled.count}`);
 const nearChanged=difference(near,nearUnculled);if(nearChanged>width*height*.02)throw new Error(`Refined culling changed ${nearChanged} pixels`);
 async function inspectSeams(){
 const nodes=renderer.patches,chunk=441*48,buffer=device.createBuffer({size:nodes.length*chunk,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),copy=device.createCommandEncoder();
 nodes.forEach((node,i)=>copy.copyBufferToBuffer(renderer.vertices,node.slot*chunk,buffer,i*chunk,chunk));device.queue.submit([copy.finish()]);await buffer.mapAsync(GPUMapMode.READ);
 const data=new Float32Array(buffer.getMappedRange());let maxSeamKm=0,matched=0,mixed=0,maxNormal=0,deepMatched=0,deepMaxKm=0,deepMaxNormal=0;
 const pointAt=(node,index,x,y)=>{const offset=index*441*12+((y+2)*21+(x+2))*12;return [0,1,2].map(k=>node.direction[k]*6371+data[offset+k]);};
 const normalAt=(index,x,y)=>{const offset=index*441*12+((y+2)*21+(x+2))*12+4;return [data[offset],data[offset+1],data[offset+2]];};
 for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
  const a=nodes[i],b=nodes[j];if(a.face!==b.face)continue;
  for(const axis of ['u','v']){const otherAxis=axis==='u'?'v':'u';let first=a,second=b,firstIndex=i,secondIndex=j;
   if(first[axis]>second[axis]){[first,second]=[second,first];[firstIndex,secondIndex]=[secondIndex,firstIndex];}
   if(Math.abs(first[axis]+first.span/2-(second[axis]-second.span/2))>1e-10)continue;
   const low=Math.max(first[otherAxis]-first.span/2,second[otherAxis]-second.span/2),high=Math.min(first[otherAxis]+first.span/2,second[otherAxis]+second.span/2);if(high-low<1e-10)continue;
   const fine=first.level>=second.level?first:second,coarse=fine===first?second:first,fi=fine===first?firstIndex:secondIndex,ci=fine===first?secondIndex:firstIndex;
   if(fine.level!==coarse.level)mixed++;
   for(let k=0;k<=16;k++){
    const v=fine[otherAxis]-fine.span/2+fine.span*k/16;if(v<low-1e-10||v>high+1e-10)continue;
    const ck=Math.round((v-(coarse[otherAxis]-coarse.span/2))/coarse.span*16);
    if(Math.abs(coarse[otherAxis]-coarse.span/2+coarse.span*ck/16-v)>1e-10)continue;
    const fb=fine===first?16:0,cb=coarse===first?16:0;
    const fp=axis==='u'?pointAt(fine,fi,fb,k):pointAt(fine,fi,k,fb),cp=axis==='u'?pointAt(coarse,ci,cb,ck):pointAt(coarse,ci,ck,cb);
    const fn=axis==='u'?normalAt(fi,fb,k):normalAt(fi,k,fb),cn=axis==='u'?normalAt(ci,cb,ck):normalAt(ci,ck,cb);
    const angle=Math.acos(Math.max(-1,Math.min(1,fn.reduce((s,n,l)=>s+n*cn[l],0))))*180/Math.PI;
    const distance=Math.hypot(...fp.map((n,l)=>n-cp[l]));maxSeamKm=Math.max(maxSeamKm,distance);maxNormal=Math.max(maxNormal,angle);matched++;
    if(fine.level>=15){deepMatched++;deepMaxKm=Math.max(deepMaxKm,distance);deepMaxNormal=Math.max(deepMaxNormal,angle);}
   }
  }
 }
 buffer.unmap();buffer.destroy();return {matched,mixed,maxSeamKm,maxNormal,deepMatched,deepMaxKm,deepMaxNormal};
 }
 const seams=await inspectSeams();
 if(seams.matched<100||seams.mixed<1||seams.maxSeamKm>.002||seams.maxNormal>.5)throw new Error(`Terrain seams: ${JSON.stringify(seams)}`);
 // At the closest altitude, the geometry and lighting must still agree across
 // mixed LODs, including retained patches when neighbor masks change.
 renderer.budget=384;renderer.pixelSize=14;renderer.invalidateTerrain();
 Object.assign(renderer.cameraState,{mode:'orbit',altitude:.03,surfaceHeight:point[3],longitude:Math.atan2(highland.direction[2],highland.direction[0]),latitude:Math.asin(highland.direction[1])});
 renderer.lastSelection=0;await capture();const deepSeams=await inspectSeams();
 if(deepSeams.deepMatched<100||deepSeams.deepMaxKm>.00001||deepSeams.deepMaxNormal>.5)throw new Error(`Close-up seams: ${JSON.stringify(deepSeams)}`);
 let reusedChanges=0;
 for(const offset of [.01,.03,.07]){
  const before=new Map(renderer.patches.map(p=>[p.key,p.normalStitch]));renderer.cameraState.longitude+=offset;renderer.needsSelection=true;renderer.lastSelection=0;await capture();
  reusedChanges=renderer.patches.filter(p=>before.has(p.key)&&before.get(p.key)!==p.normalStitch).length;
  if(reusedChanges){if(renderer.stats.reusedNormalUpdates!==0)throw new Error('World-space normals should not need neighbor-dependent regeneration');break;}
 }
 if(!reusedChanges)throw new Error('Camera movement did not exercise a cached stitch change');
 // Exercise a close-up view centered directly on a cube-face edge. The same
 // high-frequency terrain must agree on both faces, not only within a face.
 const edgeHeight=await renderer.sampleTerrain(edgeDirection);
 Object.assign(renderer.cameraState,{mode:'orbit',altitude:.03,surfaceHeight:Math.max(0,edgeHeight[3]),longitude:Math.atan2(edgeDirection[2],edgeDirection[0]),latitude:Math.asin(edgeDirection[1])});
 renderer.invalidateTerrain();renderer.cameraState.surfaceHeight=Math.max(0,edgeHeight[3]);renderer.lastSelection=0;await capture();
 async function inspectCubeEdge(){
  const nodes=renderer.patches,chunk=441*48,buffer=device.createBuffer({size:nodes.length*chunk,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();
  nodes.forEach((node,i)=>encoder.copyBufferToBuffer(renderer.vertices,node.slot*chunk,buffer,i*chunk,chunk));device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
  const data=new Float32Array(buffer.getMappedRange()),points=new Map();let matches=0,maxKm=0,maxNormal=0,deepMatches=0,deepMaxKm=0,deepMaxNormal=0,worst=null,worstNormal=null;
  for(let i=0;i<nodes.length;i++){
   const n=nodes[i],half=n.span/2;
   for(let edge=0;edge<4;edge++){
    const boundary=edge===0?n.u-half:edge===1?n.u+half:edge===2?n.v-half:n.v+half;
    if(Math.abs(Math.abs(boundary)-1)>1e-12)continue;
    for(let k=0;k<=16;k++){
     const x=edge===0?0:edge===1?16:k,y=edge===2?0:edge===3?16:k;
     const d=faceDirection(n.face,n.u+(x-8)*n.span/16,n.v+(y-8)*n.span/16),key=d.map(v=>v.toFixed(10)).join(',');
     const offset=i*441*12+((y+2)*21+x+2)*12,position=[0,1,2].map(c=>n.direction[c]*6371+data[offset+c]);
     const normal=[data[offset+4],data[offset+5],data[offset+6]],other=points.get(key)||[];
     for(const p of other)if(p.face!==n.face){
      const distance=Math.hypot(...position.map((v,c)=>v-p.position[c]));
      const dot=Math.max(-1,Math.min(1,normal.reduce((sum,v,c)=>sum+v*p.normal[c],0))),angle=Math.acos(dot)*180/Math.PI;
      matches++;maxKm=Math.max(maxKm,distance);maxNormal=Math.max(maxNormal,angle);
      if(n.level>=15&&p.level>=15){deepMatches++;if(distance>deepMaxKm){deepMaxKm=distance;worst={a:n.key,b:p.key};}if(angle>deepMaxNormal){deepMaxNormal=angle;worstNormal={a:n.key,ax:x,ay:y,as:n.stitch,an:n.normalStitch,ae:n.edgeKeys,b:p.key,bx:p.x,by:p.y,bs:p.stitch,bn:p.normalStitch,be:p.edgeKeys};}}
     }
     other.push({face:n.face,level:n.level,key:n.key,x,y,stitch:n.stitch,normalStitch:n.normalStitch,edgeKeys:n.edgeKeys,position,normal});points.set(key,other);
    }
   }
  }
  buffer.unmap();buffer.destroy();return {matches,maxKm,maxNormal,deepMatches,deepMaxKm,deepMaxNormal,worst,worstNormal};
 }
 const closeCubeEdge=await inspectCubeEdge();
 if(closeCubeEdge.deepMatches<50||closeCubeEdge.deepMaxKm>.00001||closeCubeEdge.deepMaxNormal>.5)throw new Error(`Close-up cube-face seams: ${JSON.stringify(closeCubeEdge)}`);
 // Travel along the same boundary with cached geometry still resident; the
 // world-space normals should remain stable as LOD neighbors change.
 const priorSlots=new Map(renderer.patches.map(n=>[n.key,n.slot])),movedDirection=[...edgeDirection];
 let minor=0;for(let i=1;i<3;i++)if(Math.abs(movedDirection[i])<Math.abs(movedDirection[minor]))minor=i;
 movedDirection[minor]+=(movedDirection[minor]>0?-.0001:.0001);const movedLength=Math.hypot(...movedDirection);for(let i=0;i<3;i++)movedDirection[i]/=movedLength;
 const movedHeight=await renderer.sampleTerrain(movedDirection);
 Object.assign(renderer.cameraState,{surfaceHeight:Math.max(0,movedHeight[3]),longitude:Math.atan2(movedDirection[2],movedDirection[0]),latitude:Math.asin(movedDirection[1])});
 renderer.needsSelection=true;renderer.lastSelection=0;renderer.lastProbeTime=Infinity;await capture();
 const reusedAtCubeEdge=renderer.patches.filter(n=>priorSlots.get(n.key)===n.slot).length,movedCubeEdge=await inspectCubeEdge();
 if(reusedAtCubeEdge<10||movedCubeEdge.deepMatches<50||movedCubeEdge.deepMaxKm>.00001||movedCubeEdge.deepMaxNormal>.5)throw new Error(`Moving across cached cube-edge patches: ${JSON.stringify({reusedAtCubeEdge,movedCubeEdge})}`);
 Object.assign(renderer.cameraState,original);renderer.budget=36;renderer.pixelSize=24;renderer.invalidateTerrain();
 const background={pixels:new Uint8Array(first.pixels.length)};for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*stride+x*4;background.pixels.set(first.pixels.subarray(0,4),i);}
 const foreground=difference(first,background);if(foreground<2000)throw new Error(`Planet render is empty: ${foreground} foreground pixels`);
 renderer.invalidateTerrain();const repeat=await capture();const repeatChanged=difference(first,repeat);if(repeatChanged>10)throw new Error(`Same seed did not reproduce terrain: ${repeatChanged} pixels`);
 renderer.seed=31829;renderer.invalidateTerrain();const other=await capture();const seedChanged=difference(first,other);if(seedChanged<1000)throw new Error(`Different seed did not change the planet: ${seedChanged} pixels`);
 renderer.biomes=false;const plainColors=await capture();renderer.biomes=true;const biomeChanged=difference(other,plainColors);if(biomeChanged<100)throw new Error('Climate colors did not affect the image');
 renderer.lodColors=true;const levels=await capture();const lodChanged=difference(other,levels);if(lodChanged<1000)throw new Error('LOD colors did not affect the image');
 renderer.lodColors=false;renderer.patchLines=true;const patchLines=await capture();const patchChanged=difference(other,patchLines);if(patchChanged<100)throw new Error('Patch boundaries did not affect the image');
 renderer.patchLines=false;renderer.patchColors=true;const patchColor=await capture();const patchColorChanged=difference(levels,patchColor);if(patchColorChanged<500)throw new Error('Patch identity colors did not change the LOD overlay');
 renderer.patchColors=false;renderer.meshletColors=true;const meshletColor=await capture();const meshletColorChanged=difference(patchColor,meshletColor);if(meshletColorChanged<500)throw new Error('Meshlet identity colors did not change the patch overlay');
 renderer.meshletColors=false;renderer.meshletLines=true;const meshletEdges=await capture();const meshletEdgeChanged=difference(patchLines,meshletEdges);if(meshletEdgeChanged<100)throw new Error('Meshlet boundaries did not differ from patch boundaries');
 renderer.meshletColors=true;renderer.debugOpacity=0;const noColor=await capture();if(difference(meshletEdges,noColor)>10)throw new Error('Zero overlay opacity did not restore the terrain color');
 renderer.meshletColors=false;renderer.meshletLines=false;renderer.debugOpacity=.75;renderer.wireframe=true;const wire=await capture();const wireChanged=difference(other,wire);if(wireChanged<100)throw new Error('Triangle wireframe did not affect the image');renderer.wireframe=false;
 // Find a connected river on the seeded world, render it, then disable surface
 // water at the same camera position and check that the image really changes.
 renderer.seed=918273;renderer.rivers=true;renderer.invalidateTerrain();const river=await renderer.findRivers();
 if(!river||river.flow<3)throw new Error(`River search failed: ${JSON.stringify(river)}`);
 Object.assign(renderer.cameraState,{mode:'orbit',altitude:25,surfaceHeight:river.height,longitude:Math.atan2(river.direction[2],river.direction[0]),latitude:Math.asin(river.direction[1])});
 renderer.budget=180;renderer.pixelSize=14;renderer.lastSelection=0;const riversOn=await capture();
 renderer.rivers=false;renderer.invalidateTerrain();renderer.cameraState.surfaceHeight=river.height;renderer.lastSelection=0;const riversOff=await capture();
 const riverChanged=difference(riversOn,riversOff);if(riverChanged<20)throw new Error(`River control did not affect the image: ${riverChanged} pixels`);
 // Check the full camera-to-patch lookup against generated terrain, not only
 // the synthetic triangles used for the probe arithmetic above.
 renderer.rivers=true;renderer.invalidateTerrain();renderer.budget=512;renderer.pixelSize=14;
 Object.assign(renderer.cameraState,{mode:'walk',altitude:.0017,surfaceHeight:point[3],longitude:Math.atan2(highland.direction[2],highland.direction[0]),latitude:Math.asin(highland.direction[1]),pitch:.08});
 renderer.lastSelection=-Infinity;await capture();const walkHeight=await renderer.sampleRenderedSurface(highland.direction);
 if(walkHeight==null||!Number.isFinite(walkHeight)||Math.abs(walkHeight-point[3])>.5)throw new Error(`Walking probe could not find the generated ground: ${walkHeight} / ${point[3]}`);
 const walkSeams=await inspectSeams();
 if(renderer.stats.deepest<22||walkSeams.deepMatched<100||walkSeams.deepMaxKm>.00001||walkSeams.deepMaxNormal>.5)throw new Error(`Walking-level seams: ${JSON.stringify({depth:renderer.stats.deepest,walkSeams})}`);
 Object.assign(renderer.cameraState,{surfaceHeight:Math.max(0,edgeHeight[3]),longitude:Math.atan2(edgeDirection[2],edgeDirection[0]),latitude:Math.asin(edgeDirection[1])});
 renderer.invalidateTerrain();renderer.cameraState.surfaceHeight=Math.max(0,edgeHeight[3]);renderer.lastSelection=-Infinity;await capture();
 const walkCubeSeams=await inspectCubeEdge();
 if(renderer.stats.deepest<22||walkCubeSeams.deepMatches<50||walkCubeSeams.deepMaxKm>.00001||walkCubeSeams.deepMaxNormal>.5)throw new Error(`Walking-level cube-face seams: ${JSON.stringify({depth:renderer.stats.deepest,walkCubeSeams})}`);
 if(errors.length)throw new Error(errors.join('; '));
 const canvas=document.querySelector('#preview');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d'),image=ctx.createImageData(width,height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*stride+x*4,o=(y*width+x)*4;
  if(renderer.format.startsWith('bgra')){image.data[o]=first.pixels[i+2];image.data[o+1]=first.pixels[i+1];image.data[o+2]=first.pixels[i];}else image.data.set(first.pixels.subarray(i,i+3),o);image.data[o+3]=255;
 }
 ctx.putImageData(image,0,0);
 const result={ok:true,patches:first.patches,meshlets:first.count,foregroundPixels:foreground,cullingChanged,nearChanged,water,coastalWater,exposedSeafloor,stableWater:[...stableWater],coastLand,coastSea,seams,deepSeams,closeCubeEdge,movedCubeEdge,reusedAtCubeEdge,edgeIncision,reusedChanges,detail:[...detail],valleyChanges,maxValleyKm,geometryChange,maxOceanChange,maxRepeat,gradientError,alongDifference,acrossDifference,regionalCountActive,regionalMax,regionalTangency,lodMeasurements,lodResidualMax,lodResidualDifference,valleyIncision:valley.incision,crossMatches,crossMaxKm,highlandHeight:highland.height,repeatChanged,seedChanged,biomeChanged,riverChanged,lodChanged,patchChanged,patchColorChanged,meshletColorChanged,meshletEdgeChanged,wireChanged};status.textContent=JSON.stringify(result);window.__planetSmokeDone=result;
}catch(error){status.textContent=error.stack;window.__planetSmokeDone={ok:false,error:error.stack};}

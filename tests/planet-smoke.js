import {PlanetRenderer} from '../src/planet/renderer.js';
import {faceDirection} from '../src/planet/planet-math.js';
const status=document.querySelector('#status');
try{
 const source=document.querySelector('#source');const adapter=await navigator.gpu?.requestAdapter();if(!adapter)throw new Error('No WebGPU adapter');
 const device=await adapter.requestDevice(),errors=[];
 const renderer=new PlanetRenderer(source,adapter,device,source.getContext('webgpu'),false,e=>errors.push(e));
 await renderer.init();window.__planetRenderer=renderer;renderer.budget=36;renderer.pixelSize=24;renderer.resize();renderer.lastSample=Infinity;
 const width=source.width,height=source.height,stride=Math.ceil(width*4/256)*256;
 const color=device.createTexture({size:[width,height],format:renderer.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
 renderer.context={getCurrentTexture:()=>color};
 async function capture(){
  while(renderer.inFlight>=2)await new Promise(resolve=>setTimeout(resolve,1));
  renderer.frame(performance.now()+1000);
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
 renderer.culling=false;const uncull=await capture();renderer.culling=true;
 if(uncull.count!==uncull.patches*16 || first.count>uncull.count)throw new Error(`Invalid meshlet culling counts: ${first.count} / ${uncull.count}`);
 const cullingChanged=difference(first,uncull);if(cullingChanged>width*height*.02)throw new Error(`Culling changed ${cullingChanged} pixels`);
 // Check GPU-generated positions on the edges where different cube faces meet.
 const roots=renderer.patches.filter(node=>node.level===0),rootChunk=441*32;
 const rootBuffer=device.createBuffer({size:roots.length*rootChunk,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),rootEncoder=device.createCommandEncoder();
 roots.forEach((node,i)=>rootEncoder.copyBufferToBuffer(renderer.vertices,node.slot*rootChunk,rootBuffer,i*rootChunk,rootChunk));device.queue.submit([rootEncoder.finish()]);await rootBuffer.mapAsync(GPUMapMode.READ);
 const rootData=new Float32Array(rootBuffer.getMappedRange()),edges=new Map();let crossMatches=0,crossMaxKm=0;
 roots.forEach((node,i)=>{for(let y=0;y<=16;y++)for(let x=0;x<=16;x++){
  if(x!==0&&x!==16&&y!==0&&y!==16)continue;
  const direction=faceDirection(node.face,-1+x/8,-1+y/8),key=direction.map(v=>v.toFixed(6)).join(','),base=i*441*8+((y+2)*21+x+2)*8;
  const position=direction.map((_,k)=>node.direction[k]*6371+rootData[base+k]);
  if(edges.has(key)){const previous=edges.get(key);if(previous.face!==node.face){crossMatches++;crossMaxKm=Math.max(crossMaxKm,Math.hypot(...position.map((v,k)=>v-previous.position[k])));}}
  else edges.set(key,{face:node.face,position});
 }});
 rootBuffer.unmap();rootBuffer.destroy();if(crossMatches<100||crossMaxKm>.002)throw new Error(`Cube-face seams: ${crossMatches} matches, max ${crossMaxKm} km`);
 const highland=await renderer.findHighlands();const point=await renderer.sampleTerrain(highland.direction);
 if(Math.abs(point[3]-highland.height)>.02)throw new Error(`Highland probe disagrees with its sampled height: ${point[3]} / ${highland.height}`);
 // The extra detail is geometry, including at scales smaller than a float32
 // unit-vector coordinate can represent without the high/low decomposition.
 const [common,generator]=await Promise.all(['common.wgsl','generate.wgsl'].map(p=>fetch(`../src/planet/${p}`).then(r=>r.text())));
 const detailModule=device.createShaderModule({code:common+'\n'+generator+`
 @compute @workgroup_size(1) fn detailCheck(){
  let direction=normalize(probe.direction.xyz);let tangent=normalize(cross(direction,vec3<f32>(0.0,1.0,0.0)));
  let zero=vec3<f32>(0.0);let seed=frame.counts.z;let base=terrain(direction,seed);
  let a=detailedTerrain(direction,direction,zero,zero,seed)-base;
  let b=detailedTerrain(direction,direction,zero,tangent*(8.0/6371000.0),seed)-base;
  let c=localNoise(direction,zero,zero,8388608.0,seed+421u);
  let d=localNoise(direction,zero,tangent*(.5/6371000.0),8388608.0,seed+421u);
  samples[0]=vec4<f32>(a,b,c,d);
 }`});
 const detailPipe=await device.createComputePipelineAsync({layout:'auto',compute:{module:detailModule,entryPoint:'detailCheck'}});
 const detailBind=device.createBindGroup({layout:detailPipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:renderer.uniform}},{binding:4,resource:{buffer:renderer.plates}},{binding:5,resource:{buffer:renderer.sampleBuffer}},{binding:6,resource:{buffer:renderer.probeInput}}]});
 const detailBuffer=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),detailEncoder=device.createCommandEncoder(),detailPass=detailEncoder.beginComputePass();
 detailPass.setPipeline(detailPipe);detailPass.setBindGroup(0,detailBind);detailPass.dispatchWorkgroups(1);detailPass.end();detailEncoder.copyBufferToBuffer(renderer.sampleBuffer,0,detailBuffer,0,16);device.queue.submit([detailEncoder.finish()]);
 await detailBuffer.mapAsync(GPUMapMode.READ);const detail=new Float32Array(detailBuffer.getMappedRange().slice(0));detailBuffer.unmap();detailBuffer.destroy();
 if(!detail.every(Number.isFinite)||Math.abs(detail[0]-detail[1])<.000001||Math.abs(detail[2]-detail[3])<.001)throw new Error(`Fine terrain samples did not vary with position: ${[...detail]}`);
 // A flat ocean must shade the rendered sea surface, not cavities and slopes
 // in the hidden seafloor. Exercise many patches near an actual coastline.
 const oceanCamera={...renderer.cameraState},oceanSamples=await renderer.sampleTerrain();let sea=0;
 for(let i=0;i<oceanSamples.length;i+=4)if(oceanSamples[i+3]<-.1&&Math.abs(oceanSamples[i+3]+.6)<Math.abs(oceanSamples[sea+3]+.6))sea=i;
 const seaDirection=[oceanSamples[sea],oceanSamples[sea+1],oceanSamples[sea+2]];
 Object.assign(renderer.cameraState,{mode:'orbit',altitude:100,surfaceHeight:0,longitude:Math.atan2(seaDirection[2],seaDirection[0]),latitude:Math.asin(seaDirection[1])});
 renderer.budget=180;renderer.pixelSize=10;renderer.ocean=true;renderer.invalidateTerrain();renderer.lastSelection=0;await capture();
 async function inspectOcean(){
  const nodes=renderer.patches,chunk=441*32,read=device.createBuffer({size:nodes.length*chunk,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();
  nodes.forEach((node,i)=>encoder.copyBufferToBuffer(renderer.vertices,node.slot*chunk,read,i*chunk,chunk));device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
  const data=new Float32Array(read.getMappedRange());let count=0,maxCavity=0,maxNormalAngle=0;
  for(let i=0;i<nodes.length;i++)for(let y=0;y<=16;y++)for(let x=0;x<=16;x++){
   const off=i*441*8+((y+2)*21+x+2)*8;if(data[off+3]>=-.1)continue;
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
 if(exposedSeafloor.count<100||exposedSeafloor.maxCavity<.001)throw new Error(`Exposed seafloor lost terrain shading: ${JSON.stringify(exposedSeafloor)}`);
 renderer.ocean=true;Object.assign(renderer.cameraState,oceanCamera);renderer.budget=36;renderer.pixelSize=24;renderer.invalidateTerrain();renderer.lastSelection=0;await capture();
 // Exercise culling and exact shared vertices in a refined, mixed-LOD view.
 const original={...renderer.cameraState};renderer.budget=180;renderer.pixelSize=10;renderer.cameraState.altitude=100;renderer.invalidateTerrain();
 const near=await capture();renderer.culling=false;const nearUnculled=await capture();renderer.culling=true;
 if(!(near.count>0 && near.count<nearUnculled.count && nearUnculled.count===near.patches*16))throw new Error(`Refined culling counts are incorrect: ${near.count}/${nearUnculled.count}`);
 const nearChanged=difference(near,nearUnculled);if(nearChanged>width*height*.02)throw new Error(`Refined culling changed ${nearChanged} pixels`);
 async function inspectSeams(){
 const nodes=renderer.patches,chunk=441*32,buffer=device.createBuffer({size:nodes.length*chunk,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),copy=device.createCommandEncoder();
 nodes.forEach((node,i)=>copy.copyBufferToBuffer(renderer.vertices,node.slot*chunk,buffer,i*chunk,chunk));device.queue.submit([copy.finish()]);await buffer.mapAsync(GPUMapMode.READ);
 const data=new Float32Array(buffer.getMappedRange());let maxSeamKm=0,matched=0,mixed=0,maxNormal=0,deepMatched=0,deepMaxKm=0,deepMaxNormal=0;
 const pointAt=(node,index,x,y)=>{const offset=index*441*8+((y+2)*21+(x+2))*8;return [0,1,2].map(k=>node.direction[k]*6371+data[offset+k]);};
 const normalAt=(index,x,y)=>{const offset=index*441*8+((y+2)*21+(x+2))*8+4;return [data[offset],data[offset+1],data[offset+2]];};
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
 // mixed LODs, and retained patches must be updated when neighbor masks change.
 renderer.budget=384;renderer.pixelSize=14;renderer.invalidateTerrain();
 Object.assign(renderer.cameraState,{mode:'orbit',altitude:.03,surfaceHeight:point[3],longitude:Math.atan2(highland.direction[2],highland.direction[0]),latitude:Math.asin(highland.direction[1])});
 renderer.lastSelection=0;await capture();const deepSeams=await inspectSeams();
 if(deepSeams.deepMatched<100||deepSeams.deepMaxKm>.0001||deepSeams.deepMaxNormal>.5)throw new Error(`Close-up seams: ${JSON.stringify(deepSeams)}`);
 let reusedChanges=0;
 for(const offset of [.01,.03,.07]){
  const before=new Map(renderer.patches.map(p=>[p.key,p.normalStitch]));renderer.cameraState.longitude+=offset;renderer.needsSelection=true;renderer.lastSelection=0;await capture();
  reusedChanges=renderer.patches.filter(p=>before.has(p.key)&&before.get(p.key)!==p.normalStitch).length;
  if(reusedChanges){if(renderer.stats.reusedNormalUpdates<reusedChanges)throw new Error('Changed neighboring LOD did not refresh cached normals');break;}
 }
 if(!reusedChanges)throw new Error('Camera movement did not exercise a cached stitch change');
 Object.assign(renderer.cameraState,original);renderer.budget=36;renderer.pixelSize=24;renderer.invalidateTerrain();
 const background={pixels:new Uint8Array(first.pixels.length)};for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*stride+x*4;background.pixels.set(first.pixels.subarray(0,4),i);}
 const foreground=difference(first,background);if(foreground<2000)throw new Error(`Planet render is empty: ${foreground} foreground pixels`);
 renderer.invalidateTerrain();const repeat=await capture();const repeatChanged=difference(first,repeat);if(repeatChanged>10)throw new Error(`Same seed did not reproduce terrain: ${repeatChanged} pixels`);
 renderer.seed=31829;renderer.invalidateTerrain();const other=await capture();const seedChanged=difference(first,other);if(seedChanged<1000)throw new Error(`Different seed did not change the planet: ${seedChanged} pixels`);
 renderer.lodColors=true;const levels=await capture();const lodChanged=difference(other,levels);if(lodChanged<1000)throw new Error('LOD colors did not affect the image');
 renderer.lodColors=false;renderer.patchLines=true;const patchLines=await capture();const patchChanged=difference(other,patchLines);if(patchChanged<100)throw new Error('Patch boundaries did not affect the image');
 renderer.patchLines=false;renderer.wireframe=true;const wire=await capture();const wireChanged=difference(other,wire);if(wireChanged<100)throw new Error('Triangle wireframe did not affect the image');renderer.wireframe=false;
 if(errors.length)throw new Error(errors.join('; '));
 const canvas=document.querySelector('#preview');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d'),image=ctx.createImageData(width,height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*stride+x*4,o=(y*width+x)*4;
  if(renderer.format.startsWith('bgra')){image.data[o]=first.pixels[i+2];image.data[o+1]=first.pixels[i+1];image.data[o+2]=first.pixels[i];}else image.data.set(first.pixels.subarray(i,i+3),o);image.data[o+3]=255;
 }
 ctx.putImageData(image,0,0);
 const result={ok:true,patches:first.patches,meshlets:first.count,foregroundPixels:foreground,cullingChanged,nearChanged,water,coastalWater,exposedSeafloor,seams,deepSeams,reusedChanges,detail:[...detail],crossMatches,crossMaxKm,highlandHeight:highland.height,repeatChanged,seedChanged,lodChanged,patchChanged,wireChanged};status.textContent=JSON.stringify(result);window.__planetSmokeDone=result;
}catch(error){status.textContent=error.stack;window.__planetSmokeDone={ok:false,error:error.stack};}

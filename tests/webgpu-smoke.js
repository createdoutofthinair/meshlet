// Real WebGPU compute + render test using an offscreen texture. This also works
// with software WebGPU implementations whose headless canvas presentation fails.
import {Renderer} from '../src/gpu/renderer.js';
import {generateMesh,calculateBounds,LOD_TRIANGLES} from '../src/geometry/meshlets.js';
const status=document.querySelector('#status');
try {
 const source=document.querySelector('#source');source.style.display='block';
 const adapter=await navigator.gpu?.requestAdapter();if(!adapter)throw new Error('No WebGPU adapter');
 const device=await adapter.requestDevice();const errors=[];
 const renderer=new Renderer(source,adapter,device,source.getContext('webgpu'),false,e=>errors.push(e));
 await renderer.init();
 const wasm=await (await fetch('../src/geometry/bounds.wasm')).arrayBuffer();
 const mesh=await calculateBounds(generateMesh(24),wasm);renderer.setScene(mesh,4);renderer.resetCamera();
 renderer.distance=5;renderer.pitch=.6;renderer.resize();renderer.lastSample=Infinity;
 const width=source.width,height=source.height;
 const color=device.createTexture({size:[width,height],format:renderer.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
 renderer.context={getCurrentTexture:()=>color};
 const bytesPerRow=Math.ceil(width*4/256)*256;
 async function capture({culling=true,colorMode=0,lodMode=1,meshletEdges=false,triangleEdges=false,projectedBounds=false,projectionScope=0}={}) {
  Object.assign(renderer,{culling,colorMode,lodMode,meshletEdges,triangleEdges,projectedBounds,projectionScope});renderer.frame(100);
  const pixels=device.createBuffer({size:bytesPerRow*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const indirect=device.createBuffer({size:48,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const enc=device.createCommandEncoder();
  enc.copyTextureToBuffer({texture:color},{buffer:pixels,bytesPerRow,rowsPerImage:height},[width,height]);
  enc.copyBufferToBuffer(renderer.scene.indirect,0,indirect,0,48);device.queue.submit([enc.finish()]);
  await Promise.all([pixels.mapAsync(GPUMapMode.READ),indirect.mapAsync(GPUMapMode.READ)]);
  const commands=new Uint32Array(indirect.getMappedRange().slice(0)),counts=[commands[1],commands[5],commands[9]];
  const result={pixels:new Uint8Array(pixels.getMappedRange().slice(0)),count:counts.reduce((a,b)=>a+b,0),counts,vertices:[commands[0],commands[4],commands[8]]};
  pixels.unmap();indirect.unmap();pixels.destroy();indirect.destroy();return result;
 }
 function difference(a,b,threshold=3) {
  let changed=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const i=y*bytesPerRow+x*4;
   if(Math.max(...[0,1,2].map(k=>Math.abs(a.pixels[i+k]-b.pixels[i+k])))>threshold)changed++;
  }return changed;
 }
 const views=[];let firstCulled,firstFull,nonBackground=0;
 for(const camera of [{yaw:.75,pitch:.6,distance:5},{yaw:-1.8,pitch:1.0,distance:8},{yaw:3.1,pitch:.25,distance:5}]) {
  Object.assign(renderer,camera);
  const all=await capture({culling:false}),culled=await capture();
  if(all.count!==renderer.scene.candidates)throw new Error(`Expected ${renderer.scene.candidates} candidates without culling, got ${all.count}`);
  if(!(culled.count>0 && culled.count<=all.count))throw new Error(`Invalid visible count: ${culled.count} / ${all.count}`);
  const changed=difference(all,culled);
  if(changed>width*height*.02)throw new Error(`Culling changed ${changed} rendered pixels at ${JSON.stringify(camera)}`);
  const allAuto=await capture({culling:false,lodMode:0}),culledAuto=await capture({lodMode:0});
  const autoChanged=difference(allAuto,culledAuto);
  if(autoChanged>width*height*.02)throw new Error(`Automatic LOD culling changed ${autoChanged} pixels at ${JSON.stringify(camera)}`);
  views.push({camera,visible:culled.count,changedPixels:changed,autoChangedPixels:autoChanged});
  if(!firstCulled){firstCulled=culled;firstFull=all;}
 }
 if(firstCulled.count>=firstFull.count)throw new Error('Culling did not reduce the visible count');
 Object.assign(renderer,views[0].camera);
 const forced=[];
 for(let lod=0;lod<3;lod++){
  const result=await capture({culling:false,lodMode:lod+1});
  if(result.counts[lod]!==renderer.scene.candidates || result.counts.some((count,index)=>index!==lod&&count!==0))throw new Error(`Forced LOD ${lod}: ${result.counts}`);
  if(result.vertices.some((count,index)=>count!==LOD_TRIANGLES[index]*3))throw new Error(`Unexpected indirect triangle counts: ${result.vertices}`);
  forced.push(result);
 }
 if(difference(forced[0],forced[1])<100||difference(forced[0],forced[2])<100)throw new Error('LOD geometry did not visibly change');
 const colorMeans=[];
 for(let lod=0;lod<3;lod++){
  const colored=await capture({culling:false,lodMode:lod+1,colorMode:2});
  const bg=[colored.pixels[0],colored.pixels[1],colored.pixels[2]],sum=[0,0,0];let n=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const i=y*bytesPerRow+x*4;if(Math.max(...[0,1,2].map(k=>Math.abs(colored.pixels[i+k]-bg[k])))<=5)continue;
   const r=renderer.format.startsWith('bgra')?2:0,b=renderer.format.startsWith('bgra')?0:2;
   sum[0]+=colored.pixels[i+r];sum[1]+=colored.pixels[i+1];sum[2]+=colored.pixels[i+b];n++;
  }
  if(!n)throw new Error(`LOD ${lod} color view is empty`);
  colorMeans.push(sum.map(v=>v/n));
 }
 if(!(colorMeans[0][1]>colorMeans[0][0] && colorMeans[0][2]>colorMeans[0][0] && colorMeans[1][0]>colorMeans[1][2] && colorMeans[1][1]>colorMeans[1][2] && colorMeans[2][0]>colorMeans[2][1] && colorMeans[2][2]>colorMeans[2][1]))throw new Error(`LOD colors do not match the legend: ${JSON.stringify(colorMeans)}`);
 renderer.distance=5;const near=await capture({culling:false,lodMode:0});
 renderer.distance=40;const far=await capture({culling:false,lodMode:0});
 const score=r=>r.counts.reduce((sum,count,i)=>sum+count*LOD_TRIANGLES[i],0);
 if(score(near)<=score(far))throw new Error(`Automatic LOD did not reduce triangles with distance: ${near.counts} / ${far.counts}`);
 renderer.setScene(mesh,1);renderer.distance=6;renderer.yaw=.75;renderer.pitch=.2;
 const shallow=await capture({culling:false,lodMode:0});renderer.pitch=1.25;const steep=await capture({culling:false,lodMode:0});
 if(shallow.counts[1]!==mesh.meshletCount || steep.counts[1]!==mesh.meshletCount)throw new Error(`LOD changes incorrectly with camera pitch: ${shallow.counts} / ${steep.counts}`);
 renderer.setScene(mesh,4);Object.assign(renderer,views[0].camera);
 const shaded=await capture(),lodColors=await capture({colorMode:2}),meshletLines=await capture({meshletEdges:true}),triangles=await capture({triangleEdges:true}),projected=await capture({projectedBounds:true}),projectedAll=await capture({projectedBounds:true,projectionScope:1}),combined=await capture({colorMode:2,meshletEdges:true,projectedBounds:true});
 const changed={lodColors:difference(shaded,lodColors,5),meshletLines:difference(shaded,meshletLines,5),triangles:difference(shaded,triangles,5),projected:difference(shaded,projected,5),projectedAll:difference(shaded,projectedAll,5)};
 for(const [name,count] of Object.entries(changed))if(count<100)throw new Error(`${name} did not visibly change the image (${count} pixels)`);
 if(changed.projectedAll<=changed.projected)throw new Error('Showing all projected bounds did not increase the overlay');
 const bg=[firstFull.pixels[0],firstFull.pixels[1],firstFull.pixels[2]];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*bytesPerRow+x*4;if(Math.max(...[0,1,2].map(k=>Math.abs(shaded.pixels[i+k]-bg[k])))>5)nonBackground++;}
 if(nonBackground<500)throw new Error(`Expected rendered geometry; found only ${nonBackground} foreground pixels`);
 if(errors.length)throw new Error(errors.join('; '));
 const canvas=document.querySelector('#preview');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d'),image=ctx.createImageData(width,height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*bytesPerRow+x*4,o=(y*width+x)*4;
  if(renderer.format.startsWith('bgra')){image.data[o]=combined.pixels[i+2];image.data[o+1]=combined.pixels[i+1];image.data[o+2]=combined.pixels[i];}
  else image.data.set(combined.pixels.subarray(i,i+3),o);
  image.data[o+3]=255;
 }
 ctx.putImageData(image,0,0);
 const result={ok:true,candidates:firstFull.count,views,forcedLods:forced.map(x=>x.counts),colorMeans,automatic:{near:near.counts,far:far.counts},debugChangedPixels:changed,foregroundPixels:nonBackground};
 status.textContent=JSON.stringify(result);window.__webgpuSmokeDone=result;
}catch(error){status.textContent=error.stack;window.__webgpuSmokeDone={ok:false,error:error.stack};}

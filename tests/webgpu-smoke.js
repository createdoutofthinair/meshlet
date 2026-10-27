// Real WebGPU compute + render test using an offscreen texture. This also works
// with software WebGPU implementations whose headless canvas presentation fails.
import {Renderer} from '../src/gpu/renderer.js';
import {generateMesh,calculateBounds} from '../src/geometry/meshlets.js';
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
 async function capture(culling,colors=false) {
  renderer.culling=culling;renderer.colorMeshlets=colors;renderer.frame(100);
  const pixels=device.createBuffer({size:bytesPerRow*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const indirect=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const enc=device.createCommandEncoder();
  enc.copyTextureToBuffer({texture:color},{buffer:pixels,bytesPerRow,rowsPerImage:height},[width,height]);
  enc.copyBufferToBuffer(renderer.scene.indirect,0,indirect,0,16);device.queue.submit([enc.finish()]);
  await Promise.all([pixels.mapAsync(GPUMapMode.READ),indirect.mapAsync(GPUMapMode.READ)]);
  const result={pixels:new Uint8Array(pixels.getMappedRange().slice(0)),count:new Uint32Array(indirect.getMappedRange().slice(0))[1]};
  pixels.unmap();indirect.unmap();pixels.destroy();indirect.destroy();return result;
 }
 const views=[];let firstCulled,firstFull,nonBackground=0,debugChanged=0;
 for(const camera of [{yaw:.75,pitch:.6,distance:5},{yaw:-1.8,pitch:1.0,distance:8},{yaw:3.1,pitch:.25,distance:5}]) {
  Object.assign(renderer,camera);
  const all=await capture(false),culled=await capture(true);
  if(all.count!==renderer.scene.candidates)throw new Error(`Expected ${renderer.scene.candidates} candidates without culling, got ${all.count}`);
  if(!(culled.count>0 && culled.count<=all.count))throw new Error(`Invalid visible count: ${culled.count} / ${all.count}`);
  let changed=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
   const i=y*bytesPerRow+x*4;
   if(Math.max(...[0,1,2].map(k=>Math.abs(all.pixels[i+k]-culled.pixels[i+k])))>3)changed++;
  }
  if(changed>width*height*.02)throw new Error(`Culling changed ${changed} rendered pixels at ${JSON.stringify(camera)}`);
  views.push({camera,visible:culled.count,changedPixels:changed});
  if(!firstCulled){firstCulled=culled;firstFull=all;}
 }
 if(firstCulled.count>=firstFull.count)throw new Error('Culling did not reduce the visible count');
 Object.assign(renderer,views[0].camera);
 const colored=await capture(true,true),culled=firstCulled,all=firstFull;
 const bg=[all.pixels[0],all.pixels[1],all.pixels[2]];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*bytesPerRow+x*4;
  if(Math.max(...[0,1,2].map(k=>Math.abs(culled.pixels[i+k]-bg[k])))>5)nonBackground++;
  if(Math.max(...[0,1,2].map(k=>Math.abs(colored.pixels[i+k]-culled.pixels[i+k])))>5)debugChanged++;
 }
 if(nonBackground<500)throw new Error(`Expected rendered geometry; found only ${nonBackground} foreground pixels`);
 if(debugChanged<500)throw new Error('Meshlet color mode did not affect the rendered geometry');
 if(errors.length)throw new Error(errors.join('; '));
 const canvas=document.querySelector('#preview');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d'),image=ctx.createImageData(width,height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*bytesPerRow+x*4,o=(y*width+x)*4;
  if(renderer.format.startsWith('bgra')){image.data[o]=culled.pixels[i+2];image.data[o+1]=culled.pixels[i+1];image.data[o+2]=culled.pixels[i];}
  else image.data.set(culled.pixels.subarray(i,i+3),o);
  image.data[o+3]=255;
 }
 ctx.putImageData(image,0,0);
 const result={ok:true,candidates:all.count,visible:culled.count,foregroundPixels:nonBackground,views,debugChangedPixels:debugChanged,format:renderer.format};
 status.textContent=JSON.stringify(result);window.__webgpuSmokeDone=result;
}catch(error){status.textContent=error.stack;window.__webgpuSmokeDone={ok:false,error:error.stack};}

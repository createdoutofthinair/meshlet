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
 const roots=renderer.patches.filter(node=>node.level===0),rootChunk=361*32;
 const rootBuffer=device.createBuffer({size:roots.length*rootChunk,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),rootEncoder=device.createCommandEncoder();
 roots.forEach((node,i)=>rootEncoder.copyBufferToBuffer(renderer.vertices,node.slot*rootChunk,rootBuffer,i*rootChunk,rootChunk));device.queue.submit([rootEncoder.finish()]);await rootBuffer.mapAsync(GPUMapMode.READ);
 const rootData=new Float32Array(rootBuffer.getMappedRange()),edges=new Map();let crossMatches=0,crossMaxKm=0;
 roots.forEach((node,i)=>{for(let y=0;y<=16;y++)for(let x=0;x<=16;x++){
  if(x!==0&&x!==16&&y!==0&&y!==16)continue;
  const direction=faceDirection(node.face,-1+x/8,-1+y/8),key=direction.map(v=>v.toFixed(6)).join(','),base=i*361*8+((y+1)*19+x+1)*8;
  const position=direction.map((_,k)=>node.direction[k]*6371+rootData[base+k]);
  if(edges.has(key)){const previous=edges.get(key);if(previous.face!==node.face){crossMatches++;crossMaxKm=Math.max(crossMaxKm,Math.hypot(...position.map((v,k)=>v-previous.position[k])));}}
  else edges.set(key,{face:node.face,position});
 }});
 rootBuffer.unmap();rootBuffer.destroy();if(crossMatches<100||crossMaxKm>.002)throw new Error(`Cube-face seams: ${crossMatches} matches, max ${crossMaxKm} km`);
 const highland=await renderer.findHighlands();const point=await renderer.sampleTerrain(highland.direction);
 if(Math.abs(point[3]-highland.height)>.02)throw new Error(`Highland probe disagrees with its sampled height: ${point[3]} / ${highland.height}`);
 // Exercise culling and exact shared vertices in a refined, mixed-LOD view.
 const original={...renderer.cameraState};renderer.budget=180;renderer.pixelSize=10;renderer.cameraState.altitude=100;renderer.invalidateTerrain();
 const near=await capture();renderer.culling=false;const nearUnculled=await capture();renderer.culling=true;
 if(!(near.count>0 && near.count<nearUnculled.count && nearUnculled.count===near.patches*16))throw new Error(`Refined culling counts are incorrect: ${near.count}/${nearUnculled.count}`);
 const nearChanged=difference(near,nearUnculled);if(nearChanged>width*height*.02)throw new Error(`Refined culling changed ${nearChanged} pixels`);
 const nodes=renderer.patches,chunk=361*32,buffer=device.createBuffer({size:nodes.length*chunk,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),copy=device.createCommandEncoder();
 nodes.forEach((node,i)=>copy.copyBufferToBuffer(renderer.vertices,node.slot*chunk,buffer,i*chunk,chunk));device.queue.submit([copy.finish()]);await buffer.mapAsync(GPUMapMode.READ);
 const data=new Float32Array(buffer.getMappedRange());let maxSeamKm=0,matched=0,mixed=0;
 const pointAt=(node,index,x,y)=>{const offset=index*361*8+((y+1)*19+(x+1))*8;return [0,1,2].map(k=>node.direction[k]*6371+data[offset+k]);};
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
    maxSeamKm=Math.max(maxSeamKm,Math.hypot(...fp.map((n,l)=>n-cp[l])));matched++;
   }
  }
 }
 buffer.unmap();buffer.destroy();if(matched<100||mixed<1||maxSeamKm>.002)throw new Error(`Terrain seams: ${matched} matches, ${mixed} mixed edges, max ${maxSeamKm} km`);
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
 const result={ok:true,patches:first.patches,meshlets:first.count,foregroundPixels:foreground,cullingChanged,nearChanged,matchedSeamVertices:matched,mixedLodEdges:mixed,maxSeamKm,crossMatches,crossMaxKm,highlandHeight:highland.height,repeatChanged,seedChanged,lodChanged,patchChanged,wireChanged};status.textContent=JSON.stringify(result);window.__planetSmokeDone=result;
}catch(error){status.textContent=error.stack;window.__planetSmokeDone={ok:false,error:error.stack};}

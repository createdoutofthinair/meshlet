import {RiverRenderer,TERRAIN_GRID,WATER_ALONG,WATER_ACROSS} from '../src/river/renderer.js';
const status=document.getElementById('status');
try{
 const canvas=document.getElementById('source'),errors=[],renderer=await RiverRenderer.create(canvas,error=>errors.push(error));
 const meta=await renderer.regenerate(918273,0),device=renderer.device;
 if(!meta||!Number.isFinite(meta.discharge)||meta.discharge<2||meta.start===meta.end||meta.slope<=0)throw Error(`Invalid selected river: ${JSON.stringify(meta)}`);
 const bytes=192,read=device.createBuffer({size:bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();
 encoder.copyBufferToBuffer(renderer.world.world,meta.start*48,read,0,48);
 encoder.copyBufferToBuffer(renderer.world.world,meta.end*48,read,48,48);
 encoder.copyBufferToBuffer(renderer.world.world,24578*48+(meta.start*17+7)*16,read,96,48);
 const terrainCenter=((TERRAIN_GRID/2)*(TERRAIN_GRID+1)+TERRAIN_GRID/2)*48;
 const waterCenter=((WATER_ALONG/2)*(WATER_ACROSS+1)+WATER_ACROSS/2)*48;
 encoder.copyBufferToBuffer(renderer.vertices[0],terrainCenter,read,144,16);encoder.copyBufferToBuffer(renderer.vertices[1],waterCenter,read,160,16);
 encoder.copyBufferToBuffer(renderer.motion,0,read,176,16);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
 const raw=read.getMappedRange().slice(0),f=new Float32Array(raw),u=new Uint32Array(raw);read.unmap();read.destroy();
 if(u[4]!==meta.end||f[5]<=f[17])throw Error(`Chosen flow is not the downhill route: ${u[4]}/${meta.end}, ${f[5]}/${f[17]}`);
 const tangent=[f[32]-f[24],f[33]-f[25],f[34]-f[26]],alignment=tangent.reduce((sum,v,i)=>sum+v*meta.downstream[i],0);
 if(!(alignment>0))throw Error(`Flow tangent points upstream: ${alignment}`);
 if(Math.abs(f[36])>.01||Math.abs(f[38])>.01||Math.abs(f[37]+renderer.depth)>.05||Math.abs(f[40])>.01||Math.abs(f[41])>.01)throw Error(`Bed and water did not meet at the river center: ${[...f.slice(36,44)]}`);
 renderer.resize();const width=canvas.width,height=canvas.height,stride=Math.ceil(width*4/256)*256;
 const color=device.createTexture({size:[width,height],format:renderer.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});renderer.context={getCurrentTexture:()=>color};
 async function capture(time){
  while(renderer.inFlight>=2)await device.queue.onSubmittedWorkDone();renderer.frame(time);await device.queue.onSubmittedWorkDone();
  const output=device.createBuffer({size:stride*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),command=device.createCommandEncoder();
  command.copyTextureToBuffer({texture:color},{buffer:output,bytesPerRow:stride,rowsPerImage:height},[width,height]);device.queue.submit([command.finish()]);await output.mapAsync(GPUMapMode.READ);
  const pixels=new Uint8Array(output.getMappedRange().slice(0));output.unmap();output.destroy();return pixels;
 }
 renderer.paused=true;const plain=await capture(1000);renderer.showFlow=true;const arrows=await capture(1100);let changed=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*stride+x*4;if(Math.max(...[0,1,2].map(k=>Math.abs(plain[i+k]-arrows[i+k])))>3)changed++;}
 if(changed<20)throw Error(`Downstream arrows did not affect the rendered water: ${changed} pixels`);
 async function phase(){const b=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),e=device.createCommandEncoder();e.copyBufferToBuffer(renderer.motion,0,b,0,16);device.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const p=new Float32Array(b.getMappedRange())[0];b.unmap();b.destroy();return p;}
 const before=await phase();renderer.paused=false;renderer.frame(1200);await device.queue.onSubmittedWorkDone();const after=await phase();
 if(!(after>before))throw Error(`Water advection did not move downstream: ${before}/${after}`);
 renderer.paused=true;renderer.frame(1300);await device.queue.onSubmittedWorkDone();const paused=await phase();if(Math.abs(paused-after)>.000001)throw Error('Paused water continued to move');
 if(errors.length)throw Error(errors.join('; '));const result={ok:true,start:meta.start,end:meta.end,alignment,bed:f[37],water:f[41],arrowPixels:changed,advection:after-before};status.textContent=JSON.stringify(result);window.__riverSmokeDone=result;
}catch(error){status.textContent=error.stack;window.__riverSmokeDone={ok:false,error:error.stack};}

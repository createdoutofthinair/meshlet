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
 if(Math.abs(f[36])>.01||Math.abs(f[38])>.01||f[37]>=-.5||Math.abs(f[40])>.01||Math.abs(f[41])>.01)throw Error(`Bed and water did not meet at the river center: ${[...f.slice(36,44)]}`);
 // Exercise the actual material functions, including reset continuity and flow direction.
 const source=await Promise.all(['../src/planet/common.wgsl','../src/river/shared.wgsl','../src/river/render.wgsl','./river-flow-smoke.wgsl'].map(async path=>{const response=await fetch(path);if(!response.ok)throw Error(`Could not load ${path}`);return response.text();}));
 const module=device.createShaderModule({code:source.join('\n')}),pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'probeRiverFlow'}});
 const probe=device.createBuffer({size:192,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),probeRead=device.createBuffer({size:192,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 const group0=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:renderer.frameBuffer}},{binding:8,resource:{buffer:renderer.rocks}}]}),group1=device.createBindGroup({layout:pipeline.getBindGroupLayout(1),entries:[{binding:0,resource:{buffer:probe}}]});
 const command=device.createCommandEncoder(),compute=command.beginComputePass();compute.setPipeline(pipeline);compute.setBindGroup(0,group0);compute.setBindGroup(1,group1);compute.dispatchWorkgroups(1);compute.end();command.copyBufferToBuffer(probe,0,probeRead,0,192);device.queue.submit([command.finish()]);
 await probeRead.mapAsync(GPUMapMode.READ);const values=new Float32Array(probeRead.getMappedRange().slice(0));probeRead.unmap();probeRead.destroy();probe.destroy();
 if(!(values[0]>values[1]&&values[2]>values[3]&&values[6]>values[7]&&Math.abs(values[4]-values[5])<1e-5))throw Error(`Channel or downstream velocity is invalid: ${[...values.slice(0,8)]}`);
 if(Math.hypot(values[8]-values[10],values[9]-values[11])<.005&&Math.abs(values[12]-values[13])<.005)throw Error('Surface detail did not change as water moved');
 if(Math.abs(values[14]-values[15])>.003||Math.hypot(values[16]-values[18],values[17]-values[19])>.003)throw Error('Advected surface popped when its phase reset');
 if(!(values[20]>.019&&values[20]<.022&&values[21]>values[20]&&values[22]>.999&&values[23]>=.54&&values[23]<=1.0))throw Error(`Invalid water Fresnel or foam detail: ${[...values.slice(20,24)]}`);
 if(!(values[24]>.999&&values[24]>values[25]&&values[25]>values[26]&&values[27]>values[26]))throw Error(`Water absorption did not increase with depth: ${[...values.slice(24,28)]}`);
 if(Math.abs(values[28])>.55||Math.abs(values[29])>.55||Math.abs(values[30]-values[31])>.003||Math.abs(values[28]-values[29])<.001)throw Error('Water geometry height or animation continuity is invalid');
 if(!(values[32]>.35&&values[33]>.4&&Math.abs(values[34])<.001&&Math.abs(values[35])<.001&&Math.abs(values[36]-values[37])>.001&&values[38]>0&&values[39]>0))throw Error(`Rock waves or moving wakes are invalid: ${[...values.slice(32,40)]}`);
 if(Math.abs(values[40]-values[41])>.01||Math.abs(values[42]-values[43])>.01||Math.abs(values[44]-values[45])>.01||Math.abs(values[46]-values[47])>.01)throw Error(`Wave normals do not match the displaced surface: ${[...values.slice(40,48)]}`);
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
 // Compare the reflected scene to the same reflected sky alone: banks must be present.
 const rw=Math.ceil(width*renderer.reflectionScale),rh=Math.ceil(height*renderer.reflectionScale),rpitch=Math.ceil(rw*4/256)*256,section=rpitch*rh;
 const skyOnly=device.createTexture({size:[rw,rh],format:renderer.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
 const skyDepth=device.createTexture({size:[rw,rh],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT});
 const reflectedRead=device.createBuffer({size:section*2,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),reflectCommand=device.createCommandEncoder();
 const skyPass=reflectCommand.beginRenderPass({colorAttachments:[{view:skyOnly.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}],depthStencilAttachment:{view:skyDepth.createView(),depthLoadOp:'clear',depthStoreOp:'discard',depthClearValue:1}});
 skyPass.setPipeline(renderer.skyPipe);skyPass.setBindGroup(0,renderer.skyBinds[1]);skyPass.draw(3);skyPass.end();
 reflectCommand.copyTextureToBuffer({texture:renderer.reflectionTexture},{buffer:reflectedRead,offset:0,bytesPerRow:rpitch,rowsPerImage:rh},[rw,rh]);
 reflectCommand.copyTextureToBuffer({texture:skyOnly},{buffer:reflectedRead,offset:section,bytesPerRow:rpitch,rowsPerImage:rh},[rw,rh]);device.queue.submit([reflectCommand.finish()]);
 await reflectedRead.mapAsync(GPUMapMode.READ);const reflectionBytes=new Uint8Array(reflectedRead.getMappedRange());let bankPixels=0;
 for(let y=0;y<rh;y++)for(let x=0;x<rw;x++){const i=y*rpitch+x*4;if(Math.max(...[0,1,2].map(k=>Math.abs(reflectionBytes[i+k]-reflectionBytes[section+i+k])))>6)bankPixels++;}
 reflectedRead.unmap();reflectedRead.destroy();skyOnly.destroy();skyDepth.destroy();if(bankPixels<20)throw Error(`Riverbanks are missing from the reflection: ${bankPixels} pixels`);
 async function phase(){const b=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),e=device.createCommandEncoder();e.copyBufferToBuffer(renderer.motion,0,b,0,16);device.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const p=new Float32Array(b.getMappedRange())[0];b.unmap();b.destroy();return p;}
 renderer.showFlow=false;renderer.paused=false;const before=await phase(),first=await capture(1200),moving=await capture(2200),after=await phase();let movingPixels=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*stride+x*4;if(Math.max(...[0,1,2].map(k=>Math.abs(first[i+k]-moving[i+k])))>2)movingPixels++;}
 if(!(after-before>.9&&after-before<1.2))throw Error(`Water did not advance by the expected distance at 1 fps: ${before}/${after}`);
 if(movingPixels<50)throw Error(`Advected water did not visibly change without arrows: ${movingPixels} pixels`);
 renderer.paused=true;renderer.frame(2300);await device.queue.onSubmittedWorkDone();const paused=await phase();if(Math.abs(paused-after)>.000001)throw Error('Paused water continued to move');
 renderer.waterfall=true;renderer.drop=35;renderer.dirty=true;renderer.frame(2400);await device.queue.onSubmittedWorkDone();
 const fallsRead=device.createBuffer({size:32,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),fallsCommand=device.createCommandEncoder();
 const row=WATER_ACROSS+1,up=((WATER_ALONG/2-2)*row+WATER_ACROSS/2)*48,down=((WATER_ALONG/2+2)*row+WATER_ACROSS/2)*48;
 fallsCommand.copyBufferToBuffer(renderer.vertices[1],up,fallsRead,0,16);fallsCommand.copyBufferToBuffer(renderer.vertices[1],down,fallsRead,16,16);device.queue.submit([fallsCommand.finish()]);
 await fallsRead.mapAsync(GPUMapMode.READ);const falls=new Float32Array(fallsRead.getMappedRange().slice(0));fallsRead.unmap();fallsRead.destroy();
 if(!(falls[1]-falls[5]>25))throw Error(`Waterfall geometry did not descend: ${falls[1]}/${falls[5]}`);
 if(errors.length)throw Error(errors.join('; '));const result={ok:true,start:meta.start,end:meta.end,alignment,bed:f[37],water:f[41],arrowPixels:changed,reflectedBankPixels:bankPixels,movingPixels,advection:after-before,waterfallDrop:falls[1]-falls[5]};status.textContent=JSON.stringify(result);window.__riverSmokeDone=result;
}catch(error){status.textContent=error.stack;window.__riverSmokeDone={ok:false,error:error.stack};}

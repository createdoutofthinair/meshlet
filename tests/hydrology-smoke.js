import {PlanetRenderer} from '../src/planet/renderer.js';
import {buildWorldGrid} from '../src/planet/world-grid.js';
const status=document.querySelector('#status');
try{
 const canvas=document.querySelector('#source'),adapter=await navigator.gpu?.requestAdapter();if(!adapter)throw new Error('No WebGPU adapter');
 const device=await adapter.requestDevice(),errors=[],renderer=new PlanetRenderer(canvas,adapter,device,canvas.getContext('webgpu'),false,e=>errors.push(e));
 await renderer.init();window.__hydrologyRenderer=renderer;
 const grid=buildWorldGrid(64),count=grid.count,pathOffset=count*12,flagOffset=pathOffset+count*17*4;
 const size=Math.ceil(count*(48+17*16+4)/16)*16,NONE=0xffffffff,faceBits=new Uint8Array(count);
 for(let face=0;face<6;face++)for(let i=0;i<65*65;i++)faceBits[grid.faceIndices[face*65*65+i]]|=1<<face;
 async function read(){
  const buffer=device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(renderer.world,0,buffer,0,size);device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);const result=buffer.getMappedRange().slice(0);buffer.unmap();buffer.destroy();return result;
 }
 async function inspect(seed){
  renderer.seed=seed;renderer.invalidateTerrain();await renderer.sampleTerrain([1,0,0]);
  const raw=await read(),f=new Float32Array(raw),u=new Uint32Array(raw);let land=0,sea=0,riverNodes=0,sinks=0,basins=0,eroded=0,deposited=0,maxFlow=0,maxDepth=0,maxDeposit=0,maxError=0,maxPath=0,sharedRiverNodes=0,lakeNodes=0,lakeLinks=0,maxLakeFloorGap=0;
  const pathLength=new Int32Array(count).fill(-1);
  function path(i){if(pathLength[i]>=0)return pathLength[i];const chain=[];let j=i;while(j!==NONE&&pathLength[j]<0){chain.push(j);if(chain.length>count)throw new Error(`Seed ${seed}: drainage graph contains a cycle`);j=u[j*12+4];}let n=j===NONE?0:pathLength[j];while(chain.length)pathLength[chain.pop()]=++n;return pathLength[i];}
  function active(i){return u[i*12+4]!==NONE&&f[i*12+2]>=1.5;}
  for(let i=0;i<count;i++){
   const o=i*12,base=f[o],height=f[o+1],flow=f[o+2],deposit=f[o+3],down=u[o+4],filled=f[o+5],rain=f[o+10];
   if(![base,height,flow,deposit,filled,rain].every(Number.isFinite)||height < -8.001||height >9.001||filled<height-.00001||filled>=20||flow<0||deposit<0)throw new Error(`Seed ${seed}: invalid world cell ${i}`);
   if(height>0)land++;else sea++;if(flow>3&&down!==NONE)riverNodes++;if(down===NONE&&height>0)sinks++;
   if(filled-height>.001&&height>0)basins++;
   if(height>0&&filled<19&&filled-height>.05){
    const floor=f[o+8];lakeNodes++;
    if(!Number.isFinite(floor)||floor<=0||floor>height+.00001)throw new Error(`Seed ${seed}: invalid basin floor at ${i}: ${floor}/${height}`);
    for(const j of grid.neighbors.subarray(i*8,i*8+8))if(j!==NONE){
     const n=j*12,otherHeight=f[n+1],otherSpill=f[n+5];
     if(otherHeight>0&&otherSpill<19&&otherSpill-otherHeight>.05&&Math.abs(filled-otherSpill)<.001){lakeLinks++;maxLakeFloorGap=Math.max(maxLakeFloorGap,Math.abs(floor-f[n+8]));}
    }
   }
   if(base-height>.001)eroded++;if(deposit>.001)deposited++;maxDepth=Math.max(maxDepth,base-height);maxDeposit=Math.max(maxDeposit,deposit);maxFlow=Math.max(maxFlow,flow);
   if(down!==NONE&&(down>=count||filled<=f[down*12+5]))throw new Error(`Seed ${seed}: non-downhill filled-surface route ${i} -> ${down}`);
   let expected=height>0?rain:0,nearRiver=active(i);for(const j of grid.neighbors.subarray(i*8,i*8+8))if(j!==NONE){if(u[j*12+4]===i)expected+=f[j*12+2];nearRiver||=active(j);}
   if(Boolean(u[flagOffset+i])!==nearRiver)throw new Error(`Seed ${seed}: incorrect river-presence flag at ${i}`);
   maxError=Math.max(maxError,Math.abs(expected-flow));maxPath=Math.max(maxPath,path(i));
   if(active(i)){
    if(faceBits[i]&(faceBits[i]-1))sharedRiverNodes++;
    for(let sample=0;sample<17;sample++){
     const p=pathOffset+(i*17+sample)*4,point=[f[p],f[p+1],f[p+2]],width=f[p+3];
     if(!point.every(Number.isFinite)||!Number.isFinite(width)||width<.0249||width>.2801||Math.abs(Math.hypot(...point)-1)>.00001)throw new Error(`Seed ${seed}: invalid river path ${i}/${sample}`);
     if(sample===0||sample===16){const id=sample===0?i:down,distance=Math.hypot(...point.map((v,k)=>v-grid.directions[id*4+k]));if(distance>.00001)throw new Error(`Seed ${seed}: disconnected river path ${i}/${sample}: ${distance}`);}
    }
   }
  }
  if(land<1000||sea<1000||riverNodes<100||eroded<100||deposited<100||sinks||maxPath>128||maxError>.001||maxLakeFloorGap>.0001)throw new Error(`Seed ${seed}: incomplete drainage, erosion or lake propagation: ${JSON.stringify({land,sea,riverNodes,eroded,deposited,sinks,maxPath,maxError,lakeNodes,lakeLinks,maxLakeFloorGap})}`);
  return {raw,summary:{seed,land,sea,riverNodes,sinks,basins,eroded,deposited,maxFlow,maxDepth,maxDeposit,maxError,maxPath,sharedRiverNodes,lakeNodes,lakeLinks,maxLakeFloorGap}};
 }
 const first=await inspect(918273);renderer.hydrologySeed=null;await renderer.sampleTerrain([1,0,0]);const repeated=new Uint32Array(await read()),original=new Uint32Array(first.raw);
 for(let i=0;i<original.length;i++)if(original[i]!==repeated[i])throw new Error(`World generation was not deterministic at word ${i}`);
 const results=[first.summary];for(const seed of [1,42,0xffffffff])results.push((await inspect(seed)).summary);
 if(errors.length)throw new Error(errors.join('; '));
 const result={ok:true,count,deterministic:true,results};status.textContent=JSON.stringify(result);window.__hydrologySmokeDone=result;
}catch(error){status.textContent=error.stack;window.__hydrologySmokeDone={ok:false,error:error.stack};}

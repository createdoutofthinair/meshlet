import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.GPUBufferUsage={UNIFORM:1,STORAGE:2,COPY_DST:4,COPY_SRC:8,MAP_READ:16,INDIRECT:32};
globalThis.GPUMapMode={READ:1};
Object.defineProperty(globalThis,'navigator',{value:{gpu:{getPreferredCanvasFormat:()=> 'bgra8unorm'}},configurable:true});
const {PlanetRenderer}=await import('../src/planet/renderer.js');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fakeRenderer(){
 const value={pixels:.25,world:.00001},device={},renderPasses=[];
 const buffer=size=>({data:new ArrayBuffer(size),mapAsync:async()=>{},getMappedRange(){return this.data;},unmap(){},destroy(){}});
 device.createBuffer=({size})=>buffer(size);
 device.createCommandEncoder=()=>{
  const ops=[];let pipeline;
  const compute={setPipeline(p){pipeline=p;},setBindGroup(){},dispatchWorkgroups(count){
   if(pipeline?.kind==='transition')ops.push(()=>{const out=new Float32Array(r.transitionErrorBuffer.data);for(let i=0;i<count;i++){out[i*2]=value.pixels;out[i*2+1]=value.world;}});
   if(pipeline?.kind==='cull')ops.push(()=>{new Uint32Array(r.indirect.data)[1]=1;});
  },end(){}};
  const render={setPipeline(){},setBindGroup(){},drawIndirect(){},draw(){},end(){}};
  return {beginComputePass:()=>compute,beginRenderPass:descriptor=>{renderPasses.push(descriptor);return render;},copyBufferToBuffer(a,ao,b,bo,size){ops.push(()=>new Uint8Array(b.data,bo,size).set(new Uint8Array(a.data,ao,size)));},resolveQuerySet(){},finish(){return ops;}};
 };
 device.queue={writeBuffer(target,offset,source){const bytes=source instanceof ArrayBuffer?new Uint8Array(source):new Uint8Array(source.buffer,source.byteOffset,source.byteLength);new Uint8Array(target.data,offset,bytes.length).set(bytes);},submit(commands){for(const command of commands)for(const op of command)op();},onSubmittedWorkDone:async()=>{}};
 const canvas={width:960,height:600},context={getCurrentTexture:()=>({createView:()=>({})})};
 const r=new PlanetRenderer(canvas,{},device,context,false,error=>{throw Error(error);});
 r.resize=()=>{};r.ensureHydrology=()=>{};r.requestSurface=()=>{};r.depth={createView:()=>({})};r.waterDepth={createView:()=>({})};r.budget=120;r.pixelSize=14;r.lastSample=Infinity;
 for(const key of ['uniform','oceanView','patchBuffer','vertices','queueBuffer','normalQueueBuffer','activeBuffer','indirect','lodErrorBuffer','transitionPairsBuffer','transitionErrorBuffer']){
  const size={uniform:224,oceanView:80,patchBuffer:1024*128,vertices:1024*441*48,queueBuffer:1024*4,normalQueueBuffer:1024*4,activeBuffer:1024*4,indirect:16,lodErrorBuffer:1024*4,transitionPairsBuffer:1024*32,transitionErrorBuffer:1024*8}[key];r[key]=buffer(size);
 }
 for(const key of ['generate','normal','bounds','cull','lodError','transition','riverDetail']){r[key+'Pipe']={kind:key};r[key+'Bind']={};}
 r.renderPipe={};r.renderBind={};r.oceanPipe={};r.oceanBind={};return {r,value,renderPasses};
}

test('water reads terrain depth in a separate render pass',async()=>{
 const {r,renderPasses}=fakeRenderer();r.frame(1000);await flush();assert.equal(renderPasses.length,2);
 assert.equal(renderPasses[0].colorAttachments.length,2);assert.equal(renderPasses[0].depthStencilAttachment.depthStoreOp,'store');
 assert.equal(renderPasses[1].colorAttachments.length,1);assert.equal(renderPasses[1].colorAttachments[0].loadOp,'load');assert.equal(renderPasses[1].depthStencilAttachment.depthLoadOp,'load');
 renderPasses.length=0;r.wireframe=true;r.frame(1200);await flush();assert.equal(renderPasses.length,1);
 renderPasses.length=0;r.wireframe=false;r.meshletLines=true;r.meshletColors=true;r.debugOpacity=.4;r.frame(1400);await flush();assert.equal(renderPasses.length,1);
 const bits=new Uint32Array(r.uniform.data)[47];assert.ok(bits&256);assert.ok(bits&128);assert.equal(bits&32,0);assert.ok(Math.abs(new Float32Array(r.uniform.data)[55]-.4)<.0001);
});

test('renderer prepares new geometry before swapping and keeps coverage while measuring',async()=>{
 const {r,value}=fakeRenderer();r.frame(1000);await flush();const initial=r.patches.map(p=>p.key);assert.ok(initial.length);
 r.cameraState.altitude=500;r.needsSelection=true;r.frame(1200);await flush();assert.ok(r.stage);assert.deepEqual(r.patches.map(p=>p.key),initial);
 let previousTodo=r.stage.todo.length;let now=1350;
 for(let i=0;i<100&&r.stage;i++,now+=150){
  if(r.stage.state==='building')assert.ok(r.stage.todo.length<=previousTodo);
  previousTodo=r.stage.todo.length;r.frame(now);await flush();
 }
 assert.equal(r.stage,null);assert.notDeepEqual(r.patches.map(p=>p.key),initial);assert.equal(r.transition.overTarget,false);assert.ok(Math.abs(r.transition.pixels-value.pixels)<1e-5);
 assert.equal(r.free.length,1024-r.patches.length);assert.equal(new Set(r.free).size,r.free.length);
});

test('an excessive coarsening difference holds old geometry until it becomes subpixel',async()=>{
 const {r,value}=fakeRenderer();r.frame(1000);await flush();r.cameraState.altitude=500;r.needsSelection=true;
 for(let i=0;i<100;i++){r.frame(1200+i*150);await flush();if(!r.stage)break;}
 const before=r.patches.map(p=>p.key);value.pixels=2;r.cameraState.altitude=900;r.needsSelection=true;r.lastSelection=0;r.frame(20000);await flush();
 assert.ok(r.stage);r.stage.uncovered=false;r.stage.hasRefinement=false;
 for(let i=0;i<100&&!r.transition.waiting;i++){r.frame(20150+i*150);await flush();}
 assert.equal(r.transition.waiting,true);assert.deepEqual(r.patches.map(p=>p.key),before);
 value.pixels=.1;
 for(let i=0;i<100&&r.stage;i++){r.frame(40000+i*250);await flush();}
 assert.equal(r.stage,null);assert.ok(r.transition.pixels<.5);assert.notDeepEqual(r.patches.map(p=>p.key),before);
});

test('an above-target merge cannot indefinitely prevent a requested refinement',async()=>{
 const {r,value}=fakeRenderer();r.frame(1000);await flush();r.cameraState.altitude=500;r.needsSelection=true;
 for(let i=0;i<100;i++){r.frame(1200+i*150);await flush();if(!r.stage)break;}
 value.pixels=2;r.cameraState.altitude=900;r.needsSelection=true;r.lastSelection=0;r.frame(20000);await flush();
 assert.ok(r.stage);r.stage.uncovered=false;r.stage.hasRefinement=true;let sawWaiting=false;
 for(let i=0;i<100&&r.stage;i++){r.frame(20150+i*250);await flush();sawWaiting||=r.transition.waiting;}
 assert.ok(sawWaiting);assert.equal(r.stage,null);assert.equal(r.transition.overTarget,true);
});


test('GPU render timing covers the cloud pass and disabled clouds retain sky',async()=>{
 const {r,renderPasses}=fakeRenderer();r.timing=true;r.queries={};r.resolve=r.device.createBuffer({size:32});r.cloudPipe={};r.cloudBind={};r.cloudUniform=r.device.createBuffer({size:176});r.clouds=false;r.lastSample=0;
 r.frame(1000);await flush();assert.equal(renderPasses.length,3);
 assert.equal(renderPasses[0].timestampWrites.beginningOfPassWriteIndex,2);assert.equal(renderPasses[1].timestampWrites,undefined);assert.equal(renderPasses[2].timestampWrites.endOfPassWriteIndex,3);assert.equal(renderPasses[1].depthStencilAttachment.depthStoreOp,'store','final ocean depth is retained for atmospheric compositing');
 assert.equal(new Float32Array(r.cloudUniform.data)[7],0);
});

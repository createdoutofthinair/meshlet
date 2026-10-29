import test from 'node:test';
import assert from 'node:assert/strict';
Object.defineProperty(globalThis,'navigator',{value:{gpu:{getPreferredCanvasFormat:()=> 'bgra8unorm'}},configurable:true});
const {RiverRenderer,WATER_ALONG,WATER_ACROSS,RIVER_ROCKS}=await import('../src/river/renderer.js');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
 const operations=[],device={};
 device.queue={writeBuffer(buffer,offset,data){new Uint8Array(buffer.data,offset,data.byteLength).set(new Uint8Array(data.buffer||data,data.byteOffset||0,data.byteLength));},submit(){},onSubmittedWorkDone:async()=>{}};
 device.createCommandEncoder=()=>({beginComputePass(){return {setPipeline(p){operations.push(['compute',p]);},setBindGroup(){},dispatchWorkgroups(n){operations.push(['dispatch',n]);},end(){}};},beginRenderPass(descriptor){operations.push(['pass',descriptor]);return {setPipeline(p){operations.push(['render',p]);},setBindGroup(){},setIndexBuffer(){},draw(n,instances){operations.push(['draw',n,instances]);},drawIndexed(n){operations.push(['drawIndexed',n]);},end(){}};},finish(){return {};}});
 const canvas={width:800,height:500},context={getCurrentTexture:()=>({createView:()=>({})})},r=new RiverRenderer(canvas,{},device,context,()=>{});
 const texture=()=>({createView:()=>({})});
 Object.assign(r,{ready:true,dirty:true,frameBuffer:{data:new ArrayBuffer(224)},reflectionFrame:{data:new ArrayBuffer(224)},depthTexture:texture(),sceneTexture:texture(),reflectionTexture:texture(),reflectionDepth:texture(),geometryPipes:['bankCompute','waterCompute','rockCompute'],geometryBinds:[{},{},{}],flowPipe:'flowCompute',flowBind:{},skyPipe:'sky',skyBinds:[{},{}],compositePipe:'composite',compositeBind:{},volumePipe:'volumeRender',volumeBind:{},sprayPipe:'sprayRender',sprayBind:{},renderPipes:['bankRender','waterRender','reflectionRender','rockRender','rockReflectionRender'],renderBinds:[{},{},{},{},{}],indices:[{},{}]});
 r.resize=()=>{};return {r,operations};
}
test('GPU frame builds separate bank and water meshes and advances only unpaused water',async()=>{
 const {r,operations}=harness();assert.equal(r.frame(1000),true);await flush();
 assert.deepEqual(operations.filter(x=>x[0]==='compute').map(x=>x[1]),['bankCompute','waterCompute','rockCompute','flowCompute']);
 assert.deepEqual(operations.filter(x=>x[0]==='drawIndexed').map(x=>x[1]),[192*192*6,192*192*6,WATER_ALONG*WATER_ACROSS*6]);
 assert.deepEqual(operations.filter(x=>x[0]==='render').map(x=>x[1]),['sky','bankRender','rockRender','sky','reflectionRender','rockReflectionRender','composite','waterRender']);
 assert.equal(operations.filter(x=>x[0]==='draw'&&x[2]===RIVER_ROCKS).length,2,'GPU rocks appear in the scene and its reflection');
 const passes=operations.filter(x=>x[0]==='pass').map(x=>x[1]);assert.equal(passes[0].depthStencilAttachment.depthStoreOp,'store');
 assert.equal(passes[2].depthStencilAttachment.depthReadOnly,true);assert.equal(passes[2].depthStencilAttachment.depthLoadOp,undefined);assert.equal(passes[2].depthStencilAttachment.depthStoreOp,undefined);
 operations.length=0;r.showFlow=true;assert.equal(r.frame(1016),true);await flush();
 assert.deepEqual(operations.filter(x=>x[0]==='compute').map(x=>x[1]),['flowCompute']);
 let frame=new Float32Array(r.frameBuffer.data);assert.ok(Math.abs(frame[19]-.016)<1e-6);assert.equal(frame[31],1);
 assert.equal(r.frame(1516),true);await flush();frame=new Float32Array(r.frameBuffer.data);assert.ok(Math.abs(frame[19]-.5)<1e-6,'slow frames still advance the correct elapsed time');
 r.paused=true;r.dirty=true;assert.equal(r.frame(1532),true);await flush();frame=new Float32Array(r.frameBuffer.data);assert.equal(frame[19],0);
 assert.equal(operations.filter(x=>x[0]==='compute'&&x[1]==='bankCompute').length,1);
});

test('waterfall draws its ray-marched volume and spray only when enabled',async()=>{
 const {r,operations}=harness();r.waterfall=true;assert.equal(r.frame(1000),true);await flush();
 assert.deepEqual(operations.filter(x=>x[0]==='render').slice(-3).map(x=>x[1]),['waterRender','volumeRender','sprayRender']);
 assert.ok(operations.some(x=>x[0]==='render'&&x[1]==='volumeRender'));assert.ok(operations.some(x=>x[0]==='draw'&&x[1]===6&&x[2]===1536));
 operations.length=0;r.spray=0;assert.equal(r.frame(1016),true);await flush();assert.ok(!operations.some(x=>x[0]==='render'&&x[1]==='sprayRender'));
});

test('reflection quality recreates and rebinds appropriately sized GPU targets',()=>{
 globalThis.window={devicePixelRatio:1};globalThis.GPUTextureUsage={RENDER_ATTACHMENT:1,TEXTURE_BINDING:2,COPY_SRC:4};
 const created=[],groups=[],device={limits:{maxTextureDimension2D:4096},createTexture(descriptor){const texture={descriptor,destroyed:false,destroy(){this.destroyed=true;},createView(){return {texture:this};}};created.push(texture);return texture;},createBindGroup(descriptor){groups.push(descriptor);return descriptor;}};
 const canvas={width:0,height:0,getBoundingClientRect:()=>({width:800,height:500})},r=new RiverRenderer(canvas,{},device,{},()=>{});
 const pipe={getBindGroupLayout:()=>({})};Object.assign(r,{compositePipe:pipe,volumePipe:pipe,renderPipes:[null,pipe],renderBinds:[],frameBuffer:{},reach:{},vertices:[{},{}],motion:{},rocks:{},sceneSampler:{}});
 r.resize();assert.deepEqual(r.reflectionTexture.descriptor.size,[400,250]);assert.equal(created.length,4);assert.equal(groups.length,3);
 const previous=created.slice();r.reflectionScale=1;r.resize();assert.deepEqual(r.reflectionTexture.descriptor.size,[800,500]);assert.ok(previous.every(t=>t.destroyed));assert.equal(groups.length,6);
 r.resize();assert.equal(created.length,8,'unchanged dimensions and quality reuse existing textures');
});

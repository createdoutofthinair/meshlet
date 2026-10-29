import test from 'node:test';
import assert from 'node:assert/strict';
Object.defineProperty(globalThis,'navigator',{value:{gpu:{getPreferredCanvasFormat:()=> 'bgra8unorm'}},configurable:true});
const {RiverRenderer}=await import('../src/river/renderer.js');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
 const operations=[],device={};
 device.queue={writeBuffer(buffer,offset,data){new Uint8Array(buffer.data,offset,data.byteLength).set(new Uint8Array(data.buffer||data,data.byteOffset||0,data.byteLength));},submit(){},onSubmittedWorkDone:async()=>{}};
 device.createCommandEncoder=()=>({beginComputePass(){return {setPipeline(p){operations.push(['compute',p]);},setBindGroup(){},dispatchWorkgroups(n){operations.push(['dispatch',n]);},end(){}};},beginRenderPass(){return {setPipeline(p){operations.push(['render',p]);},setBindGroup(){},setIndexBuffer(){},draw(n){operations.push(['draw',n]);},drawIndexed(n){operations.push(['drawIndexed',n]);},end(){}};},finish(){return {};}});
 const canvas={width:800,height:500},context={getCurrentTexture:()=>({createView:()=>({})})},r=new RiverRenderer(canvas,{},device,context,()=>{});
 Object.assign(r,{ready:true,dirty:true,frameBuffer:{data:new ArrayBuffer(144)},depthTexture:{createView:()=>({})},geometryPipes:['bankCompute','waterCompute'],geometryBinds:[{},{}],flowPipe:'flowCompute',flowBind:{},skyPipe:'sky',renderPipes:['bankRender','waterRender'],renderBinds:[{},{}],indices:[{},{}]});
 r.resize=()=>{};return {r,operations};
}
test('GPU frame builds separate bank and water meshes and advances only unpaused water',async()=>{
 const {r,operations}=harness();assert.equal(r.frame(1000),true);await flush();
 assert.deepEqual(operations.filter(x=>x[0]==='compute').map(x=>x[1]),['bankCompute','waterCompute','flowCompute']);
 assert.deepEqual(operations.filter(x=>x[0]==='drawIndexed').map(x=>x[1]),[192*192*6,192*48*6]);
 operations.length=0;r.showFlow=true;assert.equal(r.frame(1016),true);await flush();
 assert.deepEqual(operations.filter(x=>x[0]==='compute').map(x=>x[1]),['flowCompute']);
 let frame=new Float32Array(r.frameBuffer.data);assert.ok(Math.abs(frame[19]-.016)<1e-6);assert.equal(frame[31],1);
 r.paused=true;r.dirty=true;assert.equal(r.frame(1032),true);await flush();frame=new Float32Array(r.frameBuffer.data);assert.equal(frame[19],0);
 assert.equal(operations.filter(x=>x[0]==='compute'&&x[1]==='bankCompute').length,1);
});

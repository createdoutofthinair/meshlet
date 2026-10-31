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
 r.morphBuffer=buffer(17*1024*1024);
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

test('an unsupported coarsening difference holds old geometry until it becomes subpixel',async()=>{
 const {r,value}=fakeRenderer();r.frame(1000);await flush();r.cameraState.altitude=500;r.needsSelection=true;
 for(let i=0;i<100;i++){r.frame(1200+i*150);await flush();if(!r.stage)break;}
 const before=r.patches.map(p=>p.key);value.pixels=2;r.cameraState.altitude=900;r.needsSelection=true;r.lastSelection=0;r.frame(20000);await flush();
 assert.ok(r.stage);r.stage.uncovered=false;r.stage.hasRefinement=false;for(const c of r.stage.components)c.deferredReasons.push('unsupported-test-topology');
 for(let i=0;i<100&&!r.transition.waiting;i++){r.frame(20150+i*150);await flush();}
 assert.equal(r.transition.waiting,true);assert.deepEqual(r.patches.map(p=>p.key),before);
 value.pixels=.1;
 for(let i=0;i<100&&r.stage;i++){r.frame(40000+i*250);await flush();}
 assert.equal(r.stage,null);assert.ok(r.transition.pixels<.5);assert.notDeepEqual(r.patches.map(p=>p.key),before);
});

test('an unsupported above-target mixed transition never commits through a timeout',async()=>{
 const {r,value}=fakeRenderer();r.frame(1000);await flush();r.cameraState.altitude=500;r.needsSelection=true;
 for(let i=0;i<100;i++){r.frame(1200+i*150);await flush();if(!r.stage)break;}
 value.pixels=2;r.cameraState.altitude=900;r.needsSelection=true;r.lastSelection=0;r.frame(20000);await flush();
 assert.ok(r.stage);r.stage.uncovered=false;r.stage.hasRefinement=true;for(const c of r.stage.components)c.deferredReasons.push('unsupported-test-topology');let sawWaiting=false;
 for(let i=0;i<100&&r.stage;i++){r.frame(20150+i*250);await flush();sawWaiting||=r.transition.waiting;}
 assert.ok(sawWaiting);assert.ok(r.stage);assert.equal(r.transition.overTarget,true);
});


test('GPU render timing covers the cloud pass and disabled clouds retain sky',async()=>{
 const {r,renderPasses}=fakeRenderer();r.timing=true;r.queries={};r.resolve=r.device.createBuffer({size:64});r.cloudPipe={};r.cloudBind={};r.cloudUniform=r.device.createBuffer({size:192});r.clouds=false;r.lastSample=0;
 r.frame(1000);await flush();assert.equal(renderPasses.length,3);
 assert.equal(renderPasses[0].timestampWrites.beginningOfPassWriteIndex,2);assert.equal(renderPasses[0].timestampWrites.endOfPassWriteIndex,3);assert.equal(renderPasses[1].timestampWrites.beginningOfPassWriteIndex,4);assert.equal(renderPasses[2].timestampWrites.endOfPassWriteIndex,7);assert.equal(renderPasses[1].depthStencilAttachment.depthStoreOp,'store','final ocean depth is retained for atmospheric compositing');
 assert.equal(new Float32Array(r.cloudUniform.data)[7],0);
});

test('surface readback is discarded when displayed patch selection changes',async()=>{
 const {r}=fakeRenderer();r.frame(1000);await flush();
 const patch=r.patches[0];const direction=patch.direction;
 r.walkProbeInput=r.device.createBuffer({size:48});r.walkProbeResult=r.device.createBuffer({size:16});r.walkProbePipe={};r.walkProbeBind={};
 let release;const ready=new Promise(resolve=>{release=resolve;});
 const create=r.device.createBuffer;
 r.device.createBuffer=options=>{const b=create(options);b.mapAsync=()=>ready;new Float32Array(b.data).set([4,1,0,0]);return b;};
 // Avoid overwriting the fake readback contents during the copy.
 const encoder=r.device.createCommandEncoder;
 r.device.createCommandEncoder=()=>{const e=encoder();e.copyBufferToBuffer=()=>{};return e;};
 const pending=r.sampleRenderedSurface(direction);r.surfaceRevision++;release();
 assert.equal(await pending,null);
});

test('morph upload changes the surface revision and rejects nonresident parents',async()=>{
 const {r}=fakeRenderer();r.frame(1000);await flush();
 r.morphBuffer=r.device.createBuffer({size:1024*32});
 const [fine,coarse]=r.patches;
 const pair={fine,coarse,originX:0,originY:0,scale:.5};
 const before=r.surfaceRevision;r.uploadMorphs([{pair,factor:.4}]);
 assert.equal(r.surfaceRevision,before+1);
 const words=new Uint32Array(r.morphBuffer.data);assert.equal(words[fine.slot*8+3],1);
 const revision=r.surfaceRevision;
 assert.throws(()=>r.uploadMorphs([{pair:{...pair,coarse:{...coarse,slot:1023}},factor:0}]),/nonresident/);
 assert.equal(r.surfaceRevision,revision);
 r.uploadMorphs([]);assert.ok(new Uint32Array(r.morphBuffer.data).every(v=>v===0));
});

async function preparedRefinement(){
 const {makeTile}=await import('../src/planet/planet-math.js');
 const {transitionPairs,transitionGroups,coordinateTransitions}=await import('../src/planet/patch-transition.js');
 const {planetCamera}=await import('../src/planet/camera.js');
 const {r}=fakeRenderer();r.frame(1000);await flush();r.morphBuffer=r.device.createBuffer({size:1024*32});
 const parent=r.patches.find(p=>p.stitch===0);assert.ok(parent);
 const children=[0,1,2,3].map(i=>({...makeTile(parent.face,parent.level+1,parent.x*2+i%2,parent.y*2+(i>>1)),slot:r.free.pop(),stitch:0,normalStitch:0,edgeKeys:[null,null,null,null],cornerKeys:[[],[],[],[]]}));
 const nodes=[...r.patches.filter(p=>p!==parent),...children],slots=new Map(nodes.map(p=>[p.key,p.slot]));
 const groups=transitionGroups(r.patches,nodes),pairs=transitionPairs(r.patches,nodes).map(p=>({...p,refining:true}));
 r.stage={nodes,slots,groups,pairs,components:coordinateTransitions(r.patches,nodes),uncovered:false,newNodes:children,normalPending:[],todo:[],signatures:new Map(),result:{leaves:nodes,splits:new Set(),deepest:parent.level+1},selectionMs:0,state:'ready',generation:r.generation,maxRefine:.25,maxMerge:0};
 return {r,parent,children,camera:planetCamera(r.cameraState,960,600)};
}

test('refinement draws a shared spatial factor and retains its parent through completion',async()=>{
 const {r,parent,camera}=await preparedRefinement();assert.equal(r.beginTransition(camera),true);
 const m=r.stage.morph;assert.equal(m.factor,0);assert.ok(!r.free.includes(parent.slot));
 const atDistance=d=>({...camera,eye:camera.eye.map((v,i)=>m.anchor[i]+(v-m.anchor[i])*d/m.distance)});
 r.advanceTransition(camera,2000);assert.equal(m.factor,0,'elapsed time alone cannot morph terrain');
 r.advanceTransition(atDistance(m.distance-m.band*.5),2100);assert.ok(Math.abs(m.factor-.5)<1e-8);
 const data=new Float32Array(r.morphBuffer.data);
 for(const p of r.stage.pairs)assert.ok(Math.abs(data[p.fine.slot*8+7]-.5)<1e-6);
 assert.throws(()=>r.cancelStage(),/intermediate/);assert.throws(()=>r.commitStage(2200),/intermediate/);
 r.surfaceReads=1;r.advanceTransition(atDistance(m.distance-m.band*2),2300);assert.ok(Math.abs(m.factor-.5)<1e-8);
 r.surfaceReads=0;r.advanceTransition(atDistance(m.distance-m.band*2),2400);assert.equal(r.stage,null);
 assert.ok(!r.free.includes(parent.slot),'parent is held until the GPU fence completes');await flush();assert.ok(r.free.includes(parent.slot));
});

test('camera reversal returns to the old surface before cancelling the refinement',async()=>{
 const {r,camera}=await preparedRefinement(),old=r.patches;r.beginTransition(camera);const m=r.stage.morph;
 const atDistance=d=>({...camera,eye:camera.eye.map((v,i)=>m.anchor[i]+(v-m.anchor[i])*d/m.distance)});
 r.advanceTransition(atDistance(m.distance-m.band*.4),2000);assert.ok(m.factor>0);
 r.advanceTransition(atDistance(m.distance+m.band*.1),2100);assert.equal(r.stage,null);assert.equal(r.patches,old);
 assert.ok(new Uint32Array(r.morphBuffer.data).every(x=>x===0));await flush();
 assert.equal(r.free.length,1024-r.patches.length);
});

async function preparedMerge(){
 const {r,parent,children,camera}=await preparedRefinement();
 const {transitionPairs,transitionGroups,coordinateTransitions}=await import('../src/planet/patch-transition.js');
 const target=r.patches,previous=r.stage.nodes;r.patches=previous;r.slotByKey=new Map(previous.map(p=>[p.key,p.slot]));
 Object.assign(r.stage,{nodes:target,slots:new Map(target.map(p=>[p.key,p.slot])),newNodes:[parent],groups:transitionGroups(previous,target),pairs:transitionPairs(previous,target).map(p=>({...p,refining:false})),components:coordinateTransitions(previous,target),maxRefine:0,maxMerge:.25});
 return {r,parent,children,camera};
}

test('merge keeps fine children drawn until they coincide with the target parent',async()=>{
 const {r,parent,children,camera}=await preparedMerge();assert.ok(r.beginTransition(camera));const m=r.stage.morph;
 assert.equal(m.approaching,false);assert.ok(!r.stage.drawNodes.some(p=>p.key===parent.key));
 assert.ok(children.every(c=>r.stage.drawNodes.some(p=>p.key===c.key)));
 const atDistance=d=>({...camera,eye:camera.eye.map((v,i)=>m.anchor[i]+(v-m.anchor[i])*d/m.distance)});
 const factors=()=>children.map(c=>new Float32Array(r.morphBuffer.data)[c.slot*8+7]);
 assert.deepEqual(factors(),[1,1,1,1]);
 r.advanceTransition(atDistance(m.distance+m.band*.5),2000);for(const f of factors())assert.ok(Math.abs(f-.5)<1e-6);
 r.advanceTransition(atDistance(m.distance+m.band*2),2100);assert.equal(r.stage,null);
 assert.ok(r.patches.some(p=>p.key===parent.key));assert.ok(children.every(c=>!r.free.includes(c.slot)));
 await flush();assert.ok(children.every(c=>r.free.includes(c.slot)));assert.equal(r.free.length,1024-r.patches.length);
});

test('merge reversal restores the original fine surface',async()=>{
 const {r,camera}=await preparedMerge(),old=r.patches;r.beginTransition(camera);const m=r.stage.morph;
 const atDistance=d=>({...camera,eye:camera.eye.map((v,i)=>m.anchor[i]+(v-m.anchor[i])*d/m.distance)});
 r.advanceTransition(atDistance(m.distance+m.band*.5),2000);assert.ok(m.factor>0);
 r.advanceTransition(atDistance(m.distance-m.band*.1),2100);assert.equal(r.stage,null);assert.equal(r.patches,old);
 await flush();assert.equal(r.free.length,1024-r.patches.length);
});

test('mixed progress uses complementary fine factors for splits and merges',async()=>{
 const {r}=fakeRenderer();
 const groups=[{type:'refine',pairs:[{fine:{slot:4}}]},{type:'merge',pairs:[{fine:{slot:8}}]}];
 for(const t of [0,.25,.5,.75,1]){
  const entries=r.transitionEntries({groups},t);assert.equal(entries[0].factor,t);assert.equal(entries[1].factor,1-t);
 }
});

test('mixed split and merge draws each region once and commits both atomically',async()=>{
 const {r,parent,camera}=await preparedRefinement();
 const {makeTile}=await import('../src/planet/planet-math.js');
 const {transitionPairs,transitionGroups,coordinateTransitions}=await import('../src/planet/patch-transition.js');
 const other=r.patches.find(p=>p.key!==parent.key&&p.stitch===0);assert.ok(other);
 const fine=[0,1,2,3].map(i=>({...makeTile(other.face,other.level+1,other.x*2+i%2,other.y*2+(i>>1)),slot:r.free.pop(),stitch:0,normalStitch:0,edgeKeys:[null,null,null,null],cornerKeys:[[],[],[],[]]}));
 r.patches=[...r.patches.filter(p=>p!==other),...fine];r.slotByKey=new Map(r.patches.map(p=>[p.key,p.slot]));
 r.stage.newNodes.push(other);r.stage.groups=transitionGroups(r.patches,r.stage.nodes);r.stage.components=coordinateTransitions(r.patches,r.stage.nodes);r.stage.pairs=transitionPairs(r.patches,r.stage.nodes);
 assert.ok(r.beginTransition(camera));const m=r.stage.morph;assert.equal(m.approaching,true);
 const draw=r.stage.drawNodes;assert.ok(!draw.some(p=>p.key===parent.key||p.key===other.key));
 assert.equal(new Set(draw.map(p=>p.key)).size,draw.length);
 assert.ok(fine.every(c=>draw.some(p=>p.key===c.key)));
 const target=new Set(r.stage.nodes.map(p=>p.key));
 const close={...camera,eye:camera.eye.map((v,i)=>m.anchor[i]+(v-m.anchor[i])*(m.distance-2*m.band)/m.distance)};
 r.advanceTransition(close,2000);assert.equal(r.stage,null);assert.deepEqual(new Set(r.patches.map(p=>p.key)),target);
 await flush();assert.equal(r.free.length,1024-r.patches.length);assert.equal(new Set(r.free).size,r.free.length);
});

test('retained stitch changes use one common mesh and one morph record per slot',async()=>{
 const {r}=fakeRenderer();r.frame(1000);await flush();
 const {MORPH_BUFFER_BYTES,MORPH_RANGE_OFFSET}=await import('../src/planet/transition-upload.js');
 const {transitionPairs,transitionGroups,coordinateTransitions}=await import('../src/planet/patch-transition.js');
 const {planetCamera}=await import('../src/planet/camera.js');
 r.morphBuffer=r.device.createBuffer({size:MORPH_BUFFER_BYTES});
 const original=r.patches[0];r.patches=r.patches.map(p=>p===original?{...p,stitch:1}:p);
 const next=r.patches.map(p=>p.key===original.key?{...p,stitch:2}:p),groups=transitionGroups(r.patches,next);
 r.stage={nodes:next,slots:new Map(r.slotByKey),signatures:new Map(),newNodes:[],normalPending:[],todo:[],groups,pairs:transitionPairs(r.patches,next),components:coordinateTransitions(r.patches,next),result:{leaves:next,splits:new Set(),deepest:original.level},selectionMs:0,generation:r.generation,state:'ready',maxRefine:.25,maxMerge:.25,uncovered:false};
 const camera=planetCamera(r.cameraState,960,600);assert.ok(r.beginTransition(camera));
 assert.equal(r.transitionEntries(r.stage,0).length,1);assert.ok(r.topologySlots.has(original.slot));
 const words=new Uint32Array(r.morphBuffer.data);assert.equal(words[original.slot*8],original.slot);
 assert.equal(words[original.slot*8+1],1);assert.equal(words[original.slot*8+2],2|16);
 const ranges=new Uint32Array(r.morphBuffer.data,MORPH_RANGE_OFFSET,1024*16*2);
 let vertices=0;for(let i=0;i<16;i++)vertices+=ranges[(original.slot*16+i)*2+1];assert.ok(vertices>0);
 const m=r.stage.morph,close={...camera,eye:camera.eye.map((v,i)=>m.anchor[i]+(v-m.anchor[i])*(m.distance-2*m.band)/m.distance)};
 r.advanceTransition(close,2000);assert.equal(r.stage,null);assert.equal(r.patches.find(p=>p.key===original.key).stitch,2);
 assert.equal(r.morphVertexCount,96);assert.equal(r.topologySlots,null);
});

test('actual camera-driven selection starts a complete resident morph without missing children',async()=>{
 const {r,value}=fakeRenderer();r.frame(1000);await flush();
 assert.equal(r.patches.length,r.coveringLeaves.length);assert.ok(r.patches.length<=r.budget);
 value.pixels=3;r.cameraState.altitude=500;r.needsSelection=true;r.frame(1200);await flush();
 for(let i=0;i<100&&r.stage?.state!=='transitioning';i++){r.frame(1400+i*150);await flush();}
 assert.equal(r.stage?.state,'transitioning');assert.equal(r.stage.uncovered,false);
 assert.ok(r.stage.components.every(c=>!c.deferredReasons.includes('incomplete-children')));
 const slots=[...new Uint32Array(r.activeBuffer.data,0,r.stage.drawNodes.length)];
 assert.deepEqual(slots,r.stage.drawNodes.map(p=>p.slot));assert.equal(new Set(slots).size,slots.length);
 for(const group of r.stage.groups)for(const slot of group.slots)assert.ok(!r.free.includes(slot));
});

test('quality, viewport and mode changes cancel only at the original morph endpoint',async()=>{
 const changes=[r=>{r.budget--;},r=>{r.pixelSize++;},r=>{r.maxDepth--;},(r,c)=>{c.width++;},(r,c)=>{c.height++;},r=>{r.cameraState.mode='walk';}];
 for(const change of changes){
  const {r,camera}=await preparedRefinement();r.beginTransition(camera);const old=r.patches;
  change(r,camera);r.invalidateSelection(camera);
  assert.equal(r.stage,null);assert.equal(r.patches,old);assert.equal(r.needsSelection,true);
  await flush();assert.equal(new Set(r.free).size,1024-r.patches.length);
 }
});

test('settings changes preserve intermediate geometry and reselect after reversal',async()=>{
 const {r,camera}=await preparedRefinement();r.beginTransition(camera);const stage=r.stage,m=stage.morph;
 const atDistance=d=>({...camera,eye:camera.eye.map((v,i)=>m.anchor[i]+(v-m.anchor[i])*d/m.distance)});
 const halfway=atDistance(m.distance-m.band*.5);r.advanceTransition(halfway,2000);
 const before=r.morphBuffer.data.slice(0);r.maxDepth--;r.budget--;r.pixelSize++;camera.width++;r.cameraState.mode='walk';
 r.invalidateSelection(camera);assert.equal(r.stage,stage);assert.equal(r.transition.reselectionPending,true);
 assert.deepEqual(r.morphBuffer.data,before,'settings do not rewrite intermediate morph geometry');
 r.advanceTransition(halfway,900000);assert.deepEqual(r.morphBuffer.data,before,'elapsed time does not complete the deferred morph');
 r.advanceTransition(atDistance(m.distance+m.band*.1),900100);
 assert.equal(r.stage,null);assert.equal(r.transition.reselectionPending,false);assert.equal(r.needsSelection,true);
 await flush();assert.equal(r.free.length,1024-r.patches.length);
});

test('pending rendered probes prevent settings cancellation even at endpoint zero',async()=>{
 const {r,camera}=await preparedRefinement();r.beginTransition(camera);const stage=r.stage;
 r.surfaceReads=1;r.maxDepth--;r.invalidateSelection(camera);
 assert.equal(r.stage,stage);assert.equal(r.transition.reselectionPending,true);
 r.surfaceReads=0;r.invalidateSelection(camera);assert.equal(r.stage,null);await flush();
});

test('max depth changes invalidate staged geometry before it becomes visible',async()=>{
 const {r,camera}=await preparedRefinement();r.stage.state='building';const old=r.patches;
 r.maxDepth--;r.invalidateSelection(camera);assert.equal(r.stage,null);assert.equal(r.patches,old);
 await flush();assert.equal(r.free.length,1024-r.patches.length);
});

test('terrain reset invalidates an active morph and ignores its previous retirement fence',async()=>{
 const {r,camera}=await preparedRefinement();r.beginTransition(camera);const m=r.stage.morph;
 r.advanceTransition({...camera,eye:camera.eye.map((v,i)=>m.anchor[i]+(v-m.anchor[i])*(m.distance-m.band*.5)/m.distance)},2000);
 let finish;const done=new Promise(resolve=>{finish=resolve;});r.device.queue.onSubmittedWorkDone=()=>done;
 const spare=r.free.pop();r.retireSlots([spare]);const generation=r.generation;
 r.resetPatchCache();assert.equal(r.stage,null);assert.equal(r.generation,generation+1);assert.equal(r.lastFrameEye,null);
 assert.equal(r.coveringLeaves,null);assert.equal(r.selectionState,null);assert.equal(r.previousSplits,null);
 assert.ok(new Uint32Array(r.morphBuffer.data).every(x=>x===0));
 finish();await flush();assert.equal(r.free.length,1024);assert.equal(new Set(r.free).size,1024);
});

test('device loss rejects pending probe results and stops further GPU submissions',async()=>{
 const {r,camera}=await preparedRefinement();r.beginTransition(camera);
 r.walkProbeInput=r.device.createBuffer({size:48});r.walkProbeResult=r.device.createBuffer({size:16});r.walkProbePipe={};r.walkProbeBind={};
 new Float32Array(r.walkProbeResult.data).set([4,1,0,0]);
 let reject;const ready=new Promise((resolve,no)=>{reject=no;});const create=r.device.createBuffer;
 r.device.createBuffer=options=>{const b=create(options);b.mapAsync=()=>ready;return b;};
 const pending=r.sampleRenderedSurface(r.patches[0].direction);assert.equal(r.surfaceReads,1);
 const errors=[];r.onError=e=>errors.push(e);
 r.device.queue.writeBuffer=()=>{throw Error('write after loss');};r.device.queue.submit=()=>{throw Error('submit after loss');};
 const generation=r.generation;r.handleDeviceLoss({reason:'destroyed'});r.handleDeviceLoss({reason:'destroyed'});
 assert.equal(r.generation,generation+1);assert.equal(r.stage,null);assert.equal(errors.length,1);
 reject(Error('device lost'));assert.equal(await pending,null);assert.equal(r.surfaceReads,0);
 assert.equal(r.frame(3000),null);assert.equal(await r.sampleRenderedSurface([1,0,0]),null);
 await assert.rejects(r.sampleTerrain([1,0,0]),/device is lost/);r.invalidateTerrain();
});

test('analytic terrain readback cannot return values from a reset world',async()=>{
 const {r}=fakeRenderer();r.probeInput=r.device.createBuffer({size:16});r.sampleBuffer=r.device.createBuffer({size:16});
 r.pointPipe={};r.pointBind={};let release;const ready=new Promise(resolve=>{release=resolve;});const create=r.device.createBuffer;
 r.device.createBuffer=options=>{const b=create(options);b.mapAsync=()=>ready;return b;};
 const pending=r.sampleTerrain([1,0,0]);r.resetPatchCache();release();assert.equal(await pending,null);
});

test('GPU remeasurement refreshes an active morph without restarting its progress',async()=>{
 const {r,camera}=await preparedRefinement();r.stage.maxRefine=8;r.beginTransition(camera);const stage=r.stage,m=stage.morph;
 const moved={...camera,eye:camera.eye.map((v,i)=>m.anchor[i]+(v-m.anchor[i])*(m.distance-m.band*2)/m.distance)};
 r.advanceTransition(moved,2000);assert.ok(Math.abs(m.factor-.0625)<1e-8);
 const before=r.morphBuffer.data.slice(0);r.advanceTransition(moved,900000);assert.deepEqual(r.morphBuffer.data,before);
 // Hold geometry during the fake frame; the comparison pipeline reports .25 px.
 r.surfaceReads=1;r.frame(900100);await flush();
 assert.equal(r.stage,stage);assert.equal(stage.state,'transitioning');assert.equal(m.factor,.0625);
 assert.equal(m.endpointPixels,.25);assert.equal(stage.measurementPending,false);
 r.surfaceReads=0;r.advanceTransition({...moved,eye:moved.eye.map((v,i)=>v-m.direction[i]*.001)},900200);
 assert.equal(r.stage,null);await flush();
});

test('worker selection does not block frames and ignores stale world generations',async()=>{
 const old=globalThis.Worker;let worker;
 globalThis.Worker=class {constructor(){worker=this;}postMessage(message){this.message=message;}terminate(){}};
 try{
  const {r}=fakeRenderer();r.frame(1000);await flush();assert.ok(worker.message);assert.equal(r.patches.length,0);
  const first=worker.message;r.resetPatchCache();
  const {selectPatches}=await import('../src/planet/quadtree.js');
  worker.onmessage({data:{...first,result:selectPatches(first.camera,first.options),selectionMs:1}});
  r.frame(1200);await flush();assert.equal(r.patches.length,0);assert.notEqual(worker.message.id,first.id);
  const next=worker.message;worker.onmessage({data:{...next,result:selectPatches(next.camera,next.options),selectionMs:1}});
  r.frame(1400);await flush();assert.ok(r.patches.length>0);assert.equal(r.stage,null);
 }finally{if(old===undefined)delete globalThis.Worker;else globalThis.Worker=old;}
});

test('renderer restores a compact worker covering from its visible nodes',async()=>{
 const old=globalThis.Worker;let worker;
 globalThis.Worker=class {constructor(){worker=this;}postMessage(message){this.message=message;}terminate(){}};
 try{
  const {r}=fakeRenderer();r.frame(1000);await flush();
  const message=worker.message,{selectPatches}=await import('../src/planet/quadtree.js');
  assert.equal(message.compactLeaves,true);
  const result=selectPatches(message.camera,message.options),keys=result.leaves.map(p=>p.key);
  result.leaves=null;result.compactLeaves=true;
  worker.onmessage({data:{...message,result,selectionMs:1}});
  r.frame(1200);await flush();
  assert.deepEqual(r.coveringLeaves.map(p=>p.key),keys);
  assert.equal(r.patches.length,keys.length);
 }finally{if(old===undefined)delete globalThis.Worker;else globalThis.Worker=old;}
});

test('flight selection waits for meaningful camera movement but continues pending LOD reconciliation',async()=>{
 const {r}=fakeRenderer();r.frame(1000);await flush();
 const {planetCamera}=await import('../src/planet/camera.js');const camera=planetCamera(r.cameraState,960,600);
 r.needsSelection=true;assert.equal(r.shouldSelect(camera,1200),false);
 assert.equal(r.shouldSelect({...camera,eye:camera.eye.map((x,i)=>x+(i===0?25:0))},1200),true);
 r.reconcileSelection=true;assert.equal(r.shouldSelect(camera,1200),true);
 r.reconcileSelection=false;r.pixelSize++;assert.equal(r.shouldSelect(camera,1200),true);
});

test('terrain selection combines GPU residuals with conservative transition errors',()=>{
 const {r}=fakeRenderer();
 r.lodErrors.set('a',2);r.lodErrors.set('b',4);r.lodErrorVersion++;
 r.transitionErrors.set('a',3);r.transitionErrors.set('c',1);r.transitionErrorVersion++;
 const first=r.selectionErrorEstimates();
 assert.deepEqual([...first.values],[['a',3],['b',4],['c',1]]);
 assert.equal(r.selectionErrorEstimates(),first);
 r.lodErrors.set('b',5);r.lodErrorVersion++;
 assert.equal(r.selectionErrorEstimates().values.get('b'),5);
 r.resetPatchCache();assert.equal(r.selectionErrorEstimates().values.size,0);
});

test('worker-packed topology is remapped to resident GPU slots without repacking vertices',async()=>{
 const {r}=fakeRenderer();const {packTransitionTopology,MORPH_RANGE_OFFSET,MORPH_COORD_OFFSET}=await import('../src/planet/transition-upload.js');
 const records=[{key:'a',slot:7,coordinates:new Float32Array([0,0,1,0,0,1])},{key:'b',slot:23,coordinates:new Float32Array([8,8,9,8,8,9])}];
 const packed=packTransitionTopology(records.map((v,slot)=>({...v,slot})));
 r.uploadTransitionTopology(records.map(({key,slot})=>({key,slot})),{keys:['a','b'],...packed});
 const ranges=new Uint32Array(r.morphBuffer.data,MORPH_RANGE_OFFSET,1024*32);
 assert.deepEqual([...ranges.slice(7*32,8*32)],[...packed.ranges.slice(0,32)]);
 assert.deepEqual([...ranges.slice(23*32,24*32)],[...packed.ranges.slice(32,64)]);
 assert.deepEqual([...new Float32Array(r.morphBuffer.data,MORPH_COORD_OFFSET,packed.coordinates.length)],[...packed.coordinates]);
 assert.throws(()=>r.uploadTransitionTopology([{key:'missing',slot:7}],{keys:['a'],...packed}),/Invalid prepared topology/);
});

test('stable frames avoid redundant active-slot uploads and rebuild after reset',async()=>{
 const {r}=fakeRenderer(),writes=[],write=r.device.queue.writeBuffer;
 r.device.queue.writeBuffer=(target,offset,source)=>{if(target===r.activeBuffer)writes.push([...new Uint32Array(source.buffer,source.byteOffset,source.byteLength/4)]);write(target,offset,source);};
 r.frame(1000);await flush();assert.equal(writes.length,1);
 r.frame(1100);await flush();assert.equal(writes.length,1);
 r.resetPatchCache();r.frame(1300);await flush();assert.equal(writes.length,2);
 assert.deepEqual(writes[1],r.patches.map(p=>p.slot));
});

test('active transition reuses its immutable comparison pairs buffer',async()=>{
 const {r,camera}=await preparedRefinement(),writes=[],write=r.device.queue.writeBuffer;
 r.device.queue.writeBuffer=(target,offset,source)=>{if(target===r.transitionPairsBuffer)writes.push(source.byteLength);write(target,offset,source);};
 r.beginTransition(camera);r.surfaceReads=1;r.frame(2000);await flush();r.frame(2300);await flush();
 assert.equal(writes.length,1);assert.ok(r.stage.comparisonUploaded);
});

test('stationary morphs reuse their measured GPU endpoint errors',async()=>{
 const {r,camera}=await preparedRefinement();r.beginTransition(camera);r.surfaceReads=1;
 let comparisons=0;const create=r.device.createCommandEncoder;
 r.device.createCommandEncoder=(...args)=>{const encoder=create(...args),begin=encoder.beginComputePass;encoder.beginComputePass=(...params)=>{const pass=begin(...params),set=pass.setPipeline;pass.setPipeline=p=>{if(p===r.transitionPipe)comparisons++;set(p);};return pass;};return encoder;};
 r.frame(2000);await flush();assert.equal(comparisons,1);
 r.frame(2500);await flush();r.frame(3000);await flush();assert.equal(comparisons,1);
 r.cameraState.longitude+=.001;r.frame(3500);await flush();assert.equal(comparisons,2);
});

test('morph progress reuses metadata and uploads only the active slot span',async()=>{
 const {r,camera}=await preparedRefinement();r.beginTransition(camera);const stage=r.stage,m=stage.morph,metadata=r.morphMetadata;
 const writes=[],write=r.device.queue.writeBuffer;
 r.device.queue.writeBuffer=(target,offset,source)=>{if(target===r.morphBuffer)writes.push({offset,size:source.byteLength});write(target,offset,source);};
 const halfway={...camera,eye:camera.eye.map((v,i)=>m.anchor[i]+(v-m.anchor[i])*(m.distance-m.band*.5)/m.distance)};
 r.advanceTransition(halfway,2000);const slots=stage.groups.flatMap(g=>g.pairs.map(p=>p.fine.slot));
 assert.equal(r.morphMetadata,metadata);assert.deepEqual(writes,[{offset:Math.min(...slots)*32,size:(Math.max(...slots)-Math.min(...slots)+1)*32}]);
 const f=new Float32Array(r.morphBuffer.data);for(const slot of slots)assert.ok(Math.abs(f[slot*8+7]-.5)<1e-6);
});

test('cached patch metadata preserves camera-relative updates and resets',async()=>{
 const {r}=fakeRenderer();r.frame(1000);await flush();const p=r.patches[0],i=p.slot*32;
 const staticBefore=[...new Uint32Array(r.patchBuffer.data,i*4,20)],relativeBefore=[...new Float32Array(r.patchBuffer.data,(i+20)*4,3)];
 r.cameraState.longitude+=.00001;r.frame(1050);await flush();
 assert.deepEqual([...new Uint32Array(r.patchBuffer.data,i*4,20)],staticBefore);
 assert.notDeepEqual([...new Float32Array(r.patchBuffer.data,(i+20)*4,3)],relativeBefore);
 const oldCache=r.patchMetadataCache;r.resetPatchCache();assert.notEqual(r.patchMetadataCache,oldCache);
});

test('patch uploads cover resident slot span and skip unchanged camera frames',async()=>{
 const {r}=fakeRenderer(),writes=[],write=r.device.queue.writeBuffer;
 r.device.queue.writeBuffer=(target,offset,source)=>{if(target===r.patchBuffer)writes.push({offset,size:source.byteLength});write(target,offset,source);};
 r.frame(1000);await flush();const slots=r.patches.map(p=>p.slot);
 assert.deepEqual(writes,[{offset:Math.min(...slots)*128,size:(Math.max(...slots)-Math.min(...slots)+1)*128}]);
 r.frame(1100);await flush();assert.equal(writes.length,1);
 r.cameraState.longitude+=.00001;r.frame(1200);await flush();assert.equal(writes.length,2);
 r.resetPatchCache();r.frame(1400);await flush();assert.equal(writes.length,3);
});

test('selection worker receives error estimates only when they change or reset',async()=>{
 const old=globalThis.Worker;let worker;
 globalThis.Worker=class {constructor(){worker=this;}postMessage(message){this.message=message;}terminate(){}};
 try{
  const {r}=fakeRenderer();const {selectPatches}=await import('../src/planet/quadtree.js');
  r.frame(1000);await flush();assert.ok(worker.message.errorEstimates instanceof Map);
  let m=worker.message;worker.onmessage({data:{...m,result:selectPatches(m.camera,m.options),selectionMs:1}});
  r.frame(1200);await flush();r.cameraState.longitude+=.1;r.needsSelection=true;r.frame(1400);await flush();
  assert.equal(worker.message.errorEstimates,null);
  r.resetPatchCache();r.frame(1600);await flush();assert.ok(worker.message.errorEstimates instanceof Map);
 }finally{if(old===undefined)delete globalThis.Worker;else globalThis.Worker=old;}
});

test('unchanged terrain selection retains its worker snapshot inputs',async()=>{
 const {r}=fakeRenderer();r.frame(1000);await flush();const patches=r.patches,leaves=r.coveringLeaves,splits=r.previousSplits;
 const {planetCamera}=await import('../src/planet/camera.js');r.select(planetCamera(r.cameraState,960,600),1200);
 assert.equal(r.patches,patches);assert.equal(r.coveringLeaves,leaves);assert.equal(r.previousSplits,splits);assert.equal(r.stage,null);
});

test('worker transition relationships map to the renderer resident slots',async()=>{
 const {r}=fakeRenderer();r.frame(1000);await flush();
 const {planetCamera}=await import('../src/planet/camera.js');const {selectPatches}=await import('../src/planet/quadtree.js');
 const {transitionPairs,transitionGroups,coordinateTransitions}=await import('../src/planet/patch-transition.js');
 const camera=planetCamera({...r.cameraState,altitude:500},960,600),old=r.patches;
 const result=selectPatches(camera,{budget:r.budget,maxDepth:r.maxDepth,pixelSize:r.pixelSize,includeHidden:true,previousLeaves:r.coveringLeaves});
 const previous=new Set(old),raw=transitionPairs(old,result.visible);
 const relationships=raw.map(p=>({fineKey:p.fine.key,coarseKey:p.coarse.key,fineOld:previous.has(p.fine),coarseOld:previous.has(p.coarse),originX:p.originX,originY:p.originY,scale:p.scale,refining:p.refining}));
 const groups=transitionGroups(old,result.visible,raw),describe=p=>({fineKey:p.fine.key,coarseKey:p.coarse.key,fineOld:previous.has(p.fine),coarseOld:previous.has(p.coarse),originX:p.originX,originY:p.originY,scale:p.scale,refining:p.refining});
 const indices=new Map(raw.map((p,i)=>[p,i]));
 const groupPlan=groups.map(g=>({key:g.key,type:g.type,coarseKey:g.coarse.key,coarseOld:previous.has(g.coarse),...(g.type==='stitch'?{pairs:g.pairs.map(describe)}:{pairIndices:g.pairs.map(p=>indices.get(p))})}));
 const componentPlan=coordinateTransitions(old,result.visible,groups).map(c=>({groupKeys:c.groups.map(g=>g.key),deferredReasons:c.deferredReasons}));
 r.select(camera,1200,{result,relationships,groupPlan,componentPlan,selectionMs:0});assert.ok(r.stage);
 const expected=transitionPairs(old,r.stage.nodes).map(p=>({...p,refining:p.refining??r.stage.slots.has(p.fine.key)}));
 assert.deepEqual(r.stage.pairs,expected);
 const expectedGroups=transitionGroups(old,r.stage.nodes,expected);assert.deepEqual(r.stage.groups,expectedGroups);
 assert.deepEqual(r.stage.components,coordinateTransitions(old,r.stage.nodes,expectedGroups));
});

test('unchanged patch state avoids per-patch frame preparation',async()=>{
 const {r}=fakeRenderer();r.frame(1000);await flush();let reads=0;
 const get=r.patchMetadataCache.get.bind(r.patchMetadataCache);r.patchMetadataCache.get=key=>{reads++;return get(key);};
 r.frame(1100);await flush();assert.equal(reads,0);
 r.cameraState.longitude+=.00001;r.frame(1200);await flush();assert.ok(reads>0);
 r.resetPatchCache();assert.equal(r.preparedPatchState,null);
});

test('compact unchanged worker response retains the active covering',async()=>{
 const {r}=fakeRenderer();r.frame(1000);await flush();const patches=r.patches,leaves=r.coveringLeaves;
 const {planetCamera}=await import('../src/planet/camera.js'),camera=planetCamera(r.cameraState,960,600);
 const key=[r.generation,r.cameraState.mode,r.budget,r.maxDepth,r.pixelSize,camera.width,camera.height].join('/');
 r.needsSelection=true;r.selectionResult={key,camera,unchanged:true,leafCount:leaves.length,deepest:r.stats.deepest,selectionMs:2};
 r.frame(1200);await flush();assert.equal(r.patches,patches);assert.equal(r.coveringLeaves,leaves);
 assert.equal(r.needsSelection,false);assert.equal(r.stage,null);assert.equal(r.stats.selectionMs,2);
});

test('surface probes dispatch the regular or overlay pipeline for the displayed patch',async()=>{
 const {r}=fakeRenderer();r.frame(1000);await flush();
 r.walkProbeInput=r.device.createBuffer({size:48});r.walkProbeResult=r.device.createBuffer({size:16});
 r.walkProbePipe={kind:'overlay-probe'};r.walkProbeBind={};r.walkRegularPipe={kind:'regular-probe'};r.walkRegularBind={};
 const seen=[],create=r.device.createCommandEncoder;
 r.device.createCommandEncoder=(...args)=>{const e=create(...args),begin=e.beginComputePass;e.beginComputePass=(...params)=>{const pass=begin(...params),set=pass.setPipeline;pass.setPipeline=p=>{seen.push(p.kind);set(p);};return pass;};return e;};
 const patch=r.patches[0];await r.sampleRenderedSurface(patch.direction);assert.equal(seen.at(-1),'regular-probe');
 r.stage={state:'transitioning'};r.topologySlots=new Set([patch.slot]);await r.sampleRenderedSurface(patch.direction);assert.equal(seen.at(-1),'overlay-probe');
 r.topologySlots=new Set();await r.sampleRenderedSurface(patch.direction);assert.equal(seen.at(-1),'regular-probe');
});

test('point probe readbacks are reused and invalidated by a terrain reset',async()=>{
 const {r}=fakeRenderer();r.probeInput=r.device.createBuffer({size:16});r.sampleBuffer=r.device.createBuffer({size:16});r.pointPipe={};r.pointBind={};
 let created=0,destroyed=0;const create=r.device.createBuffer;
 r.device.createBuffer=options=>{const b=create(options);if(options.size===16){created++;b.destroy=()=>{destroyed++;};}return b;};
 await r.sampleTerrain([1,0,0]);await r.sampleTerrain([0,1,0]);assert.equal(created,1);assert.equal(r.probeReadbacks.length,1);
 r.resetPatchCache();assert.equal(destroyed,1);assert.equal(r.probeReadbacks.length,0);
 await r.sampleTerrain([1,0,0]);assert.equal(created,2);
});

test('concurrent probes use separate readbacks and stale readbacks are destroyed',async()=>{
 const {r}=fakeRenderer();r.probeInput=r.device.createBuffer({size:16});r.sampleBuffer=r.device.createBuffer({size:16});r.pointPipe={};r.pointBind={};
 const resolve=[],created=[];const create=r.device.createBuffer;
 r.device.createBuffer=options=>{const b=create(options);if(options.size===16){b.mapAsync=()=>new Promise(done=>resolve.push(done));b.destroyed=false;b.destroy=()=>{b.destroyed=true;};created.push(b);}return b;};
 const a=r.sampleTerrain([1,0,0]),b=r.sampleTerrain([0,1,0]);assert.equal(created.length,2);assert.notEqual(created[0],created[1]);
 r.resetPatchCache();resolve.forEach(done=>done());assert.equal(await a,null);assert.equal(await b,null);
 assert.ok(created.every(buffer=>buffer.destroyed));assert.equal(r.probeReadbacks.length,0);
});

test('point terrain sampling reuses only an identical valid GPU input',async()=>{
 const {r}=fakeRenderer();r.probeInput=r.device.createBuffer({size:16});r.sampleBuffer=r.device.createBuffer({size:16});r.pointPipe={};r.pointBind={};r.hydrologySeed=r.seed>>>0;
 let submissions=0;const submit=r.device.queue.submit;r.device.queue.submit=commands=>{submissions++;submit(commands);};
 const first=await r.sampleTerrain([1,0,0]);first[3]=123;
 const second=await r.sampleTerrain([1,0,0]);assert.equal(submissions,1);assert.notEqual(second[3],123);
 await r.sampleTerrain([1,.0001,0]);assert.equal(submissions,2);
 r.relief+=.1;await r.sampleTerrain([1,.0001,0]);assert.equal(submissions,3);
 r.terrainFieldRevision++;await r.sampleTerrain([1,.0001,0]);assert.equal(submissions,4);
 r.resetPatchCache();await r.sampleTerrain([1,.0001,0]);assert.equal(submissions,5);
});

test('regional changes invalidate in-flight point terrain results',async()=>{
 const {r}=fakeRenderer();r.probeInput=r.device.createBuffer({size:16});r.sampleBuffer=r.device.createBuffer({size:16});r.pointPipe={};r.pointBind={};
 let release;const ready=new Promise(resolve=>{release=resolve;});const create=r.device.createBuffer;
 r.device.createBuffer=options=>{const b=create(options);b.mapAsync=()=>ready;return b;};
 const pending=r.sampleTerrain([1,0,0]);r.terrainFieldRevision++;release();assert.equal(await pending,null);assert.equal(r.terrainPointCache,null);
});

test('identical concurrent point probes share a submission but not result arrays',async()=>{
 const {r}=fakeRenderer();r.probeInput=r.device.createBuffer({size:16});r.sampleBuffer=r.device.createBuffer({size:16});r.pointPipe={};r.pointBind={};r.hydrologySeed=r.seed>>>0;
 let release,submissions=0;const ready=new Promise(resolve=>{release=resolve;}),create=r.device.createBuffer,submit=r.device.queue.submit;
 r.device.createBuffer=options=>{const b=create(options);b.mapAsync=()=>ready;return b;};r.device.queue.submit=commands=>{submissions++;submit(commands);};
 const a=r.sampleTerrain([1,0,0]),b=r.sampleTerrain([1,0,0]);assert.equal(submissions,1);release();
 const [first,second]=await Promise.all([a,b]);assert.notEqual(first,second);first[3]=99;assert.notEqual(second[3],99);assert.equal(r.terrainPointInFlight.size,0);
});

test('coalesced point probes are all invalidated by a terrain reset',async()=>{
 const {r}=fakeRenderer();r.probeInput=r.device.createBuffer({size:16});r.sampleBuffer=r.device.createBuffer({size:16});r.pointPipe={};r.pointBind={};r.hydrologySeed=r.seed>>>0;
 let release;const ready=new Promise(resolve=>{release=resolve;}),create=r.device.createBuffer;
 r.device.createBuffer=options=>{const b=create(options);b.mapAsync=()=>ready;return b;};
 const a=r.sampleTerrain([1,0,0]),b=r.sampleTerrain([1,0,0]);r.resetPatchCache();release();
 assert.deepEqual(await Promise.all([a,b]),[null,null]);assert.equal(r.terrainPointInFlight.size,0);
});

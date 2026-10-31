// CPU-only benchmark; it does not measure GPU work, rendering or flight FPS.
import {performance} from 'node:perf_hooks';
import {planetCamera} from '../src/planet/camera.js';
import {selectPatches} from '../src/planet/quadtree.js';
import {transitionCoordinates} from '../src/planet/transition-topology.js';
import {packTransitionTopology} from '../src/planet/transition-upload.js';

const runs=Math.max(10,Number(process.argv[2])||100);
const cases=[];
for(let a=0;a<16;a++)for(let b=0;b<16;b++)cases.push([{mask:a},{mask:b}]);
for(let pass=0;pass<2;pass++){
 const start=performance.now();for(const [from,to] of cases)transitionCoordinates(from,to);
 console.log(`256 stitch pairs ${pass?'revisit':'first pass'}: ${(performance.now()-start).toFixed(2)} ms`);
}
const templates=Array.from({length:4},(_,i)=>transitionCoordinates({mask:i+1,originX:i%2*8,originY:(i>>1)*8,scale:.5},{mask:(i+5)%16}));
const records=Array.from({length:64},(_,slot)=>({slot,coordinates:templates[slot%templates.length]}));
const cache=new WeakMap();for(let i=0;i<10;i++)packTransitionTopology(records,undefined,cache);
const durations=[];
for(let i=0;i<runs;i++){const start=performance.now();packTransitionTopology(records,undefined,cache);durations.push(performance.now()-start);}
durations.sort((a,b)=>a-b);
const percentile=p=>durations[Math.min(durations.length-1,Math.ceil(p*durations.length)-1)].toFixed(3);
console.log(`64 shared patch layouts: p50=${percentile(.5)} ms p95=${percentile(.95)} ms`);

// Exercise the same changing-surface selection and topology preparation used
// by the worker, without browser scheduling or structured-clone costs.
let response=null;globalThis.self={postMessage(message){response=message;}};
await import('../src/planet/selection-worker.js');
const options={budget:384,pixelSize:6,includeHidden:true};
const before=selectPatches(planetCamera({mode:'walk',altitude:.0017,longitude:.8,latitude:.4,pitch:.2},1280,720),options);
const camera=planetCamera({mode:'walk',altitude:.0017,longitude:.801,latitude:.4,pitch:.2},1280,720);
const request={data:{id:1,key:'benchmark',camera,options:{...options,previousLeaves:before.leaves,previousSplits:before.splits},previousPatches:before.visible,snapshotPresent:true,allowUnchanged:true}};
for(let i=0;i<10;i++)self.onmessage(request);
durations.length=0;
for(let i=0;i<runs;i++){const start=performance.now();self.onmessage(request);durations.push(performance.now()-start);}
durations.sort((a,b)=>a-b);
console.log(`changing surface worker: p50=${percentile(.5)} ms p95=${percentile(.95)} ms`);

// Simulate changing selections through a descent. This applies each result
// immediately and therefore does not model renderer morph timing or GPU work.
let current=selectPatches(planetCamera({mode:'flyover',altitude:50,longitude:.8,latitude:.4,pitch:.2},1280,720),options);
durations.length=0;let unchanged=0;
for(let i=0;i<runs;i++){
 const t=i/Math.max(1,runs-1),altitude=50*Math.pow(.01/50,t);
 const descentCamera=planetCamera({mode:'flyover',altitude,longitude:.8+t*.0005,latitude:.4,pitch:.2},1280,720);
 const data={id:i,key:'descent',camera:descentCamera,options:{...options,previousLeaves:current.leaves,previousSplits:current.splits},previousPatches:current.visible,snapshotPresent:true,allowUnchanged:true};
 response=null;const start=performance.now();self.onmessage({data});durations.push(performance.now()-start);
 if(response.unchanged)unchanged++;else current=response.result;
}
durations.sort((a,b)=>a-b);
console.log(`synthetic descent worker: p50=${percentile(.5)} ms p95=${percentile(.95)} ms unchanged=${unchanged}/${runs}`);

// Include the actual structured-copy and transferable-buffer operations for
// a changing complete covering. Node timings exclude browser thread scheduling
// and should not be interpreted as measured frame times.
const cloneRequest={id:1,key:'clone-benchmark',camera,options:{...options,previousSplits:before.splits},previousPatches:before.visible,snapshotPresent:true,deriveLeaves:true,compactLeaves:true,allowUnchanged:true};
const inputTimes=[],outputTimes=[];
self.postMessage=(message,transfers)=>{const start=performance.now();response=structuredClone(message,{transfer:transfers||[]});outputTimes.push(performance.now()-start);};
for(let i=0;i<runs;i++){
 const start=performance.now(),input=structuredClone(cloneRequest);inputTimes.push(performance.now()-start);self.onmessage({data:input});
}
for(const [label,times] of [['request copy',inputTimes],['response copy and transfer',outputTimes]]){
 times.sort((a,b)=>a-b);console.log(`${label}: p50=${times[Math.ceil(times.length*.5)-1].toFixed(3)} ms p95=${times[Math.ceil(times.length*.95)-1].toFixed(3)} ms`);
}

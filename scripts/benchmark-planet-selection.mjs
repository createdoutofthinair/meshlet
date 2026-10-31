// CPU-only selection benchmark. It does not measure rendering or GPU time.
import {performance} from 'node:perf_hooks';
import {planetCamera} from '../src/planet/camera.js';
import {selectPatches} from '../src/planet/quadtree.js';

const runs=Math.max(10,Number(process.argv[2])||100);
const cases=[
 {name:'orbit',mode:'orbit',altitude:12000},
 {name:'descent',mode:'flyover',altitude:50,pitch:.2},
 {name:'surface',mode:'walk',altitude:.0017,pitch:.2},
];
for(const scenario of cases)for(const moving of [false,true])for(const compact of [false,true]){
 const cameraAt=i=>planetCamera({...scenario,longitude:.8+(moving?i*.00001:0),latitude:.4,heading:.45},1280,720);
 const options={budget:384,maxDepth:scenario.mode==='walk'?22:20,pixelSize:6,includeHidden:true};
 let previous=null;
 for(let i=0;i<10;i++)previous=selectPatches(cameraAt(i),options);
 const durations=[];let unchanged=0;
 for(let i=0;i<runs;i++){
  const start=performance.now();
  const result=selectPatches(cameraAt(i+10),{...options,previousLeaves:previous.leaves,previousSplits:previous.splits,unchangedPatches:compact?previous.visible:null});
  if(result.unchanged)unchanged++;else previous=result;
  durations.push(performance.now()-start);
 }
 durations.sort((a,b)=>a-b);
 const percentile=p=>durations[Math.min(durations.length-1,Math.ceil(p*durations.length)-1)].toFixed(2);
 console.log(`${scenario.name} ${moving?'moving':'fixed'} ${compact?'compact':'full'}: p50=${percentile(.5)} ms p95=${percentile(.95)} ms max=${percentile(1)} ms leaves=${previous.leaves.length} unchanged=${unchanged}`);
}

// Summarize exported planet statistics without counting missing GPU timings as zero.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const metrics=['frameMs','framePeakMs','cpuSubmitMs','cpuSelectionMs','gpuComputeMs','gpuTerrainMs','gpuOceanMs','gpuCloudAtmosphereMs','gpuRenderMs'];
const phases=[['surface (<50 km)',x=>x<50],['descent (50–900 km)',x=>x>=50&&x<=900],['orbit (>900 km)',x=>x>900]];
export function summarize(samples){
 const result={samples:samples.length};
 for(const key of metrics){
  const values=samples.map(sample=>sample[key]).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!values.length)continue;
  const at=p=>values[Math.max(0,Math.ceil(values.length*p)-1)];
  result[key]={count:values.length,p50:at(.5),p95:at(.95),max:values.at(-1)};
 }
 return result;
}
export function analyze(recording){
 if(!recording||!Array.isArray(recording.samples))throw new Error('Recording must contain a samples array');
 const result={durationMs:recording.recordedMs??null,adapter:recording.metadata?.adapter??null,overall:summarize(recording.samples),phases:{}};
 for(const [name,contains] of phases)result.phases[name]=summarize(recording.samples.filter(sample=>Number.isFinite(sample.camera?.altitudeKm)&&contains(sample.camera.altitudeKm)));
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const files=process.argv.slice(2);
 if(!files.length){console.error('Usage: node scripts/analyze-planet-performance.mjs recording.json [recording.json ...]');process.exitCode=1;}
 else for(const file of files){
  try{const recording=JSON.parse(await readFile(file,'utf8'));console.log(JSON.stringify({file,...analyze(recording)},null,2));}
  catch(error){console.error(`${file}: ${error.message}`);process.exitCode=1;}
 }
}

export const HISTORY_MS=60_000;
export const SAMPLE_MS=250;

// Aggregate a quarter-second of actual frames, retaining the worst frame so
// a brief hitch is not lost in the average. GPU values are asynchronous.
export class InspectorHistory {
 constructor(){this.samples=[];this.paused=false;this.lastSample=null;this.gap=true;this.resetAccumulation();}
 resetAccumulation(){this.frameSum=0;this.frameCount=0;this.framePeak=0;this.cpuSum=0;this.cpuCount=0;}
 setPaused(value){this.paused=!!value;this.gap=true;this.resetAccumulation();}
 clear(){this.samples=[];this.lastSample=null;this.gap=true;this.resetAccumulation();}
 markGap(){this.gap=true;this.resetAccumulation();}
 record(now,frameMs,cpuMs,snapshot){
  if(this.paused||!Number.isFinite(now))return false;
  if(Number.isFinite(frameMs)&&frameMs>0&&frameMs<5000){this.frameSum+=frameMs;this.frameCount++;this.framePeak=Math.max(this.framePeak,frameMs);}
  if(Number.isFinite(cpuMs)&&cpuMs>=0){this.cpuSum+=cpuMs;this.cpuCount++;}
  if(this.lastSample!==null&&now-this.lastSample<SAMPLE_MS)return false;
  const value=x=>Number.isFinite(x)&&x>=0?x:null;
  this.samples.push({at:now,gap:this.gap||(this.lastSample!==null&&now-this.lastSample>SAMPLE_MS*4),
   frameMs:this.frameCount?this.frameSum/this.frameCount:null,framePeakMs:this.frameCount?this.framePeak:null,
   cpuMs:this.cpuCount?this.cpuSum/this.cpuCount:null,gpuComputeMs:value(snapshot.gpuComputeMs),gpuRenderMs:value(snapshot.gpuRenderMs),
   patches:value(snapshot.patches),meshlets:value(snapshot.meshlets),lodError:value(snapshot.lodError),lodWaiting:!!snapshot.lodWaiting,lodOverTarget:!!snapshot.lodOverTarget});
  this.lastSample=now;this.gap=false;this.resetAccumulation();
  while(this.samples.length&&now-this.samples[0].at>HISTORY_MS)this.samples.shift();
  return true;
 }
}

export function levelCounts(patches){
 const counts=new Map();for(const patch of patches||[]){if(Number.isInteger(patch.level)&&patch.level>=0)counts.set(patch.level,(counts.get(patch.level)||0)+1);}
 return [...counts].sort((a,b)=>a[0]-b[0]);
}

export function graphCeiling(values,minimum=1){
 const max=Math.max(minimum,...values.filter(Number.isFinite));const power=10**Math.floor(Math.log10(max)),scaled=max/power;
 return (scaled<=1?1:scaled<=2?2:scaled<=5?5:10)*power;
}

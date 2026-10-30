// A session is independent of the inspector's rolling 60-second graph.
export class StatisticsRecorder {
 constructor(limit=28800){this.limit=limit;this.active=false;this.samples=[];this.lastGpuSample=null;}
 start(now,renderer){this.active=true;this.startedAt=now;this.startedUtc=new Date().toISOString();this.lastAt=null;this.lastGpuSample=null;this.samples=[];this.frames=[];this.cpus=[];this.truncated=false;this.metadata={seed:renderer.seed,gpuTimestampQueries:!!renderer.timing,adapter:renderer.adapter?.info?{vendor:renderer.adapter.info.vendor,architecture:renderer.adapter.info.architecture,description:renderer.adapter.info.description}:null};}
 record(now,frameMs,cpuMs,renderer){
  if(!this.active)return;
  if(Number.isFinite(frameMs)&&frameMs>0&&frameMs<5000)this.frames.push(frameMs);
  if(Number.isFinite(cpuMs)&&cpuMs>=0)this.cpus.push(cpuMs);
  if(this.lastAt!==null&&now-this.lastAt<250)return;
  if(this.samples.length>=this.limit){this.truncated=true;this.active=false;return;}
  const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
  const t=renderer.latest||{},s=renderer.stats||{},c=renderer.cameraState||{},transition=renderer.transition||{};
  const fresh=renderer.timing&&Number.isFinite(t.gpuSampleAt)&&t.gpuSampleAt!==this.lastGpuSample;
  if(fresh)this.lastGpuSample=t.gpuSampleAt;
  this.samples.push({elapsedMs:Math.round(now-this.startedAt),frameMs:avg(this.frames),framePeakMs:this.frames.length?Math.max(...this.frames):null,cpuSubmitMs:avg(this.cpus),gpuSampleAgeMs:fresh?Math.max(0,Math.round(now-t.gpuSampleAt)):null,gpuComputeMs:fresh?t.gpuComputeMs??null:null,gpuTerrainMs:fresh?t.gpuTerrainMs??null:null,gpuOceanMs:fresh?t.gpuOceanMs??null:null,gpuCloudAtmosphereMs:fresh?t.gpuCloudMs??null:null,gpuRenderMs:fresh?t.gpuRenderMs??null:null,generatedPatches:fresh?t.generatedPatchesSample??null:null,cpuSelectionMs:s.selectionMs??null,patches:s.visiblePatches??null,meshlets:t.visibleMeshlets??null,deepestLod:s.deepest??null,lodErrorPixels:transition.pixels??null,lodWaiting:!!transition.waiting,camera:{mode:c.mode??null,altitudeKm:c.altitude??null,surfaceHeightKm:c.surfaceHeight??null,latitude:c.latitude??null,longitude:c.longitude??null},settings:{patchBudget:renderer.budget,renderScale:renderer.resolution,clouds:renderer.clouds,cloudQuality:renderer.cloudQuality,cloudCoverage:renderer.cloudCoverage,ocean:renderer.ocean,culling:renderer.culling}});
  this.frames=[];this.cpus=[];this.lastAt=now;
 }
 stop(now){this.active=false;this.stoppedAt=now;return this.export();}
 export(){return {version:1,startedUtc:this.startedUtc,recordedMs:Math.max(0,Math.round((this.stoppedAt??this.lastAt??this.startedAt)-this.startedAt)),sampleIntervalMs:250,truncated:this.truncated,metadata:this.metadata,timingNotes:{gpuComputeMs:'One combined GPU compute pass: terrain generation, normals, bounds, visibility and transition work when scheduled.',gpuTerrainMs:'Terrain draw pass.',gpuOceanMs:'Ocean and lake pass when active.',gpuCloudAtmosphereMs:'Combined clouds and atmosphere pass when active.',gpuRenderMs:'Sum of timed render passes; excludes presentation.',gpuSampleAgeMs:'GPU samples arrive asynchronously and are recorded only once.',frameMs:'Display frame interval including pacing; CPU submit is not total CPU cost.',other:'Hydrology initialization and separate surface probe submissions are not timed individually.'},samples:this.samples};}
}

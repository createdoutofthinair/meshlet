import test from 'node:test';
import assert from 'node:assert/strict';
import {StatisticsRecorder} from '../src/planet/statistics-recorder.js';
const makeRenderer=()=>({seed:7,timing:true,adapter:{info:{vendor:'test'}},cameraState:{mode:'flight',altitude:10,surfaceHeight:1,latitude:0,longitude:0},stats:{visiblePatches:8,selectionMs:2,deepest:12},latest:{gpuSampleAt:100,gpuComputeMs:1,gpuTerrainMs:2,gpuOceanMs:.5,gpuCloudMs:3,gpuRenderMs:5.5,visibleMeshlets:50},transition:{waiting:false},budget:384,resolution:1});
test('records a session independently with camera changes and non-duplicated GPU samples',()=>{
 const r=makeRenderer(),rec=new StatisticsRecorder();rec.start(100,r);rec.record(100,16,2,r);r.cameraState.mode='walk';r.cameraState.altitude=.0017;rec.record(200,20,3,r);rec.record(350,30,4,r);
 assert.equal(rec.samples.length,2);assert.equal(rec.samples[0].gpuCloudAtmosphereMs,3);assert.equal(rec.samples[1].gpuCloudAtmosphereMs,null);assert.equal(rec.samples[1].framePeakMs,30);assert.equal(rec.samples[1].camera.mode,'walk');
 const result=rec.stop(500);assert.equal(result.recordedMs,400);assert.equal(result.metadata.seed,7);assert.equal(rec.active,false);
});
test('reports missing GPU timestamps and caps long sessions',()=>{
 const r=makeRenderer();r.timing=false;const rec=new StatisticsRecorder(1);rec.start(0,r);rec.record(0,20,1,r);rec.record(250,21,1,r);assert.equal(rec.active,false);const result=rec.stop(250);assert.equal(result.truncated,true);assert.equal(result.metadata.gpuTimestampQueries,false);assert.equal(result.samples[0].gpuTerrainMs,null);
});


test('records each actual LOD commit once with refinement and merge errors',()=>{
 const r=makeRenderer(),rec=new StatisticsRecorder();rec.start(0,r);r.lastTransitionCommit={id:1,at:80,pairs:4,refinements:3,merges:1,maxRefinementPixels:3,maxMergePixels:.2};rec.record(100,16,1,r);rec.record(110,16,1,r);const out=rec.stop(150);assert.equal(out.transitionEvents.length,1);assert.equal(out.transitionEvents[0].maxRefinementPixels,3);assert.equal(out.transitionEvents[0].elapsedMs,80);
});

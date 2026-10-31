import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze} from '../scripts/analyze-planet-performance.mjs';

test('flight statistics distinguish missing GPU samples and altitude phases',()=>{
 const result=analyze({recordedMs:500,samples:[
  {frameMs:10,gpuCloudAtmosphereMs:null,camera:{altitudeKm:1}},
  {frameMs:20,gpuCloudAtmosphereMs:8,camera:{altitudeKm:50}},
  {frameMs:30,gpuCloudAtmosphereMs:12,camera:{altitudeKm:900}},
  {frameMs:40,gpuCloudAtmosphereMs:4,camera:{altitudeKm:901}},
  {frameMs:50,gpuCloudAtmosphereMs:null,camera:{}},
 ]});
 assert.deepEqual(result.overall.gpuCloudAtmosphereMs,{count:3,p50:8,p95:12,p99:12,max:12});
 assert.equal(result.phases['surface (<50 km)'].samples,1);
 assert.equal(result.phases['surface (<50 km)'].gpuCloudAtmosphereMs,undefined);
 assert.equal(result.phases['descent (50–900 km)'].samples,2);
 assert.equal(result.phases['orbit (>900 km)'].samples,1);
 assert.equal(result.overall.frameMs.p95,50);
 assert.throws(()=>analyze({}),/samples array/);
});

test('analysis reports the 99th percentile of valid samples',()=>{
 const result=analyze({samples:Array.from({length:100},(_,i)=>({frameMs:i+1}))});
 assert.equal(result.overall.frameMs.p99,99);
});

test('separates walking from low flight without treating missing altitude as zero',()=>{
 const result=analyze({samples:[
  {frameMs:10,camera:{mode:'walk',altitudeKm:.0017}},
  {frameMs:20,camera:{mode:'flight',altitudeKm:.049}},
  {frameMs:30,camera:{mode:'flight',altitudeKm:.05}},
  {frameMs:40,camera:{mode:'flight'}},
 ]});
 assert.equal(result.surfacePhases.walking.samples,1);
 assert.equal(result.surfacePhases['low flight (<50 m)'].frameMs.p50,20);
 assert.equal(result.surfacePhases['flight 50 m–1 km'].frameMs.p50,30);
});

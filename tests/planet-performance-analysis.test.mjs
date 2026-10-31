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
 assert.deepEqual(result.overall.gpuCloudAtmosphereMs,{count:3,p50:8,p95:12,max:12});
 assert.equal(result.phases['surface (<50 km)'].samples,1);
 assert.equal(result.phases['surface (<50 km)'].gpuCloudAtmosphereMs,undefined);
 assert.equal(result.phases['descent (50–900 km)'].samples,2);
 assert.equal(result.phases['orbit (>900 km)'].samples,1);
 assert.equal(result.overall.frameMs.p95,50);
 assert.throws(()=>analyze({}),/samples array/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {InspectorHistory,levelCounts,graphCeiling,HISTORY_MS} from '../src/planet/inspector-history.js';

test('history aggregates frame averages and preserves short spikes',()=>{
 const h=new InspectorHistory(),snapshot={patches:23,meshlets:200,gpuComputeMs:null,gpuRenderMs:3.2,lodError:.4};
 h.record(0,0,1,snapshot);h.record(100,10,2,snapshot);h.record(200,40,4,snapshot);h.record(250,25,3,snapshot);
 const sample=h.samples.at(-1);assert.equal(sample.frameMs,25);assert.equal(sample.framePeakMs,40);assert.equal(sample.cpuMs,3);
 assert.equal(sample.gpuComputeMs,null);assert.equal(sample.gpuRenderMs,3.2);assert.equal(sample.lodError,.4);
});

test('history rolls over and pause or visibility gaps break graph lines',()=>{
 const h=new InspectorHistory(),snapshot={patches:1};for(let t=0;t<=HISTORY_MS+500;t+=250)h.record(t,16,1,snapshot);
 assert.equal(h.samples[0].at,500);const count=h.samples.length;h.setPaused(true);h.record(70000,100,1,snapshot);assert.equal(h.samples.length,count);
 h.setPaused(false);h.record(70250,17,1,snapshot);assert.equal(h.samples.at(-1).gap,true);
 h.markGap();h.record(70500,18,1,snapshot);assert.equal(h.samples.at(-1).gap,true);h.clear();assert.equal(h.samples.length,0);
});

test('level counts and graph scale reflect only real data',()=>{
 assert.deepEqual(levelCounts([{level:4},{level:2},{level:4},{level:3},{level:NaN}]),[[2,1],[3,1],[4,2]]);
 assert.equal(graphCeiling([16.7,20],20),20);assert.equal(graphCeiling([21],20),50);assert.equal(graphCeiling([.61],1),1);
});

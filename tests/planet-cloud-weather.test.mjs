import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {planetCloudSource} from '../src/planet/cloud-compose.js';

test('planet cloud shader uses precomputed wind and weather axis uniforms',async()=>{
 const paths=['../src/atmosphere/atmosphere.wgsl','../src/cloud/cloud.wgsl','../src/planet/cloud-overlay.wgsl'];
 const parts=await Promise.all(paths.map(path=>readFile(new URL(path,import.meta.url),'utf8')));
 const shader=planetCloudSource(...parts);
 assert.ok(shader.includes('let windCos=params.sky.y;let windSin=params.cloud.w;'));
 assert.ok(shader.includes('let axis=params.shape.yzw;'));
 assert.ok(shader.includes('params.sky.y,params.cloud.w,.00028/max(.5,params.shape.x)'));
 assert.ok(!shader.includes('sin(seed*.07)'));
 assert.ok(shader.includes('min(2.0,atmosphereMiePhase(mu))*density*params.atmosphere.y;'),'planet atmosphere keeps the Mie-strength control');
});

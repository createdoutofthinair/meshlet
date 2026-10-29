import test from 'node:test';
import assert from 'node:assert/strict';
import {readShader} from '../src/river/world.js';

test('river shader requests revalidate cached files before building a pipeline',async()=>{
 const original=globalThis.fetch;let request;
 globalThis.fetch=async(url,options)=>{request={url,options};return {ok:true,text:async()=> 'fn makeRocks() {}'};};
 try{assert.match(await readShader('./geometry.wgsl'),/makeRocks/);assert.ok(request.url.pathname.endsWith('/src/river/geometry.wgsl'));assert.equal(request.options.cache,'no-cache');}
 finally{globalThis.fetch=original;}
});

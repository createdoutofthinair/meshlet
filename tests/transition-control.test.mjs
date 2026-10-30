import test from 'node:test';
import assert from 'node:assert/strict';
import {createTransitionControl,advanceTransitionControl} from '../src/planet/transition-control.js';
const camera={eye:[0,0,100],clearance:100,focalPixels:800};
const control=(error,options={})=>createTransitionControl(camera,{anchor:[0,0,0],approaching:true,endpointPixels:error,...options});
const at=z=>({...camera,eye:[0,0,z]});

test('measured endpoint error widens the spatial band within a reachable distance',()=>{
 const small=control(.25),large=control(32);
 assert.ok(large.band>small.band);assert.ok(large.band<=large.distance*.5);
 assert.deepEqual(large.direction,[0,0,-1]);
});

test('rapid descent limits the estimated geometry step without animating a stationary view',()=>{
 const m=control(8);advanceTransitionControl(m,at(1));
 assert.equal(m.factor,.5/8);assert.equal(m.estimatedStepPixels,.5);assert.equal(m.limited,true);
 for(let i=0;i<100;i++)advanceTransitionControl(m,at(1));
 assert.equal(m.factor,.5/8);assert.equal(m.estimatedStepPixels,0);
 // Further physical movement allows progress, regardless of elapsed time.
 for(let i=0;i<20&&m.factor<1;i++){
  advanceTransitionControl(m,at(1-i*.01));assert.ok(m.estimatedStepPixels<=.5+1e-10);
 }
 assert.equal(m.factor,1);
});

test('reversal cannot cancel before a bounded return to the original surface',()=>{
 const m=control(4);
 for(let i=0;i<4;i++)advanceTransitionControl(m,at(40-i));
 assert.equal(m.factor,.5);
 assert.equal(advanceTransitionControl(m,at(110)).cancel,false);assert.equal(m.factor,.375);
 for(let i=1;i<=3;i++)advanceTransitionControl(m,at(110+i));
 assert.equal(m.factor,0);assert.equal(advanceTransitionControl(m,at(114)).cancel,true);
});

test('observed lateral movement supplies the spatial axis for walking and cube-face travel',()=>{
 const m=control(.25,{previousEye:[-10,0,100]});assert.deepEqual(m.direction,[1,0,0]);
 advanceTransitionControl(m,{...camera,eye:[m.band*.5,0,100]});assert.equal(m.factor,.5);
 advanceTransitionControl(m,{...camera,eye:[m.band,0,100]});assert.equal(m.factor,1);
});

test('viewport growth and descent tighten the estimated step allowance',()=>{
 const m=control(8);advanceTransitionControl(m,{eye:[0,0,1],clearance:50,focalPixels:1600});
 assert.equal(m.estimatedEndpointPixels,32);assert.equal(m.factor,.5/32);assert.equal(m.estimatedStepPixels,.5);
});

test('coarsening follows outward travel and remains reversible',()=>{
 const m=control(.25,{approaching:false});assert.deepEqual(m.direction,[0,0,1]);
 advanceTransitionControl(m,at(100+m.band*.5));assert.equal(m.factor,.5);
 advanceTransitionControl(m,at(100));assert.equal(m.factor,0);
 advanceTransitionControl(m,at(100+m.band));assert.equal(m.factor,1);
});

test('subpixel replacements do not acquire a time delay',()=>{
 const m=control(.2);advanceTransitionControl(m,at(0));assert.equal(m.factor,1);assert.ok(m.estimatedStepPixels<=.5);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {PlanetRenderer} from '../src/planet/renderer.js';
import {RiverWorld} from '../src/river/world.js';

function fakeDevice(log){
 return {queue:{writeBuffer(){},submit(){}},createCommandEncoder(){
  let pipeline,work;return {beginComputePass(){return {setPipeline(p){pipeline=p;},setBindGroup(group,value){if(group===1)work=value;},dispatchWorkgroups(count){log.push([pipeline,work,count]);},end(){}};},finish(){return {};}};
 }};
}
test('River Lab runs the same seeded drainage and path passes as Planet Lab',()=>{
 const names=['initialize','initializeFlood','flood','saveFlood','route','clearFlow','runoff','prepareSediment','sediment','applySediment','finish','initializeLake','spreadLakeMinimum','saveLakeMinimum','markRiverPresence','buildRiverPaths'];
 const pipes=Object.fromEntries(names.map(name=>[name,name])),planetLog=[],riverLog=[];
 const planet=Object.create(PlanetRenderer.prototype);Object.assign(planet,{device:fakeDevice(planetLog),seed:918273,hydrologySeed:null,uniform:{},plates:{},worldCount:24578,hydroPipes:pipes,hydroMain:{},hydroWork:[0,1]});planet.ensureHydrology();
 const river=new RiverWorld(fakeDevice(riverLog));Object.assign(river,{uniform:{},plates:{},count:24578,pipes,main:{},work:[0,1]});assert.equal(river.generate(918273),true);
 const excluded=new Set(['initializeLake','spreadLakeMinimum','saveLakeMinimum','markRiverPresence']);
 assert.deepEqual(planetLog.filter(([name])=>!excluded.has(name)),riverLog);
 assert.equal(river.generate(918273),false,'reselecting a reach does not rerun the world simulation');
});

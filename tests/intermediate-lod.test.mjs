import test from 'node:test';
import assert from 'node:assert/strict';
import {makeTile} from '../src/planet/planet-math.js';
import {intermediateLeaves,neighbors,selectPatches} from '../src/planet/quadtree.js';
import {planetCamera} from '../src/planet/camera.js';
const keys=nodes=>nodes.map(n=>n.key).sort().join('|');
function verify(old,next){
 const map=new Map(next.map(p=>[p.key,p]));assert.equal(map.size,next.length);
 let area=0;
 for(const p of next){
  area+=4**(-p.level);
  for(let l=0;l<p.level;l++){const s=2**(p.level-l);assert.ok(!map.has(`${p.face}/${l}/${Math.floor(p.x/s)}/${Math.floor(p.y/s)}`),'overlapping ancestor');}
  for(let e=0;e<4;e++)for(const n of neighbors(map,p,e))assert.ok(Math.abs(p.level-n.level)<=1,'unbalanced edge');
  for(const n of old)if(n.face===p.face){
   const l=Math.min(p.level,n.level),a=2**(p.level-l),b=2**(n.level-l);
   if(Math.floor(p.x/a)===Math.floor(n.x/b)&&Math.floor(p.y/a)===Math.floor(n.y/b))assert.ok(Math.abs(p.level-n.level)<=1,'skipped generation');
  }
 }
 assert.ok(Math.abs(area-6)<1e-10,'lost planetary coverage');
}
function converge(start,target,budget){
 let current=start;
 for(let i=0;i<40&&keys(current)!==keys(target);i++){
  const next=intermediateLeaves(current,target,budget);verify(current,next);
  assert.ok(next.length<=Math.max(current.length,budget));assert.notEqual(keys(current),keys(next),'stalled reconciliation');current=next;
 }
 assert.equal(keys(current),keys(target));
}
test('multi-level refinement and budget reduction use balanced intermediate coverings',()=>{
 const roots=Array.from({length:6},(_,face)=>makeTile(face,0,0,0));
 const fine=Array.from({length:6},(_,f)=>Array.from({length:64},(_,i)=>makeTile(f,3,i%8,i>>3))).flat();
 converge(roots,fine,384);converge(fine,roots,6);
});
test('intermediate coverings converge after a large camera change across cube faces',()=>{
 const options={budget:120,pixelSize:14};
 const a=selectPatches(planetCamera({mode:'orbit',altitude:14000,longitude:.8,latitude:.4},960,600),options).leaves;
 const b=selectPatches(planetCamera({mode:'orbit',altitude:50,longitude:2.2,latitude:-.2},960,600),options).leaves;
 converge(a,b,120);converge(b,a,120);
});

test('resident covering selections produce complete transition groups across the horizon',async()=>{
 const {coordinateTransitions}=await import('../src/planet/patch-transition.js');
 const options={budget:120,pixelSize:14,includeHidden:true};
 const a=planetCamera({mode:'orbit',altitude:14000,longitude:.8,latitude:.4},960,600);
 const b=planetCamera({mode:'orbit',altitude:50,longitude:2.2,latitude:-.2},960,600);
 let previous=selectPatches(a,options);
 assert.equal(previous.visible.length,previous.leaves.length);
 for(let step=0;step<12;step++){
  const next=selectPatches(b,{...options,previousLeaves:previous.leaves});
  assert.equal(next.visible.length,next.leaves.length);assert.ok(next.visible.length<=120);
  const components=coordinateTransitions(previous.visible,next.visible);
  for(const c of components){assert.ok(!c.deferredReasons.includes('incomplete-children'));assert.ok(!c.deferredReasons.includes('skipped-levels'));}
  verify(previous.leaves,next.leaves);previous=next;
 }
});

test('stable target covering returns the same topology on repeated selection',()=>{
 const camera=planetCamera({mode:'flight',altitude:500,longitude:.8,latitude:.4,heading:.45,pitch:1.48},960,600);
 const options={budget:120,pixelSize:14,includeHidden:true};const first=selectPatches(camera,options);
 const repeated=selectPatches(camera,{...options,previousLeaves:first.leaves});
 assert.deepEqual(repeated,first);verify(first.leaves,repeated.leaves);
});

test('compact unchanged covering skips stitch graph only for a complete resident tree',()=>{
 const camera=planetCamera({mode:'flight',altitude:500,longitude:.8,latitude:.4},960,600),options={budget:120,pixelSize:14,includeHidden:true};
 const first=selectPatches(camera,options);
 const compact=selectPatches(camera,{...options,previousLeaves:first.leaves,unchangedPatches:first.visible});
 assert.deepEqual(compact,{unchanged:true,leafCount:first.leaves.length,deepest:first.deepest});
 const partial=selectPatches(camera,{...options,previousLeaves:first.leaves,unchangedPatches:first.visible.slice(1)});
 assert.equal(partial.unchanged,undefined);assert.deepEqual(partial,first);
});

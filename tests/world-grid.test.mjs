import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWorldGrid} from '../src/planet/world-grid.js';
import {faceDirection} from '../src/planet/planet-math.js';

test('world simulation grid shares cube edges and corners and has a connected symmetric graph',()=>{
 const n=16,g=buildWorldGrid(n),width=n+1,at=(face,x,y)=>face*width*width+y*width+x;
 assert.equal(g.count,6*n*n+2);assert.equal(g.faceIndices.length,6*width*width);
 let totalArea=0;const uses=new Uint16Array(g.count);
 for(let face=0;face<6;face++)for(let y=0;y<=n;y++)for(let x=0;x<=n;x++){
  const i=g.faceIndices[at(face,x,y)],direction=faceDirection(face,x*2/n-1,y*2/n-1);uses[i]++;
  assert.ok(Math.hypot(...direction.map((v,k)=>v-g.directions[i*4+k]))<1e-6);
 }
 assert.equal([...uses].filter(c=>c===3).length,8);assert.equal([...uses].filter(c=>c===2).length,12*(n-1));
 for(let i=0;i<g.count;i++){
  totalArea+=g.directions[i*4+3];const adjacent=[...g.neighbors.subarray(i*8,i*8+8)].filter(v=>v!==0xffffffff);
  assert.ok(adjacent.length>=6&&adjacent.length<=8);assert.equal(new Set(adjacent).size,adjacent.length);
  for(const j of adjacent)assert.ok([...g.neighbors.subarray(j*8,j*8+8)].includes(i),`${i} -> ${j}`);
 }
 assert.ok(Math.abs(totalArea*(2/n)**2-4*Math.PI)<.03);
 const visited=new Uint8Array(g.count),queue=[0];visited[0]=1;
 for(let head=0;head<queue.length;head++)for(const n of g.neighbors.subarray(queue[head]*8,queue[head]*8+8))if(n!==0xffffffff&&!visited[n]){visited[n]=1;queue.push(n);}
 assert.equal(queue.length,g.count);
});

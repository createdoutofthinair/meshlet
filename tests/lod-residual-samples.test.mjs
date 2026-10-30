import test from 'node:test';
import assert from 'node:assert/strict';

test('compact LOD residual enumeration covers every non-coarse vertex once',()=>{
 const actual=new Set();
 for(let index=0;index<208;index++){
  const x=index<72?(index%8)*2+1:(index-72)%17;
  const y=index<72?Math.floor(index/8)*2:Math.floor((index-72)/17)*2+1;
  actual.add(`${x}/${y}`);
 }
 const expected=new Set();
 for(let y=0;y<17;y++)for(let x=0;x<17;x++)if(x%2||y%2)expected.add(`${x}/${y}`);
 assert.equal(actual.size,208);
 assert.deepEqual(actual,expected);
});

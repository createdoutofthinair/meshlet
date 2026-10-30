import test from 'node:test';
import assert from 'node:assert/strict';

test('early cloud-density rejection remains below the density threshold for every erosion extreme',()=>{
 for(let t=0;t<=100;t++)for(let k=0;k<=100;k++)for(let b=0;b<=100;b++){
  const detail=t/100,threshold=.3+.56*k/100,base=b/100;
  for(const lower of [threshold,threshold-.04*(1-detail)])if(base+.080001*detail<=lower){
   for(const noise of [0,.25,.5,.75,1])assert.ok(base+(noise-.5)*.16*detail<=lower+1e-12);
  }
 }
});

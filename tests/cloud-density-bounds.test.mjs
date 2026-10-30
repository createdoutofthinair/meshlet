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

test('first-octave bound never rejects a nonzero cloud sample',()=>{
 for(let t=0;t<=20;t++)for(let c=0;c<=20;c++)for(let n=0;n<=20;n++)for(let k=0;k<=20;k++){
  const detail=t/20,coarse=c/20,first=n/20,threshold=.3+.56*k/20;
  for(const lower of [threshold,threshold-.04*(1-detail)]){
   const upper=coarse*(1-detail)+(first*.68+.32001)*detail+.08001*detail;
   if(upper<=lower)for(const second of [0,.5,1])for(const erosion of [0,.5,1]){
    const sample=coarse*(1-detail)+(first*.68+second*.32)*detail+(erosion-.5)*.16*detail;
    assert.ok(sample<=lower+1e-12);
   }
  }
 }
});

test('coarse cloud bound cannot reject a sample with positive density',()=>{
 for(let t=0;t<=50;t++)for(let c=0;c<=50;c++)for(let k=0;k<=50;k++){
  const detail=t/50,coarse=c/50,threshold=.3+.56*k/50;
  for(const lower of [threshold,threshold-.04*(1-detail)]){
   const upper=coarse*(1-detail)+1.08002*detail;
   if(upper<=lower)for(const first of [0,.5,1])for(const second of [0,.5,1])for(const erosion of [0,.5,1]){
    const sample=coarse*(1-detail)+(first*.68+second*.32)*detail+(erosion-.5)*.16*detail;
    assert.ok(sample<=lower+1e-12);
   }
  }
 }
});

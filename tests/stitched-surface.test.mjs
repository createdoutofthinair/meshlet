import test from 'node:test';
import assert from 'node:assert/strict';

// Enumerate rendered triangles independently of the shader's local search.
function collapsed([x,y],mask){
 if(x===0&&(mask&1)&&y%2)y--;
 if(x===16&&(mask&2)&&y%2)y--;
 if(y===0&&(mask&4)&&x%2)x--;
 if(y===16&&(mask&8)&&x%2)x--;
 return [x,y];
}
function containing(q,mask){
 const out=[];
 for(let y=0;y<16;y++)for(let x=0;x<16;x++){
  const p=[[x,y],[x+1,y],[x,y+1],[x+1,y+1]].map(a=>collapsed(a,mask));
  for(const ids of [[0,1,2],[1,3,2]]){
   const [a,b,c]=ids.map(i=>p[i]),ab=[b[0]-a[0],b[1]-a[1]],ac=[c[0]-a[0],c[1]-a[1]],aq=[q[0]-a[0],q[1]-a[1]];
   const det=ab[0]*ac[1]-ab[1]*ac[0];if(!det)continue;
   const u=(aq[0]*ac[1]-aq[1]*ac[0])/det,v=(ab[0]*aq[1]-ab[1]*aq[0])/det;
   if(u>=-1e-9&&v>=-1e-9&&u+v<=1+1e-9)out.push({x,y,vertices:[a,b,c],weights:[1-u-v,u,v]});
  }
 }
 return out;
}
test('collapsed triangles cover the grid and are reachable from adjacent cells',()=>{
 for(let mask=0;mask<16;mask++)for(let iy=0;iy<=32;iy++)for(let ix=0;ix<=32;ix++){
  const q=[ix/2,iy/2],hits=containing(q,mask),base=q.map(v=>Math.min(15,Math.floor(v)));
  assert.ok(hits.some(h=>Math.abs(h.x-base[0])<=1&&Math.abs(h.y-base[1])<=1),'missing at '+mask+' '+q);
  for(const h of hits){const z=h.vertices.reduce((sum,p,i)=>sum+h.weights[i]*(2*p[0]-3*p[1]+7),0);assert.ok(Math.abs(z-(2*q[0]-3*q[1]+7))<1e-8);}
 }
});

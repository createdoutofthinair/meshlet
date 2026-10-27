@group(0) @binding(0) var<uniform> frame:PlanetFrame;
@group(0) @binding(1) var<storage,read> vertices:array<PlanetVertex>;
@group(0) @binding(2) var<storage,read> queue:array<u32>;
@group(0) @binding(3) var<storage,read_write> errors:array<f32>;
var<workgroup> residuals:array<f32,64>;
fn position(slot:u32,x:u32,y:u32)->vec3<f32>{
 return vertices[slot*GRID_COUNT+(y+2u)*GRID+x+2u].position.xyz;
}
// Measure how far the generated surface deviates from a grid with twice the
// cell spacing. The next finer level's error is estimated from this observed
// residual; this is not a mathematical upper bound for unsampled detail.
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) group:vec3<u32>,@builtin(local_invocation_index) lane:u32){
 if(group.x>=frame.counts.y){return;}let slot=queue[group.x];var largest=0.0;
 for(var index=lane;index<INNER_COUNT;index+=64u){
  let x=index%17u;let y=index/17u;let oddX=(x&1u)!=0u;let oddY=(y&1u)!=0u;
  if(oddX || oddY){
   var a:vec3<f32>;var b:vec3<f32>;
   if(oddX && oddY){a=position(slot,x-1u,y+1u);b=position(slot,x+1u,y-1u);}
   else if(oddX){a=position(slot,x-1u,y);b=position(slot,x+1u,y);}
   else{a=position(slot,x,y-1u);b=position(slot,x,y+1u);}
   largest=max(largest,length(position(slot,x,y)-(a+b)*.5));
  }
 }
 residuals[lane]=largest;workgroupBarrier();
 for(var step=32u;step>0u;step>>=1u){
  if(lane<step){residuals[lane]=max(residuals[lane],residuals[lane+step]);}
  workgroupBarrier();
 }
 if(lane==0u){errors[slot]=residuals[0];}
}

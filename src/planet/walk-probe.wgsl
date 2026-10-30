@group(0) @binding(0) var<storage,read> patches:array<Patch>;
@group(0) @binding(1) var<storage,read> vertices:array<PlanetVertex>;
struct WalkProbe {origin:vec4<f32>,direction:vec4<f32>,cell:vec4<u32>};
@group(0) @binding(2) var<uniform> probe:WalkProbe;
@group(0) @binding(3) var<storage,read_write> result:array<vec4<f32>>;

@group(0) @binding(4) var<storage,read> morphs:MorphStorage;

fn probeTriangle(a:vec3<f32>,b:vec3<f32>,c:vec3<f32>,origin:vec3<f32>,ray:vec3<f32>)->vec2<f32>{
 let ab=b-a;let ac=c-a;let normal=cross(ab,ac);let denom=dot(normal,ray);
 if(abs(denom)<1e-13){return vec2<f32>(0.0);}
 let t=dot(normal,a-origin)/denom;let ap=origin+ray*t-a;
 let d00=dot(ab,ab);let d01=dot(ab,ac);let d11=dot(ac,ac);
 let d20=dot(ap,ab);let d21=dot(ap,ac);let det=d00*d11-d01*d01;
 if(det<=1e-24){return vec2<f32>(0.0);}
 let u=(d11*d20-d01*d21)/det;let v=(d00*d21-d01*d20)/det;
 return vec2<f32>(t,select(0.0,1.0,u>=-.002 && v>=-.002 && u+v<=1.002));
}
@compute @workgroup_size(1)
fn main(){
 let slot=probe.cell.x;let tile=patches[slot];let origin=probe.origin.xyz;let ray=normalize(probe.direction.xyz);
 var found=false;var height=0.0;
 let metadata=morphs.patches[slot];
 if(metadata.slots.w!=0u && (metadata.slots.z&16u)!=0u){
  for(var meshlet=0u;meshlet<16u;meshlet++){
   let range=morphs.ranges[slot*16u+meshlet];
   for(var i=0u;i<range.y;i+=3u){
    let a=displayedSample(slot,morphs.coordinates[range.x+i]);
    let b=displayedSample(slot,morphs.coordinates[range.x+i+1u]);
    let c=displayedSample(slot,morphs.coordinates[range.x+i+2u]);
    let hit=probeTriangle(a,b,c,origin,ray);
    if(hit.y>.5 && (!found || hit.x>height)){height=hit.x;found=true;}
   }
  }
  result[0]=vec4<f32>(height+probe.origin.w,select(0.0,1.0,found),0.0,0.0);return;
 }
 // During a morph a radial ray need not hit its original fine-grid cell.
 // Search the complete patch then; normal probes keep the small neighborhood.
 let moving=morphs.patches[slot].slots.w!=0u && morphs.patches[slot].mapping.w<1.0;
 let start=select(vec2<i32>(probe.cell.yz)-vec2<i32>(1),vec2<i32>(0),moving);
 let end=select(vec2<i32>(probe.cell.yz)+vec2<i32>(1),vec2<i32>(i32(CELLS)-1),moving);
 for(var cy=start.y;cy<=end.y;cy++){for(var cx=start.x;cx<=end.x;cx++){
  if(cx<0 || cy<0 || cx>=i32(CELLS) || cy>=i32(CELLS)){continue;}
  let cell=vec2<u32>(u32(cx),u32(cy));
  // The two grid triangles share two vertices. Evaluate each corner once,
  // retaining the exact rendered winding and intersection order.
  let a=displayedPosition(slot,cell,tile.details.z);
  let b=displayedPosition(slot,cell+vec2<u32>(1u,0u),tile.details.z);
  let c=displayedPosition(slot,cell+vec2<u32>(0u,1u),tile.details.z);
  let d=displayedPosition(slot,cell+vec2<u32>(1u,1u),tile.details.z);
  let first=probeTriangle(a,b,c,origin,ray);
  if(first.y>.5 && (!found || first.x>height)){height=first.x;found=true;}
  let second=probeTriangle(b,d,c,origin,ray);
  if(second.y>.5 && (!found || second.x>height)){height=second.x;found=true;}
 }}
 result[0]=vec4<f32>(height+probe.origin.w,select(0.0,1.0,found),0.0,0.0);
}

@group(0) @binding(0) var<storage,read> patches:array<Patch>;
@group(0) @binding(1) var<storage,read> vertices:array<PlanetVertex>;
struct WalkProbe {origin:vec4<f32>,direction:vec4<f32>,cell:vec4<u32>};
@group(0) @binding(2) var<uniform> probe:WalkProbe;
@group(0) @binding(3) var<storage,read_write> result:array<vec4<f32>>;

@compute @workgroup_size(1)
fn main(){
 let slot=probe.cell.x;let tile=patches[slot];let origin=probe.origin.xyz;let ray=normalize(probe.direction.xyz);
 var found=false;var height=0.0;
 // Adjacent cells cover degenerate stitched triangles and exact grid edges.
 for(var dy=-1;dy<=1;dy++) {for(var dx=-1;dx<=1;dx++){
  let cx=i32(probe.cell.y)+dx;let cy=i32(probe.cell.z)+dy;
  if(cx<0 || cy<0 || cx>=i32(CELLS) || cy>=i32(CELLS)){continue;}
  let cell=vec2<u32>(u32(cx),u32(cy));
  let offsets=array<vec2<u32>,6>(vec2<u32>(0u,0u),vec2<u32>(1u,0u),vec2<u32>(0u,1u),vec2<u32>(1u,0u),vec2<u32>(1u,1u),vec2<u32>(0u,1u));
  for(var tri=0u;tri<2u;tri++){
   let a=at(slot,cell+offsets[tri*3u],tile.details.z);
   let b=at(slot,cell+offsets[tri*3u+1u],tile.details.z);
   let c=at(slot,cell+offsets[tri*3u+2u],tile.details.z);
   let ab=b-a;let ac=c-a;let normal=cross(ab,ac);let denom=dot(normal,ray);
   if(abs(denom)<1e-13){continue;}
   let t=dot(normal,a-origin)/denom;let ap=origin+ray*t-a;
   let d00=dot(ab,ab);let d01=dot(ab,ac);let d11=dot(ac,ac);
   let d20=dot(ap,ab);let d21=dot(ap,ac);let det=d00*d11-d01*d01;
   if(det<=1e-24){continue;}
   let u=(d11*d20-d01*d21)/det;let v=(d00*d21-d01*d20)/det;
   if(u>=-.002 && v>=-.002 && u+v<=1.002){if(!found || t>height){height=t;found=true;}}
  }
 }}
 result[0]=vec4<f32>(height+probe.origin.w,select(0.0,1.0,found),0.0,0.0);
}

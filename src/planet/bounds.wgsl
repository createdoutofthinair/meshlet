@group(0) @binding(0) var<uniform> frame: PlanetFrame;
@group(0) @binding(1) var<storage,read> vertices: array<PlanetVertex>;
@group(0) @binding(2) var<storage,read_write> bounds: array<Bound>;
@group(0) @binding(3) var<storage,read> queue: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>) {
 let index=gid.x;if(index>=frame.counts.y*MESHLETS_PER_PATCH){return;}
 let slot=queue[index/MESHLETS_PER_PATCH];let meshlet=index%MESHLETS_PER_PATCH;
 let x0=(meshlet%4u)*4u+2u;let y0=(meshlet/4u)*4u+2u;
 var lo=vec3<f32>(1e30);var hi=vec3<f32>(-1e30);
 for(var y=0u;y<=4u;y++){for(var x=0u;x<=4u;x++){
  let p=vertices[slot*GRID_COUNT+(y0+y)*GRID+x0+x].position.xyz;lo=min(lo,p);hi=max(hi,p);
 }}
 let center=(lo+hi)*.5;let radius=length((hi-lo)*.5)*1.0001+.00001;
 bounds[slot*MESHLETS_PER_PATCH+meshlet].sphere=vec4<f32>(center,radius);
}

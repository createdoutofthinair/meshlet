@group(0) @binding(0) var<uniform> frame: PlanetFrame;
@group(0) @binding(1) var<storage,read> patches: array<Patch>;
@group(0) @binding(2) var<storage,read_write> vertices: array<PlanetVertex>;
@group(0) @binding(3) var<storage,read> queue: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>) {
 let index=gid.x;if(index>=frame.counts.y*INNER_COUNT){return;}
 let slot=queue[index/INNER_COUNT];let v=index%INNER_COUNT;
 let x=v%17u+1u;let y=v/17u+1u;let base=slot*GRID_COUNT+y*GRID+x;
 let du=vertices[base+1u].position.xyz-vertices[base-1u].position.xyz;
 let dv=vertices[base+GRID].position.xyz-vertices[base-GRID].position.xyz;
 var n=normalize(cross(du,dv));if(dot(n,patches[slot].centerDirection.xyz)<0.0){n=-n;}
 let avg=(vertices[base-1u].position.w+vertices[base+1u].position.w+vertices[base-GRID].position.w+vertices[base+GRID].position.w)*.25;
 let cellSize=max(.001,patches[slot].cube.w*frame.settings.x/f32(CELLS));
 let cavity=clamp(max(0.0,avg-vertices[base].position.w)/cellSize*3.0,0.0,1.0);
 vertices[base].normal=vec4<f32>(n,cavity);
}

@group(0) @binding(0) var<uniform> frame: PlanetFrame;
@group(0) @binding(1) var<storage,read> patches: array<Patch>;
@group(0) @binding(2) var<storage,read> bounds: array<Bound>;
@group(0) @binding(3) var<storage,read> activeSlots: array<u32>;
@group(0) @binding(4) var<storage,read_write> visible: array<u32>;
struct Indirect { vertexCount:u32,instanceCount:atomic<u32>,firstVertex:u32,firstInstance:u32 };
@group(0) @binding(5) var<storage,read_write> indirect: Indirect;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>) {
 let index=gid.x;if(index>=frame.counts.x*MESHLETS_PER_PATCH){return;}
 let slot=activeSlots[index/MESHLETS_PER_PATCH];let meshlet=index%MESHLETS_PER_PATCH;
 let bound=bounds[slot*MESHLETS_PER_PATCH+meshlet].sphere;
 let center=bound.xyz+patches[slot].relative.xyz;
 if((frame.counts.w & 1u)!=0u){for(var p=0u;p<5u;p++){let plane=frame.planes[p];if(dot(plane.xyz,center)+plane.w < -bound.w){return;}}}
 let dest=atomicAdd(&indirect.instanceCount,1u);visible[dest]=(slot<<4u)|meshlet;
}

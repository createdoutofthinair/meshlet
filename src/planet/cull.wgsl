@group(0) @binding(0) var<uniform> frame: PlanetFrame;
@group(0) @binding(1) var<storage,read> patches: array<Patch>;
@group(0) @binding(2) var<storage,read> bounds: array<Bound>;
@group(0) @binding(3) var<storage,read> activeSlots: array<u32>;
@group(0) @binding(4) var<storage,read_write> visible: array<u32>;
struct Indirect { vertexCount:u32,instanceCount:atomic<u32>,firstVertex:u32,firstInstance:u32 };
@group(0) @binding(5) var<storage,read_write> indirect: Indirect;
@group(0) @binding(6) var<storage,read> morphs:MorphStorage;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>) {
 let index=gid.x;if(index>=frame.counts.x*MESHLETS_PER_PATCH){return;}
 let slot=activeSlots[index/MESHLETS_PER_PATCH];let meshlet=index%MESHLETS_PER_PATCH;
 var bound=bounds[slot*MESHLETS_PER_PATCH+meshlet].sphere;
 let morph=morphs.patches[slot];
 if(morph.slots.w!=0u && (morph.mapping.w<1.0 || (morph.slots.z&16u)!=0u)){
  // Parent samples are convex combinations of its rendered vertices. The
  // union of all parent meshlet spheres contains every possible endpoint,
  // including stitched and skipped-level mappings. This broad bound is
  // intentionally conservative until per-child endpoint bounds are cached.
  var lo=bound.xyz-vec3<f32>(bound.w);var hi=bound.xyz+vec3<f32>(bound.w);
  let delta=patches[morph.slots.x].relative.xyz-patches[slot].relative.xyz;
  for(var i=0u;i<MESHLETS_PER_PATCH;i++){
   if((morph.slots.z&16u)!=0u){
    let fine=bounds[slot*MESHLETS_PER_PATCH+i].sphere;
    lo=min(lo,fine.xyz-vec3<f32>(fine.w));hi=max(hi,fine.xyz+vec3<f32>(fine.w));
   }
   let parent=bounds[morph.slots.x*MESHLETS_PER_PATCH+i].sphere;
   let center=parent.xyz+delta;
   lo=min(lo,center-vec3<f32>(parent.w));hi=max(hi,center+vec3<f32>(parent.w));
  }
  bound=vec4<f32>((lo+hi)*.5,length((hi-lo)*.5)*1.0001+.00001);
 }
 let center=bound.xyz+patches[slot].relative.xyz;
 if((frame.counts.w & 1u)!=0u){for(var p=0u;p<5u;p++){let plane=frame.planes[p];if(dot(plane.xyz,center)+plane.w < -bound.w){return;}}}
 let dest=atomicAdd(&indirect.instanceCount,1u);visible[dest]=(slot<<4u)|meshlet;
}

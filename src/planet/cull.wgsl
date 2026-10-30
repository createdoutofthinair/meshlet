@group(0) @binding(0) var<uniform> frame: PlanetFrame;
@group(0) @binding(1) var<storage,read> patches: array<Patch>;
@group(0) @binding(2) var<storage,read> bounds: array<Bound>;
@group(0) @binding(3) var<storage,read> activeSlots: array<u32>;
@group(0) @binding(4) var<storage,read_write> visible: array<u32>;
struct Indirect { vertexCount:u32,instanceCount:atomic<u32>,firstVertex:u32,firstInstance:u32 };
@group(0) @binding(5) var<storage,read_write> indirect: Indirect;
@group(0) @binding(6) var<storage,read> morphs:MorphStorage;
// Four patches per workgroup. Parent unions are shared by all 16 meshlets
// of each patch instead of reading the same parent bounds 16 times.
var<workgroup> unionLo:array<vec3<f32>,4>;
var<workgroup> unionHi:array<vec3<f32>,4>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3<u32>) {
 let index=gid.x;
 if((frame.counts.w & 1u)!=0u && lane<4u){
  let patchIndex=group.x*4u+lane;
  if(patchIndex<frame.counts.x){
   let sharedSlot=activeSlots[patchIndex];let m=morphs.patches[sharedSlot];
   if(m.slots.w!=0u && (m.mapping.w<1.0 || (m.slots.z&16u)!=0u)){
    var lo=vec3<f32>(1e30);var hi=vec3<f32>(-1e30);
    let delta=patches[m.slots.x].relative.xyz-patches[sharedSlot].relative.xyz;
    for(var i=0u;i<MESHLETS_PER_PATCH;i++){
     if((m.slots.z&16u)!=0u){let fine=bounds[sharedSlot*MESHLETS_PER_PATCH+i].sphere;lo=min(lo,fine.xyz-vec3<f32>(fine.w));hi=max(hi,fine.xyz+vec3<f32>(fine.w));}
     let parent=bounds[m.slots.x*MESHLETS_PER_PATCH+i].sphere;let center=parent.xyz+delta;
     lo=min(lo,center-vec3<f32>(parent.w));hi=max(hi,center+vec3<f32>(parent.w));
    }
    unionLo[lane]=lo;unionHi[lane]=hi;
   }
  }
 }
 workgroupBarrier();
 if(index>=frame.counts.x*MESHLETS_PER_PATCH){return;}
 let slot=activeSlots[index/MESHLETS_PER_PATCH];let meshlet=index%MESHLETS_PER_PATCH;
 // With frustum culling disabled no bounds or morph union is needed. Keep
 // the same indirect draw entries without touching the bounds buffers.
 if((frame.counts.w & 1u)==0u){
  let dest=atomicAdd(&indirect.instanceCount,1u);visible[dest]=(slot<<4u)|meshlet;return;
 }
 var bound=bounds[slot*MESHLETS_PER_PATCH+meshlet].sphere;
 let morph=morphs.patches[slot];
 if(morph.slots.w!=0u && (morph.mapping.w<1.0 || (morph.slots.z&16u)!=0u)){
  // Parent samples are convex combinations of its rendered vertices. The
  // union of all parent meshlet spheres contains every possible endpoint,
  // including stitched and skipped-level mappings. This broad bound is
  // intentionally conservative until per-child endpoint bounds are cached.
  let sharedIndex=lane/MESHLETS_PER_PATCH;
  let lo=min(bound.xyz-vec3<f32>(bound.w),unionLo[sharedIndex]);
  let hi=max(bound.xyz+vec3<f32>(bound.w),unionHi[sharedIndex]);
  bound=vec4<f32>((lo+hi)*.5,length((hi-lo)*.5)*1.0001+.00001);
 }
 let center=bound.xyz+patches[slot].relative.xyz;
 for(var p=0u;p<5u;p++){let plane=frame.planes[p];if(dot(plane.xyz,center)+plane.w < -bound.w){return;}}
 let dest=atomicAdd(&indirect.instanceCount,1u);visible[dest]=(slot<<4u)|meshlet;
}

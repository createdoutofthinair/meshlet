@group(0) @binding(2) var<storage,read> world:HydroStorage;
@group(0) @binding(3) var<storage,read_write> candidates:array<vec2<u32>>;
var<workgroup> candidateScores:array<u32,64>;
var<workgroup> candidateIds:array<u32,64>;
const REACH_GROUPS:u32=385u;
@compute @workgroup_size(64)
fn chooseNodes(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(workgroup_id) group:vec3<u32>,@builtin(local_invocation_index) lane:u32){
 let id=gid.x;var score=0u;var selected=0xffffffffu;
 if(id<WORLD_COUNT){
  let cell=world.cells[id];let next=cell.route.x;
  if(next!=0xffffffffu && cell.profile.z>=2.0 && cell.profile.y>.05 && world.cells[next].profile.y>0.0){
   let start=bitcast<f32>(cell.route.y);let finish=bitcast<f32>(world.cells[next].route.y);let width=world.paths[id*RIVER_SAMPLES+8u].w;
   if(start>finish && width>0.0){
    let random=riverHash(vec2<f32>(f32(id)+f32(riverFrame.config.x%65521u)*.013,f32(riverFrame.config.y)*53.3+9.0));
    let weight=.04*clamp(log2(1.0+cell.profile.z),0.0,10.0);score=bitcast<u32>(random+weight+.001);selected=id;
   }
  }
 }
 candidateScores[lane]=score;candidateIds[lane]=selected;workgroupBarrier();
 for(var step=32u;step>0u;step>>=1u){if(lane<step && candidateScores[lane+step]>candidateScores[lane]){candidateScores[lane]=candidateScores[lane+step];candidateIds[lane]=candidateIds[lane+step];}workgroupBarrier();}
 if(lane==0u){candidates[group.x]=vec2<u32>(candidateIds[0],candidateScores[0]);}
}
@compute @workgroup_size(64)
fn selectReach(@builtin(local_invocation_index) lane:u32){
 var best=vec2<u32>(0xffffffffu,0u);for(var i=lane;i<REACH_GROUPS;i+=64u){let item=candidates[i];if(item.y>best.y){best=item;}}
 candidateIds[lane]=best.x;candidateScores[lane]=best.y;workgroupBarrier();
 for(var step=32u;step>0u;step>>=1u){if(lane<step && candidateScores[lane+step]>candidateScores[lane]){candidateScores[lane]=candidateScores[lane+step];candidateIds[lane]=candidateIds[lane+step];}workgroupBarrier();}
 if(lane==0u){reach.ids=vec4<u32>(candidateIds[0],0xffffffffu,0u,0u);}
}
@compute @workgroup_size(1)
fn prepareReach(){
 let id=reach.ids.x;if(id==0xffffffffu || id>=WORLD_COUNT){return;}let cell=world.cells[id];let next=cell.route.x;
 let before=world.paths[id*RIVER_SAMPLES+7u].xyz;let mid=world.paths[id*RIVER_SAMPLES+8u];let after=world.paths[id*RIVER_SAMPLES+9u].xyz;
 let radial=normalize(mid.xyz);let raw=after-before;let tangent=normalize(raw-radial*dot(raw,radial));let side=normalize(cross(tangent,radial));
 let prevDelta=(before-mid.xyz)*6371000.0;let nextDelta=(after-mid.xyz)*6371000.0;
 let prevZ=dot(prevDelta,tangent);let nextZ=dot(nextDelta,tangent);
 let upstream=dot(prevDelta,side)/min(-1.0,prevZ);let downstream=dot(nextDelta,side)/max(1.0,nextZ);
 let delta=max(.00001,bitcast<f32>(cell.route.y)-bitcast<f32>(world.cells[next].route.y))*1000.0;
 let lengthM=max(1.0,length(world.paths[id*RIVER_SAMPLES].xyz-world.paths[id*RIVER_SAMPLES+16u].xyz)*6371000.0);
 let grade=clamp(delta/lengthM,.0002,.006);let phase=riverHash(vec2<f32>(f32(id),f32(riverFrame.config.x%65521u)))*6.2831853;
 reach.info=vec4<f32>(clamp(mid.w*1000.0,40.0,200.0),grade,cell.profile.z,phase);
 reach.bend=vec4<f32>(clamp(upstream,-.5,.5),clamp(downstream,-.5,.5),lengthM,delta);
 reach.anchor=vec4<f32>(radial,0.0);reach.downstream=vec4<f32>(tangent,0.0);reach.ids=vec4<u32>(id,next,1u,0u);
}

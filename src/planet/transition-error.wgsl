@group(0) @binding(0) var<uniform> frame:PlanetFrame;
@group(0) @binding(1) var<storage,read> patches:array<Patch>;
@group(0) @binding(2) var<storage,read> vertices:array<PlanetVertex>;
struct TransitionPair {slots:vec4<u32>,mapping:vec4<f32>};
@group(0) @binding(3) var<storage,read> pairs:array<TransitionPair>;
@group(0) @binding(4) var<storage,read_write> errors:array<vec2<f32>>;
var<workgroup> pixelErrors:array<f32,64>;
var<workgroup> worldErrors:array<f32,64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) group:vec3<u32>,@builtin(local_invocation_index) lane:u32){
 let p=pairs[group.x];var maxPixel=0.0;var maxWorld=0.0;
 for(var i=lane;i<INNER_COUNT;i+=64u){
  let grid=vec2<u32>(i%17u,i/17u);let actual=stitchCoord(grid,p.slots.z);
  let child=at(p.slots.x,grid,p.slots.z);
  let parent=parentSurface(p.slots.y,p.mapping.xy+vec2<f32>(actual)*p.mapping.z,p.slots.w);
  maxWorld=max(maxWorld,length(child-parent));
  let a=frame.viewProjection*vec4<f32>(child,1.0);let b=frame.viewProjection*vec4<f32>(parent,1.0);
  // Ignore pairs wholly outside a generous viewport margin. Otherwise a
  // vertex behind the viewer can keep an unrelated on-screen LOD frozen.
  // A crossing near the view is flagged as an unresolved transition.
  if(a.w>0.0 || b.w>0.0){
   if(a.w<=.00001 || b.w<=.00001){
    let front=select(b,a,a.w>.00001);let projected=front.xy/front.w;
    if(all(abs(projected)<=vec2<f32>(2.0))){maxPixel=max(maxPixel,100000.0);}
   }else{
    let first=a.xy/a.w;let second=b.xy/b.w;let low=min(first,second);let high=max(first,second);
    if(all(low<=vec2<f32>(2.0)) && all(high>=vec2<f32>(-2.0))){
     let screen=vec2<f32>(frame.queueCounts.zw)*.5;maxPixel=max(maxPixel,length((first-second)*screen));
    }
   }
  }
 }
 pixelErrors[lane]=maxPixel;worldErrors[lane]=maxWorld;workgroupBarrier();
 for(var step=32u;step>0u;step>>=1u){
  if(lane<step){pixelErrors[lane]=max(pixelErrors[lane],pixelErrors[lane+step]);worldErrors[lane]=max(worldErrors[lane],worldErrors[lane+step]);}
  workgroupBarrier();
 }
 if(lane==0u){errors[group.x]=vec2<f32>(pixelErrors[0],worldErrors[0]);}
}

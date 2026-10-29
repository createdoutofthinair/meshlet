@group(0) @binding(0) var<uniform> frame:PlanetFrame;
@group(0) @binding(1) var<storage,read> patches:array<Patch>;
@group(0) @binding(2) var<storage,read> vertices:array<PlanetVertex>;
struct TransitionPair {slots:vec4<u32>,mapping:vec4<f32>};
@group(0) @binding(3) var<storage,read> pairs:array<TransitionPair>;
@group(0) @binding(4) var<storage,read_write> errors:array<vec2<f32>>;
var<workgroup> pixelErrors:array<f32,64>;
var<workgroup> worldErrors:array<f32,64>;
fn stitched(point:vec2<u32>,mask:u32)->vec2<u32>{
 var p=point;
 if(p.x==0u && (mask&1u)!=0u && p.y%2u!=0u){p.y-=1u;}
 if(p.x==CELLS && (mask&2u)!=0u && p.y%2u!=0u){p.y-=1u;}
 if(p.y==0u && (mask&4u)!=0u && p.x%2u!=0u){p.x-=1u;}
 if(p.y==CELLS && (mask&8u)!=0u && p.x%2u!=0u){p.x-=1u;}
 return p;
}
fn at(slot:u32,point:vec2<u32>,mask:u32)->vec3<f32>{
 let p=stitched(point,mask);
 return patches[slot].relative.xyz+vertices[slot*GRID_COUNT+(p.y+2u)*GRID+p.x+2u].position.xyz;
}
fn parentSurface(slot:u32,coord:vec2<f32>,mask:u32)->vec3<f32>{
 let q=clamp(coord,vec2<f32>(0.0),vec2<f32>(16.0));
 // Along a collapsed edge, the visible segment spans two cells. Sampling
 // the collapsed odd vertex directly would report a false tangential error.
 if((q.x==0.0 && (mask&1u)!=0u)||(q.x==16.0 && (mask&2u)!=0u)){
  let y=u32(min(floor(q.y*.5)*2.0,14.0));
  return mix(at(slot,vec2<u32>(u32(q.x),y),mask),at(slot,vec2<u32>(u32(q.x),y+2u),mask),(q.y-f32(y))*.5);
 }
 if((q.y==0.0 && (mask&4u)!=0u)||(q.y==16.0 && (mask&8u)!=0u)){
  let x=u32(min(floor(q.x*.5)*2.0,14.0));
  return mix(at(slot,vec2<u32>(x,u32(q.y)),mask),at(slot,vec2<u32>(x+2u,u32(q.y)),mask),(q.x-f32(x))*.5);
 }
 let cell=vec2<u32>(min(floor(q),vec2<f32>(15.0)));let f=q-vec2<f32>(cell);
 let a=at(slot,cell,mask);let b=at(slot,cell+vec2<u32>(1u,0u),mask);
 let c=at(slot,cell+vec2<u32>(0u,1u),mask);let d=at(slot,cell+vec2<u32>(1u,1u),mask);
 if(f.x+f.y<=1.0){return a*(1.0-f.x-f.y)+b*f.x+c*f.y;}
 return b*(1.0-f.y)+c*(1.0-f.x)+d*(f.x+f.y-1.0);
}
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) group:vec3<u32>,@builtin(local_invocation_index) lane:u32){
 let p=pairs[group.x];var maxPixel=0.0;var maxWorld=0.0;
 for(var i=lane;i<INNER_COUNT;i+=64u){
  let grid=vec2<u32>(i%17u,i/17u);let actual=stitched(grid,p.slots.z);
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

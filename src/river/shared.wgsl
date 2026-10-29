// Distances in this local reach are meters. Positive z is downstream.
struct RiverFrame {
 viewProjection:mat4x4<f32>,
 cameraDelta:vec4<f32>, // camera xyz, frame delta seconds
 sunSpeed:vec4<f32>, // light xyz, flow speed meters/second
 shape:vec4<f32>, // width multiplier, channel depth m, bank height m, roughness
 optics:vec4<f32>, // clarity, ripple strength, foam, flow arrows
 config:vec4<u32>, // seed, reach variant, reserved, reserved
};
struct Reach {
 info:vec4<f32>, // half width m, surface slope, discharge, local phase
 bend:vec4<f32>, // upstream/downstream centerline slope, segment length m, filled drop m
 anchor:vec4<f32>, // geographic direction at midpoint
 downstream:vec4<f32>, // world-space downstream tangent
 ids:vec4<u32>, // upstream node, downstream node, validity, reserved
};
struct RiverVertex {position:vec4<f32>,normal:vec4<f32>,material:vec4<f32>};
@group(0) @binding(0) var<uniform> riverFrame:RiverFrame;
@group(0) @binding(1) var<storage,read> reach:Reach;
const TERRAIN_GRID:u32=192u;
const WATER_ALONG:u32=192u;
const WATER_ACROSS:u32=48u;
const REACH_LENGTH:f32=1200.0;
const REACH_WIDTH:f32=900.0;
fn riverHash(p:vec2<f32>)->f32{return fract(sin(dot(p,vec2<f32>(127.1,311.7)))*43758.5453);}
fn riverNoise(p:vec2<f32>)->f32{
 let i=floor(p);let f=fract(p);let s=f*f*(vec2<f32>(3.0)-2.0*f);
 return mix(mix(riverHash(i),riverHash(i+vec2<f32>(1.0,0.0)),s.x),mix(riverHash(i+vec2<f32>(0.0,1.0)),riverHash(i+vec2<f32>(1.0,1.0)),s.x),s.y);
}
fn riverFbm(p:vec2<f32>)->f32{return riverNoise(p)*.57+riverNoise(p*2.07+vec2<f32>(12.7,7.1))*.28+riverNoise(p*4.13+vec2<f32>(4.8,19.2))*.15;}
fn riverHalfWidth()->f32{return clamp(reach.info.x*riverFrame.shape.x,20.0,280.0);}
fn riverCenter(z:f32)->f32{
 let base=z*select(reach.bend.x,reach.bend.y,z>=0.0);let phase=reach.info.w;
 let broad=sin(z/225.0+phase)-sin(phase);let fine=sin(z/81.0+phase*1.7)-sin(phase*1.7);
 return base+min(18.0,riverHalfWidth()*.18)*broad+3.0*fine;
}
fn riverLevel(z:f32)->f32{return -z*reach.info.y;}
fn riverDepth(q:f32)->f32{return riverFrame.shape.y*(1.0-smoothstep(.10,1.0,abs(q)));}
fn riverGround(p:vec2<f32>)->f32{
 let q=abs(p.x-riverCenter(p.y))/riverHalfWidth();
 let bank=riverFrame.shape.z*smoothstep(.91,1.70,q);
 let terrain=(riverFbm(p*.006+vec2<f32>(reach.info.w,31.0))-.5)*riverFrame.shape.w*12.0*smoothstep(.75,1.55,q);
 let fine=(riverNoise(p*.055+vec2<f32>(11.2,reach.info.w))-.5)*riverFrame.shape.w*1.1*smoothstep(.88,1.2,q);
 return riverLevel(p.y)-riverDepth(q)+bank+terrain+fine;
}
fn riverNormal(p:vec2<f32>)->vec3<f32>{
 let step=1.0;let left=riverGround(p-vec2<f32>(step,0.0));let right=riverGround(p+vec2<f32>(step,0.0));
 let before=riverGround(p-vec2<f32>(0.0,step));let after=riverGround(p+vec2<f32>(0.0,step));
 return normalize(vec3<f32>(left-right,2.0*step,before-after));
}

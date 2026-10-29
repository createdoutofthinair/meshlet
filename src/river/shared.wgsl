// Distances in this local reach are meters. Positive z is downstream.
struct RiverFrame {
 viewProjection:mat4x4<f32>,
 cameraDelta:vec4<f32>, // camera xyz, frame delta seconds
 sunSpeed:vec4<f32>, // light xyz, flow speed meters/second
 shape:vec4<f32>, // width multiplier, channel depth m, bank height m, roughness
 optics:vec4<f32>, // clarity, ripple strength, foam, flow arrows
 config:vec4<u32>, // seed, reach variant, viewport width and height
 reflectionViewProjection:mat4x4<f32>, // view reflected in the sloped river plane
};
struct Reach {
 info:vec4<f32>, // half width m, surface slope, discharge, local phase
 bend:vec4<f32>, // upstream/downstream centerline slope, segment length m, filled drop m
 anchor:vec4<f32>, // geographic direction at midpoint
 downstream:vec4<f32>, // world-space downstream tangent
 ids:vec4<u32>, // upstream node, downstream node, validity, reserved
};
struct RiverVertex {position:vec4<f32>,normal:vec4<f32>,material:vec4<f32>};
struct RiverRock {position:vec4<f32>,shape:vec4<f32>}; // center x, water level, z, radius; depth, exposed height, x/z scales
@group(0) @binding(0) var<uniform> riverFrame:RiverFrame;
@group(0) @binding(1) var<storage,read> reach:Reach;
const TERRAIN_GRID:u32=192u;
const WATER_ALONG:u32=384u;
const WATER_ACROSS:u32=128u;
const RIVER_ROCKS:u32=12u;
const REACH_LENGTH:f32=1200.0;
const REACH_WIDTH:f32=900.0;
fn riverHash(p:vec2<f32>)->f32{return fract(sin(dot(p,vec2<f32>(127.1,311.7)))*43758.5453);}
fn riverNoise(p:vec2<f32>)->f32{
 let i=floor(p);let f=fract(p);let s=f*f*(vec2<f32>(3.0)-2.0*f);
 return mix(mix(riverHash(i),riverHash(i+vec2<f32>(1.0,0.0)),s.x),mix(riverHash(i+vec2<f32>(0.0,1.0)),riverHash(i+vec2<f32>(1.0,1.0)),s.x),s.y);
}
fn riverFbm(p:vec2<f32>)->f32{return riverNoise(p)*.57+riverNoise(p*2.07+vec2<f32>(12.7,7.1))*.28+riverNoise(p*4.13+vec2<f32>(4.8,19.2))*.15;}
fn riverHalfWidth()->f32{return clamp(reach.info.x*riverFrame.shape.x,20.0,280.0);}
fn riverWaveNumber()->f32{return 6.2831853/clamp(riverHalfWidth()*16.0,650.0,4480.0);}
fn riverCenter(z:f32)->f32{
 let w=riverHalfWidth();let k=riverWaveNumber();let phase=reach.info.w;
 let average=(reach.bend.x+reach.bend.y)*.5;let change=(reach.bend.y-reach.bend.x)*.5;
 let base=average*z+change*(sqrt(z*z+360000.0)-600.0);
 return base+w*.58*(sin(z*k+phase)-sin(phase))+w*.15*(sin(z*k*.61+phase*1.7)-sin(phase*1.7));
}
fn riverCenterSlope(z:f32)->f32{
 let w=riverHalfWidth();let k=riverWaveNumber();let phase=reach.info.w;
 let average=(reach.bend.x+reach.bend.y)*.5;let change=(reach.bend.y-reach.bend.x)*.5;
 return average+change*z/sqrt(z*z+360000.0)+w*.58*k*cos(z*k+phase)+w*.15*k*.61*cos(z*k*.61+phase*1.7);
}
// Positive curvature turns toward +x: the outside, scoured bank is at -q.
fn riverCurvature(z:f32)->f32{
 let w=riverHalfWidth();let k=riverWaveNumber();let phase=reach.info.w;
 let change=(reach.bend.y-reach.bend.x)*.5;let base=change*360000.0/pow(z*z+360000.0,1.5);
 let bend=base-w*.58*k*k*sin(z*k+phase)-w*.15*k*k*.61*.61*sin(z*k*.61+phase*1.7);
 return clamp(bend*w*8.0,-1.0,1.0);
}
fn riverLevel(z:f32)->f32{return -z*reach.info.y;}
fn riverRiffle(z:f32)->f32{return 1.0-smoothstep(.08,.65,abs(riverCurvature(z)));}
fn riverDepthAtBend(q:f32,bend:f32)->f32{
 let profile=1.0-smoothstep(.0,1.0,abs(q));let riffle=1.0-smoothstep(.08,.65,abs(bend));
 // Pools deepen on the outside of bends; the shallow crossings form riffles.
 return riverFrame.shape.y*profile*(1.0-.5*bend*clamp(q,-1.0,1.0))*(1.0-.24*riffle);
}
fn riverDepth(q:f32,z:f32)->f32{return riverDepthAtBend(q,riverCurvature(z));}
fn riverFlowSpeedAtBend(q:f32,bend:f32)->f32{
 let profile=.18+.82*(1.0-smoothstep(.15,1.0,abs(q)));
 return profile*clamp(1.0-.30*bend*q,.7,1.3);
}
fn riverFlowSpeed(q:f32,z:f32)->f32{return riverFlowSpeedAtBend(q,riverCurvature(z));}
fn riverFlowCoordinate(z:f32,distance:f32,speed:f32)->f32{return z-distance*speed;}
fn riverGround(p:vec2<f32>)->f32{
 let w=riverHalfWidth();let q=(p.x-riverCenter(p.y))/w;let side=abs(q);let bend=riverCurvature(p.y);
 let inside=clamp(.5+.5*bend*q,0.0,1.0);let bankRun=mix(.32,1.05,inside)*w;
 let bank=riverFrame.shape.z*smoothstep(0.0,bankRun,max(0.0,(side-1.0)*w));
 let terrain=(riverFbm(p*.006+vec2<f32>(reach.info.w,31.0))-.5)*riverFrame.shape.w*9.0*smoothstep(1.02,1.9,side);
 let fine=(riverNoise(p*.055+vec2<f32>(11.2,reach.info.w))-.5)*riverFrame.shape.w*.8*smoothstep(1.01,1.45,side);
 return riverLevel(p.y)-riverDepthAtBend(q,bend)+bank+terrain+fine;
}
fn riverNormal(p:vec2<f32>)->vec3<f32>{
 let step=1.0;let left=riverGround(p-vec2<f32>(step,0.0));let right=riverGround(p+vec2<f32>(step,0.0));
 let before=riverGround(p-vec2<f32>(0.0,step));let after=riverGround(p+vec2<f32>(0.0,step));
 return normalize(vec3<f32>(left-right,2.0*step,before-after));
}

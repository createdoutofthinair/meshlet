struct CloudParams{view:vec4<f32>,sky:vec4<f32>,cloud:vec4<f32>};
@group(0) @binding(0) var<uniform> params:CloudParams;
struct Screen{@builtin(position) pos:vec4<f32>};
@vertex fn vertex(@builtin(vertex_index) i:u32)->Screen{
 let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));return Screen(vec4<f32>(p[i],0.0,1.0));
}
fn cloudHash(p:vec3<f32>)->f32{return fract(sin(dot(p,vec3<f32>(127.1,311.7,74.7)))*43758.5453);}
fn cloudNoise(p:vec3<f32>)->f32{
 let i=floor(p);let f=fract(p);let u=f*f*(3.0-2.0*f);
 let a=mix(mix(cloudHash(i),cloudHash(i+vec3<f32>(1,0,0)),u.x),mix(cloudHash(i+vec3<f32>(0,1,0)),cloudHash(i+vec3<f32>(1,1,0)),u.x),u.y);
 let b=mix(mix(cloudHash(i+vec3<f32>(0,0,1)),cloudHash(i+vec3<f32>(1,0,1)),u.x),mix(cloudHash(i+vec3<f32>(0,1,1)),cloudHash(i+vec3<f32>(1,1,1)),u.x),u.y);
 return mix(a,b,u.z);
}
fn cloudDensity(p:vec3<f32>)->f32{
 let height=(p.y-1500.0)/1800.0;let profile=smoothstep(0.0,.12,height)*(1.0-smoothstep(.68,1.0,height));
 if(profile<=0.0){return 0.0;}
 let seed=params.cloud.z;let wind=params.sky.x*params.cloud.y;let q=(p+vec3<f32>(wind,0.0,wind*.27))*.00055+vec3<f32>(seed*.071,seed*.039,seed*.053);
 let shape=cloudNoise(q)*.65+cloudNoise(q*2.03+vec3<f32>(12.0,3.0,6.0))*.35;
 let detail=cloudNoise(q*4.1+vec3<f32>(2.0,7.0,4.0));let threshold=mix(.79,.27,params.sky.w);
 return smoothstep(threshold,threshold+.20,shape+(detail-.5)*.17)*profile*params.cloud.x*smoothstep(0.0,.08,params.sky.w);
}
@fragment fn fragment(input:Screen)->@location(0) vec4<f32>{
 let uv=vec2<f32>(input.pos.x/params.view.x*2.0-1.0,1.0-input.pos.y/params.view.y*2.0);let yaw=params.view.z;let pitch=params.view.w;
 let forward=vec3<f32>(sin(yaw)*cos(pitch),sin(pitch),cos(yaw)*cos(pitch));let right=vec3<f32>(cos(yaw),0.0,-sin(yaw));let up=normalize(cross(forward,right));
 let ray=normalize(forward+right*uv.x*(params.view.x/params.view.y)*.58+up*uv.y*.58);
 let sun=normalize(vec3<f32>(.32,sin(params.sky.y),cos(params.sky.y)*.95));let origin=vec3<f32>(0.0,params.sky.z,0.0);
 var color=atmosphereSky(ray,sun,vec3<f32>(0,1,0),origin.y);
 if(ray.y<0.0){let horizon=smoothstep(-.12,.02,ray.y);color=mix(vec3<f32>(.19,.22,.20),color,horizon);}
 if(abs(ray.y)>.001){
  let a=(1500.0-origin.y)/ray.y;let b=(3300.0-origin.y)/ray.y;let start=max(0.0,min(a,b));let end=min(30000.0,max(a,b));
  if(end>start){
   let steps=28u;let stepSize=(end-start)/f32(steps);var transmission=1.0;var lightAccum=vec3<f32>(0.0);
   let jitter=cloudHash(vec3<f32>(floor(input.pos.xy),1.7));
   for(var i=0u;i<steps;i++){
    if(transmission<.02){break;}let distance=start+(f32(i)+jitter)*stepSize;let point=origin+ray*distance;let density=cloudDensity(point);
    if(density>.001){
     let optical=density*stepSize*.0018;let alpha=1.0-exp(-optical);
     let shadow=exp(-cloudDensity(point+sun*280.0)*.8);let phase=.55+.45*pow(max(dot(ray,sun),0.0),6.0);
     let illumination=mix(vec3<f32>(.32,.38,.43),vec3<f32>(1.0,.86,.68),shadow*phase);
     lightAccum+=transmission*alpha*illumination;transmission*=1.0-alpha;
    }
   }
   color=color*transmission+lightAccum;
  }
 }
 let mapped=max(color,vec3<f32>(0.0))/(1.0+max(color,vec3<f32>(0.0))*.22);return vec4<f32>(pow(mapped,vec3<f32>(1.0/2.2)),1.0);
}

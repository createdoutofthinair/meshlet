// Optical water study inspired by Muck's Optically-Realistic-Water (MIT)
// and Martins Upitis' ocean shader. Independent WGSL implementation.
struct Params {eye:vec4<f32>, settings:vec4<f32>, viewport:vec4<f32>};
@group(0) @binding(0) var<uniform> params:Params;
struct Screen {@builtin(position) pos:vec4<f32>};
@vertex fn vertex(@builtin(vertex_index) id:u32)->Screen{
 let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));return Screen(vec4<f32>(p[id],0.0,1.0));
}
fn hash(p:vec2<f32>)->f32{return fract(sin(dot(p,vec2<f32>(127.1,311.7)))*43758.5453);}
fn noise(p:vec2<f32>)->f32{let i=floor(p);let f=fract(p);let w=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2<f32>(1.0,0.0)),w.x),mix(hash(i+vec2<f32>(0.0,1.0)),hash(i+vec2<f32>(1.0,1.0)),w.x),w.y);}
// Dampen each wave band before it becomes smaller than a pixel. Distance
// also stabilizes the iterative surface intersection near the horizon.
fn wave(p:vec2<f32>,time:f32,dist:f32)->f32{
 let large=1.0-smoothstep(25.0,120.0,dist);let mid=1.0-smoothstep(10.0,48.0,dist);let fine=1.0-smoothstep(4.0,18.0,dist);
 let a=sin(p.x*.57+p.y*.32+time*.72)*.12*large;let b=sin(p.x*1.3-p.y*.8-time*1.05)*.055*mid;
 let c=sin(p.x*2.6+p.y*2.05+time*1.5)*.018*fine;return (a+b+c)*params.settings.y;
}
fn waveNormal(p:vec2<f32>,time:f32,dist:f32)->vec3<f32>{
 let e=.035;let dx=(wave(p+vec2<f32>(e,0.0),time,dist)-wave(p-vec2<f32>(e,0.0),time,dist))/(2.0*e);
 let dz=(wave(p+vec2<f32>(0.0,e),time,dist)-wave(p-vec2<f32>(0.0,e),time,dist))/(2.0*e);
 let detail=1.0-smoothstep(4.0,15.0,dist);let fine=(noise(p*6.0+vec2<f32>(time*.25,time*.13))-.5)*.11*detail;
 return normalize(vec3<f32>(-dx+fine,1.0,-dz-fine));
}
fn sky(ray:vec3<f32>)->vec3<f32>{
 let y=max(ray.y,0.0);let sun=normalize(vec3<f32>(-.35,.65,.55));
 let base=mix(vec3<f32>(.69,.77,.78),vec3<f32>(.16,.34,.55),pow(y,.55));
 let cloud=noise(ray.xz/max(.13,ray.y)*2.0+vec2<f32>(3.2,8.1));let clouds=smoothstep(.53,.72,cloud)*smoothstep(.02,.2,ray.y);
 return mix(base,vec3<f32>(.86,.88,.85),clouds*.55)+vec3<f32>(1.0,.84,.60)*pow(max(dot(ray,sun),0.0),350.0)*2.0;
}
fn ground(p:vec2<f32>)->vec3<f32>{let n=noise(p*.48);let grain=noise(p*5.0);return mix(vec3<f32>(.19,.23,.19),vec3<f32>(.51,.48,.34),n)*(.85+.3*grain);}
fn fresnel(cosine:f32)->f32{
 let c=clamp(cosine,0.0,1.0);let eta=1.333;let g=sqrt(max(0.0,eta*eta-1.0+c*c));
 let a=(g-c)/(g+c);let b=(c*(g+c)-1.0)/(c*(g-c)+1.0);return clamp(.5*a*a*(1.0+b*b),0.0,1.0);
}
@fragment fn fragment(input:Screen)->@location(0) vec4<f32>{
 let size=params.viewport.xy;let xy=vec2<f32>(input.pos.x/size.x*2.0-1.0,1.0-input.pos.y/size.y*2.0);
 let eye=params.eye.xyz;let forward=normalize(vec3<f32>(0.0,0.0,0.0)-eye);let right=normalize(cross(forward,vec3<f32>(0.0,1.0,0.0)));let up=normalize(cross(right,forward));
 let ray=normalize(forward+right*xy.x*(size.x/size.y)*.57735027+up*xy.y*.57735027);let time=params.settings.x;
 if(ray.y>=-.001){return vec4<f32>(pow(max(sky(ray),vec3<f32>(0.0)),vec3<f32>(1.0/2.2)),1.0);}
 var t= -eye.y/ray.y;for(var i=0u;i<5u;i++){let p=eye+ray*t;t=(wave(p.xz,time,t)-eye.y)/ray.y;}
 if(t<=0.0 || t>200.0){return vec4<f32>(pow(max(sky(ray),vec3<f32>(0.0)),vec3<f32>(1.0/2.2)),1.0);}
 let point=eye+ray*t;let normal=waveNormal(point.xz,time,t);
 let cosView=max(dot(-ray,normal),0.0);let reflection=sky(reflect(ray,normal));let refracted=refract(ray,normal,1.0/1.333);
 let floorDepth=2.2;let travel=min(50.0,(floorDepth+point.y)/max(.05,-refracted.y));let bottom=point+refracted*travel;
 let clarity=max(.2,params.settings.z);let transmission=exp(-vec3<f32>(.34,.15,.08)*travel/clarity);
 let causticWave=sin(bottom.x*3.3+time*1.2+sin(bottom.z*2.4-time))*sin(bottom.z*3.0-time*.9+sin(bottom.x*2.0+time));
 let caustics=pow(max(0.0,causticWave),5.0)*.22*exp(-floorDepth*.35);
 let seabed=ground(bottom.xz)*(1.0+caustics);let water=vec3<f32>(.018,.17,.16);
 let transmitted=seabed*transmission+water*(vec3<f32>(1.0)-transmission);
 let sun=normalize(vec3<f32>(-.35,.65,.55));let halfVec=normalize(sun-ray);let spec=pow(max(dot(normal,halfVec),0.0),200.0)*1.2;
 let scatter=pow(max(dot(ray,sun),0.0),5.0)*.07*(1.0-cosView);let f=fresnel(cosView);
 let color=mix(transmitted,reflection,f)+vec3<f32>(1.0,.91,.72)*spec+vec3<f32>(.05,.3,.24)*scatter;
 let horizon=mix(color,sky(ray),smoothstep(90.0,200.0,t));
 return vec4<f32>(pow(max(horizon,vec3<f32>(0.0)),vec3<f32>(1.0/2.2)),1.0);
}

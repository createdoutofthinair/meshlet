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
 // Smooth, independent ripple bands avoid square value-noise cells in highlights.
 let medium=1.0-smoothstep(3.0,12.0,dist);let tiny=1.0-smoothstep(1.5,6.0,dist);
 let a=p.x*5.4+p.y*2.1+time*1.7;let b=p.x*2.8-p.y*6.2-time*1.15;
 let c=p.x*11.3+p.y*7.1+time*2.2;
 let rippleX=medium*(.032*cos(a)+.014*cos(b))+tiny*.014*cos(c);
 let rippleZ=medium*(.012*cos(a)-.031*cos(b))+tiny*.009*cos(c);
 return normalize(vec3<f32>(-dx-rippleX,1.0,-dz-rippleZ));
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
// Ray-box intersection places a real 3D cube across the waterline, so
// primary, reflected and refracted rays can all see the same object.
fn cubeHit(origin:vec3<f32>,direction:vec3<f32>)->f32{
 let safe=select(select(vec3<f32>(-.00001),vec3<f32>(.00001),direction>=vec3<f32>(0.0)),direction,abs(direction)>vec3<f32>(.00001));
 let a=(vec3<f32>(-.65,-.95,-.65)-origin)/safe;let b=(vec3<f32>(.65,.75,.65)-origin)/safe;
 let near=min(a,b);let far=max(a,b);let enter=max(near.x,max(near.y,near.z));let leave=min(far.x,min(far.y,far.z));
 if(leave<max(enter,0.0)){return -1.0;}return select(leave,enter,enter>0.0);
}
fn cubeColor(p:vec3<f32>)->vec3<f32>{
 let q=abs(p-vec3<f32>(0.0,-.1,0.0))/vec3<f32>(.65,.85,.65);var n=vec3<f32>(0.0,0.0,sign(p.z));
 if(q.x>q.y&&q.x>q.z){n=vec3<f32>(sign(p.x),0.0,0.0);}else if(q.y>q.z){n=vec3<f32>(0.0,sign(p.y+.1),0.0);}
 let light=normalize(vec3<f32>(-.35,.65,.55));let lit=.22+.78*max(dot(n,light),0.0);
 // A subtle checker makes the underwater refraction distinguishable from
 // the reflected upper part without changing the cube's silhouette.
 let coord=select(select(p.xy,p.zy,abs(n.x)>.5),p.xz,abs(n.y)>.5);
 let tiles=floor((coord.x+3.0)*4.0)+floor((coord.y+3.0)*4.0);
 let pattern=select(.68,1.0,fract(tiles*.5)<.25);
 return vec3<f32>(.80,.48,.23)*lit*pattern;
}
fn display(value:vec3<f32>)->vec4<f32>{return vec4<f32>(pow(max(value,vec3<f32>(0.0)),vec3<f32>(1.0/2.2)),1.0);}
@fragment fn fragment(input:Screen)->@location(0) vec4<f32>{
 let size=params.viewport.xy;let xy=vec2<f32>(input.pos.x/size.x*2.0-1.0,1.0-input.pos.y/size.y*2.0);
 let eye=params.eye.xyz;let forward=normalize(vec3<f32>(0.0,0.0,0.0)-eye);let right=normalize(cross(forward,vec3<f32>(0.0,1.0,0.0)));let up=normalize(cross(right,forward));
 let ray=normalize(forward+right*xy.x*(size.x/size.y)*.57735027+up*xy.y*.57735027);let time=params.settings.x;
 let direct=cubeHit(eye,ray);
 if(ray.y>=-.001){if(direct>0.0){return display(cubeColor(eye+ray*direct));}return display(sky(ray));}
 var t= -eye.y/ray.y;for(var i=0u;i<5u;i++){let p=eye+ray*t;t=(wave(p.xz,time,t)-eye.y)/ray.y;}
 if(direct>0.0 && (t<=0.0 || direct<t)){return display(cubeColor(eye+ray*direct));}
 if(t<=0.0 || t>200.0){return display(sky(ray));}
 let point=eye+ray*t;let normal=waveNormal(point.xz,time,t);
 let cosView=max(dot(-ray,normal),0.0);let reflectedRay=reflect(ray,normal);var reflection=sky(reflectedRay);
 let reflectedHit=cubeHit(point+normal*.001,reflectedRay);if(reflectedHit>0.0){reflection=cubeColor(point+normal*.001+reflectedRay*reflectedHit);}
 let refracted=refract(ray,normal,1.0/1.333);
 let floorDepth=2.2;let travel=min(50.0,(floorDepth+point.y)/max(.05,-refracted.y));let bottom=point+refracted*travel;
 let clarity=max(.2,params.settings.z);
 let causticWave=sin(bottom.x*3.3+time*1.2+sin(bottom.z*2.4-time))*sin(bottom.z*3.0-time*.9+sin(bottom.x*2.0+time));
 let caustics=pow(max(0.0,causticWave),5.0)*.22*exp(-floorDepth*.35);
 var seabed=ground(bottom.xz)*(1.0+caustics);
 let submergedHit=cubeHit(point-normal*.001,refracted);if(submergedHit>0.0 && submergedHit<travel){seabed=cubeColor(point-normal*.001+refracted*submergedHit);}
 let water=vec3<f32>(.018,.17,.16);
 let path=select(travel,submergedHit,submergedHit>0.0 && submergedHit<travel);
 let attenuation=exp(-vec3<f32>(.17,.095,.065)*path/clarity);
 let transmitted=seabed*attenuation+water*(vec3<f32>(1.0)-attenuation);
 let sun=normalize(vec3<f32>(-.35,.65,.55));let halfVec=normalize(sun-ray);
 // A broader microfacet highlight reduces high-contrast sparkling artifacts.
 let nh=max(dot(normal,halfVec),0.0);let roughness=.16;let alpha=roughness*roughness;
 let denom=max(.0001,nh*nh*(alpha*alpha-1.0)+1.0);let distribution=alpha*alpha/(3.14159265*denom*denom);
 let spec=min(1.2,distribution*.018)*max(dot(normal,sun),0.0);
 let scatter=pow(max(dot(ray,sun),0.0),5.0)*.07*(1.0-cosView);let f=fresnel(cosView);
 let color=mix(transmitted,reflection,f)+vec3<f32>(1.0,.91,.72)*spec+vec3<f32>(.05,.3,.24)*scatter;
 let horizon=mix(color,sky(ray),smoothstep(90.0,200.0,t));
 return vec4<f32>(pow(max(horizon,vec3<f32>(0.0)),vec3<f32>(1.0/2.2)),1.0);
}

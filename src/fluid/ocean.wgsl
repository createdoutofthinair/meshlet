// Optical water study inspired by Muck's Optically-Realistic-Water (MIT)
// and Martins Upitis' ocean shader. Independent WGSL implementation.
struct Params {eye:vec4<f32>, settings:vec4<f32>, viewport:vec4<f32>};
@group(0) @binding(0) var<uniform> params:Params;
struct FloatingBall {position:vec4<f32>,velocity:vec4<f32>};
@group(0) @binding(1) var<storage,read_write> balls:array<FloatingBall>;
@group(0) @binding(2) var<storage,read_write> impact:array<vec4<f32>>;
struct Screen {@builtin(position) pos:vec4<f32>};
@vertex fn vertex(@builtin(vertex_index) id:u32)->Screen{
 let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));return Screen(vec4<f32>(p[id],0.0,1.0));
}
fn hash(p:vec2<f32>)->f32{return fract(sin(dot(p,vec2<f32>(127.1,311.7)))*43758.5453);}
fn noise(p:vec2<f32>)->f32{let i=floor(p);let f=fract(p);let w=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2<f32>(1.0,0.0)),w.x),mix(hash(i+vec2<f32>(0.0,1.0)),hash(i+vec2<f32>(1.0,1.0)),w.x),w.y);}
// Dampen each wave band before it becomes smaller than a pixel. Distance
// also stabilizes the iterative surface intersection near the horizon.
fn baseWave(p:vec2<f32>,time:f32,dist:f32)->f32{
 let large=1.0-smoothstep(25.0,120.0,dist);let mid=1.0-smoothstep(10.0,48.0,dist);let fine=1.0-smoothstep(4.0,18.0,dist);
 let a=sin(p.x*.57+p.y*.32+time*.72)*.12*large;let b=sin(p.x*1.3-p.y*.8-time*1.05)*.055*mid;
 let c=sin(p.x*2.6+p.y*2.05+time*1.5)*.018*fine;
 return (a+b+c)*params.settings.y;
}
fn wave(p:vec2<f32>,time:f32,dist:f32)->f32{
 var ring=0.0;
 for(var eventIndex=0u;eventIndex<u32(params.viewport.w);eventIndex++){
  let event=impact[eventIndex];let age=time-event.z;
  if(event.w>0.0 && age>=0.0 && age<4.0){let radius=length(p-event.xy);let front=radius-age*1.4;ring+=.045*sin(front*13.0)*exp(-front*front*3.0)*exp(-age*.8);}
 }
 ring=clamp(ring,-.15,.15);
 return baseWave(p,time,dist)+ring;
}
// Smooth union of overlapping ellipsoidal lobes forms an irregular rounded
// test object. The same distance field drives rendering and ball contacts.
fn roundedObjectField(p:vec3<f32>)->f32{
 // Seeded irregular boulder. A conservative step scale keeps ray marching stable.
 if(params.viewport.z>2.5){
  let seed=params.eye.w;let q=p-vec3<f32>(0.0,-.08,0.0);
  let warp=.075*sin(q.x*3.9+seed*.13)*sin(q.y*4.2+seed*.17)*cos(q.z*3.6-seed*.11)
          +.035*sin(q.x*8.0+q.z*3.2+seed*.07)*cos(q.y*6.7-q.z*4.4+seed*.19);
  let shape=length(q/vec3<f32>(.86,.78,.73))-.95+warp;
  return shape*.36;
 }
 // Upright torus: its open center is visible above and below the waterline.
 if(params.viewport.z>1.5){return length(vec2<f32>(length(p.xy)-.62,p.z))-.24;}
 let a=length((p-vec3<f32>(-.20,-.10,0.0))/vec3<f32>(.78,.90,.62))-.90;
 let b=length((p-vec3<f32>(.38,.03,.07))/vec3<f32>(.55,.70,.58))-.78;
 let c=length((p-vec3<f32>(-.08,.32,-.30))/vec3<f32>(.58,.55,.51))-.72;
 let k=.24;let h=clamp(.5+.5*(b-a)/k,0.0,1.0);let ab=mix(b,a,h)-k*h*(1.0-h);
 let j=clamp(.5+.5*(c-ab)/k,0.0,1.0);return (mix(c,ab,j)-k*j*(1.0-j))*.51;
}
fn roundedObjectNormal(p:vec3<f32>)->vec3<f32>{
 let e=.002;return normalize(vec3<f32>(roundedObjectField(p+vec3<f32>(e,0,0))-roundedObjectField(p-vec3<f32>(e,0,0)),roundedObjectField(p+vec3<f32>(0,e,0))-roundedObjectField(p-vec3<f32>(0,e,0)),roundedObjectField(p+vec3<f32>(0,0,e))-roundedObjectField(p-vec3<f32>(0,0,e))));
}
// The bounded test bodies fit in one invocation: pair resolution is deterministic and
// never reads another invocation's partially updated state.
@compute @workgroup_size(1) fn updateBalls(){
 let dt=min(.033,params.settings.w);if(dt<=0.0){return;}
 for(var i=0u;i<u32(params.viewport.w);i++){
  var ball=balls[i];if(ball.position.w<=0.0){continue;}let water=wave(ball.position.xz,params.settings.x,0.0);let radius=ball.position.w;
  let submerged=clamp((water-(ball.position.y-radius))/(2.0*radius),0.0,1.0);
  ball.velocity.y=(ball.velocity.y+9.81*(submerged*2.0-1.0)*dt)*exp(-2.5*dt);
  let drift=mix(ball.velocity.xz,vec2<f32>(.18,.06),1.0-exp(-.45*dt));ball.velocity.x=drift.x;ball.velocity.z=drift.y;
  let previousY=ball.position.y;ball.position=vec4<f32>(ball.position.xyz+ball.velocity.xyz*dt,radius);
  if(previousY-radius>water && ball.position.y-radius<=water && ball.velocity.y< -1.2){impact[i]=vec4<f32>(ball.position.x,ball.position.z,params.settings.x,1.0);}
  balls[i]=ball;
 }
 // Several sequential projections handle chains of simultaneous contacts.
 for(var iteration=0u;iteration<4u;iteration++){
  for(var i=0u;i<u32(params.viewport.w);i++){
   var ball=balls[i];let r=ball.position.w;if(r<=0.0){continue;}let lo=vec3<f32>(-.65,-.95,-.65);let hi=vec3<f32>(.65,.75,.65);
   if(params.viewport.z>.5){
    let d=roundedObjectField(ball.position.xyz);if(d<r){let normal=roundedObjectNormal(ball.position.xyz);ball.position=vec4<f32>(ball.position.xyz+normal*(r-d),r);let vn=dot(ball.velocity.xyz,normal);if(vn<0.0){ball.velocity=vec4<f32>(ball.velocity.xyz-normal*vn*1.15,0.0);}}
   }else{
   let closest=clamp(ball.position.xyz,lo,hi);let delta=ball.position.xyz-closest;let d=length(delta);
   if(d<r){
    var normal=vec3<f32>(1.0,0.0,0.0);var penetration=r-d;
    if(d>.00001){normal=delta/d;}else{
     let left=ball.position.x-lo.x;let right=hi.x-ball.position.x;let bottom=ball.position.y-lo.y;let top=hi.y-ball.position.y;let back=ball.position.z-lo.z;let front=hi.z-ball.position.z;
     var side=left;normal=vec3<f32>(-1.0,0.0,0.0);
     if(right<side){side=right;normal=vec3<f32>(1.0,0.0,0.0);}if(bottom<side){side=bottom;normal=vec3<f32>(0.0,-1.0,0.0);}
     if(top<side){side=top;normal=vec3<f32>(0.0,1.0,0.0);}if(back<side){side=back;normal=vec3<f32>(0.0,0.0,-1.0);}
     if(front<side){side=front;normal=vec3<f32>(0.0,0.0,1.0);}penetration=r+side;
    }
    ball.position=vec4<f32>(ball.position.xyz+normal*penetration,r);
    let vn=dot(ball.velocity.xyz,normal);if(vn<0.0){ball.velocity=vec4<f32>(ball.velocity.xyz-normal*vn*1.15,0.0);}
   }
   }
   balls[i]=ball;
   for(var j=i+1u;j<u32(params.viewport.w);j++){
    var other=balls[j];if(other.position.w<=0.0){continue;}ball=balls[i];let deltaPair=other.position.xyz-ball.position.xyz;let dPair=length(deltaPair);let overlap=ball.position.w+other.position.w-dPair;
    if(overlap>0.0){
     var normal=vec3<f32>(1.0,0.0,0.0);if(dPair>.00001){normal=deltaPair/dPair;}
     ball.position=vec4<f32>(ball.position.xyz-normal*overlap*.5,ball.position.w);other.position=vec4<f32>(other.position.xyz+normal*overlap*.5,other.position.w);
     let closing=dot(other.velocity.xyz-ball.velocity.xyz,normal);
     if(closing<0.0){let impulse= -.575*closing;ball.velocity=vec4<f32>(ball.velocity.xyz-normal*impulse,0.0);other.velocity=vec4<f32>(other.velocity.xyz+normal*impulse,0.0);}
     balls[i]=ball;balls[j]=other;
    }
   }
  }
 }
 for(var i=0u;i<u32(params.viewport.w);i++){
  var ball=balls[i];if(ball.position.w<=0.0){continue;}if(abs(ball.position.x)>3.0){ball.position.x=clamp(ball.position.x,-3.0,3.0);ball.velocity.x*= -.7;}
  if(abs(ball.position.z)>2.5){ball.position.z=clamp(ball.position.z,-2.5,2.5);ball.velocity.z*= -.7;}balls[i]=ball;
 }
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
// March only inside a conservative bounding sphere; all optical rays see
// the same surface, including reflection and refraction below the water.
fn roundedObjectHit(origin:vec3<f32>,direction:vec3<f32>)->f32{
 let center=vec3<f32>(0.0,-.05,0.0);let q=origin-center;let b=dot(q,direction);let disc=b*b-dot(q,q)+1.5*1.5;
 if(disc<0.0){return -1.0;}let far= -b+sqrt(disc);var t=max(.001,-b-sqrt(disc));
 for(var i=0u;i<96u;i++){if(t>far){break;}let d=roundedObjectField(origin+direction*t);if(d<.001){return t;}t+=max(.001,d*.8);}
 return -1.0;
}
// Ripples travel from each actual impact to the cube, then the wash fades.
fn cubeImpactWash(position:vec2<f32>,faceNormal:vec2<f32>,time:f32)->f32{
 var response=0.0;
 for(var i=0u;i<u32(params.viewport.w);i++){
  let event=impact[i];let distance=length(position-event.xy);let arrival=distance/1.4;let elapsed=time-event.z-arrival;
  if(event.w>0.0 && elapsed>=0.0 && elapsed<4.0){
   let near=1.0-smoothstep(1.5,4.0,distance);
   // Only faces facing the source receive the incoming impact wave.
   let toImpact=event.xy-position;let facing=dot(faceNormal,toImpact)/max(.001,length(toImpact));
   let directional=smoothstep(.05,.55,facing);
   let attack=smoothstep(0.0,.12,elapsed);let decay=1.0-smoothstep(1.2,4.0,elapsed);
   // The event seed stays fixed throughout the wash, so patches adhere to
   // the cube while different impacts wet different parts of the face.
   let variant=hash(vec2<f32>(event.z*7.13+f32(i)*19.17,dot(event.xy,vec2<f32>(13.7,31.1))));
   let patches=noise(position*8.0+vec2<f32>(variant*31.0,variant*17.0));
   response=max(response,near*directional*attack*decay*mix(.35,1.0,smoothstep(.25,.75,patches)));
  }
 }
 return response;
}
// Impact-driven patches: a short upward surge followed by gravity-driven
// drainage. Each patch has a different path, width and fall speed.
fn cubeFoamDrain(position:vec2<f32>,faceNormal:vec2<f32>,height:f32,faceCoord:f32,time:f32)->f32{
 var result=0.0;
 for(var i=0u;i<u32(params.viewport.w);i++){
  let event=impact[i];let delta=event.xy-position;let dist=length(delta);let elapsed=time-event.z-dist/1.4;
  if(event.w>0.0 && elapsed>=0.0 && elapsed<4.8){
   let variant=hash(vec2<f32>(event.z*7.13+f32(i)*19.17,dot(event.xy,vec2<f32>(13.7,31.1))+dot(faceNormal,vec2<f32>(5.3,9.7))));
   let grid=(faceCoord+2.0)*7.0+(variant-.5)*1.6;let cell=floor(grid);let local=fract(grid);
   let seed=hash(vec2<f32>(cell+variant*37.0,18.7+f32(i)*.9));let shift=.18+.64*seed;
   let facing=smoothstep(.05,.55,dot(faceNormal,delta)/max(.001,dist));let near=1.0-smoothstep(1.5,4.0,dist);
   let surge=(.25+.08*seed)*smoothstep(0.0,.38,elapsed);
   let drainage=max(0.0,elapsed-.26)*(.15+.07*seed);
   let head=.03+surge-drainage;
   let waviness=(noise(vec2<f32>(height*14.0,cell+seed))-.5)*.20;
   let width=.20+.16*seed;let across=1.0-smoothstep(width,width+.16,abs(local-shift+waviness));
   let length=.08+.12*clamp(elapsed,0.0,1.0);let vertical=exp(-pow((height-head)/length,2.0));
   let lowerEdge= -.11+.07*noise(vec2<f32>(faceCoord*11.0+variant*13.0,seed*5.0));
   let fade=smoothstep(0.0,.15,elapsed)*(1.0-smoothstep(2.8,4.8,elapsed))*smoothstep(lowerEdge-.035,lowerEdge+.035,height);
   result=max(result,across*vertical*fade*facing*near);
  }
 }
 return result;
}
// Shared multiscale foam field, evaluated in each surface's local coordinates.
fn foamBreakup(uv:vec2<f32>)->f32{
 return noise(uv)*.40+noise(uv*2.4+vec2<f32>(4.2,6.1))*.30+noise(uv*5.3+vec2<f32>(8.1,4.9))*.20+noise(uv*10.0+vec2<f32>(2.1,11.0))*.10;
}
// Seamless world-space procedural height field, sampled directly at the
// visible surface; the small-scale relief perturbs normals, not silhouette.
fn rockHeight(p:vec3<f32>)->f32{
 let seed=params.eye.w;let q=p+vec3<f32>(seed*.013,seed*.021,seed*.017);
 let broad=(noise(q.xy*6.0)+noise(q.yz*6.0+vec2<f32>(4.2,1.3))+noise(q.zx*6.0+vec2<f32>(2.7,9.1)))/3.0;
 let fine=(noise(q.xy*24.0)+noise(q.yz*24.0+vec2<f32>(7.3,2.9))+noise(q.zx*24.0+vec2<f32>(3.1,4.6)))/3.0;
 let grain=(noise(q.xy*68.0)+noise(q.yz*68.0+vec2<f32>(3.3,6.2))+noise(q.zx*68.0+vec2<f32>(8.2,1.7)))/3.0;
 return broad*.045+fine*.014+grain*.003;
}
fn rockMaterial(p:vec3<f32>,normal:vec3<f32>,light:vec3<f32>)->vec3<f32>{
 let e=.003;let h=rockHeight(p);
 let grad=vec3<f32>(rockHeight(p+vec3<f32>(e,0,0))-h,rockHeight(p+vec3<f32>(0,e,0))-h,rockHeight(p+vec3<f32>(0,0,e))-h)/e;
 let n=normalize(normal-(grad-normal*dot(grad,normal)));
 let mineral=noise(p.xz*5.0+vec2<f32>(params.eye.w*.03,3.0))*.5+noise(p.xy*10.0+vec2<f32>(2.7,params.eye.w*.02))*.5;
 let albedo=mix(vec3<f32>(.095,.105,.10),vec3<f32>(.32,.30,.26),smoothstep(.24,.76,mineral));
 let view=normalize(params.eye.xyz-p);let halfVec=normalize(light+view);
 let nl=max(dot(n,light),0.0);let nv=max(dot(n,view),.001);let nh=max(dot(n,halfVec),0.0);let vh=max(dot(view,halfVec),0.0);
 let roughness=.76;let a=roughness*roughness;let a2=a*a;let denom=nh*nh*(a2-1.0)+1.0;
 let distribution=a2/(3.14159265*denom*denom);let k=(roughness+1.0)*(roughness+1.0)/8.0;
 let geometry=(nl/(nl*(1.0-k)+k))*(nv/(nv*(1.0-k)+k));let f=.04+.96*pow(1.0-vh,5.0);
 let spec=distribution*geometry*f/max(.004,4.0*nl*nv);
 return albedo*(.24+nl*.76)+vec3<f32>(1.0,.91,.79)*spec*nl;
}
fn cubeColor(p:vec3<f32>)->vec3<f32>{
 let q=abs(p-vec3<f32>(0.0,-.1,0.0))/vec3<f32>(.65,.85,.65);var n=vec3<f32>(0.0,0.0,sign(p.z));
 if(q.x>q.y&&q.x>q.z){n=vec3<f32>(sign(p.x),0.0,0.0);}else if(q.y>q.z){n=vec3<f32>(0.0,sign(p.y+.1),0.0);}
 if(params.viewport.z>.5){n=roundedObjectNormal(p);}
 let light=normalize(vec3<f32>(-.35,.65,.55));let lit=.22+.78*max(dot(n,light),0.0);
 // A subtle checker makes the underwater refraction distinguishable from
 // the reflected upper part without changing the cube's silhouette.
 let coord=select(select(select(p.xy,p.zy,abs(n.x)>.5),p.xz,abs(n.y)>.5),vec2<f32>(atan2(p.z,p.x)*.45,p.y),params.viewport.z>.5);
 let tiles=floor((coord.x+3.0)*4.0)+floor((coord.y+3.0)*4.0);
 let pattern=select(.68,1.0,fract(tiles*.5)<.25);
 var color=vec3<f32>(.80,.48,.23)*lit*pattern;
 if(params.viewport.z>2.5){color=rockMaterial(p,n,light);}
 // A translucent wet film and sparse draining rivulets respond only to
 // nearby impacts. The underlying cube remains visible through the film.
 let time=params.settings.x;
 // Anchor the film to the cube's mean waterline instead of the oscillating
 // wave height so adhered water does not stretch and bounce with ripples.
 let height=p.y;
 let faceCoord=select(select(p.x,p.z,abs(n.x)>.5),atan2(p.z,p.x)*.45,params.viewport.z>.5);let response=cubeImpactWash(p.xz,n.xz,time);
 let side=select(select(1.0,0.0,abs(n.y)>.5),smoothstep(.15,.55,length(n.xz)),params.viewport.z>.5);
 let lowerEdge= -.08+.07*noise(vec2<f32>(faceCoord*9.0,3.7))+.025*noise(vec2<f32>(faceCoord*24.0,8.1));
 let band=smoothstep(lowerEdge-.035,lowerEdge+.035,height)*(1.0-smoothstep(.12,.36,height));
 let breakup=noise(vec2<f32>(faceCoord*18.0,p.y*18.0));
 let drain=cubeFoamDrain(p.xz,n.xz,height,faceCoord,time);
 let film=clamp((band*.50*response+drain*.80)*side,0.0,.90);
 let view=normalize(params.eye.xyz-p);let fresnelWet=.04+.96*pow(1.0-abs(dot(n,view)),5.0);
 let halfVector=normalize(light+view);let highlight=pow(max(dot(n,halfVector),0.0),72.0);
 let reflected=sky(reflect(-view,n));
 color=color*(1.0-film*.30)+reflected*film*(.12+.30*fresnelWet)+vec3<f32>(.8,.9,.87)*film*highlight*.65;
 // Use the same breakup and optical response as the impact foam on water.
 let foamUv=vec2<f32>(faceCoord,height)*8.0;
 let foam=max(band*response,drain*.85)*smoothstep(.44,.73,foamBreakup(foamUv))*.65*side;
 let tintedFoam=mix(color,foamColor(n),.52);
 return mix(color,tintedFoam,foam);
}
// Thin expanding crown surface, expressed as a 3D implicit sheet.
fn crownField(p:vec3<f32>,age:f32,base:f32,position:vec2<f32>)->f32{
 let local=p-vec3<f32>(position.x,base,position.y);let radial=length(local.xz);let angle=atan2(local.z,local.x);
 let growth=smoothstep(0.0,.15,age);let fade=1.0-smoothstep(.38,.9,age);
 let height=(.34+.09*sin(angle*13.0+age*4.0)+.045*sin(angle*23.0-age*3.0))*growth*fade;
 let radius=.16+age*.52+max(0.0,local.y)*.55;
 return max(abs(radial-radius)-.028,max(-local.y,local.y-height));
}
// Local optical approximation for thin water: reflected sky and refracted
// environment, weighted by the dielectric Fresnel response.
fn splashOptics(p:vec3<f32>,incident:vec3<f32>,surfaceNormal:vec3<f32>)->vec3<f32>{
 let n=select(-surfaceNormal,surfaceNormal,dot(surfaceNormal,incident)<0.0);
 let reflection=sky(reflect(incident,n));let transmittedRay=refract(incident,n,1.0/1.333);
 var transmitted=sky(transmittedRay);if(transmittedRay.y< -.001){let d=min(30.0,(p.y+2.2)/max(.04,-transmittedRay.y));transmitted=ground((p+transmittedRay*d).xz)*vec3<f32>(.8,.93,.94);}
 return mix(transmitted,reflection,fresnel(abs(dot(n,-incident))));
}
// Common illuminated foam tint for the surface and airborne sheet.
fn foamColor(normal:vec3<f32>)->vec3<f32>{
 let sun=normalize(vec3<f32>(-.35,.65,.55));let illumination=.86+.14*abs(dot(normal,sun));
 return vec3<f32>(.76,.85,.82)*illumination;
}
// Foam is a translucent aerated layer over the existing water optics.
// Preserve some reflected and transmitted light even at high coverage.
fn foamOptics(water:vec3<f32>,reflected:vec3<f32>,normal:vec3<f32>,coverage:f32,fresnelTerm:f32)->vec3<f32>{
 let amount=clamp(coverage,0.0,1.0);let scattering=foamColor(normal);
 let reflectionWeight=clamp(.08+fresnelTerm*.35,0.0,.5);
 let layer=mix(scattering,reflected,reflectionWeight);
 return mix(water,layer,amount*.58);
}
struct ObjectHit {distance:f32,color:vec3<f32>,opacity:f32};
fn objectHit(origin:vec3<f32>,direction:vec3<f32>,includeCrown:bool)->ObjectHit{
 var distance=cubeHit(origin,direction);if(params.viewport.z>.5){distance=roundedObjectHit(origin,direction);}var color=vec3<f32>(0.0);var opacity=1.0;
 if(distance>0.0){color=cubeColor(origin+direction*distance);}
 for(var i=0u;i<u32(params.viewport.w);i++){
  let ball=balls[i];if(ball.position.w<=0.0){continue;}let delta=origin-ball.position.xyz;let b=dot(delta,direction);let discriminant=b*b-dot(delta,delta)+ball.position.w*ball.position.w;
  if(discriminant>0.0){let root=sqrt(discriminant);var hit= -b-root;if(hit<=.001){hit= -b+root;}
   if(hit>.001 && (distance<0.0 || hit<distance)){
    distance=hit;let normal=normalize(origin+direction*hit-ball.position.xyz);let sun=normalize(vec3<f32>(-.35,.65,.55));
    let palette=array<vec3<f32>,6>(vec3<f32>(.85,.24,.08),vec3<f32>(.95,.71,.13),vec3<f32>(.18,.53,.70),vec3<f32>(.78,.28,.18),vec3<f32>(.80,.76,.50),vec3<f32>(.24,.56,.42));
    let diffuse=.28+.72*max(dot(normal,sun),0.0);let spec=pow(max(dot(reflect(-sun,normal),-direction),0.0),50.0);
    color=palette[i%6u]*diffuse+vec3<f32>(.55)*spec;
   }
  }
 }
 for(var eventIndex=0u;eventIndex<u32(params.viewport.w);eventIndex++){
 let event=impact[eventIndex];
 // Trace a continuous curved sheet with an irregular, moving rim.
 let crownAge=params.settings.x-event.z;
 if(includeCrown && event.w>0.0 && crownAge>=0.0 && crownAge<.9){
  let base=baseWave(event.xy,event.z,0.0);let center=vec3<f32>(event.x,base+.16,event.y);
  let delta=origin-center;let projection=dot(delta,direction);let bound=projection*projection-dot(delta,delta)+1.44;
  if(bound>0.0){var t=max(.001,-projection-sqrt(bound));let stop= -projection+sqrt(bound);
   for(var step=0u;step<64u;step++){
    if(t>stop || (distance>0.0 && t>distance)){break;}let p=origin+direction*t;let field=crownField(p,crownAge,base,event.xy);
    if(field<.003){
     let e=.008;let normal=normalize(vec3<f32>(crownField(p+vec3<f32>(e,0.0,0.0),crownAge,base,event.xy)-crownField(p-vec3<f32>(e,0.0,0.0),crownAge,base,event.xy),crownField(p+vec3<f32>(0.0,e,0.0),crownAge,base,event.xy)-crownField(p-vec3<f32>(0.0,e,0.0),crownAge,base,event.xy),crownField(p+vec3<f32>(0.0,0.0,e),crownAge,base,event.xy)-crownField(p-vec3<f32>(0.0,0.0,e),crownAge,base,event.xy)));
     let fine=noise(p.xz*55.0+vec2<f32>(p.y*12.0,crownAge*3.0))*.55+noise(p.xz*117.0+vec2<f32>(p.y*22.0,8.0))*.45;
     let rim=smoothstep(.16,.32,p.y-base);let edge=pow(1.0-abs(dot(normal,-direction)),3.0);
     let optics=splashOptics(p,direction,normal);let coverage=clamp(.28+rim*.44+smoothstep(.48,.85,fine)*.20,0.0,.9);
     color=foamOptics(optics,sky(reflect(direction,normal)),normal,coverage,edge);
     opacity=clamp(.20+rim*.30+edge*.22+smoothstep(.7,.9,fine)*.12,.20,.76);distance=t;break;
    }
    t+=clamp(field*.65,.012,.12);
   }
  }
 }
 // Small ballistic droplets, emitted at the detected surface crossing.
 let age=params.settings.x-event.z;
 if(includeCrown && event.w>0.0 && age>=0.0 && age<1.15){
  for(var k=0u;k<16u;k++){
   let angle=f32(k)*2.399963;let speed=1.2+.12*f32(k%5u);let rise=2.6+.18*f32(k%4u);
   let center=vec3<f32>(event.x+cos(angle)*speed*age, baseWave(event.xy,event.z,0.0)+rise*age-4.905*age*age,event.y+sin(angle)*speed*age);
   if(center.y<0.0){continue;}
   // Ellipsoids stretch along their ballistic velocity and gently oscillate.
   // Transform the ray into the ellipsoid's local unit sphere for one
   // analytic intersection, then transform its normal back to world space.
   let velocity=vec3<f32>(cos(angle)*speed,rise-9.81*age,sin(angle)*speed);
   let axis=normalize(velocity+vec3<f32>(.0001,0.0,0.0));var side=cross(axis,vec3<f32>(0.0,1.0,0.0));
   if(length(side)<.001){side=vec3<f32>(1.0,0.0,0.0);}side=normalize(side);let third=normalize(cross(axis,side));
   let stretch=clamp(1.15+length(velocity)*.18+.13*sin(age*13.0+f32(k)*1.7),1.05,2.2);
   let r=.034;let axes=vec3<f32>(r*stretch,r/sqrt(stretch),r/sqrt(stretch));
   let offset=origin-center;let o=vec3<f32>(dot(offset,axis),dot(offset,side),dot(offset,third))/axes;
   let d=vec3<f32>(dot(direction,axis),dot(direction,side),dot(direction,third))/axes;
   let qa=dot(d,d);let qb=dot(o,d);let disc=qb*qb-qa*(dot(o,o)-1.0);
   if(disc>0.0){let hit=(-qb-sqrt(disc))/qa;if(hit>.001 && (distance<0.0||hit<distance)){
    let local=o+d*hit;let gradient=local/axes;let n=normalize(axis*gradient.x+side*gradient.y+third*gradient.z);let edge=pow(1.0-clamp(dot(n,-direction),0.0,1.0),3.0);
    let sun=normalize(vec3<f32>(-.35,.65,.55));let highlight=pow(max(dot(reflect(-sun,n),-direction),0.0),80.0);
    let p=origin+direction*hit;let optics=splashOptics(p,direction,n);
    distance=hit;color=mix(optics,foamColor(n),.48)+vec3<f32>(.75,.83,.80)*highlight*.7;
    opacity=clamp(.48+edge*.28+highlight*.20,.48,.85);
   }}
  }
 }
 }
 return ObjectHit(distance,color,opacity);
}
fn overlayCrown(base:vec3<f32>,hit:ObjectHit,limit:f32)->vec3<f32>{
 if(hit.distance>0.0 && hit.distance<limit && hit.opacity<1.0){return mix(base,hit.color,hit.opacity);}return base;
}
fn display(value:vec3<f32>)->vec4<f32>{return vec4<f32>(pow(max(value,vec3<f32>(0.0)),vec3<f32>(1.0/2.2)),1.0);}
@fragment fn fragment(input:Screen)->@location(0) vec4<f32>{
 let size=params.viewport.xy;let xy=vec2<f32>(input.pos.x/size.x*2.0-1.0,1.0-input.pos.y/size.y*2.0);
 let eye=params.eye.xyz;let forward=normalize(vec3<f32>(0.0,0.0,0.0)-eye);let right=normalize(cross(forward,vec3<f32>(0.0,1.0,0.0)));let up=normalize(cross(right,forward));
 let ray=normalize(forward+right*xy.x*(size.x/size.y)*.57735027+up*xy.y*.57735027);let time=params.settings.x;
 let direct=objectHit(eye,ray,false);let crown=objectHit(eye,ray,true);
 if(ray.y>=-.001){if(direct.distance>0.0){return display(overlayCrown(direct.color,crown,direct.distance));}return display(overlayCrown(sky(ray),crown,10000.0));}
 var t= -eye.y/ray.y;for(var i=0u;i<5u;i++){let p=eye+ray*t;t=(wave(p.xz,time,t)-eye.y)/ray.y;}
 if(direct.distance>0.0 && (t<=0.0 || direct.distance<t)){return display(overlayCrown(direct.color,crown,direct.distance));}
 if(t<=0.0 || t>200.0){return display(overlayCrown(sky(ray),crown,10000.0));}
 let point=eye+ray*t;let normal=waveNormal(point.xz,time,t);
 let cosView=max(dot(-ray,normal),0.0);let reflectedRay=reflect(ray,normal);var reflection=sky(reflectedRay);
 let reflectedHit=objectHit(point+normal*.001,reflectedRay,true);if(reflectedHit.distance>0.0){reflection=mix(reflection,reflectedHit.color,reflectedHit.opacity);}
 let refracted=refract(ray,normal,1.0/1.333);
 let floorDepth=2.2;let travel=min(50.0,(floorDepth+point.y)/max(.05,-refracted.y));let bottom=point+refracted*travel;
 let clarity=max(.2,params.settings.z);
 let causticWave=sin(bottom.x*3.3+time*1.2+sin(bottom.z*2.4-time))*sin(bottom.z*3.0-time*.9+sin(bottom.x*2.0+time));
 let caustics=pow(max(0.0,causticWave),5.0)*.22*exp(-floorDepth*.35);
 var seabed=ground(bottom.xz)*(1.0+caustics);
 let submergedHit=objectHit(point-normal*.001,refracted,false);if(submergedHit.distance>0.0 && submergedHit.distance<travel){seabed=submergedHit.color;}
 let water=vec3<f32>(.018,.17,.16);
 let path=select(travel,submergedHit.distance,submergedHit.distance>0.0 && submergedHit.distance<travel);
 let attenuation=exp(-vec3<f32>(.17,.095,.065)*path/clarity);
 let transmitted=seabed*attenuation+water*(vec3<f32>(1.0)-attenuation);
 let sun=normalize(vec3<f32>(-.35,.65,.55));let halfVec=normalize(sun-ray);
 // A broader microfacet highlight reduces high-contrast sparkling artifacts.
 let nh=max(dot(normal,halfVec),0.0);let roughness=.16;let alpha=roughness*roughness;
 let denom=max(.0001,nh*nh*(alpha*alpha-1.0)+1.0);let distribution=alpha*alpha/(3.14159265*denom*denom);
 let spec=min(1.2,distribution*.018)*max(dot(normal,sun),0.0);
 let scatter=pow(max(dot(ray,sun),0.0),5.0)*.07*(1.0-cosView);let f=fresnel(cosView);
 var color=mix(transmitted,reflection,f)+vec3<f32>(1.0,.91,.72)*spec+vec3<f32>(.05,.3,.24)*scatter;
 // Foam gathers where waves meet the cube and thins outward.
 let cubeDistance=select(max(abs(point.x),abs(point.z))-.65,roundedObjectField(vec3<f32>(point.x,0.0,point.z)),params.viewport.z>.5);
 if(cubeDistance>=0.0 && cubeDistance<.55){
  let near=1.0-smoothstep(.05,.50,cubeDistance);
  let uv=point.xz*8.0+vec2<f32>(time*.55,-time*.3);
  let texture=noise(uv)*.52+noise(uv*2.6+vec2<f32>(4.8,2.3))*.30+noise(uv*6.0+vec2<f32>(8.0,5.0))*.18;
  var face=select(vec2<f32>(0.0,sign(point.z)),vec2<f32>(sign(point.x),0.0),abs(point.x)>abs(point.z));
  if(params.viewport.z>.5){let n=roundedObjectNormal(vec3<f32>(point.x,0.0,point.z));face=normalize(n.xz+vec2<f32>(.00001));}
  let response=cubeImpactWash(point.xz,face,time);
  color=foamOptics(color,reflection,normal,near*smoothstep(.38,.71,texture)*.72*response,f);
 }
 // Advected multiscale breakup creates foam around the expanding impact.
 for(var eventIndex=0u;eventIndex<u32(params.viewport.w);eventIndex++){
 let event=impact[eventIndex];
 let foamAge=time-event.z;
 if(event.w>0.0 && foamAge>=0.0 && foamAge<6.0){
  let relative=point.xz-event.xy-vec2<f32>(.08,.025)*foamAge;let radius=length(relative);let front=.16+foamAge*.48;
  let lifetime=1.0-smoothstep(3.6,6.0,foamAge);
  let outer=exp(-pow((radius-front)/(.20+foamAge*.10),2.0));
  let trailing=exp(-pow(radius/(.30+foamAge*.22),2.0))*.45;
  let envelope=max(outer,trailing)*lifetime;
  let uv=relative*8.0+vec2<f32>(foamAge*.8,-foamAge*.5);let broken=foamBreakup(uv);
  let foam=envelope*smoothstep(.32,.67,broken)*.82;
  color=foamOptics(color,reflection,normal,foam,f);
 }
 }
 let horizon=overlayCrown(mix(color,sky(ray),smoothstep(90.0,200.0,t)),crown,t);
 return vec4<f32>(pow(max(horizon,vec3<f32>(0.0)),vec3<f32>(1.0/2.2)),1.0);
}

struct CloudParams{view:vec4<f32>,sky:vec4<f32>,cloud:vec4<f32>};
@group(0) @binding(0) var<uniform> params:CloudParams;
struct Screen{@builtin(position) pos:vec4<f32>};
@vertex fn vertex(@builtin(vertex_index) i:u32)->Screen{
 let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));return Screen(vec4<f32>(p[i],0.0,1.0));
}
// Integer avalanche hashing avoids the correlated bands produced by
// trigonometric hashes at planet-sized coordinates.
fn cloudHash(p:vec3<f32>)->f32{
 let i=bitcast<vec3<u32>>(vec3<i32>(p));
 var h=(i.x*1597334677u) ^ (i.y*3812015801u) ^ (i.z*2798796415u);
 h=(h ^ (h>>16u))*2246822519u;h=(h ^ (h>>13u))*3266489917u;h=h ^ (h>>16u);
 return f32(h>>8u)*(1.0/16777216.0);
}
fn cloudNoise(p:vec3<f32>)->f32{
 let i=floor(p);let f=fract(p);let u=f*f*(3.0-2.0*f);
 let a=mix(mix(cloudHash(i),cloudHash(i+vec3<f32>(1,0,0)),u.x),mix(cloudHash(i+vec3<f32>(0,1,0)),cloudHash(i+vec3<f32>(1,1,0)),u.x),u.y);
 let b=mix(mix(cloudHash(i+vec3<f32>(0,0,1)),cloudHash(i+vec3<f32>(1,0,1)),u.x),mix(cloudHash(i+vec3<f32>(0,1,1)),cloudHash(i+vec3<f32>(1,1,1)),u.x),u.y);
 return mix(a,b,u.z);
}
const PLANET_RADIUS:f32=6371000.0;
// Local tangent coordinates keep the camera near the origin; rationalized
// radial altitude avoids subtracting nearly equal planet-sized floats.
fn planetAltitude(p:vec3<f32>)->f32{
 let y=PLANET_RADIUS+p.y;let r=sqrt(y*y+dot(p.xz,p.xz));
 return p.y+dot(p.xz,p.xz)/max(1.0,r+y);
}
// Intersection with a sphere specified by height above the planet surface.
// The quadratic constant uses height differences to preserve f32 precision.
fn sphereInterval(altitude:f32,ray:vec3<f32>,shellHeight:f32)->vec2<f32>{
 let b=(PLANET_RADIUS+altitude)*ray.y;
 let c=(altitude-shellHeight)*(2.0*PLANET_RADIUS+altitude+shellHeight);
 let disc=b*b-c;if(disc<0.0){return vec2<f32>(1.0,-1.0);}
 let root=sqrt(disc);let q= -b-select(-root,root,b>=0.0);
 // Compute the near root from the product of roots to avoid catastrophic
 // cancellation between two planet-sized numbers near the ground.
 if(abs(q)<.001){return vec2<f32>(-b-root,-b+root);}
 let other=c/q;return vec2<f32>(min(q,other),max(q,other));
}
// Seeded spherical weather field: broad systems and distorted fronts control
// local coverage independently from small three-dimensional cloud structure.
fn weatherField(point:vec3<f32>)->vec2<f32>{
 let seed=params.cloud.z;let angle=params.sky.x*params.cloud.y/PLANET_RADIUS;
 let pos=vec3<f32>(point.x,PLANET_RADIUS+point.y,point.z);
 let direction=normalize(vec3<f32>(pos.x*cos(angle)+pos.z*sin(angle),pos.y,-pos.x*sin(angle)+pos.z*cos(angle)));
 let key=vec3<f32>(seed*.071,seed*.039,seed*.053);let regional=direction*22.0+key;
 let warp=vec3<f32>(cloudNoise(regional+vec3<f32>(7,13,3)),cloudNoise(regional+vec3<f32>(19,2,11)),cloudNoise(regional+vec3<f32>(4,17,23)))-.5;
 let warped=regional+warp*2.8;let large=cloudNoise(warped*.65);let medium=cloudNoise(warped*1.9+vec3<f32>(9,3,17));
 let fronts=1.0-abs(2.0*cloudNoise(warped*1.2+vec3<f32>(4,7,21))-1.0);
 return vec2<f32>(clamp(large*.56+medium*.24+fronts*.20,0.0,1.0),cloudNoise(warped*.8+vec3<f32>(12,5,19)));
}
fn cloudDensity(p:vec3<f32>,weather:vec2<f32>,detailWeight:f32)->f32{
 let height=(planetAltitude(p)-1500.0)/1800.0;
 let profile=smoothstep(0.0,.10,height)*(1.0-smoothstep(mix(.46,.72,weather.y),1.0,height));
 if(profile<=0.0 || params.sky.w<=0.0){return 0.0;}
 let seed=params.cloud.z;let angle=params.sky.x*params.cloud.y/PLANET_RADIUS;let global=vec3<f32>(p.x,PLANET_RADIUS+p.y,p.z);
 let rotated=vec3<f32>(global.x*cos(angle)+global.z*sin(angle),global.y,-global.x*sin(angle)+global.z*cos(angle));
 let q=rotated*.00028+vec3<f32>(seed*.071,seed*.039,seed*.053);
 let base=cloudNoise(q)*.68+cloudNoise(q*2.03+vec3<f32>(12.0,3.0,6.0))*.32;
 let erode=cloudNoise(q*4.1+vec3<f32>(2.0,7.0,4.0));
 // Regional humidity gates broad clear areas and dense weather systems.
 let humidity=smoothstep(.31,.67,weather.x);
 let coverage=clamp(params.sky.w*.45+humidity*.72-.18,0.0,1.0);
 let threshold=mix(.86,.30,coverage);
 return smoothstep(threshold,threshold+.23,base+(erode-.5)*.16*detailWeight)*profile*params.cloud.x*smoothstep(0.0,.08,params.sky.w);
}
@fragment fn fragment(input:Screen)->@location(0) vec4<f32>{
 let uv=vec2<f32>(input.pos.x/params.view.x*2.0-1.0,1.0-input.pos.y/params.view.y*2.0);let yaw=params.view.z;let pitch=params.view.w;
 let forward=vec3<f32>(sin(yaw)*cos(pitch),sin(pitch),cos(yaw)*cos(pitch));let right=vec3<f32>(cos(yaw),0.0,-sin(yaw));let up=normalize(cross(forward,right));
 let ray=normalize(forward+right*uv.x*(params.view.x/params.view.y)*.58+up*uv.y*.58);
 let sun=normalize(vec3<f32>(.32,sin(params.sky.y),cos(params.sky.y)*.95));let origin=vec3<f32>(0.0,params.sky.z,0.0);
 var color=atmosphereSky(ray,sun,vec3<f32>(0,1,0),origin.y);
 // The horizon is the intersection of the actual planet sphere.
 let ground=sphereInterval(origin.y,ray,0.0);var groundDistance=1e9;
 if(ground.y>0.0 && ground.x>0.0){
  groundDistance=ground.x;
  // A simple ocean-colored spherical ground supplies contrast through gaps.
  let horizonDistance=sqrt(max(1.0,origin.y*(2.0*PLANET_RADIUS+origin.y)));
  let haze=smoothstep(.20,1.0,groundDistance/horizonDistance);
  color=mix(vec3<f32>(.045,.12,.19),vec3<f32>(.26,.49,.67),haze*.8);
 }
 let outer=sphereInterval(origin.y,ray,3300.0);let inner=sphereInterval(origin.y,ray,1500.0);
 if(outer.y>0.0 && outer.y>outer.x){
  var start=max(0.0,outer.x);var end=min(outer.y,groundDistance);
  // A ray can cross the inner sphere: retain the near cloud-shell segment.
  if(inner.y>inner.x){if(inner.x>start){end=min(end,inner.x);}else if(inner.y>start){start=inner.y;}}
  if(end>start){
   let steps=48u;let stepSize=(end-start)/f32(steps);var transmission=1.0;var lightAccum=vec3<f32>(0.0);
   let midpoint=origin+ray*((start+end)*.5);let weather=weatherField(midpoint);
   let footprint=max(stepSize,(start+end)*.58/params.view.y);
   let detailWeight=1.0-smoothstep(250.0,1300.0,footprint);
   let jitter=.5+(cloudHash(vec3<f32>(floor(input.pos.xy),1.0))-.5)*.35;
   for(var i=0u;i<steps;i++){
    if(transmission<.02){break;}let distance=start+(f32(i)+jitter)*stepSize;let point=origin+ray*distance;let density=cloudDensity(point,weather,detailWeight);
    if(density>.001){
     let optical=density*stepSize*.0018;let alpha=1.0-exp(-optical);
     let shadow=exp(-cloudDensity(point+sun*280.0,weather,detailWeight)*.8);let phase=.55+.45*pow(max(dot(ray,sun),0.0),6.0);
     let illumination=mix(vec3<f32>(.32,.38,.43),vec3<f32>(1.0,.86,.68),shadow*phase);
     lightAccum+=transmission*alpha*illumination;transmission*=1.0-alpha;
    }
   }
   color=color*transmission+lightAccum;
  }
 }
 // Limb glow is evaluated from tangent altitude above the spherical ground.
 // This inexpensive single-scattering approximation is visible from orbit.
 let tangentDistance=max(0.0,-(PLANET_RADIUS+origin.y)*ray.y);
 if(tangentDistance>0.0 && groundDistance>1e8){
  let tangentHeight=max(0.0,planetAltitude(origin+ray*tangentDistance));
  let altitudeVisibility=smoothstep(5000.0,60000.0,origin.y);
  let limb=exp(-tangentHeight/12000.0)*altitudeVisibility;
  let sunSide=.55+.45*max(dot(ray,sun),0.0);
  color+=vec3<f32>(.08,.30,.78)*limb*sunSide;
 }
 let mapped=max(color,vec3<f32>(0.0))/(1.0+max(color,vec3<f32>(0.0))*.22);return vec4<f32>(pow(mapped,vec3<f32>(1.0/2.2)),1.0);
}

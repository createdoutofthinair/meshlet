struct CloudParams{view:vec4<f32>,sky:vec4<f32>,cloud:vec4<f32>,shape:vec4<f32>};
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
 let key=vec3<f32>(seed*.071,seed*.039,seed*.053);
 // Bend the planetary weather coordinates around seeded large-scale vortices.
 // The three-dimensional direction is continuous across the sphere.
 let axis=normalize(vec3<f32>(.08+sin(seed*.07)*.08,.99,.07+cos(seed*.09)*.08));
 let distance=length(cross(direction,axis));let rotation=2.8*exp(-distance*distance*38.0);
 let swirled=direction*cos(rotation)+cross(axis,direction)*sin(rotation)+axis*dot(axis,direction)*(1.0-cos(rotation));
 let regional=swirled*22.0+key;
 let warp=vec3<f32>(cloudNoise(regional+vec3<f32>(7,13,3)),cloudNoise(regional+vec3<f32>(19,2,11)),cloudNoise(regional+vec3<f32>(4,17,23)))-.5;
 let warped=regional+warp*2.8;let large=cloudNoise(warped*.65);let medium=cloudNoise(warped*1.9+vec3<f32>(9,3,17));
 let fronts=1.0-abs(2.0*cloudNoise(warped*1.2+vec3<f32>(4,7,21))-1.0);
 return vec2<f32>(clamp(large*.56+medium*.24+fronts*.20,0.0,1.0),cloudNoise(warped*.8+vec3<f32>(12,5,19)));
}
fn cloudDensity(p:vec3<f32>,weather:vec2<f32>,detailWeight:f32)->f32{
 let height=(planetAltitude(p)-1500.0)/6500.0;
 return cloudDensityAtHeight(p,weather,detailWeight,height);
}
struct CloudWeatherTerms {typeBlend:f32,threshold:f32,coverageFactor:f32,windCos:f32,windSin:f32,scale:f32,seedOffset:vec3<f32>};
fn cloudWeatherTerms(weather:vec2<f32>)->CloudWeatherTerms{
 let humidity=smoothstep(.31,.67,weather.x);
 let coverage=clamp(params.sky.w*.45+humidity*.72-.18,0.0,1.0);
 let angle=params.sky.x*params.cloud.y/PLANET_RADIUS;let seed=params.cloud.z;
 return CloudWeatherTerms(smoothstep(.32,.68,weather.y),mix(.86,.30,coverage),smoothstep(0.0,.08,params.sky.w),cos(angle),sin(angle),.00028/max(.5,params.shape.x),vec3<f32>(seed*.071,seed*.039,seed*.053));
}
fn cloudDensityPrepared(p:vec3<f32>,detailWeight:f32,terms:CloudWeatherTerms)->f32{
 return cloudDensityWithTerms(p,detailWeight,(planetAltitude(p)-1500.0)/6500.0,terms);
}
// A caller that also shades a sample can reuse its radial height.
fn cloudDensityAtHeight(p:vec3<f32>,weather:vec2<f32>,detailWeight:f32,height:f32)->f32{
 return cloudDensityWithTerms(p,detailWeight,height,cloudWeatherTerms(weather));
}
fn cloudDensityWithTerms(p:vec3<f32>,detailWeight:f32,height:f32,terms:CloudWeatherTerms)->f32{
 // Low sheet clouds and taller cumulus coexist, with smooth regional changes.
 let low=smoothstep(0.0,.055,height)*(1.0-smoothstep(.18,.40,height));
 let tall=smoothstep(0.0,.08,height)*(1.0-smoothstep(.55,1.0,height));
 let profile=mix(low,tall,terms.typeBlend);
 if(profile<=0.0 || params.sky.w<=0.0){return 0.0;}
 let global=vec3<f32>(p.x,PLANET_RADIUS+p.y,p.z);
 let rotated=vec3<f32>(global.x*terms.windCos+global.z*terms.windSin,global.y,-global.x*terms.windSin+global.z*terms.windCos);
 let q=rotated*terms.scale+terms.seedOffset;
 // At full detail the coarse field has zero contribution to the mix.
 var coarse=0.0;
 if(detailWeight<1.0){coarse=cloudNoise(q*.16+vec3<f32>(8.0,14.0,3.0));}
 // Filter the base shape as well as erosion when it becomes subpixel.
 // When the detail weight is exactly zero, its noise and erosion cannot
 // affect the output. Orbital samples always use this filtered path.
 var base=coarse;
 if(detailWeight>0.0){
  let baseShape=cloudNoise(q)*.68+cloudNoise(q*2.03+vec3<f32>(12.0,3.0,6.0))*.32;
  base=mix(coarse,baseShape,detailWeight);
 }
 // Regional humidity gates broad clear areas and dense weather systems.
 let threshold=terms.threshold;
 let lower=threshold;
 // Noise is in [0,1], so erosion can increase density by at most .08 times
 // the detail weight. Samples below that bound cannot produce cloud density.
 if(base+.080001*detailWeight<=lower){return 0.0;}
 var erosion=0.0;
 if(detailWeight>0.0){erosion=(cloudNoise(q*4.1+vec3<f32>(2.0,7.0,4.0))-.5)*.16*detailWeight;}
 return smoothstep(lower,threshold+.23,base+erosion)*profile*params.cloud.x*terms.coverageFactor;
}
@fragment fn fragment(input:Screen)->@location(0) vec4<f32>{
 let uv=vec2<f32>(input.pos.x/params.view.x*2.0-1.0,1.0-input.pos.y/params.view.y*2.0);let yaw=params.view.z;let pitch=params.view.w;
 let forward=vec3<f32>(sin(yaw)*cos(pitch),sin(pitch),cos(yaw)*cos(pitch));let right=vec3<f32>(cos(yaw),0.0,-sin(yaw));let up=normalize(cross(forward,right));
 let ray=normalize(forward+right*uv.x*(params.view.x/params.view.y)*.58+up*uv.y*.58);
 let sun=vec3<f32>(sin(params.cloud.w)*cos(params.sky.y),sin(params.sky.y),cos(params.cloud.w)*cos(params.sky.y));let origin=vec3<f32>(0.0,params.sky.z,0.0);
 let sunElevation=sun.y;let day=atmosphereDaylight(sunElevation);let twilight=atmosphereTwilight(sunElevation);
 var color=vec3<f32>(0.0);
 if(params.shape.z>.5){color=atmosphereSky(ray,sun,vec3<f32>(0,1,0),origin.y);}
 // The horizon is the intersection of the actual planet sphere.
 let ground=sphereInterval(origin.y,ray,0.0);var groundDistance=1e9;
 let horizonDistance=sqrt(max(1.0,origin.y*(2.0*PLANET_RADIUS+origin.y)));
 let horizonDirection= -horizonDistance/(PLANET_RADIUS+origin.y);
 // Analytical pixel coverage at the spherical silhouette; the derivative is
 // taken before divergent branches so it remains valid in WebGPU shaders.
 let edgeWidth=max(.000001,fwidth(ray.y)*1.25);
 let groundCoverage=1.0-smoothstep(horizonDirection-edgeWidth,horizonDirection+edgeWidth,ray.y);
 // At sea level the near root is zero. It must occlude downward rays;
 // otherwise they reach the cloud shell on the far side of the planet.
 if(params.shape.w>.5 && ground.y>0.0 && ground.x>=0.0){groundDistance=ground.x;}
 if(params.shape.w>.5 && origin.y<=.5 && ray.y<0.0){groundDistance=0.0;}
 let haze=smoothstep(.48,1.0,min(groundDistance,horizonDistance)/horizonDistance)*select(0.0,1.0,params.shape.z>.5);
 // The surface is an analytic smooth sphere, shaded using the actual
 // spherical normal at the ray hit rather than a flat horizon fill.
 let hitPoint=origin+ray*max(0.0,groundDistance);
 let surfaceNormal=normalize(vec3<f32>(hitPoint.x,PLANET_RADIUS+hitPoint.y,hitPoint.z));
 let direct=max(dot(surfaceNormal,sun),0.0);
 let surfaceLight=.025+.9*direct;
 let groundBase=vec3<f32>(.10,.23,.32)*surfaceLight;
 let groundColor=mix(groundBase,vec3<f32>(.26,.49,.67)*max(.03,day),haze*.52);
 color=mix(color,groundColor,groundCoverage*select(0.0,1.0,params.shape.w>.5));
 // Limb glow is evaluated from tangent altitude above the spherical ground.
 // This inexpensive single-scattering approximation is visible from orbit.
 let tangentDistance=max(0.0,-(PLANET_RADIUS+origin.y)*ray.y);
 {
  let tangentHeight=max(0.0,planetAltitude(origin+ray*tangentDistance));
  let altitudeVisibility=smoothstep(5000.0,60000.0,origin.y);
  // Upward rays have their closest point at the camera. Fade their short
  // atmospheric path smoothly instead of abruptly dropping the halo at y=0.
  let upwardFade=exp(-max(0.0,ray.y)*5.0);
  let broad=exp(-tangentHeight/40000.0)*altitudeVisibility*upwardFade;
  let inner=exp(-tangentHeight/9000.0)*altitudeVisibility*upwardFade;
  let sunSide=.65+.35*max(dot(ray,sun),0.0);
  let limbTint=mix(vec3<f32>(.07,.25,.65),vec3<f32>(.60,.18,.06),twilight*pow(max(dot(ray,sun),0.0),2.0));
  color+=select(0.0,1.0,params.shape.z>.5)*(limbTint*broad+vec3<f32>(.12,.25,.40)*inner)*sunSide*max(.035,day+twilight*.22)*.72*max(0.0,params.shape.y)*(1.0-groundCoverage*.65);
 }
 // Feather the outer cloud-shell silhouette over the pixel footprint.
 // For cameras inside the shell, no limb masking is needed.
 let shellAlt=max(0.0,origin.y-8000.0);
 let shellHorizon= -sqrt(shellAlt*(2.0*PLANET_RADIUS+origin.y+8000.0))/(PLANET_RADIUS+origin.y);
 let shellEdge=max(.000001,fwidth(ray.y)*2.0);
 let shellCoverage=select(1.0,1.0-smoothstep(shellHorizon-shellEdge,shellHorizon+shellEdge,ray.y),origin.y>8000.0);
 let outer=sphereInterval(origin.y,ray,8000.0);let inner=sphereInterval(origin.y,ray,1500.0);
 if(params.cloud.x>.001 && params.sky.w>.001 && outer.y>0.0 && outer.y>outer.x){
  var start=max(0.0,outer.x);var end=min(outer.y,groundDistance);
  // A ray can cross the inner sphere: retain the near cloud-shell segment.
  if(inner.y>inner.x){if(inner.x>start){end=min(end,inner.x);}else if(inner.y>start){start=inner.y;}}
  if(end>start){
   // Long, shallow views cross more of the cloud volume and need more
   // samples; otherwise repeated sampling planes appear as stripes.
   let steps=u32(mix(48.0,96.0,smoothstep(12000.0,100000.0,end-start)));let stepSize=(end-start)/f32(steps);var transmission=1.0;var lightAccum=vec3<f32>(0.0);
   let midpoint=origin+ray*((start+end)*.5);let weather=weatherField(midpoint);
   let footprint=max(stepSize,(start+end)*.58/params.view.y);
   let detailWeight=1.0-smoothstep(650.0,3400.0,footprint);
   // A per-pixel offset breaks up aligned ray-march slices without
   // time-varying noise or flicker when the camera is stationary.
   let jitter=cloudHash(vec3<f32>(floor(input.pos.xy),1.0));
   for(var i=0u;i<steps;i++){
    if(transmission<.02){break;}let distance=start+(f32(i)+jitter)*stepSize;let point=origin+ray*distance;let density=cloudDensity(point,weather,detailWeight);
    if(density>.001){
     let optical=density*stepSize*.0018;let alpha=1.0-exp(-optical);
     let shadow=exp(-cloudDensity(point+sun*420.0,weather,detailWeight)*1.15);let phase=.55+.45*pow(max(dot(ray,sun),0.0),6.0);
     let cloudHeight=clamp((planetAltitude(point)-1500.0)/6500.0,0.0,1.0);
     let cloudUp=normalize(vec3<f32>(point.x,PLANET_RADIUS+point.y,point.z));
     let cloudSun=dot(cloudUp,sun);let cloudDay=atmosphereDaylight(cloudSun);let cloudTwilight=atmosphereTwilight(cloudSun);
     let cool=mix(vec3<f32>(.018,.025,.05),vec3<f32>(.24,.31,.39),cloudDay);
     let warm=mix(vec3<f32>(1.0,.92,.80),vec3<f32>(1.0,.32,.12),cloudTwilight*.85);
     let illumination=mix(cool,warm*max(.035,cloudDay+cloudTwilight*.30),clamp(shadow*phase*(.70+.45*cloudHeight),0.0,1.0));
     lightAccum+=transmission*alpha*illumination;transmission*=1.0-alpha;
    }
   }
   // Cloud light travels through the atmosphere before reaching the eye.
   // Blend distant details toward the same blue haze as the planetary limb.
   let aerial=1.0-exp(-max(0.0,start-90000.0)/480000.0);
   let haze=mix(vec3<f32>(.012,.02,.045),mix(vec3<f32>(.25,.44,.62),vec3<f32>(.60,.24,.12),twilight*.6),max(day,twilight*.35));
   lightAccum=mix(lightAccum,haze*(1.0-transmission),aerial*.65*select(0.0,1.0,params.shape.z>.5));
   let tangentFade=mix(1.0,smoothstep(0.0,16000.0,end-start),smoothstep(8000.0,12000.0,origin.y));
   let cloudColor=color*transmission+lightAccum;
   color=mix(color,cloudColor,shellCoverage*tangentFade);
  }
 }
 let mapped=max(color,vec3<f32>(0.0))/(1.0+max(color,vec3<f32>(0.0))*.22);let display=pow(mapped,vec3<f32>(1.0/2.2));
 // Sub-LSB dither reduces visible color steps in smooth sunset gradients.
 let dither=(cloudHash(vec3<f32>(floor(input.pos.xy),31.0))-.5)/255.0;
 return vec4<f32>(clamp(display+vec3<f32>(dither),vec3<f32>(0.0),vec3<f32>(1.0)),1.0);
}

@group(0) @binding(1) var sceneDepth:texture_depth_2d;
// A filtered far-field approximation: resolve large weather systems and
// fractional coverage without evaluating subpixel cloud erosion in orbit.
fn orbitalCloud(point:vec3<f32>,span:f32,ray:vec3<f32>,sun:vec3<f32>,weather:vec2<f32>)->vec4<f32>{
 // The same density field and weather drive both representations. Four
 // stratified volume samples approximate its integrated coverage in orbit.
 var density=0.0;
 for(var i=0u;i<4u;i++){
  let samplePoint=point+ray*((f32(i)-1.5)*span*.25);
  density+=cloudDensity(samplePoint,weather,0.0)*.25;
 }
 let opacity=1.0-exp(-density*max(span,0.0)*.0009);
 let shape=clamp(density,0.0,1.0);
 let up=normalize(vec3<f32>(point.x,PLANET_RADIUS+point.y,point.z));let elevation=dot(up,sun);
 let day=atmosphereDaylight(elevation);let twilight=atmosphereTwilight(elevation);
 let cool=mix(vec3<f32>(.018,.025,.05),vec3<f32>(.24,.31,.39),day);
 let warm=mix(vec3<f32>(1.0,.92,.80),vec3<f32>(1.0,.32,.12),twilight*.85)*max(.035,day+twilight*.30);
 let phase=.55+.45*pow(max(dot(ray,sun),0.0),6.0);
 let color=mix(cool,warm,clamp((.48+.34*shape)*phase,0.0,1.0));
 return vec4<f32>(color*opacity,opacity);
}
@fragment fn planetCloud(input:Screen)->@location(0) vec4<f32>{
 let uv=vec2<f32>(input.pos.x/params.view.x*2.0-1.0,1.0-input.pos.y/params.view.y*2.0);
 let worldRay=normalize(params.forward.xyz+params.right.xyz*uv.x*params.forward.w+params.up.xyz*uv.y*params.right.w);
 let ray=vec3<f32>(dot(worldRay,params.east.xyz),dot(worldRay,params.radial.xyz),dot(worldRay,params.north.xyz));
 let sun=vec3<f32>(dot(params.sun.xyz,params.east.xyz),dot(params.sun.xyz,params.radial.xyz),dot(params.sun.xyz,params.north.xyz));
 let origin=vec3<f32>(0.0,params.sky.z,0.0);
 // The final depth includes terrain and any ocean pixel that survived its
 // coast test. An analytic sea hit alone does not mean a pixel was drawn.
 let depth=textureLoad(sceneDepth,vec2<i32>(input.pos.xy),0);
 var sceneDistance=1e10;
 if(depth>0.0){sceneDistance=params.up.w*1000.0/(depth*max(.001,dot(worldRay,params.forward.xyz)));}
 var limit=sceneDistance;
 let ground=sphereInterval(origin.y,ray,0.0);
 // The sphere is only an occluder for the ocean. At sea level its near
 // intersection is exactly zero; include it to prevent far-side clouds.
 if(params.sun.w>0.5 && ground.y>0.0 && ground.x>=0.0){limit=min(limit,ground.x);}
 if(params.sun.w>0.5 && origin.y<=0.5 && ray.y<0.0){limit=0.0;}
 let outer=sphereInterval(origin.y,ray,8000.0);let inner=sphereInterval(origin.y,ray,1500.0);
 var transmission=1.0;var light=vec3<f32>(0.0);
 if(params.sky.w>0.001 && params.cloud.x>0.001 && outer.y>0.0 && outer.y>outer.x){
  var start=max(0.0,outer.x);var end=min(outer.y,limit);
  if(inner.y>inner.x){if(inner.x>start){end=min(end,inner.x);}else if(inner.y>start){start=inner.y;}}
  if(end>start){
   let span=end-start;
   // Blend representations across altitude so the handoff does not pop.
   let farWeight=smoothstep(50000.0,900000.0,origin.y);
   let weather=weatherField(origin+ray*((start+end)*.5));
   var distant=vec4<f32>(0.0);
   if(farWeight>0.0){distant=orbitalCloud(origin+ray*((start+end)*.5),span,ray,sun,weather);}
   if(farWeight<.999){
   // Long, grazing rays need smaller steps than short vertical views.
   let targetSteps=max(mix(32.0,64.0,smoothstep(12000.0,100000.0,span)),span/2700.0);
   let steps=u32(max(16.0,min(96.0,targetSteps)*params.atmosphere.w));
   let stepSize=(end-start)/f32(steps);
   let footprint=max(stepSize,(start+end)*.58/params.view.y);
   let detail=1.0-smoothstep(900.0,7000.0,footprint);
   let orbital=smoothstep(80000.0,600000.0,origin.y);
   let phase=.55+.45*pow(max(dot(ray,sun),0.0),6.0);
   let extinction=stepSize*mix(.0018,.0009,orbital);
   let shadowOffset=sun*mix(420.0,1600.0,orbital);
   let shadowStrength=mix(1.15,2.0,orbital);
   // Small stable subpixel jitter breaks aligned slices without covering the
   // entire cloud in high-contrast per-pixel noise.
   let jitter=.5+(cloudHash(vec3<f32>(floor(input.pos.xy),1.0))-.5)*.24;
   var shadowFrom=1.0;var shadowTo=1.0;var shadowReady=false;var shadowStep=0u;
   for(var i=0u;i<steps;i++){
    if(transmission<.02){break;}
    let point=origin+ray*(start+(f32(i)+jitter)*stepSize);
    let height=(planetAltitude(point)-1500.0)/6500.0;
    let density=cloudDensityAtHeight(point,weather,detail,height);
    if(density>.001){
     let alpha=1.0-exp(-density*extinction);
     // Sample lighting less often, but interpolate rather than holding the
     // previous value in visible bands across three marching slices.
     if(!shadowReady || i>=shadowStep+3u){
      if(!shadowReady){shadowFrom=exp(-cloudDensity(point+shadowOffset,weather,detail)*shadowStrength);}else{shadowFrom=shadowTo;}
      let ahead=point+ray*(stepSize*3.0);
      shadowTo=exp(-cloudDensity(ahead+shadowOffset,weather,detail)*shadowStrength);
      shadowStep=i;shadowReady=true;
     }
     let shadow=mix(shadowFrom,shadowTo,clamp(f32(i-shadowStep)/3.0,0.0,1.0));
     let cloudUp=normalize(vec3<f32>(point.x,PLANET_RADIUS+point.y,point.z));let elevation=dot(cloudUp,sun);
     let day=atmosphereDaylight(elevation);let twilight=atmosphereTwilight(elevation);
     let cool=mix(vec3<f32>(.018,.025,.05),vec3<f32>(.24,.31,.39),day);
     let warm=mix(vec3<f32>(1.0,.92,.80),vec3<f32>(1.0,.32,.12),twilight*.85);
     let illumination=mix(cool,warm*max(.035,day+twilight*.30),clamp(shadow*phase*(.7+.45*clamp(height,0.0,1.0)),0.0,1.0));
     light+=transmission*alpha*illumination;transmission*=1.0-alpha;
    }
   }
   }
   if(farWeight>0.0){light=mix(light,distant.rgb,farWeight);transmission=mix(transmission,1.0-distant.a,farWeight);}
  }
 }
 // Preserve cloud coverage up to the visible horizon. The actual depth
 // and sphere intersections already stop the march at the surface.
 let altitude=max(origin.y,0.0);
 let alpha=1.0-transmission;
 let sky=atmosphereSky(ray,sun,vec3<f32>(0,1,0),origin.y);
 if(depth==0.0){
  let tangent=max(0.0,-(PLANET_RADIUS+origin.y)*ray.y);
  let height=max(0.0,planetAltitude(origin+ray*tangent));
  let halo=exp(-height/40000.0)*smoothstep(5000.0,60000.0,origin.y)*exp(-max(0.0,ray.y)*5.0);
  let color=sky*transmission+light+vec3<f32>(.06,.18,.42)*halo*atmosphereDaylight(sun.y)*.5*params.atmosphere.z;
  return vec4<f32>(pow(max(color,vec3<f32>(0.0))/(1.0+max(color,vec3<f32>(0.0))*.22),vec3<f32>(1.0/2.2)),1.0);
 }
 // Distance haze uses the same sky and sun as the background. Restrict it
 // to low altitudes so the orbital view retains its terrain contrast.
 let aerial=(1.0-exp(-max(0.0,sceneDistance-4000.0)/70000.0))*exp(-altitude/18000.0)*.72*params.atmosphere.x;
 let hazeAlpha=clamp(aerial,0.0,.85)*(1.0-alpha);
 let hazeDisplay=pow(max(sky,vec3<f32>(0.0))/(1.0+max(sky,vec3<f32>(0.0))*.22),vec3<f32>(1.0/2.2));
 var cloudDisplay=vec3<f32>(0.0);
 if(alpha>.001){let color=light/alpha;cloudDisplay=pow(max(color,vec3<f32>(0.0))/(1.0+max(color,vec3<f32>(0.0))*.22),vec3<f32>(1.0/2.2));}
 return vec4<f32>(cloudDisplay*alpha+hazeDisplay*hazeAlpha,alpha+hazeAlpha);
}

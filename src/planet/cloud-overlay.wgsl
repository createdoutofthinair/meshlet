@group(0) @binding(1) var terrainDepth:texture_2d<f32>;
@fragment fn planetCloud(input:Screen)->@location(0) vec4<f32>{
 let uv=vec2<f32>(input.pos.x/params.view.x*2.0-1.0,1.0-input.pos.y/params.view.y*2.0);
 let worldRay=normalize(params.forward.xyz+params.right.xyz*uv.x*params.forward.w+params.up.xyz*uv.y*params.right.w);
 let ray=vec3<f32>(dot(worldRay,params.east.xyz),dot(worldRay,params.radial.xyz),dot(worldRay,params.north.xyz));
 let sun=vec3<f32>(dot(params.sun.xyz,params.east.xyz),dot(params.sun.xyz,params.radial.xyz),dot(params.sun.xyz,params.north.xyz));
 let origin=vec3<f32>(0.0,params.sky.z,0.0);
 let depth=abs(textureLoad(terrainDepth,vec2<i32>(input.pos.xy),0).r);
 var limit=1e10;
 if(depth>0.0){limit=params.up.w*1000.0/(depth*max(.001,dot(worldRay,params.forward.xyz)));}
 let ground=sphereInterval(origin.y,ray,0.0);
 if(params.sun.w>0.5 && ground.x>0.0){limit=min(limit,ground.x);}
 let outer=sphereInterval(origin.y,ray,8000.0);let inner=sphereInterval(origin.y,ray,1500.0);
 var transmission=1.0;var light=vec3<f32>(0.0);
 if(outer.y>0.0 && outer.y>outer.x){
  var start=max(0.0,outer.x);var end=min(outer.y,limit);
  if(inner.y>inner.x){if(inner.x>start){end=min(end,inner.x);}else if(inner.y>start){start=inner.y;}}
  if(end>start){
   let steps=u32(mix(40.0,72.0,smoothstep(12000.0,100000.0,end-start)));
   let stepSize=(end-start)/f32(steps);let weather=weatherField(origin+ray*((start+end)*.5));
   let detail=1.0-smoothstep(650.0,3400.0,max(stepSize,(start+end)*.58/params.view.y));
   let jitter=cloudHash(vec3<f32>(floor(input.pos.xy),1.0));
   for(var i=0u;i<steps;i++){
    if(transmission<.02){break;}
    let point=origin+ray*(start+(f32(i)+jitter)*stepSize);let density=cloudDensity(point,weather,detail);
    if(density>.001){
     let alpha=1.0-exp(-density*stepSize*.0018);let shadow=exp(-cloudDensity(point+sun*420.0,weather,detail)*1.15);
     let cloudUp=normalize(vec3<f32>(point.x,PLANET_RADIUS+point.y,point.z));let elevation=dot(cloudUp,sun);
     let day=atmosphereDaylight(elevation);let twilight=atmosphereTwilight(elevation);
     let phase=.55+.45*pow(max(dot(ray,sun),0.0),6.0);
     let cool=mix(vec3<f32>(.018,.025,.05),vec3<f32>(.24,.31,.39),day);
     let warm=mix(vec3<f32>(1.0,.92,.80),vec3<f32>(1.0,.32,.12),twilight*.85);
     let illumination=mix(cool,warm*max(.035,day+twilight*.30),clamp(shadow*phase,0.0,1.0));
     light+=transmission*alpha*illumination;transmission*=1.0-alpha;
    }
   }
  }
 }
 let alpha=1.0-transmission;
 let sky=atmosphereSky(ray,sun,vec3<f32>(0,1,0),origin.y);
 if(depth==0.0 && limit>1e9){
  let tangent=max(0.0,-(PLANET_RADIUS+origin.y)*ray.y);
  let height=max(0.0,planetAltitude(origin+ray*tangent));
  let halo=exp(-height/40000.0)*smoothstep(5000.0,60000.0,origin.y)*exp(-max(0.0,ray.y)*5.0);
  let color=sky*transmission+light+vec3<f32>(.06,.18,.42)*halo*atmosphereDaylight(sun.y)*.5;
  return vec4<f32>(pow(max(color,vec3<f32>(0.0))/(1.0+max(color,vec3<f32>(0.0))*.22),vec3<f32>(1.0/2.2)),1.0);
 }
 if(alpha<.001){return vec4<f32>(0.0);}
 let color=light/alpha;
 return vec4<f32>(pow(max(color,vec3<f32>(0.0))/(1.0+max(color,vec3<f32>(0.0))*.22),vec3<f32>(1.0/2.2))*alpha,alpha);
}

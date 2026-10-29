@group(0) @binding(2) var<storage,read> geometry:array<RiverVertex>;
@group(0) @binding(3) var<storage,read> motion:array<vec4<f32>>;
@group(0) @binding(4) var opaqueScene:texture_2d<f32>;
@group(0) @binding(5) var opaqueDepth:texture_depth_2d;
@group(0) @binding(6) var reflectedScene:texture_2d<f32>;
@group(0) @binding(7) var sceneSampler:sampler;
struct VertexOut {
 @builtin(position) position:vec4<f32>,
 @location(0) world:vec3<f32>,
 @location(1) normal:vec3<f32>,
 @location(2) material:vec4<f32>,
};
@vertex fn vertexMain(@builtin(vertex_index) index:u32)->VertexOut{
 let item=geometry[index];var out:VertexOut;out.position=riverFrame.viewProjection*item.position;
 out.world=item.position.xyz;out.normal=item.normal.xyz;out.material=item.material;return out;
}
fn riverMacroWave(across:f32,z:f32,distance:f32,speed:f32)->f32{
 let offset=.17*sin(across*.018+z*.006);let a=fract(distance/32.0+offset);let b=fract(a+.5);let weight=1.0-abs(a*2.0-1.0);
 let za=riverFlowCoordinate(z,a*32.0,speed);let zb=riverFlowCoordinate(z,b*32.0,speed)+37.0;
 let waveA=.10*sin(across*.045+za*.16)+.045*sin(across*.09-za*.24);
 let waveB=.10*sin((across+4.7)*.045+zb*.16)+.045*sin((across+4.7)*.09-zb*.24);
 return mix(waveB,waveA,weight);
}
@vertex fn waterVertex(@builtin(vertex_index) index:u32)->VertexOut{
 let item=geometry[index];let q=item.material.x;let z=item.position.z;let slope=riverCenterSlope(z);
 let speed=riverFlowSpeed(q,z)/sqrt(1.0+slope*slope);let across=q*riverHalfWidth();
 let edge=1.0-smoothstep(.70,.98,abs(q));let height=riverMacroWave(across,z,motion[0].x,speed)*edge*riverFrame.optics.y;
 let position=item.position+vec4<f32>(0.0,height,0.0,0.0);var out:VertexOut;
 out.position=riverFrame.viewProjection*position;out.world=position.xyz;out.normal=item.normal.xyz;out.material=item.material;return out;
}
struct SkyVertex {@builtin(position) position:vec4<f32>,@location(0) uv:vec2<f32>};
@vertex fn skyVertex(@builtin(vertex_index) index:u32)->SkyVertex{
 let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));return SkyVertex(vec4<f32>(p[index],0.0,1.0),p[index]);
}
fn skyColor(direction:vec3<f32>)->vec3<f32>{
 let up=clamp(direction.y,0.0,1.0);let horizon=vec3<f32>(.53,.63,.68);let high=vec3<f32>(.16,.29,.46);
 var sky=mix(horizon,high,pow(up,.65));let cloudPos=direction.xz/max(.12,direction.y)*1.4+vec2<f32>(21.4,7.9);
 let clouds=riverNoise(cloudPos)*.68+riverNoise(cloudPos*2.03+vec2<f32>(5.0,8.0))*.32;
 let cloudCover=smoothstep(.56,.73,clouds)*smoothstep(.04,.20,direction.y)*.50;
 sky=mix(sky,vec3<f32>(.80,.82,.81),cloudCover);
 let sun=max(dot(direction,normalize(riverFrame.sunSpeed.xyz)),0.0);sky+=vec3<f32>(1.0,.88,.70)*pow(sun,96.0)*.20;
 return mix(vec3<f32>(.16,.19,.16),sky,smoothstep(-.05,.06,direction.y));
}
fn displayColor(color:vec3<f32>)->vec3<f32>{let mapped=max(color,vec3<f32>(0.0))/(vec3<f32>(1.0)+max(color,vec3<f32>(0.0))*.25);return pow(mapped,vec3<f32>(1.0/2.2));}
fn sceneLinear(color:vec3<f32>)->vec3<f32>{let mapped=pow(max(color,vec3<f32>(0.0)),vec3<f32>(2.2));return mapped/max(vec3<f32>(.01),vec3<f32>(1.0)-mapped*.25);}
@fragment fn skyFragment(input:SkyVertex)->@location(0) vec4<f32>{
 let forward=normalize(-riverFrame.cameraDelta.xyz);let slope=reach.info.y;let inv=1.0/(1.0+slope*slope);
 let reflectedUp=vec3<f32>(0.0,(slope*slope-1.0)*inv,-2.0*slope*inv);
 let cameraUp=select(reflectedUp,vec3<f32>(0.0,1.0,0.0),riverFrame.cameraDelta.y>=0.0);
 let right=normalize(cross(forward,cameraUp));let up=normalize(cross(right,forward));
 let aspect=f32(riverFrame.config.z)/max(1.0,f32(riverFrame.config.w));
 let direction=normalize(forward+right*input.uv.x*aspect*.57735027+up*input.uv.y*.57735027);
 return vec4<f32>(displayColor(skyColor(direction)),1.0);
}
@fragment fn compositeFragment(input:SkyVertex)->@location(0) vec4<f32>{return textureLoad(opaqueScene,vec2<i32>(input.position.xy),0);}
fn bedColor(p:vec2<f32>,visibleDetail:f32)->vec3<f32>{
 let broad=riverFbm(p*.045+vec2<f32>(2.3,reach.info.w));let gravel=riverNoise(p*.31+vec2<f32>(17.0,8.0));
 let sand=vec3<f32>(.38,.34,.25);let stone=vec3<f32>(.20,.22,.20);
 var color=mix(stone,sand,smoothstep(.23,.76,mix(broad,gravel,.25)));
 // Small, irregular stones fade out when their projected size falls below a pixel.
 if(visibleDetail>.01){
  let cell=floor(p*.78);let local=fract(p*.78)-vec2<f32>(.24+.52*riverHash(cell+vec2<f32>(3.0,9.0)),.24+.52*riverHash(cell+vec2<f32>(12.0,4.0)));
  let size=.13+.18*riverHash(cell);let pebble=1.0-smoothstep(size-.035,size+.035,length(local*vec2<f32>(1.0,1.3)));
  let pebbleColor=mix(vec3<f32>(.18,.20,.19),vec3<f32>(.48,.46,.38),riverHash(cell+vec2<f32>(6.0,2.0)));
  color=mix(color,pebbleColor,pebble*visibleDetail*.64);
 }
 return color;
}
fn shadeGround(input:VertexOut)->vec4<f32>{
 let p=input.world.xz;let n=normalize(input.normal);let signedQ=(p.x-riverCenter(p.y))/riverHalfWidth();let q=abs(signedQ);
 let footprint=max(length(dpdx(p)),length(dpdy(p)));let detail=1.0-smoothstep(.55,2.0,footprint);
 let gravel=bedColor(p,detail);let wet=smoothstep(.90,1.03,q)*(1.0-smoothstep(1.06,1.28,q));
 let earth=mix(vec3<f32>(.18,.19,.13),vec3<f32>(.27,.27,.18),riverFbm(p*.012+vec2<f32>(19.0,2.0)));
 let vegetation=vec3<f32>(.16,.24,.13)*(0.75+.5*riverFbm(p*.018+vec2<f32>(8.0,21.0)));
 let inside=clamp(.5+.5*riverCurvature(p.y)*signedQ,0.0,1.0);
 let barEnd=mix(1.25,1.90,inside);let slope=1.0-clamp(n.y,0.0,1.0);
 var bank=mix(earth,vegetation,smoothstep(barEnd,barEnd+.55,q));bank=mix(bank,gravel,smoothstep(.18,.55,slope)*.30);
 var base=mix(gravel,bank,smoothstep(1.03,barEnd,q));base=mix(base,base*.70,wet*.55);
 let light=normalize(riverFrame.sunSpeed.xyz);let diffuse=.32+.78*max(dot(n,light),0.0);
 var color=base*diffuse;let dist=length(riverFrame.cameraDelta.xyz-input.world);let fog=1.0-exp(-dist*.00035);color=mix(color,vec3<f32>(.50,.58,.57),fog*.45);
 return vec4<f32>(displayColor(color),1.0);
}
@fragment fn groundFragment(input:VertexOut)->@location(0) vec4<f32>{return shadeGround(input);}
@fragment fn reflectionFragment(input:VertexOut)->@location(0) vec4<f32>{
 let color=shadeGround(input);if(input.world.y<riverLevel(input.world.z)+.03){discard;}return color;
}
// Two independently phased layers hide the reset of a locally advected pattern.
// The coordinates are in meters; a positive displacement travels downstream.
fn riverWaveSlopes(across:f32,along:f32,footprint:f32)->vec2<f32>{
 let medium=1.0-smoothstep(2.5,9.0,footprint);let fine=1.0-smoothstep(.5,2.5,footprint);
 let a=across*.11+along*.50;let b=across*.31-along*.85;let c=across*.52+along*1.35;
 return vec2<f32>(cos(a)*.11*.30+cos(b)*.31*.14*medium+cos(c)*.52*.05*fine,
                  cos(a)*.50*.30-cos(b)*.85*.14*medium+cos(c)*1.35*.05*fine);
}
fn riverAdvectedSlopes(across:f32,z:f32,distance:f32,speed:f32,footprint:f32)->vec2<f32>{
 let offset=.17*sin(across*.018+z*.006);let phaseA=fract(distance/32.0+offset);let phaseB=fract(phaseA+.5);let weightA=1.0-abs(phaseA*2.0-1.0);
 let alongA=riverFlowCoordinate(z,phaseA*32.0,speed);let alongB=riverFlowCoordinate(z,phaseB*32.0,speed)+37.0;
 return mix(riverWaveSlopes(across+4.7,alongB,footprint),riverWaveSlopes(across,alongA,footprint),weightA);
}
fn riverAdvectedStreak(across:f32,z:f32,distance:f32,speed:f32)->f32{
 let offset=.17*sin(across*.018+z*.006);let phaseA=fract(distance/32.0+offset);let phaseB=fract(phaseA+.5);let weightA=1.0-abs(phaseA*2.0-1.0);
 let alongA=riverFlowCoordinate(z,phaseA*32.0,speed);let alongB=riverFlowCoordinate(z,phaseB*32.0,speed)+37.0;
 let streakA=riverNoise(vec2<f32>(across*.17,alongA*.055)+vec2<f32>(11.0,3.0));
 let streakB=riverNoise(vec2<f32>((across+4.7)*.17,alongB*.055)+vec2<f32>(27.0,9.0));
 return mix(streakB,streakA,weightA);
}
// Approximate a cluster of sub-meter bubbles with irregular cellular edges.
// This is evaluated only for nearby, visible foam; subpixel bubbles fade out.
fn riverBubblePattern(p:vec2<f32>)->f32{
 let cell=floor(p);let local=fract(p);var first=10.0;var second=10.0;
 for(var y=-1;y<=1;y++){
  for(var x=-1;x<=1;x++){
   let offset=vec2<f32>(f32(x),f32(y));let id=cell+offset;
   let point=offset+vec2<f32>(riverHash(id+vec2<f32>(9.3,2.1)),riverHash(id+vec2<f32>(3.7,17.0)))*.8+vec2<f32>(.1);
   let delta=point-local;let d=dot(delta,delta);
   if(d<first){second=first;first=d;}else if(d<second){second=d;}
  }
 }
 let edge=smoothstep(.015,.16,sqrt(second)-sqrt(first));
 return mix(.54,1.0,edge);
}
fn riverAdvectedBubbles(across:f32,z:f32,distance:f32,speed:f32)->f32{
 let offset=.17*sin(across*.018+z*.006);let a=fract(distance/32.0+offset);let b=fract(a+.5);let weight=1.0-abs(a*2.0-1.0);
 let pa=vec2<f32>(across,riverFlowCoordinate(z,a*32.0,speed))*4.0;
 let pb=vec2<f32>(across+4.7,riverFlowCoordinate(z,b*32.0,speed)+37.0)*4.0;
 return mix(riverBubblePattern(pb),riverBubblePattern(pa),weight);
}
fn waterFresnel(cosine:f32)->f32{return .02037+(1.0-.02037)*pow(1.0-clamp(cosine,0.0,1.0),5.0);}
fn waterTransmittance(path:f32,clarity:f32)->vec3<f32>{return exp(-vec3<f32>(.18,.085,.052)*max(0.0,path)/max(.2,clarity));}
fn uvFromClip(clip:vec4<f32>)->vec2<f32>{let ndc=clip.xy/max(.00001,clip.w);return vec2<f32>(ndc.x*.5+.5,.5-ndc.y*.5);}
fn uvEdge(uv:vec2<f32>)->f32{return smoothstep(.0,.035,min(min(uv.x,uv.y),min(1.0-uv.x,1.0-uv.y)));}
fn viewDepth(depth:f32)->f32{return 5000.0/max(.001,10000.0-depth*9999.5);}
@fragment fn waterFragment(input:VertexOut)->@location(0) vec4<f32>{
 let p=input.world.xz;let center=riverCenter(p.y);let across=p.x-center;let q=across/riverHalfWidth();let bend=riverCurvature(p.y);
 let tangentSlope=riverCenterSlope(p.y);let speed=riverFlowSpeedAtBend(q,bend)/sqrt(1.0+tangentSlope*tangentSlope);
 let flow=normalize(vec3<f32>(tangentSlope,0.0,1.0));let side=normalize(vec3<f32>(1.0,0.0,-tangentSlope));
 let footprint=max(length(dpdx(p)),length(dpdy(p)));let detail=1.0-smoothstep(.55,2.0,footprint);
 let slopes=riverAdvectedSlopes(across,p.y,motion[0].x,speed,footprint)*riverFrame.optics.y;
 let n=normalize(vec3<f32>(0.0,1.0,reach.info.y)-side*slopes.x-flow*slopes.y);
 let view=normalize(riverFrame.cameraDelta.xyz-input.world);let light=normalize(riverFrame.sunSpeed.xyz);let ndv=clamp(dot(n,view),0.0,1.0);let ndl=max(dot(n,light),0.0);
 let depth=riverDepthAtBend(q,bend);let refracted=refract(-view,n,1.0/1.333);
 let path=min(60.0,depth/max(.15,-refracted.y));let projected=riverFrame.viewProjection*vec4<f32>(input.world+refracted*path,1.0);
 let baseUv=input.position.xy/vec2<f32>(textureDimensions(opaqueScene));let targetUv=uvFromClip(projected);
 let size=vec2<i32>(textureDimensions(opaqueDepth));let pixel=clamp(vec2<i32>(clamp(targetUv,vec2<f32>(0.0),vec2<f32>(1.0))*vec2<f32>(size)),vec2<i32>(0),size-vec2<i32>(1));
 let targetDepth=textureLoad(opaqueDepth,pixel,0);let depthGap=viewDepth(targetDepth)-viewDepth(input.position.z);
 let refractionMask=uvEdge(targetUv)*smoothstep(-1.5,.5,depthGap)*select(0.0,1.0,projected.w>0.0&&targetDepth<.999999);
 let refractUv=mix(baseUv,clamp(targetUv,vec2<f32>(0.0),vec2<f32>(1.0)),refractionMask);
 let bottom=sceneLinear(textureSampleLevel(opaqueScene,sceneSampler,refractUv,0.0).rgb);
 let transmittance=waterTransmittance(path,riverFrame.optics.x);
 let transmitted=bottom*transmittance+vec3<f32>(.035,.12,.10)*(vec3<f32>(1.0)-transmittance);
 let reflectionClip=riverFrame.reflectionViewProjection*vec4<f32>(input.world,1.0);
 let reflectionUv=uvFromClip(reflectionClip)+vec2<f32>(slopes.x,-slopes.y)*.018;
 let reflected=sceneLinear(textureSampleLevel(reflectedScene,sceneSampler,clamp(reflectionUv,vec2<f32>(0.0),vec2<f32>(1.0)),0.0).rgb);
 let reflectionMask=uvEdge(reflectionUv)*select(0.0,1.0,reflectionClip.w>0.0);
 var environment=reflected;if(reflectionMask<.99){environment=mix(skyColor(reflect(-view,n)),reflected,reflectionMask);}let fresnel=waterFresnel(ndv);
 let halfVector=normalize(view+light);let nh=max(dot(n,halfVector),0.0);let vh=max(dot(view,halfVector),0.0);
 let roughness=.12+.09*smoothstep(.4,5.0,footprint);let alpha=roughness*roughness;let alpha2=alpha*alpha;
 let denom=max(.00001,nh*nh*(alpha2-1.0)+1.0);let distribution=alpha2/(3.14159265*denom*denom);
 let k=(roughness+1.0)*(roughness+1.0)/8.0;let g=(ndv/(ndv*(1.0-k)+k))*(ndl/(ndl*(1.0-k)+k));
 let specular=min(1.5,distribution*g*waterFresnel(vh)/(4.0*max(.08,ndv)));
 var color=mix(transmitted,environment,fresnel)+vec3<f32>(1.0,.94,.80)*specular;
 let streak=riverAdvectedStreak(across,p.y,motion[0].x,speed);let riffle=1.0-smoothstep(.08,.65,abs(bend));
 let edge=smoothstep(.70,.97,abs(q));let shallows=1.0-smoothstep(.35,2.2,depth);
 let turbulence=(.08+.35*riffle+.24*edge*shallows)*smoothstep(.08,.8,riverFrame.sunSpeed.w);
 let patches=smoothstep(.58,.75,streak);var foam=clamp(patches*turbulence*riverFrame.optics.z,0.0,.65);
 let bubbles=1.0-smoothstep(.12,.55,footprint);
 if(foam>.005 && bubbles>.01){foam*=mix(1.0,riverAdvectedBubbles(across,p.y,motion[0].x,speed),bubbles);}
 let foamColor=vec3<f32>(.65,.69,.65)*(.58+.42*ndl);color=mix(color,foamColor,foam);
 if(riverFrame.optics.w>.5){
  let along=riverFlowCoordinate(p.y,motion[0].x,speed);
  let gx=abs(fract(across/34.0+.5)-.5);let gy=fract(along/72.0)-.5;
  let shaft=select(0.0,1.0,gx<.045 && gy>-.32 && gy<.10);
  let head=select(0.0,1.0,gy>=.04 && gy<.31 && gx<(0.31-gy)*.8);
  color=mix(color,vec3<f32>(.35,1.0,.74),max(shaft,head)*.90);
 }
 let dist=length(riverFrame.cameraDelta.xyz-input.world);let fog=1.0-exp(-dist*.00035);color=mix(color,vec3<f32>(.50,.58,.57),fog*.38);
 return vec4<f32>(displayColor(color),1.0);
}

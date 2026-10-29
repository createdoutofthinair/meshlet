@group(0) @binding(2) var<storage,read> geometry:array<RiverVertex>;
@group(0) @binding(3) var<storage,read> motion:array<vec4<f32>>;
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
struct SkyVertex {@builtin(position) position:vec4<f32>,@location(0) uv:vec2<f32>};
@vertex fn skyVertex(@builtin(vertex_index) index:u32)->SkyVertex{
 let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));return SkyVertex(vec4<f32>(p[index],0.0,1.0),p[index]);
}
fn skyColor(direction:vec3<f32>)->vec3<f32>{
 let up=clamp(direction.y*.5+.5,0.0,1.0);let horizon=vec3<f32>(.58,.68,.70);let high=vec3<f32>(.19,.34,.51);
 let sky=mix(horizon,high,smoothstep(.40,.95,up));return mix(vec3<f32>(.15,.19,.16),sky,smoothstep(-.08,.08,direction.y));
}
fn displayColor(color:vec3<f32>)->vec3<f32>{let mapped=max(color,vec3<f32>(0.0))/(vec3<f32>(1.0)+max(color,vec3<f32>(0.0))*.25);return pow(mapped,vec3<f32>(1.0/2.2));}
@fragment fn skyFragment(input:SkyVertex)->@location(0) vec4<f32>{
 let height=clamp(input.uv.y*.5+.5,0.0,1.0);let color=mix(vec3<f32>(.58,.67,.69),vec3<f32>(.20,.34,.48),pow(height,.7));return vec4<f32>(displayColor(color),1.0);
}
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
@fragment fn groundFragment(input:VertexOut)->@location(0) vec4<f32>{
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
@fragment fn waterFragment(input:VertexOut)->@location(0) vec4<f32>{
 let p=input.world.xz;let center=riverCenter(p.y);let across=p.x-center;let q=across/riverHalfWidth();let bend=riverCurvature(p.y);
 let tangentSlope=riverCenterSlope(p.y);let speed=riverFlowSpeedAtBend(q,bend)/sqrt(1.0+tangentSlope*tangentSlope);
 let flow=normalize(vec3<f32>(tangentSlope,0.0,1.0));let side=normalize(vec3<f32>(1.0,0.0,-tangentSlope));
 let footprint=max(length(dpdx(p)),length(dpdy(p)));let detail=1.0-smoothstep(.55,2.0,footprint);
 let slopes=riverAdvectedSlopes(across,p.y,motion[0].x,speed,footprint)*riverFrame.optics.y;
 let n=normalize(vec3<f32>(0.0,1.0,reach.info.y)-side*slopes.x-flow*slopes.y);
 let view=normalize(riverFrame.cameraDelta.xyz-input.world);let light=normalize(riverFrame.sunSpeed.xyz);let ndv=clamp(dot(n,view),0.0,1.0);let ndl=max(dot(n,light),0.0);
 let depth=riverDepthAtBend(q,bend);
 let displaced=p+n.xz*min(5.0,depth*1.2);let bed=bedColor(displaced,detail);
 let clarity=max(.2,riverFrame.optics.x);let transmittance=exp(-vec3<f32>(.24,.10,.055)*depth/clarity);
 let transmitted=bed*transmittance+vec3<f32>(.025,.17,.15)*(vec3<f32>(1.0)-transmittance);
 let fresnel=.02+.98*pow(1.0-ndv,5.0);let reflected=skyColor(reflect(-view,n));
 let halfVector=normalize(view+light);let nh=max(dot(n,halfVector),0.0);let alpha=.11;let alpha2=alpha*alpha;
 let denominator=max(.001,nh*nh*(alpha2-1.0)+1.0);let distribution=alpha2/(3.14159265*denominator*denominator);
 let specular=min(1.2,distribution*.02*ndl/(4.0*max(.10,ndv)));
 var color=mix(transmitted*(.42+.65*ndl),reflected,fresnel)+vec3<f32>(1.0,.94,.80)*specular;
 let streak=riverAdvectedStreak(across,p.y,motion[0].x,speed);let riffle=1.0-smoothstep(.08,.65,abs(bend));
 let edge=smoothstep(.78,.98,abs(q));let foam=smoothstep(.56,.76,streak)*(.12+.35*riffle+.12*edge)*riverFrame.optics.z;
 color*=.90+streak*.20;color=mix(color,vec3<f32>(.78,.82,.77),clamp(foam,0.0,.38));
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

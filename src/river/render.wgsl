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
 let small=riverNoise(p*.9+vec2<f32>(7.0,4.0));let sand=vec3<f32>(.33,.30,.23);let stone=vec3<f32>(.19,.21,.20);
 let value=mix(broad,mix(broad,gravel,.36),visibleDetail);var color=mix(stone,sand,smoothstep(.25,.75,value));
 color*=mix(1.0,.82+small*.36,visibleDetail*.6);return color;
}
@fragment fn groundFragment(input:VertexOut)->@location(0) vec4<f32>{
 let p=input.world.xz;let n=normalize(input.normal);let q=abs((p.x-riverCenter(p.y))/riverHalfWidth());
 let footprint=max(length(dpdx(p)),length(dpdy(p)));let detail=1.0-smoothstep(.7,4.0,footprint);
 let gravel=bedColor(p,detail);let wet=smoothstep(.82,1.10,q)*(1.0-smoothstep(1.12,1.42,q));
 let earth=mix(vec3<f32>(.18,.19,.13),vec3<f32>(.27,.27,.18),riverFbm(p*.012+vec2<f32>(19.0,2.0)));
 let vegetation=vec3<f32>(.16,.24,.13)*(0.75+.5*riverFbm(p*.018+vec2<f32>(8.0,21.0)));
 let slope=1.0-clamp(n.y,0.0,1.0);var bank=mix(earth,vegetation,smoothstep(1.35,2.4,q));
 bank=mix(bank,gravel,smoothstep(.10,.42,slope)*.65);var base=mix(gravel,bank,smoothstep(.90,1.55,q));base=mix(base,base*.67,wet*.55);
 let light=normalize(riverFrame.sunSpeed.xyz);let diffuse=.32+.78*max(dot(n,light),0.0);
 var color=base*diffuse;let dist=length(riverFrame.cameraDelta.xyz-input.world);let fog=1.0-exp(-dist*.00035);color=mix(color,vec3<f32>(.50,.58,.57),fog*.45);
 return vec4<f32>(displayColor(color),1.0);
}
@fragment fn waterFragment(input:VertexOut)->@location(0) vec4<f32>{
 let p=input.world.xz;let q=(p.x-riverCenter(p.y))/riverHalfWidth();let across=p.x-riverCenter(p.y);let along=p.y-motion[0].x;
 let tangentSlope=(riverCenter(p.y+1.0)-riverCenter(p.y-1.0))*.5;
 let flow=normalize(vec3<f32>(tangentSlope,0.0,1.0));let side=normalize(vec3<f32>(1.0,0.0,-tangentSlope));
 let a=across*.085+along*.16;let b=across*.16-along*.10;let c=across*.035+along*.043;
 let wave=riverFrame.optics.y;let crossSlope=(cos(a)*.085*.27+cos(b)*.16*.13+cos(c)*.035*.4)*wave;
 let flowSlope=(cos(a)*.16*.27-cos(b)*.10*.13+cos(c)*.043*.4)*wave;
 let n=normalize(vec3<f32>(0.0,1.0,reach.info.y)-side*crossSlope-flow*flowSlope);
 let view=normalize(riverFrame.cameraDelta.xyz-input.world);let light=normalize(riverFrame.sunSpeed.xyz);let ndv=clamp(dot(n,view),0.0,1.0);let ndl=max(dot(n,light),0.0);
 let depth=riverDepth(q);let footprint=max(length(dpdx(p)),length(dpdy(p)));let detail=1.0-smoothstep(.7,4.0,footprint);
 let displaced=p+n.xz*min(5.0,depth*1.2);let bed=bedColor(displaced,detail);
 let clarity=max(.2,riverFrame.optics.x);let transmittance=exp(-vec3<f32>(.24,.10,.055)*depth/clarity);
 let transmitted=bed*transmittance+vec3<f32>(.025,.17,.15)*(vec3<f32>(1.0)-transmittance);
 let fresnel=.02+.98*pow(1.0-ndv,5.0);let reflected=skyColor(reflect(-view,n));
 let halfVector=normalize(view+light);let nh=max(dot(n,halfVector),0.0);let alpha=.11;let alpha2=alpha*alpha;
 let denominator=max(.001,nh*nh*(alpha2-1.0)+1.0);let distribution=alpha2/(3.14159265*denominator*denominator);
 let specular=min(1.2,distribution*.02*ndl/(4.0*max(.10,ndv)));
 var color=mix(transmitted*(.42+.65*ndl),reflected,fresnel)+vec3<f32>(1.0,.94,.80)*specular;
 let noise=riverNoise(vec2<f32>(across*.075,along*.045)+vec2<f32>(11.0,3.0));
 let edge=smoothstep(.80,.98,abs(q));let foam=edge*smoothstep(.53,.78,noise)*riverFrame.optics.z*.35;
 color=mix(color,vec3<f32>(.72,.78,.73),clamp(foam,0.0,.6));
 if(riverFrame.optics.w>.5){
  let gx=abs(fract(across/34.0+.5)-.5);let gy=fract(along/72.0)-.5;
  let shaft=select(0.0,1.0,gx<.045 && gy>-.32 && gy<.10);
  let head=select(0.0,1.0,gy>=.04 && gy<.31 && gx<(0.31-gy)*.8);
  color=mix(color,vec3<f32>(.35,1.0,.74),max(shaft,head)*.90);
 }
 let dist=length(riverFrame.cameraDelta.xyz-input.world);let fog=1.0-exp(-dist*.00035);color=mix(color,vec3<f32>(.50,.58,.57),fog*.38);
 return vec4<f32>(displayColor(color),1.0);
}

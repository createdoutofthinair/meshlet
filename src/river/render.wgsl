@group(0) @binding(2) var<storage,read> geometry:array<RiverVertex>;
@group(0) @binding(3) var<storage,read> motion:array<vec4<f32>>;
@group(0) @binding(4) var opaqueScene:texture_2d<f32>;
@group(0) @binding(5) var opaqueDepth:texture_depth_2d;
@group(0) @binding(6) var reflectedScene:texture_2d<f32>;
@group(0) @binding(7) var sceneSampler:sampler;
@group(0) @binding(8) var<storage,read> rocks:array<RiverRock>;
@group(0) @binding(9) var<storage,read> fluid:array<vec4<f32>>;
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
// Value noise and its analytical x/y derivatives, for normals matching the displaced mesh.
fn riverNoiseGradient(p:vec2<f32>)->vec3<f32>{
 let i=floor(p);let f=fract(p);let s=f*f*(vec2<f32>(3.0)-2.0*f);let ds=6.0*f*(vec2<f32>(1.0)-f);
 let a=riverHash(i);let b=riverHash(i+vec2<f32>(1.0,0.0));let c=riverHash(i+vec2<f32>(0.0,1.0));let d=riverHash(i+vec2<f32>(1.0,1.0));
 return vec3<f32>(mix(mix(a,b,s.x),mix(c,d,s.x),s.y),mix(b-a,d-c,s.y)*ds.x,mix(c-a,d-b,s.x)*ds.y);
}
// A height and two derivatives, in local cross/along coordinates.
fn riverWaveLayer(across:f32,along:f32)->vec3<f32>{
 let noise=riverNoiseGradient(vec2<f32>(across*.045,along*.035)+vec2<f32>(5.3,8.7));let warp=(noise.x-.5)*2.2;
 let warpX=noise.y*.045*2.2;let warpZ=noise.z*.035*2.2;
 let a=across*.14+along*.30+warp;let b=across*.27-along*.49+warp*.7;let c=across*.36+along*.76-warp*.5;
 return vec3<f32>(.32*sin(a)+.15*sin(b)+.07*sin(c),
  .32*(.14+warpX)*cos(a)+.15*(.27+warpX*.7)*cos(b)+.07*(.36-warpX*.5)*cos(c),
  .32*(.30+warpZ)*cos(a)+.15*(-.49+warpZ*.7)*cos(b)+.07*(.76-warpZ*.5)*cos(c));
}
fn riverSurfaceWaves(across:f32,z:f32,distance:f32,speed:f32)->vec3<f32>{
 let offset=.17*sin(across*.018+z*.006);let a=fract(distance/32.0+offset);let b=fract(a+.5);let weight=1.0-abs(a*2.0-1.0);
 let za=riverFlowCoordinate(z,a*32.0,speed);let zb=riverFlowCoordinate(z,b*32.0,speed)+37.0;
 let wa=riverWaveLayer(across,za);let wb=riverWaveLayer(across+4.7,zb);
 let offsetGrad=.17*cos(across*.018+z*.006)*vec2<f32>(.018,.006);let weightGrad=select(2.0,-2.0,a>.5)*offsetGrad;
 let alongGrad=vec2<f32>(-32.0*speed*offsetGrad.x,1.0-32.0*speed*offsetGrad.y);
 let gradA=vec2<f32>(wa.y+wa.z*alongGrad.x,wa.z*alongGrad.y);let gradB=vec2<f32>(wb.y+wb.z*alongGrad.x,wb.z*alongGrad.y);
 return vec3<f32>(mix(wb.x,wa.x,weight),mix(gradB,gradA,weight)+(wa.x-wb.x)*weightGrad);
}
fn riverSmoothDerivative(a:f32,b:f32,value:f32)->f32{let t=clamp((value-a)/(b-a),0.0,1.0);return 6.0*t*(1.0-t)/(b-a);}
// Standing bow waves and downstream wakes share the same GPU-generated rocks.
// Only the current and adjacent reach sections can influence this position.
fn riverRockWaves(p:vec2<f32>,distance:f32)->vec4<f32>{
 let section=i32(floor((p.y+REACH_LENGTH*.5)/(REACH_LENGTH/f32(RIVER_ROCKS))));var result=vec4<f32>(0.0);
 for(var offset=-1;offset<=1;offset++){
  let i=section+offset;if(i<0 || i>=i32(RIVER_ROCKS)){continue;}let rock=rocks[u32(i)];
  let sx=max(.1,rock.position.w*rock.shape.z);let sz=max(.1,rock.position.w*rock.shape.w);
  let x=(p.x-rock.position.x)/sx;let z=(p.y-rock.position.z)/sz;
  if(abs(x)<2.8 && z> -3.0 && z<7.0){
   let bow=exp(-x*x*1.15-(z+1.0)*(z+1.0)*.75);
   let bowHeight=.52*bow;let rise=smoothstep(-.1,.65,z);let fall=1.0-smoothstep(4.0,7.0,z);
   let fade=rise*fall;let fadeSlope=riverSmoothDerivative(-.1,.65,z)*fall-rise*riverSmoothDerivative(4.0,7.0,z);
   let lateral=exp(-x*x*.32);let wake=fade*lateral;let phase=z*2.4+abs(x)*1.2-distance*.8;
   let wakeHeight=.30*wake*sin(phase);let wakeSlope=.30*wake*cos(phase);
   result+=vec4<f32>(bowHeight+wakeHeight,(-2.3*x*bowHeight+1.2*sign(x)*wakeSlope-.64*x*wakeHeight)/sx,
    (-1.5*(z+1.0)*bowHeight+2.4*wakeSlope+.30*fadeSlope*lateral*sin(phase))/sz,max(.70*bow,.58*wake));
  }
 }
 return result;
}
// Sample the simulated height field on the same local coordinates as the river.
fn fluidHeight(q:f32,z:f32)->f32{
 let uv=clamp(vec2<f32>((q*.5+.5)*63.0,(z/REACH_LENGTH+.5)*127.0),vec2<f32>(0.0),vec2<f32>(63.0,127.0));
 let base=vec2<u32>(floor(uv));let next=min(base+vec2<u32>(1u),vec2<u32>(63u,127u));let f=fract(uv);
 let a=mix(fluid[base.y*64u+base.x].x,fluid[base.y*64u+next.x].x,f.x);
 let b=mix(fluid[next.y*64u+base.x].x,fluid[next.y*64u+next.x].x,f.x);return mix(a,b,f.y);
}
@vertex fn waterVertex(@builtin(vertex_index) index:u32)->VertexOut{
 let item=geometry[index];let q=item.material.x;let z=item.position.z;let slope=riverCenterSlope(z);
 let speed=riverFlowSpeed(q,z)/sqrt(1.0+slope*slope);let across=q*riverHalfWidth();
 let edge=1.0-smoothstep(.67,.98,abs(q));let activity=.62+.38*riverRiffle(z);
 let waves=riverSurfaceWaves(across,z,motion[0].x,speed)*activity;let obstacle=riverRockWaves(item.position.xz,motion[0].x);
 let scale=edge*riverFrame.optics.y;let sim=fluidHeight(q,z);let height=(waves.x+obstacle.x)*scale+sim;
 let flow=normalize(vec3<f32>(slope,0.0,1.0));let side=normalize(vec3<f32>(1.0,0.0,-slope));
 let simX=(fluidHeight(q+.01,z)-fluidHeight(q-.01,z))/max(.01,.02*riverHalfWidth());let simZ=(fluidHeight(q,z+1.0)-fluidHeight(q,z-1.0))*.5;
 let normal=normalize(vec3<f32>(0.0,1.0,riverLevelSlope(z))-side*((waves.y+obstacle.y)*scale+simX)-flow*((waves.z+obstacle.z)*scale+simZ));
 let position=item.position+vec4<f32>(0.0,height,0.0,0.0);var out:VertexOut;
 out.position=riverFrame.viewProjection*position;out.world=position.xyz;out.normal=normal;out.material=vec4<f32>(item.material.xy,obstacle.w*edge,0.0);return out;
}
fn waterfallPosition(q:f32,t:f32,time:f32)->vec3<f32>{
 let y0=riverLevel(-8.0);let y1=riverLevel(10.0);let middle=sin(t*3.14159265);
 let across=q*riverHalfWidth();let fingers=sin(across*.12+time*.65)+.45*sin(across*.27-time*.38+t*5.0);
 let along=mix(-8.0,10.0,t)+middle*(2.2+1.2*fingers)+t*(1.0-t)*sin(across*.42+t*7.0-time*1.1)*1.1;
 let x=riverCenter(along)+across;
 // Join the upper and lower surfaces at their animated heights. A smooth
 // profile rolls over the lip rather than meeting at a hard angular corner.
 let upperSpeed=riverFlowSpeed(q,-8.0)/sqrt(1.0+pow(riverCenterSlope(-8.0),2.0));
 let lowerSpeed=riverFlowSpeed(q,10.0)/sqrt(1.0+pow(riverCenterSlope(10.0),2.0));
 let edge=1.0-smoothstep(.67,.98,abs(q));
 let upper=riverSurfaceWaves(across,-8.0,motion[0].x,upperSpeed).x*(.62+.38*riverRiffle(-8.0));
 let lower=riverSurfaceWaves(across,10.0,motion[0].x,lowerSpeed).x*(.62+.38*riverRiffle(10.0));
 let wave=mix(upper,lower,t)*edge*riverFrame.optics.y;
 let y=mix(y0,y1,smoothstep(0.0,1.0,t))+wave;
 return vec3<f32>(x,y,along);
}
// A separately tessellated falling sheet joins the upper and lower water meshes.
fn waterfallVertex(vertex:u32,layer:f32)->VertexOut{
 let columns=80u;let rows=48u;let cell=vertex/6u;let corner=vertex%6u;
 let corners=array<vec2<u32>,6>(vec2<u32>(0u,0u),vec2<u32>(0u,1u),vec2<u32>(1u,0u),vec2<u32>(1u,0u),vec2<u32>(0u,1u),vec2<u32>(1u,1u));
 let grid=vec2<u32>(cell%columns,cell/columns)+corners[corner];let q=(f32(grid.x)/f32(columns)*2.0-1.0)*.99;let t=f32(grid.y)/f32(rows);
 var position=waterfallPosition(q,t,motion[0].y);
 position.z+=layer*sin(t*3.14159265)*(1.8+1.2*riverNoise(vec2<f32>(q*8.0,t*4.0-motion[0].y*.7)));
 let tangentQ=waterfallPosition(q+.002,t,motion[0].y)-waterfallPosition(q-.002,t,motion[0].y);
 let tangentT=waterfallPosition(q,min(1.0,t+.002),motion[0].y)-waterfallPosition(q,max(0.0,t-.002),motion[0].y);
 let normal=normalize(cross(tangentQ,tangentT));
 var out:VertexOut;out.position=riverFrame.viewProjection*vec4<f32>(position,1.0);out.world=position;out.normal=normal;out.material=vec4<f32>(q,t,0.0,0.0);return out;
}
@vertex fn fallVertex(@builtin(vertex_index) vertex:u32)->VertexOut{return waterfallVertex(vertex,0.0);}
@vertex fn fallVeilVertex(@builtin(vertex_index) vertex:u32)->VertexOut{return waterfallVertex(vertex,1.0);}
struct SprayState {position:vec3<f32>,radius:f32,opacity:f32};
// Ballistic secondary droplets: stable, stateless trajectories evaluated on the GPU.
fn waterfallSpray(id:u32,time:f32)->SprayState{
 let key=f32(id)+f32(riverFrame.config.x%4093u)*.03;
 let a=riverHash(vec2<f32>(key,1.7));let b=riverHash(vec2<f32>(key+9.3,7.4));let c=riverHash(vec2<f32>(key+27.1,18.0));
 let d=riverHash(vec2<f32>(key+13.0,27.3));let mist=(id%5u)==0u;
 let velocity=4.0+8.0*b;let lifetime=2.0*velocity/9.81;let age=fract(time/lifetime+a)*lifetime;
 let z0=12.0+9.0*c;let x0=riverCenter(z0)+(a-.5)*riverHalfWidth()*1.55;
 let position=vec3<f32>(x0+(b-.5)*4.0*age,riverLevel(z0)+.15+velocity*age-4.905*age*age,z0+(c-.25)*5.0*age);
 let fade=smoothstep(0.0,.12,age)*(1.0-smoothstep(lifetime-.25,lifetime,age));
 return SprayState(position,select(.18+.45*d,1.4+2.0*d,mist),fade*select(.45,.10,mist)*riverFrame.waterfall.z);
}
struct SprayOut {@builtin(position) position:vec4<f32>,@location(0) uv:vec2<f32>,@location(1) opacity:f32};
@vertex fn sprayVertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->SprayOut{
 let uv=array<vec2<f32>,6>(vec2<f32>(-1.0,-1.0),vec2<f32>(1.0,-1.0),vec2<f32>(-1.0,1.0),vec2<f32>(-1.0,1.0),vec2<f32>(1.0,-1.0),vec2<f32>(1.0,1.0))[vertex];
 let particle=waterfallSpray(instance,motion[0].y);let view=normalize(riverFrame.cameraDelta.xyz-particle.position);
 var right=cross(vec3<f32>(0.0,1.0,0.0),view);if(length(right)<.0001){right=vec3<f32>(1.0,0.0,0.0);}right=normalize(right);let up=normalize(cross(view,right));
 let world=particle.position+(right*uv.x+up*uv.y)*particle.radius;
 return SprayOut(riverFrame.viewProjection*vec4<f32>(world,1.0),uv,particle.opacity);
}
@fragment fn sprayFragment(input:SprayOut)->@location(0) vec4<f32>{
 let radius=length(input.uv);let alpha=(1.0-smoothstep(.25,1.0,radius))*input.opacity;
 return vec4<f32>(.79,.85,.84,alpha);
}
@vertex fn rockVertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->VertexOut{
 let rock=rocks[instance];let sectors=24u;let rings=16u;let cell=vertex/6u;let corner=vertex%6u;
 let corners=array<vec2<u32>,6>(vec2<u32>(0u,0u),vec2<u32>(1u,0u),vec2<u32>(0u,1u),vec2<u32>(0u,1u),vec2<u32>(1u,0u),vec2<u32>(1u,1u));
 let grid=vec2<u32>(cell%sectors,cell/sectors)+corners[corner];let theta=f32(grid.x)/f32(sectors)*6.2831853;let phi=f32(grid.y)/f32(rings)*3.14159265;
 let unit=vec3<f32>(sin(phi)*cos(theta),cos(phi),sin(phi)*sin(theta));
 let rockNoise=riverNoise(unit.xz*3.3+vec2<f32>(unit.y*1.7+f32(instance)*2.1,unit.y*2.3+reach.info.w));
 let strata=riverNoise(vec2<f32>(unit.y*5.0+f32(instance),unit.x*2.1+unit.z));let rough=.74+.33*rockNoise+.16*strata;let bottom=rock.position.y-rock.shape.x-.4;let top=rock.position.y+rock.shape.y;
 let axes=vec3<f32>(rock.position.w*rock.shape.z,(top-bottom)*.5,rock.position.w*rock.shape.w);
 let center=vec3<f32>(rock.position.x,(top+bottom)*.5,rock.position.z);let position=center+unit*axes*rough;
 var out:VertexOut;out.position=riverFrame.viewProjection*vec4<f32>(position,1.0);out.world=position;
 out.normal=normalize(unit/max(axes,vec3<f32>(.01)));out.material=vec4<f32>(f32(instance),0.0,0.0,0.0);return out;
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
 let cliff=riverFrame.waterfall.x*(1.0-smoothstep(30.0,100.0,abs(p.y)))*smoothstep(.16,.60,slope);
 let rockBand=riverNoise(vec2<f32>(p.x*.045+input.world.y*.018,input.world.y*.13+riverNoise(p*.035)*2.0));
 base=mix(base,mix(vec3<f32>(.15,.17,.16),vec3<f32>(.32,.31,.27),rockBand),cliff*.82);
 let light=normalize(riverFrame.sunSpeed.xyz);let diffuse=.32+.78*max(dot(n,light),0.0);
 var color=base*diffuse;let dist=length(riverFrame.cameraDelta.xyz-input.world);let fog=1.0-exp(-dist*.00035);color=mix(color,vec3<f32>(.50,.58,.57),fog*.45);
 return vec4<f32>(displayColor(color),1.0);
}
@fragment fn groundFragment(input:VertexOut)->@location(0) vec4<f32>{return shadeGround(input);}
@fragment fn reflectionFragment(input:VertexOut)->@location(0) vec4<f32>{
 let color=shadeGround(input);if(input.world.y<riverLevel(input.world.z)+.03){discard;}return color;
}
// Rough dielectric Cook-Torrance response for stone and wet surfaces.
fn stoneLighting(base:vec3<f32>,normal:vec3<f32>,view:vec3<f32>,roughness:f32)->vec3<f32>{
 let light=normalize(riverFrame.sunSpeed.xyz);let halfVector=normalize(view+light);
 let nl=max(dot(normal,light),0.0);let nv=max(dot(normal,view),.02);let nh=max(dot(normal,halfVector),0.0);let vh=max(dot(view,halfVector),0.0);
 let a=roughness*roughness;let a2=a*a;let d=nh*nh*(a2-1.0)+1.0;
 let distribution=a2/max(.0001,3.14159265*d*d);let k=(roughness+1.0)*(roughness+1.0)*.125;
 let geometry=(nv/(nv*(1.0-k)+k))*(nl/(nl*(1.0-k)+k));let fresnel=.04+.96*pow(1.0-vh,5.0);
 let spec=distribution*geometry*fresnel/max(.08,4.0*nv*nl);
 let ambient=mix(vec3<f32>(.11,.12,.10),vec3<f32>(.28,.34,.37),clamp(normal.y*.5+.5,0.0,1.0));
 return base*(ambient+vec3<f32>(1.0,.91,.76)*nl*.82)+vec3<f32>(1.0,.91,.77)*min(spec,2.0)*nl;
}
fn shadeRock(input:VertexOut)->vec4<f32>{
 let p=input.world;let geometric=normalize(cross(dpdx(p),dpdy(p)));let baseNormal=normalize(input.normal);
 let surfaceNormal=normalize(mix(baseNormal,select(-geometric,geometric,dot(geometric,baseNormal)>0.0),.65));
 let footprint=max(length(dpdx(p)),length(dpdy(p)));let detail=1.0-smoothstep(.15,1.4,footprint);
 let broad=riverFbm(p.xz*.20+vec2<f32>(p.y*.12,input.material.x));let layers=riverNoise(vec2<f32>(p.y*.8+broad*1.8,p.x*.14+p.z*.11));
 let speckle=riverNoise(p.xz*1.1+vec2<f32>(p.y*.71,input.material.x));
 var stone=mix(vec3<f32>(.105,.125,.12),vec3<f32>(.34,.32,.28),clamp(broad*.68+layers*.32,0.0,1.0));
 // Fine relief is evaluated in world space and filtered by pixel footprint.
 // Screen-space derivatives turn the procedural height into a surface normal.
 let relief=detail*(riverNoise(p.xz*1.4+vec2<f32>(p.y*.9,input.material.x))*.11+
                    riverNoise(p.xy*2.7+vec2<f32>(input.material.x,p.z*.5))*.035);
 let px=dpdx(p);let py=dpdy(p);let tangentX=cross(py,surfaceNormal);let tangentY=cross(surfaceNormal,px);
 let determinant=dot(px,tangentX);let reliefDx=dpdx(relief);let reliefDy=dpdy(relief);var n=surfaceNormal;
 if(abs(determinant)>.00001){let gradient=(tangentX*reliefDx+tangentY*reliefDy)/determinant;n=normalize(surfaceNormal-gradient);}
 stone*=mix(1.0,.75+.5*speckle,detail);
 let height=p.y-riverLevel(p.z);let baseWet=1.0-smoothstep(.08,1.3,height);
 // Flow-driven wash on upstream-facing surfaces: the small rivulets descend
 // in world height while remaining attached laterally to the rock.
 let facing=smoothstep(-.15,.65,-surfaceNormal.z);let flowAmount=smoothstep(.05,.8,riverFrame.sunSpeed.w);
 let rivuletCoord=vec2<f32>(p.x*.48+p.z*.31+input.material.x*1.7,p.y*.6+motion[0].y*.55);
 let rivulet=riverNoise(rivuletCoord);let streak=smoothstep(.56,.72,rivulet)*smoothstep(.05,.25,height)*(1.0-smoothstep(1.5,3.2,height));
 let wet=clamp(baseWet+streak*facing*flowAmount*.65,0.0,1.0);
 stone*=mix(1.0,.65,wet);let view=normalize(riverFrame.cameraDelta.xyz-p);
 var color=stoneLighting(stone,n,view,mix(.83,.25,wet));
 let wetReflection=skyColor(reflect(-view,n));let wetFresnel=.04+.96*pow(1.0-max(dot(n,view),0.0),5.0);
 color+=wetReflection*wet*(.035+.18*wetFresnel);
 let dist=length(riverFrame.cameraDelta.xyz-p);color=mix(color,vec3<f32>(.50,.58,.57),(1.0-exp(-dist*.00035))*.45);
 return vec4<f32>(displayColor(color),1.0);
}
@fragment fn rockFragment(input:VertexOut)->@location(0) vec4<f32>{return shadeRock(input);}
@fragment fn rockReflectionFragment(input:VertexOut)->@location(0) vec4<f32>{
 let color=shadeRock(input);if(input.world.y<riverLevel(input.world.z)+.03){discard;}return color;
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
 let uvA=vec2<f32>(across*.34,alongA*.25)+vec2<f32>(11.0,3.0);let uvB=vec2<f32>((across+4.7)*.34,alongB*.25)+vec2<f32>(27.0,9.0);
 let streakA=.68*riverNoise(uvA)+.32*riverNoise(uvA*2.13+vec2<f32>(9.0,13.0));
 let streakB=.68*riverNoise(uvB)+.32*riverNoise(uvB*2.13+vec2<f32>(9.0,13.0));
 return mix(streakB,streakA,weightA);
}
// Approximate a cluster of sub-meter bubbles with irregular cellular edges.
// This is evaluated only for nearby, visible foam; subpixel bubbles fade out.
fn riverBubblePattern(p:vec2<f32>,time:f32)->f32{
 let cell=floor(p);let local=fract(p);var first=10.0;var second=10.0;
 for(var y=-1;y<=1;y++){
  for(var x=-1;x<=1;x++){
   let offset=vec2<f32>(f32(x),f32(y));let id=cell+offset;
   let phase=vec2<f32>(riverHash(id+vec2<f32>(9.3,2.1)),riverHash(id+vec2<f32>(3.7,17.0)))*6.2831853;
   let point=offset+vec2<f32>(.5)+.32*sin(phase+time*vec2<f32>(.61,.83));
   let delta=point-local;let d=dot(delta,delta);
   if(d<first){second=first;first=d;}else if(d<second){second=d;}
  }
 }
 let edge=smoothstep(.015,.16,sqrt(second)-sqrt(first));
 return mix(.88,1.0,edge);
}
@fragment fn fallFragment(input:VertexOut)->@location(0) vec4<f32>{
 let q=input.material.x;let across=q*riverHalfWidth();let travel=input.world.y*.12+motion[0].y*1.8;
 let warp=riverNoise(vec2<f32>(across*.055,travel*.38)+vec2<f32>(3.4,7.2));
 let coarse=riverFbm(vec2<f32>(across*.10+warp*1.5,travel*.52));
 let fine=riverNoise(vec2<f32>(across*.34+warp*2.0,travel*1.10));
 let volume=clamp(coarse*.72+fine*.28,0.0,1.0);let view=normalize(riverFrame.cameraDelta.xyz-input.world);
 let n=normalize(input.normal);let grazing=waterFresnel(abs(dot(view,n)));let light=.50+.50*max(dot(n,normalize(riverFrame.sunSpeed.xyz)),0.0);
 var color=mix(vec3<f32>(.14,.27,.27),vec3<f32>(.76,.81,.79),smoothstep(.27,.76,volume))*light;
 color=mix(color,vec3<f32>(.74,.81,.80),grazing*.35);
 let footprint=max(length(dpdx(input.world)),length(dpdy(input.world)));let bubbles=1.0-smoothstep(.25,1.8,footprint);
 if(bubbles>.01){let cells=1.0-riverBubblePattern(vec2<f32>(across*.9,travel*3.5),motion[0].y);color+=vec3<f32>(.025)*cells*bubbles*riverFrame.optics.z;}
 return vec4<f32>(displayColor(color),1.0);
}
// A translucent, displaced veil breaks up the silhouette around the main fall.
@fragment fn fallVeilFragment(input:VertexOut)->@location(0) vec4<f32>{
 let q=input.material.x;let t=input.material.y;let time=motion[0].y;let across=q*riverHalfWidth();
 let flow=vec2<f32>(across*.14,input.world.y*.13+time*1.6);
 let streak=riverFbm(flow+vec2<f32>(riverNoise(flow*.45)*1.5,0.0));
 let edge=smoothstep(.0,.16,t)*(1.0-smoothstep(.88,1.0,t));
 let alpha=edge*smoothstep(.46,.72,streak)*.28;
 return vec4<f32>(.77,.83,.81,alpha);
}
// Procedural density in a genuinely three-dimensional waterfall volume.
// This models aerated falling water; it is not a fluid solver.
fn waterfallDensity(p:vec3<f32>,time:f32)->f32{
 let nominalTop=riverLevel(-8.0);let nominalBottom=riverLevel(10.0);
 let initial=clamp((nominalTop-p.y)/max(1.0,nominalTop-nominalBottom),0.0,1.0);
 let center=riverCenter(mix(-8.0,10.0,initial));let across=p.x-center;let q=across/riverHalfWidth();
 let top=nominalTop+fluidHeight(q,-8.0);let bottom=nominalBottom+fluidHeight(q,10.0);let height=max(1.0,top-bottom);
 let t=(top-p.y)/height;let v=clamp(t,0.0,1.0);
 let curtain=mix(-8.0,10.0,v)+sin(v*3.14159265)*(2.0+1.2*sin(across*.12+time*.65));
 let thickness=1.1+2.8*sin(v*3.14159265)+v*1.7;
 let strand=riverFbm(vec2<f32>(across*.085,p.y*.08+time*1.3));
 let depthNoise=riverNoise(vec2<f32>(p.z*.28+across*.035,p.y*.15+time*1.7));
 let profile=1.0-smoothstep(thickness*.25,thickness*1.7,abs(p.z-curtain));
 let banks=1.0-smoothstep(.89,1.02,abs(q));
 let vertical=smoothstep(-.06,.035,t)*(1.0-smoothstep(.94,1.08,t));
 return profile*banks*vertical*clamp(.2+strand*.9+depthNoise*.3,0.0,1.2);
}
fn safeRayDirection(d:vec3<f32>)->vec3<f32>{
 return select(select(vec3<f32>(-.00001),vec3<f32>(.00001),d>=vec3<f32>(0.0)),d,abs(d)>vec3<f32>(.00001));
}
@fragment fn waterfallVolumeFragment(input:SkyVertex)->@location(0) vec4<f32>{
 let eye=riverFrame.cameraDelta.xyz;let forward=normalize(-eye);let right=normalize(cross(forward,vec3<f32>(0.0,1.0,0.0)));let up=normalize(cross(right,forward));
 let aspect=f32(riverFrame.config.z)/max(1.0,f32(riverFrame.config.w));
 let ray=normalize(forward+right*input.uv.x*aspect*.57735027+up*input.uv.y*.57735027);
 let width=riverHalfWidth()+120.0;let lower=riverLevel(10.0)-5.0;let upper=riverLevel(-8.0)+5.0;
 let lo=vec3<f32>(-width,lower,-15.0);let hi=vec3<f32>(width,upper,30.0);
 let inv=1.0/safeRayDirection(ray);let aa=(lo-eye)*inv;let bb=(hi-eye)*inv;
 let near3=min(aa,bb);let far3=max(aa,bb);let start=max(0.0,max(near3.x,max(near3.y,near3.z)));
 let end=min(far3.x,min(far3.y,far3.z));
 let pixel=clamp(vec2<i32>(input.position.xy),vec2<i32>(0),vec2<i32>(textureDimensions(opaqueDepth))-vec2<i32>(1));
 let depth=textureLoad(opaqueDepth,pixel,0);let sceneDistance=select(10000.0,viewDepth(depth)/max(.01,dot(ray,forward)),depth<.999999);
 let stop=min(end,sceneDistance);if(stop<=start){return vec4<f32>(0.0);}
 let stepSize=(stop-start)/48.0;var transmittance=1.0;var scattering=vec3<f32>(0.0);
 let sun=normalize(riverFrame.sunSpeed.xyz);let phase=.55+.45*pow(max(dot(ray,sun),0.0),4.0);
 for(var i=0u;i<48u;i++){
  let p=eye+ray*(start+(f32(i)+.5)*stepSize);let density=waterfallDensity(p,motion[0].y);
  let absorb=1.0-exp(-density*stepSize*.34);let variation=riverNoise(vec2<f32>(p.x*.12+p.z*.11,p.y*.14+motion[0].y));
  let light=mix(vec3<f32>(.18,.30,.29),vec3<f32>(.68,.77,.75),variation)*phase;
  scattering+=transmittance*absorb*light;transmittance*=1.0-absorb;
 }
 let alpha=1.0-transmittance;if(alpha<.001){return vec4<f32>(0.0);}
 return vec4<f32>(displayColor(scattering/alpha)*alpha,alpha);
}
fn riverAdvectedBubbles(across:f32,z:f32,distance:f32,speed:f32)->f32{
 let offset=.17*sin(across*.018+z*.006);let a=fract(distance/32.0+offset);let b=fract(a+.5);let weight=1.0-abs(a*2.0-1.0);
 let pa=vec2<f32>(across,riverFlowCoordinate(z,a*32.0,speed))*4.0;
 let pb=vec2<f32>(across+4.7,riverFlowCoordinate(z,b*32.0,speed)+37.0)*4.0;
 return mix(riverBubblePattern(pb,motion[0].y),riverBubblePattern(pa,motion[0].y),weight);
}
// Exact unpolarized dielectric Fresnel, shared with the optical water study.
fn waterFresnel(cosine:f32)->f32{
 let c=clamp(cosine,0.0,1.0);let eta=1.333;let g=sqrt(max(0.0,eta*eta-1.0+c*c));
 let a=(g-c)/(g+c);let b=(c*(g+c)-1.0)/(c*(g-c)+1.0);
 return clamp(.5*a*a*(1.0+b*b),0.0,1.0);
}
// Fine optical ripples follow the downstream current and are filtered when
// smaller than a pixel. Their phase is continuous, including when paused.
fn riverOpticalRipples(across:f32,along:f32,footprint:f32)->vec2<f32>{
 let mid=1.0-smoothstep(1.0,5.0,footprint);let fine=1.0-smoothstep(.3,1.4,footprint);
 let a=across*.57+along*1.30;let b=across*1.3-along*.80;let c=across*2.6+along*2.05;
 return mid*vec2<f32>(.0684*cos(a)+.0715*cos(b),.156*cos(a)-.044*cos(b))+
        fine*vec2<f32>(.0468*cos(c),.0369*cos(c));
}
fn waterTransmittance(path:f32,clarity:f32)->vec3<f32>{return exp(-vec3<f32>(.18,.085,.052)*max(0.0,path)/max(.2,clarity));}
fn uvFromClip(clip:vec4<f32>)->vec2<f32>{let ndc=clip.xy/max(.00001,clip.w);return vec2<f32>(ndc.x*.5+.5,.5-ndc.y*.5);}
fn uvEdge(uv:vec2<f32>)->f32{return smoothstep(.0,.035,min(min(uv.x,uv.y),min(1.0-uv.x,1.0-uv.y)));}
fn viewDepth(depth:f32)->f32{return 5000.0/max(.001,10000.0-depth*9999.5);}
@fragment fn waterFragment(input:VertexOut)->@location(0) vec4<f32>{
 let p=input.world.xz;let center=riverCenter(p.y);let across=p.x-center;let q=across/riverHalfWidth();let bend=riverCurvature(p.y);
 let tangentSlope=riverCenterSlope(p.y);let speed=riverFlowSpeedAtBend(q,bend)/sqrt(1.0+tangentSlope*tangentSlope);
 let flow=normalize(vec3<f32>(tangentSlope,0.0,1.0));let side=normalize(vec3<f32>(1.0,0.0,-tangentSlope));
 let footprint=max(length(dpdx(p)),length(dpdy(p)));let detail=1.0-smoothstep(.55,2.0,footprint);
 // The vertex normal describes the actual displaced mesh; fine ripples are a smaller layer.
 let movingAlong=riverFlowCoordinate(p.y,motion[0].x,speed);
 let slopes=(riverAdvectedSlopes(across,p.y,motion[0].x,speed,footprint)*.55+
             riverOpticalRipples(across,movingAlong,footprint)*.55)*riverFrame.optics.y;
 let n=normalize(normalize(input.normal)-side*slopes.x-flow*slopes.y);
 let view=normalize(riverFrame.cameraDelta.xyz-input.world);let light=normalize(riverFrame.sunSpeed.xyz);let ndv=clamp(dot(n,view),0.0,1.0);let ndl=max(dot(n,light),0.0);
 let depth=riverDepth(q,p.y);let refracted=refract(-view,n,1.0/1.333);
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
 let reflectionUv=uvFromClip(reflectionClip)+vec2<f32>(n.x,-n.z)*.022;
 let reflected=sceneLinear(textureSampleLevel(reflectedScene,sceneSampler,clamp(reflectionUv,vec2<f32>(0.0),vec2<f32>(1.0)),0.0).rgb);
 let reflectionMask=uvEdge(reflectionUv)*select(0.0,1.0,reflectionClip.w>0.0);
 var environment=reflected;if(reflectionMask<.99){environment=mix(skyColor(reflect(-view,n)),reflected,reflectionMask);}let fresnel=waterFresnel(ndv);
 let halfVector=normalize(view+light);let nh=max(dot(n,halfVector),0.0);let vh=max(dot(view,halfVector),0.0);
 let roughness=.12+.09*smoothstep(.4,5.0,footprint);let alpha=roughness*roughness;let alpha2=alpha*alpha;
 let denom=max(.00001,nh*nh*(alpha2-1.0)+1.0);let distribution=alpha2/(3.14159265*denom*denom);
 let k=(roughness+1.0)*(roughness+1.0)/8.0;let g=(ndv/(ndv*(1.0-k)+k))*(ndl/(ndl*(1.0-k)+k));
 let specular=min(1.5,distribution*g*waterFresnel(vh)/(4.0*max(.08,ndv)));
 var color=mix(transmitted,environment,fresnel)+vec3<f32>(1.0,.94,.80)*specular;
 let riffle=1.0-smoothstep(.08,.65,abs(bend));
 let edge=smoothstep(.70,.97,abs(q));let shallows=1.0-smoothstep(.35,2.2,depth);
 let turbulence=(.025*riffle+.10*edge*shallows+input.material.z*.70)*smoothstep(.08,.8,riverFrame.sunSpeed.w);
 var foam=0.0;if(turbulence>.01 && riverFrame.optics.z>.001){
  let streak=riverAdvectedStreak(across,p.y,motion[0].x,speed);let patches=smoothstep(.55,.73,streak);
  foam=clamp(patches*turbulence*riverFrame.optics.z,0.0,.65);let bubbles=1.0-smoothstep(.12,.55,footprint);
  if(foam>.005 && bubbles>.01){foam*=mix(1.0,riverAdvectedBubbles(across,p.y,motion[0].x,speed),bubbles);}
 }
 // Aerated water still carries some reflection and transmission through it.
 let foamColor=vec3<f32>(.76,.83,.80)*(.64+.36*ndl);
 let foamOptical=mix(foamColor,environment,clamp(.08+fresnel*.35,0.0,.48));
 color=mix(color,foamOptical,foam*.62);
 // A multiscale cellular foam field follows the outflow from the impact.
 let splash=riverFrame.waterfall.x*smoothstep(9.0,16.0,p.y)*(1.0-smoothstep(45.0,110.0,p.y))*(1.0-smoothstep(.72,1.0,abs(q)));
 if(splash>.001 && riverFrame.optics.z>.001){
  let time=motion[0].y;let raw=vec2<f32>(across*.15,(p.y-motion[0].x*1.5)*.17);
  let warp=vec2<f32>(riverNoise(raw*.47+vec2<f32>(time*.15,3.0)),riverNoise(raw*.53+vec2<f32>(7.0,-time*.12)))-vec2<f32>(.5);
  let uv=raw+warp*.8;let blotch=riverFbm(uv);
  let fine=riverNoise(uv*2.4+vec2<f32>(9.3,5.7));var breakup=.65*blotch+.35*fine;
  let close=1.0-smoothstep(.35,2.0,footprint);
  if(close>.01){let cellular=1.0-riverBubblePattern(uv*3.0,motion[0].y);breakup+=cellular*close*.08;}
  let impactFoam=splash*smoothstep(.35,.68,breakup)*min(1.0,riverFrame.optics.z*1.2);
  let foamLight=.55+.45*ndl;let foamShade=mix(vec3<f32>(.32,.42,.41),vec3<f32>(.88,.91,.85),clamp(breakup,0.0,1.0));
  let impactLayer=mix(foamShade*foamLight,environment,clamp(.10+fresnel*.35,0.0,.45));
  color=mix(color,impactLayer,impactFoam*.65);
 }
 if(riverFrame.optics.w>.5){
  let along=riverFlowCoordinate(p.y,motion[0].x,speed);
  let gx=abs(fract(across/34.0+.5)-.5);let gy=fract(along/72.0)-.5;
  let shaft=select(0.0,1.0,gx<.045 && gy>-.32 && gy<.10);
  let head=select(0.0,1.0,gy>=.04 && gy<.31 && gx<(0.31-gy)*.8);
  color=mix(color,vec3<f32>(.35,1.0,.74),max(shaft,head)*.90);
 }
 let dist=length(riverFrame.cameraDelta.xyz-input.world);let fog=1.0-exp(-dist*.00035);color=mix(color,vec3<f32>(.50,.58,.57),fog*.38);
 if(riverFrame.waterfall.x>.5 && p.y> -8.0 && p.y<10.0){discard;}
 return vec4<f32>(displayColor(color),1.0);
}

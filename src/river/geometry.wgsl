@group(0) @binding(2) var<storage,read_write> geometry:array<RiverVertex>;
@group(0) @binding(3) var<storage,read_write> indices:array<u32>;
@group(0) @binding(4) var<storage,read_write> rocks:array<RiverRock>;
// Seeded obstacles are placed once per reach or channel-shape change.
@compute @workgroup_size(64)
fn makeRocks(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=RIVER_ROCKS){return;}
 let key=f32(i)+f32(reach.ids.x%7919u)*.031+f32(riverFrame.config.x%4093u)*.017;
 let a=riverHash(vec2<f32>(key,14.7));let b=riverHash(vec2<f32>(key+11.3,7.4));let c=riverHash(vec2<f32>(key+31.9,2.2));
 let z=-REACH_LENGTH*.5+(f32(i)+.25+a*.50)*(REACH_LENGTH/f32(RIVER_ROCKS));
 let q=(b-.5)*1.48;let x=riverCenter(z)+q*riverHalfWidth();let depth=riverDepth(q,z);
 let radius=clamp(riverHalfWidth()*.065,2.5,8.0)*(.72+c*.65);
 rocks[i]=RiverRock(vec4<f32>(x,riverLevel(z),z,radius),vec4<f32>(depth,.25+.9*riverHash(vec2<f32>(key+3.1,19.2)),.75+a*.5,.75+b*.5));
}
@compute @workgroup_size(64)
fn makeTerrain(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;let row=TERRAIN_GRID+1u;let vertices=row*row;let indexCount=TERRAIN_GRID*TERRAIN_GRID*6u;
 if(i<vertices){
  let x=i%row;let z=i/row;let local=(vec2<f32>(f32(x),f32(z))/f32(TERRAIN_GRID)-vec2<f32>(.5))*vec2<f32>(REACH_WIDTH,REACH_LENGTH);
  let p=vec2<f32>(local.x+riverCenter(local.y),local.y);
  let h=riverGround(p);let n=riverNormal(p);let q=(p.x-riverCenter(p.y))/riverHalfWidth();
  geometry[i]=RiverVertex(vec4<f32>(p.x,h,p.y,1.0),vec4<f32>(n,0.0),vec4<f32>(q,0.0,0.0,0.0));
 }
 if(i<indexCount){
  let cell=i/6u;let x=cell%TERRAIN_GRID;let z=cell/TERRAIN_GRID;let k=i%6u;let a=z*row+x;
  let offsets=array<u32,6>(0u,row,1u,1u,row,row+1u);indices[i]=a+offsets[k];
 }
}
@compute @workgroup_size(64)
fn makeWater(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;let row=WATER_ACROSS+1u;let vertices=row*(WATER_ALONG+1u);let indexCount=WATER_ACROSS*WATER_ALONG*6u;
 if(i<vertices){
  let x=i%row;let z=i/row;let along=(f32(z)/f32(WATER_ALONG)-.5)*REACH_LENGTH;let q=(f32(x)/f32(WATER_ACROSS)*2.0-1.0)*.99;
  let across=riverCenter(along)+q*riverHalfWidth();let h=riverLevel(along);
  geometry[i]=RiverVertex(vec4<f32>(across,h,along,1.0),vec4<f32>(0.0,1.0,riverLevelSlope(along),0.0),vec4<f32>(q,riverDepth(q,along),0.0,0.0));
 }
 if(i<indexCount){
  let cell=i/6u;let x=cell%WATER_ACROSS;let z=cell/WATER_ACROSS;let k=i%6u;let a=z*row+x;
  let offsets=array<u32,6>(0u,row,1u,1u,row,row+1u);indices[i]=a+offsets[k];
 }
}

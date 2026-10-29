@group(0) @binding(2) var<storage,read_write> geometry:array<RiverVertex>;
@group(0) @binding(3) var<storage,read_write> indices:array<u32>;
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
  geometry[i]=RiverVertex(vec4<f32>(across,h,along,1.0),vec4<f32>(0.0,1.0,reach.info.y,0.0),vec4<f32>(q,riverDepth(q,along),0.0,0.0));
 }
 if(i<indexCount){
  let cell=i/6u;let x=cell%WATER_ACROSS;let z=cell/WATER_ACROSS;let k=i%6u;let a=z*row+x;
  let offsets=array<u32,6>(0u,row,1u,1u,row,row+1u);indices[i]=a+offsets[k];
 }
}

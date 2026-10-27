@group(0) @binding(0) var<uniform> frame: PlanetFrame;
@group(0) @binding(1) var<storage,read> patches: array<Patch>;
@group(0) @binding(2) var<storage,read_write> vertices: array<PlanetVertex>;
@group(0) @binding(3) var<storage,read> queue: array<u32>;
fn normalAt(base:u32,step:u32,radial:vec3<f32>)->vec3<f32>{
 let du=vertices[base+step].position.xyz-vertices[base-step].position.xyz;
 let dv=vertices[base+GRID*step].position.xyz-vertices[base-GRID*step].position.xyz;
 var n=normalize(cross(du,dv));if(dot(n,radial)<0.0){n=-n;}return n;
}
fn cavityAt(base:u32,step:u32,cellSize:f32)->f32{
 let avg=(vertices[base-step].position.w+vertices[base+step].position.w+vertices[base-GRID*step].position.w+vertices[base+GRID*step].position.w)*.25;
 return clamp(max(0.0,avg-vertices[base].position.w)/(cellSize*f32(step))*3.0,0.0,1.0);
}
fn sampleNormal(slot:u32,gx:u32,gy:u32)->vec4<f32>{
 let base=slot*GRID_COUNT+(gy+2u)*GRID+gx+2u;
 let tile=patches[slot];let stitch=tile.details.w;let cellSize=max(.00001,tile.cube.w*frame.settings.x/f32(CELLS));
 let nFine=normalAt(base,1u,tile.centerDirection.xyz);let cFine=cavityAt(base,1u,cellSize);
 // At a shared edge use the coarser neighbor's sample spacing, and blend that
 // result into a two-cell border. Same world samples give continuous shading.
 var blend=0.0;
 if((stitch&1u)!=0u){blend=max(blend,1.0-smoothstep(0.0,2.0,f32(gx)));}
 if((stitch&2u)!=0u){blend=max(blend,1.0-smoothstep(0.0,2.0,f32(CELLS-gx)));}
 if((stitch&4u)!=0u){blend=max(blend,1.0-smoothstep(0.0,2.0,f32(gy)));}
 if((stitch&8u)!=0u){blend=max(blend,1.0-smoothstep(0.0,2.0,f32(CELLS-gy)));}
 let left=1.0-smoothstep(0.0,2.0,f32(gx));let right=1.0-smoothstep(0.0,2.0,f32(CELLS-gx));
 let bottom=1.0-smoothstep(0.0,2.0,f32(gy));let top=1.0-smoothstep(0.0,2.0,f32(CELLS-gy));
 if((stitch&16u)!=0u){blend=max(blend,left*bottom);}if((stitch&32u)!=0u){blend=max(blend,right*bottom);}
 if((stitch&64u)!=0u){blend=max(blend,left*top);}if((stitch&128u)!=0u){blend=max(blend,right*top);}
 var n=nFine;var cavity=cFine;
 if(blend>0.0){n=normalize(mix(nFine,normalAt(base,2u,tile.centerDirection.xyz),blend));cavity=mix(cFine,cavityAt(base,2u,cellSize),blend);}
 return vec4<f32>(n,cavity);
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>) {
 let index=gid.x;if(index>=frame.queueCounts.x*INNER_COUNT){return;}
 let slot=queue[index/INNER_COUNT];let v=index%INNER_COUNT;
 let gx=v%17u;let gy=v/17u;let base=slot*GRID_COUNT+(gy+2u)*GRID+gx+2u;
 let tile=patches[slot];var result=sampleNormal(slot,gx,gy);var edge=4u;
 if(gx==0u && gy%2u==0u && (tile.details.z&1u)!=0u){edge=0u;}
 if(gx==CELLS && gy%2u==0u && (tile.details.z&2u)!=0u){edge=1u;}
 if(gy==0u && gx%2u==0u && (tile.details.z&4u)!=0u){edge=2u;}
 if(gy==CELLS && gx%2u==0u && (tile.details.z&8u)!=0u){edge=3u;}
 if(edge<4u){
  let neighbor=tile.coarseNeighbors[edge];
  if(neighbor!=0xffffffffu){
   let coarse=patches[neighbor];
   let point=tile.cube.xyz+tile.axisU.xyz*((f32(gx)-8.0)*tile.cube.w/16.0)+tile.axisV.xyz*((f32(gy)-8.0)*tile.cube.w/16.0);
   let offset=point-coarse.cube.xyz;
   let cgx=i32(round(dot(offset,coarse.axisU.xyz)*16.0/coarse.cube.w+8.0));
   let cgy=i32(round(dot(offset,coarse.axisV.xyz)*16.0/coarse.cube.w+8.0));
   if(cgx>=0 && cgx<=16 && cgy>=0 && cgy<=16){result=sampleNormal(neighbor,u32(cgx),u32(cgy));}
  }
 }
 vertices[base].normal=result;
}

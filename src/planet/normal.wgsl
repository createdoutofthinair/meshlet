@group(0) @binding(0) var<uniform> frame: PlanetFrame;
@group(0) @binding(1) var<storage,read> patches: array<Patch>;
@group(0) @binding(2) var<storage,read_write> vertices: array<PlanetVertex>;
@group(0) @binding(3) var<storage,read> queue: array<u32>;
fn normalAt(base:u32,step:u32,radial:vec3<f32>)->vec3<f32>{
 let du=vertices[base+step].position.xyz-vertices[base-step].position.xyz;
 let dv=vertices[base+GRID*step].position.xyz-vertices[base-GRID*step].position.xyz;
 var n=normalize(cross(du,dv));if(dot(n,radial)<0.0){n=-n;}return n;
}
fn visibleHeight(height:f32)->f32{
 return select(height,max(height,0.0),frame.settings.z>.5);
}
fn cavityAt(base:u32,step:u32,cellSize:f32)->f32{
 let avg=(visibleHeight(vertices[base-step].position.w)+visibleHeight(vertices[base+step].position.w)+visibleHeight(vertices[base-GRID*step].position.w)+visibleHeight(vertices[base+GRID*step].position.w))*.25;
 return clamp(max(0.0,avg-visibleHeight(vertices[base].position.w))/(cellSize*f32(step))*3.0,0.0,1.0);
}
fn sampleNormal(slot:u32,gx:u32,gy:u32)->vec4<f32>{
 let base=slot*GRID_COUNT+(gy+2u)*GRID+gx+2u;
 let tile=patches[slot];let stitch=tile.details.w;let cellSize=max(.00001,tile.cube.w*frame.settings.x/f32(CELLS));
 // The seabed height is retained for color and for the ocean-off mode, but
 // the displayed water is a smooth sphere. Never shade its hidden cavities.
 if(frame.settings.z>.5 && vertices[base].position.w<0.0){
  let radial=normalize(tile.centerDirection.xyz+(tile.centerLow.xyz+vertices[base].position.xyz/frame.settings.x));
  return vec4<f32>(radial,0.0);
 }
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
 let tile=patches[slot];var result=sampleNormal(slot,gx,gy);
 if(frame.settings.z>.5 && vertices[base].position.w<0.0){vertices[base].normal=result;return;}
 // Gather patches touching this vertex, including diagonal links reached via
 // a same-level neighbor. Then pick one canonical source: the coarsest level,
 // followed by face and grid ordering. This avoids corner-specific seams.
 var slots:array<u32,16>;var xs:array<u32,16>;var ys:array<u32,16>;
 slots[0]=slot;xs[0]=gx;ys[0]=gy;var count=1u;
 var source=slot;var sx=gx;var sy=gy;var bestLevel=tile.details.y;var bestFace=tile.details.x;
 var bestU=dot(tile.cube.xyz,tile.axisU.xyz);var bestV=dot(tile.cube.xyz,tile.axisV.xyz);
 for(var index=0u;index<16u;index++){
  if(index>=count){break;}let current=patches[slots[index]];let x=xs[index];let y=ys[index];
  for(var edge=0u;edge<4u;edge++){
   let onEdge=select(select(y==0u,y==CELLS,edge==3u),select(x==0u,x==CELLS,edge==1u),edge<2u);
   if(!onEdge){continue;}
   let candidate=current.coarseNeighbors[edge];if(candidate==0xffffffffu){continue;}
   let other=patches[candidate];let even=select(x%2u==0u,y%2u==0u,edge<2u);
   let coarse=(current.details.z&(1u<<edge))!=0u && even && other.details.y<current.details.y;
   if(!coarse && other.details.y!=current.details.y){continue;}
   var seen=false;for(var k=0u;k<count;k++){if(slots[k]==candidate){seen=true;}}
   if(seen || count>=16u){continue;}
   let point=current.cube.xyz+current.axisU.xyz*((f32(x)-8.0)*current.cube.w/16.0)+current.axisV.xyz*((f32(y)-8.0)*current.cube.w/16.0);
   let faceNormal=normalize(cross(other.axisU.xyz,other.axisV.xyz));let offset=point/max(.001,dot(point,faceNormal))-other.cube.xyz;
   let tx=i32(round(dot(offset,other.axisU.xyz)*16.0/other.cube.w+8.0));let ty=i32(round(dot(offset,other.axisV.xyz)*16.0/other.cube.w+8.0));
   if(tx<0 || tx>16 || ty<0 || ty>16){continue;}
   slots[count]=candidate;xs[count]=u32(tx);ys[count]=u32(ty);count++;
   let otherU=dot(other.cube.xyz,other.axisU.xyz);let otherV=dot(other.cube.xyz,other.axisV.xyz);
   let better=other.details.y<bestLevel || (other.details.y==bestLevel && (other.details.x<bestFace || (other.details.x==bestFace && (otherV<bestV || (otherV==bestV && otherU<bestU)))));
   if(better){source=candidate;sx=u32(tx);sy=u32(ty);bestLevel=other.details.y;bestFace=other.details.x;bestV=otherV;bestU=otherU;}
  }
 }
 if(source!=slot){result=sampleNormal(source,sx,sy);}
 vertices[base].normal=result;
}

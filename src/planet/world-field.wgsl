@group(0) @binding(7) var<storage,read> world:HydroStorage;
@group(0) @binding(8) var<storage,read> worldDirections:array<vec4<f32>>;
@group(0) @binding(9) var<storage,read> worldNeighbors:array<u32>;
@group(0) @binding(10) var<storage,read> worldFaces:array<u32>;
const NO_NODE:u32=0xffffffffu;
struct WorldSample { corners:vec4<u32>, blend:vec2<f32> };
fn worldCoordinates(p:vec3<f32>)->vec3<f32>{
 let a=abs(p);
 if(a.x>=a.y && a.x>=a.z){if(p.x>=0.0){return vec3<f32>(0.0,p.y/a.x,p.z/a.x);}return vec3<f32>(1.0,p.y/a.x,-p.z/a.x);}
 if(a.y>=a.z){if(p.y>=0.0){return vec3<f32>(2.0,p.x/a.y,-p.z/a.y);}return vec3<f32>(3.0,p.x/a.y,p.z/a.y);}
 if(p.z>=0.0){return vec3<f32>(4.0,p.x/a.z,p.y/a.z);}return vec3<f32>(5.0,-p.x/a.z,p.y/a.z);
}
fn worldSample(direction:vec3<f32>)->WorldSample{
 let c=worldCoordinates(direction);let xy=clamp((c.yz+vec2<f32>(1.0))*.5*f32(WORLD_RES),vec2<f32>(0.0),vec2<f32>(f32(WORLD_RES)));
 let x=min(u32(floor(xy.x)),WORLD_RES-1u);let y=min(u32(floor(xy.y)),WORLD_RES-1u);let start=u32(c.x)*WORLD_WIDTH*WORLD_WIDTH+y*WORLD_WIDTH+x;
 return WorldSample(vec4<u32>(worldFaces[start],worldFaces[start+1u],worldFaces[start+WORLD_WIDTH],worldFaces[start+WORLD_WIDTH+1u]),xy-vec2<f32>(f32(x),f32(y)));
}
fn worldProfile(s:WorldSample)->vec4<f32>{
 let a=mix(world.cells[s.corners.x].profile,world.cells[s.corners.y].profile,s.blend.x);
 let b=mix(world.cells[s.corners.z].profile,world.cells[s.corners.w].profile,s.blend.x);return mix(a,b,s.blend.y);
}
fn worldSlope(s:WorldSample)->f32{
 let a=mix(world.cells[s.corners.x].process.w,world.cells[s.corners.y].process.w,s.blend.x);
 let b=mix(world.cells[s.corners.z].process.w,world.cells[s.corners.w].process.w,s.blend.x);
 return max(0.0,mix(a,b,s.blend.y));
}
// Interpolate the direction of the cached coarse drainage graph. The graph's
// vertices are shared at cube edges, so this field is continuous at the face
// boundary and independent of the terrain patch/LOD using it.
fn worldDrainage(s:WorldSample,direction:vec3<f32>)->vec4<f32>{
 let weights=vec4<f32>((1.0-s.blend.x)*(1.0-s.blend.y),s.blend.x*(1.0-s.blend.y),(1.0-s.blend.x)*s.blend.y,s.blend.x*s.blend.y);
 var flow=vec3<f32>(0.0);var strength=0.0;
 for(var k=0u;k<4u;k++){
  let id=s.corners[k];let cell=world.cells[id];let next=cell.route.x;
  if(next==NO_NODE){continue;}
  let raw=worldDirections[next].xyz-worldDirections[id].xyz;
  let tangent=raw-direction*dot(direction,raw);let magnitude=length(tangent);
  if(magnitude>.000001){flow+=tangent/magnitude*weights[k];strength+=weights[k];}
 }
 let magnitude=length(flow);if(magnitude<.0001){return vec4<f32>(0.0);}
 // Opposing coarse routes can cancel near a watershed divide. Fade their
 // influence with directional agreement instead of flipping the detail.
 return vec4<f32>(flow/magnitude,min(clamp(strength,0.0,1.0),clamp(magnitude*2.0,0.0,1.0)));
}
fn hasRivers(s:WorldSample)->bool{
 return (world.riverPresence[s.corners.x]|world.riverPresence[s.corners.y]|world.riverPresence[s.corners.z]|world.riverPresence[s.corners.w])!=0u;
}
fn worldRain(s:WorldSample)->f32{
 let a=world.cells[s.corners.x].process.z/max(.001,worldDirections[s.corners.x].w);
 let b=world.cells[s.corners.y].process.z/max(.001,worldDirections[s.corners.y].w);
 let c=world.cells[s.corners.z].process.z/max(.001,worldDirections[s.corners.z].w);
 let d=world.cells[s.corners.w].process.z/max(.001,worldDirections[s.corners.w].w);
 return mix(mix(a,b,s.blend.x),mix(c,d,s.blend.x),s.blend.y);
}
fn worldSpill(s:WorldSample)->f32{
 let a=bitcast<f32>(world.cells[s.corners.x].route.y);let b=bitcast<f32>(world.cells[s.corners.y].route.y);
 let c=bitcast<f32>(world.cells[s.corners.z].route.y);let d=bitcast<f32>(world.cells[s.corners.w].route.y);
 return mix(mix(a,b,s.blend.x),mix(c,d,s.blend.x),s.blend.y);
}
// Search segments attached to the enclosing quad and its neighbors. Shared
// world-grid nodes let a river keep the same endpoints across all cube faces.
struct RiverInfo {mask:f32,discharge:f32};
fn riverSegment(direction:vec3<f32>,start:u32)->RiverInfo{
 if(start>=WORLD_COUNT){return RiverInfo(0.0,0.0);}
 let cell=world.cells[start];let end=cell.route.x;
 if(end==NO_NODE || cell.profile.z<1.5){return RiverInfo(0.0,0.0);}
 let a=worldDirections[start].xyz;let b=worldDirections[end].xyz;let ab=b-a;let segmentLength=length(ab);
 let upstream=cell.route.z;let next=world.cells[end].route.x;let endMain=world.cells[end].route.z;
 var previous=a;if(upstream!=NO_NODE){previous=worldDirections[upstream].xyz;}
 var following=b;if(next!=NO_NODE){following=worldDirections[next].xyz;}
 var endPrevious=a;if(endMain!=NO_NODE){endPrevious=worldDirections[endMain].xyz;}
 let m0=riverTangent(b-previous,a,segmentLength*.8);let m1=riverTangent(following-endPrevious,b,segmentLength*.8);
 var t=clamp(dot(direction-a,ab)/max(dot(ab,ab),.00000001),0.0,1.0);
 for(var iteration=0u;iteration<2u;iteration++){
  let curve=normalize(riverCurve(a,b,m0,m1,t));let derivative=riverDerivative(a,b,m0,m1,t);
  t=clamp(t+dot(direction-curve,derivative)/max(dot(derivative,derivative),.00000001),0.0,1.0);
 }
 let guess=i32(floor(t*f32(RIVER_SAMPLES-1u)));var distance=1e20;var width=.15;var bestT=t;
 for(var offset=-3;offset<=3;offset++){
  let k=guess+offset;if(k<0 || k>=i32(RIVER_SAMPLES-1u)){continue;}
  let p=world.paths[start*RIVER_SAMPLES+u32(k)];let q=world.paths[start*RIVER_SAMPLES+u32(k)+1u];let line=q.xyz-p.xyz;
  let part=clamp(dot(direction-p.xyz,line)/max(dot(line,line),.0000000001),0.0,1.0);
  let point=normalize(mix(p.xyz,q.xyz,part));let d=length(direction-point)*6371.0;
  if(d<distance){distance=d;width=mix(p.w,q.w,part);bestT=(f32(k)+part)/f32(RIVER_SAMPLES-1u);}
 }
 let flow=mix(cell.profile.z,max(cell.profile.z,world.cells[end].profile.z),bestT);
 let mask=1.0-smoothstep(width*.80,width*1.10,distance);
 return RiverInfo(mask,flow);
}
// Search segments attached to the enclosing quad and its neighbors. Shared
// world-grid nodes let a river keep the same endpoints across all cube faces.
fn riverAt(direction:vec3<f32>,s:WorldSample)->RiverInfo{
 var result=RiverInfo(0.0,0.0);
 for(var c=0u;c<4u;c++){
  let corner=s.corners[c];
  for(var k=0u;k<9u;k++){
   var start=corner;if(k>0u){start=worldNeighbors[corner*8u+k-1u];}
   let candidate=riverSegment(direction,start);
   if(candidate.mask>result.mask){result.mask=candidate.mask;result.discharge=candidate.discharge;}
  }
 }
 return result;
}

// The regional field is addressed by geographic tile rather than render LOD.
// World-space halo simulation makes same-face tile edges agree. A narrow,
// static blend joins the different cube-face parameterizations.
fn regionCube(face:u32,u:f32,v:f32)->vec3<f32>{
 if(face==0u){return vec3<f32>(1.0,u,v);}if(face==1u){return vec3<f32>(-1.0,u,-v);}
 if(face==2u){return vec3<f32>(u,1.0,-v);}if(face==3u){return vec3<f32>(u,-1.0,v);}
 if(face==4u){return vec3<f32>(u,v,1.0);}return vec3<f32>(-u,v,-1.0);
}
fn regionFaceCoords(face:u32,p:vec3<f32>)->vec2<f32>{
 if(face==0u){return p.yz/abs(p.x);}if(face==1u){return vec2<f32>(p.y,-p.z)/abs(p.x);}
 if(face==2u){return vec2<f32>(p.x,-p.z)/abs(p.y);}if(face==3u){return p.xz/abs(p.y);}
 if(face==4u){return p.xy/abs(p.z);}return vec2<f32>(-p.x,p.y)/abs(p.z);
}
fn regionIndex(face:u32,x:u32,y:u32)->u32{return face*REGION_TILES*REGION_TILES+y*REGION_TILES+x;}
fn regionAvailable(face:u32,x:i32,y:i32)->bool{
 if(x>=0 && x<i32(REGION_TILES) && y>=0 && y<i32(REGION_TILES)){return world.regionLookup[regionIndex(face,u32(x),u32(y))]!=NO_NODE;}
 let uv=(vec2<f32>(f32(x),f32(y))+vec2<f32>(.5))*2.0/f32(REGION_TILES)-vec2<f32>(1.0);
 let c=worldCoordinates(regionCube(face,uv.x,uv.y));let xy=clamp((c.yz+vec2<f32>(1.0))*.5*f32(REGION_TILES),vec2<f32>(0.0),vec2<f32>(f32(REGION_TILES)-.0001));
 return world.regionLookup[regionIndex(u32(c.x),u32(xy.x),u32(xy.y))]!=NO_NODE;
}
fn regionFaceSample(face:u32,direction:vec3<f32>)->vec4<f32>{
 let uv=clamp(regionFaceCoords(face,direction),vec2<f32>(-1.0),vec2<f32>(1.0));
 let grid=(uv+vec2<f32>(1.0))*.5*f32(REGION_TILES);let tx=min(u32(floor(grid.x)),REGION_TILES-1u);let ty=min(u32(floor(grid.y)),REGION_TILES-1u);
 let slot=world.regionLookup[regionIndex(face,tx,ty)];if(slot==NO_NODE){return vec4<f32>(0.0);}
 let local=clamp(grid-vec2<f32>(f32(tx),f32(ty)),vec2<f32>(0.0),vec2<f32>(1.0));
 let p=local*f32(REGION_CELLS);let x=min(u32(floor(p.x)),REGION_CELLS-1u);let y=min(u32(floor(p.y)),REGION_CELLS-1u);let f=p-vec2<f32>(f32(x),f32(y));
 let i=slot*REGION_SAMPLE_COUNT+y*(REGION_CELLS+1u)+x;
 let a=mix(world.regionValues[i],world.regionValues[i+1u],f.x);let b=mix(world.regionValues[i+REGION_CELLS+1u],world.regionValues[i+REGION_CELLS+2u],f.x);
 var fade=1.0;let width=2.0/f32(REGION_CELLS);
 if(!regionAvailable(face,i32(tx)-1,i32(ty))){fade*=smoothstep(0.0,width,local.x);}
 if(!regionAvailable(face,i32(tx)+1,i32(ty))){fade*=smoothstep(0.0,width,1.0-local.x);}
 if(!regionAvailable(face,i32(tx),i32(ty)-1)){fade*=smoothstep(0.0,width,local.y);}
 if(!regionAvailable(face,i32(tx),i32(ty)+1)){fade*=smoothstep(0.0,width,1.0-local.y);}
 return mix(a,b,f.y)*fade;
}
fn regionalSimulation(direction:vec3<f32>)->vec4<f32>{
 let a=abs(direction);let largest=max(a.x,max(a.y,a.z));let ratios=a/largest;
 let weights=smoothstep(vec3<f32>(.99975),vec3<f32>(1.0),ratios);var value=vec4<f32>(0.0);var total=0.0;
 if(weights.x>0.0){let face=select(1u,0u,direction.x>=0.0);value+=regionFaceSample(face,direction)*weights.x;total+=weights.x;}
 if(weights.y>0.0){let face=select(3u,2u,direction.y>=0.0);value+=regionFaceSample(face,direction)*weights.y;total+=weights.y;}
 if(weights.z>0.0){let face=select(5u,4u,direction.z>=0.0);value+=regionFaceSample(face,direction)*weights.z;total+=weights.z;}
 return value/max(total,.0001);
}

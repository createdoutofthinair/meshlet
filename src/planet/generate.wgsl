const HEIGHT_LIMIT:f32=10.0;
@group(0) @binding(0) var<uniform> frame: PlanetFrame;
@group(0) @binding(1) var<storage,read> patches: array<Patch>;
@group(0) @binding(2) var<storage,read_write> vertices: array<PlanetVertex>;
@group(0) @binding(3) var<storage,read> queue: array<u32>;
@group(0) @binding(4) var<storage,read> plates: array<vec4<f32>>;
@group(0) @binding(11) var<storage,read> riverMasks:array<vec2<f32>>;
fn carveRiver(base:SurfaceData,river:vec2<f32>)->SurfaceData{
 // No channel can change the surface when any of these factors is zero.
 // Most samples are outside rivers, so avoid the logarithm in that case.
 if(river.x==0.0 || frame.hydrology.x==0.0 || base.height<=.03 || base.lake>=1.0){return base;}
 let channel=river.x*smoothstep(.03,.3,base.height)*(1.0-base.lake);
 var h=base.height-channel*clamp(.006+.006*log2(1.0+river.y),.006,.04)*frame.hydrology.x;
 if(base.height>0.0){h=max(base.height*.10,h);}
 return SurfaceData(h,base.lake,base.humidity);
}
fn detailedTerrain(direction:vec3<f32>,high:vec3<f32>,low:vec3<f32>,delta:vec3<f32>,seed:u32)->f32{
 let base=surfaceBase(direction,high,low,delta,seed,true);var river=vec2<f32>(0.0);
 if(base.height>.03 && frame.hydrology.x>0.0){let s=worldSample(direction);if(hasRivers(s)){let r=riverAt(direction,s);river=vec2<f32>(r.mask,r.discharge);}}
 return carveRiver(base,river).height;
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>) {
 let index=gid.x;if(index>=frame.counts.y*GRID_COUNT){return;}
 let slot=queue[index/GRID_COUNT];let sample=index%GRID_COUNT;
 let x=sample%GRID;let y=sample/GRID;let tile=patches[slot];
 let du=(f32(x)-2.0-f32(CELLS)*.5)*tile.cube.w/f32(CELLS);
 let dv=(f32(y)-2.0-f32(CELLS)*.5)*tile.cube.w/f32(CELLS);
 let center=tile.cube.xyz;let delta=tile.axisU.xyz*du+tile.axisV.xyz*dv;
 let centerLength=length(center);let a=(2.0*dot(center,delta)+dot(delta,delta))/dot(center,center);
 let factor=sqrt(max(.01,1.0+a));let factorMinusOne=a/(factor+1.0);
 let directionDelta=(delta-center*factorMinusOne)/(centerLength*factor);
 let direction=normalize(center+delta);
 let base=surfaceBase(direction,tile.centerDirection.xyz,tile.centerLow.xyz,directionDelta,frame.counts.z,true);
 let river=riverMasks[slot*1681u+(y*2u)*41u+x*2u];let data=carveRiver(base,river);
 let h=clamp(data.height*frame.settings.y,-HEIGHT_LIMIT,HEIGHT_LIMIT);
 let surfaceHeight=select(h,max(h,0.0),frame.settings.z>.5);
 vertices[slot*GRID_COUNT+sample].position=vec4<f32>(directionDelta*frame.settings.x+direction*surfaceHeight,h);
 // Keep the uncarved height until the fixed-distance normal pass consumes it.
 // The pass replaces these scratch components with the broad surface slopes.
 vertices[slot*GRID_COUNT+sample].surface=vec4<f32>(data.lake,data.humidity,clamp(base.height*frame.settings.y,-HEIGHT_LIMIT,HEIGHT_LIMIT),0.0);
}
// Small, explicit readbacks for navigation tools. They are not per-vertex CPU
// generation: both height probing and highland searches evaluate on the GPU.
struct ProbeInput { direction:vec4<f32> };
@group(0) @binding(5) var<storage,read_write> samples:array<vec4<f32>>;
@group(0) @binding(6) var<uniform> probe:ProbeInput;
fn facePoint(face:u32,u:f32,v:f32)->vec3<f32>{
 if(face==0u){return vec3<f32>(1.0,u,v);}if(face==1u){return vec3<f32>(-1.0,u,-v);}
 if(face==2u){return vec3<f32>(u,1.0,-v);}if(face==3u){return vec3<f32>(u,-1.0,v);}
 if(face==4u){return vec3<f32>(u,v,1.0);}return vec3<f32>(-u,v,-1.0);
}
@compute @workgroup_size(64)
fn highlands(@builtin(global_invocation_id) gid:vec3<u32>){
 let n=gid.x;if(n>=6u*24u*24u){return;}
 let face=n/(24u*24u);let k=n%(24u*24u);
 let u=(f32(k%24u)+.5)/24.0*2.0-1.0;let v=(f32(k/24u)+.5)/24.0*2.0-1.0;
 let direction=normalize(facePoint(face,u,v));
 samples[n]=vec4<f32>(direction,clamp(detailedTerrain(direction,direction,vec3<f32>(0.0),vec3<f32>(0.0),frame.counts.z)*frame.settings.y,-HEIGHT_LIMIT,HEIGHT_LIMIT));
}
@compute @workgroup_size(64)
fn valleyCandidates(@builtin(global_invocation_id) gid:vec3<u32>){
 let n=gid.x;if(n>=6u*24u*24u){return;}
 let face=n/(24u*24u);let k=n%(24u*24u);
 let u=(f32(k%24u)+.5)/24.0*2.0-1.0;let v=(f32(k/24u)+.5)/24.0*2.0-1.0;
 let direction=normalize(facePoint(face,u,v));
 let shape=terrainShape(direction,frame.counts.z,1.0);
 let before=clamp((shape.x+shape.y)*frame.settings.y,-HEIGHT_LIMIT,HEIGHT_LIMIT);
 let after=clamp(shape.x*frame.settings.y,-HEIGHT_LIMIT,HEIGHT_LIMIT);
 samples[n]=vec4<f32>(direction,max(0.0,before-after));
}
@compute @workgroup_size(64)
fn riverCandidates(@builtin(global_invocation_id) gid:vec3<u32>){
 let n=gid.x;if(n>=WORLD_COUNT){return;}let cell=world.cells[n];
 let score=select(0.0,cell.profile.z,cell.route.x!=NO_NODE && cell.profile.y>.05);
 samples[n]=vec4<f32>(worldDirections[n].xyz,score);
}
@compute @workgroup_size(1)
fn point(){
 let direction=normalize(probe.direction.xyz);
 samples[0]=vec4<f32>(direction,clamp(detailedTerrain(direction,direction,vec3<f32>(0.0),vec3<f32>(0.0),frame.counts.z)*frame.settings.y,-HEIGHT_LIMIT,HEIGHT_LIMIT));
}

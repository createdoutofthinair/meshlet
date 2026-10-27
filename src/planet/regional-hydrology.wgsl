@group(0) @binding(0) var<uniform> frame:PlanetFrame;
@group(0) @binding(4) var<storage,read> plates:array<vec4<f32>>;
@group(0) @binding(12) var<storage,read> regionMeta:array<vec4<u32>>;
@group(0) @binding(13) var<storage,read> regionQueue:array<u32>;
@group(0) @binding(14) var<storage,read> stateIn:array<vec4<f32>>;
@group(0) @binding(15) var<storage,read_write> stateOut:array<vec4<f32>>;
@group(0) @binding(16) var<storage,read_write> flux:array<vec4<f32>>;
const REGION_NONE:u32=0xffffffffu;
fn regionPosition(slot:u32,x:u32,y:u32)->vec3<f32>{
 let info=regionMeta[slot];let gx=i32(info.y*REGION_CELLS)+i32(x)-i32(REGION_HALO);
 let gy=i32(info.z*REGION_CELLS)+i32(y)-i32(REGION_HALO);
 let scale=2.0/f32(REGION_TILES*REGION_CELLS);
 return normalize(regionCube(info.x,-1.0+f32(gx)*scale,-1.0+f32(gy)*scale));
}
fn regionalNeighbor(slot:u32,x:u32,y:u32,dx:i32,dy:i32)->u32{
 let px=i32(x)+dx;let py=i32(y)+dy;if(px<0||py<0||px>=i32(REGION_GRID)||py>=i32(REGION_GRID)){return REGION_NONE;}
 return slot*REGION_GRID_COUNT+u32(py)*REGION_GRID+u32(px);
}
// Each tile has enough overlapping cells for all six local simulation steps.
// Interior values therefore depend on the same world-coordinate samples even
// when adjacent regions are computed independently.
@compute @workgroup_size(64)
fn initializeRegion(@builtin(global_invocation_id) gid:vec3<u32>){
 let index=gid.x;if(index>=frame.queueCounts.y*REGION_GRID_COUNT){return;}
 let slot=regionQueue[index/REGION_GRID_COUNT];let sample=index%REGION_GRID_COUNT;let x=sample%REGION_GRID;let y=sample/REGION_GRID;
 let direction=regionPosition(slot,x,y);let s=worldSample(direction);let profile=worldProfile(s);
 let ground=terrainShape(direction,frame.counts.z,1.0).x+profile.y-profile.x;
 // Coarse rainfall and accumulated runoff provide regional water inputs;
 // the local solver determines how water and sediment move within the tile.
 let catchment=clamp(log2(1.0+max(0.0,profile.z))/8.0,0.0,1.0);
 let water=select(0.0,.004+.004*worldRain(s)+.002*catchment,ground>.01);
 stateOut[slot*REGION_GRID_COUNT+sample]=vec4<f32>(ground,water,0.0,ground);
}
// A four-neighbor shallow-water approximation. Outflow is limited to the
// available water, so a cell cannot send more water than it contains.
@compute @workgroup_size(64)
fn regionFlux(@builtin(global_invocation_id) gid:vec3<u32>){
 let index=gid.x;if(index>=frame.queueCounts.y*REGION_GRID_COUNT){return;}
 let slot=regionQueue[index/REGION_GRID_COUNT];let sample=index%REGION_GRID_COUNT;let x=sample%REGION_GRID;let y=sample/REGION_GRID;let id=slot*REGION_GRID_COUNT+sample;
 let center=stateIn[id];let head=center.x+center.y;var out=vec4<f32>(0.0);
 let dx=array<i32,4>(-1,1,0,0);let dy=array<i32,4>(0,0,-1,1);
 for(var k=0u;k<4u;k++){let j=regionalNeighbor(slot,x,y,dx[k],dy[k]);if(j!=REGION_NONE){let n=stateIn[j];out[k]=max(0.0,head-n.x-n.y)*.12;}}
 let sum=out.x+out.y+out.z+out.w;out*=min(1.0,center.y/max(sum,.0000001));flux[id]=out;
}
// Gather water and suspended sediment from adjacent cells, erode material
// when carrying capacity exceeds load, and deposit it when capacity falls.
// The units and constants are tuned for terrain generation, not calibration.
@compute @workgroup_size(64)
fn regionStep(@builtin(global_invocation_id) gid:vec3<u32>){
 let index=gid.x;if(index>=frame.queueCounts.y*REGION_GRID_COUNT){return;}
 let slot=regionQueue[index/REGION_GRID_COUNT];let sample=index%REGION_GRID_COUNT;let x=sample%REGION_GRID;let y=sample/REGION_GRID;let id=slot*REGION_GRID_COUNT+sample;
 let center=stateIn[id];let own=flux[id];let sent=own.x+own.y+own.z+own.w;
 let dx=array<i32,4>(-1,1,0,0);let dy=array<i32,4>(0,0,-1,1);let opposite=array<u32,4>(1u,0u,3u,2u);
 var incoming=0.0;var sedimentIn=0.0;var drop=0.0;
 for(var k=0u;k<4u;k++){
  let j=regionalNeighbor(slot,x,y,dx[k],dy[k]);if(j==REGION_NONE){continue;}
  let n=stateIn[j];let incomingWater=flux[j][opposite[k]];incoming+=incomingWater;
  sedimentIn+=n.z*min(1.0,incomingWater/max(n.y,.0000001));drop=max(drop,center.x-n.x);
 }
 let fraction=min(1.0,sent/max(center.y,.0000001));var sediment=max(0.0,center.z*(1.0-fraction)+sedimentIn);
 let cellKm=frame.settings.x*2.0/f32(REGION_TILES*REGION_CELLS);let slope=clamp(drop/max(cellKm,.001),0.0,2.0);
 let capacity=min(.02,(sent+incoming)*(.5+2.0*slope)*.20);var ground=center.x;
 if(ground>.01){
  let erosion=min(.002,min(max(0.0,capacity-sediment)*.25,max(0.0,ground+8.0)));
  let deposition=min(.002,min(sediment,min(max(0.0,sediment-capacity)*.35,max(0.0,9.0-ground))));
  ground=ground-erosion+deposition;sediment=max(0.0,sediment+erosion-deposition);
 }
 let rain=select(0.0,.004,ground>.01);let water=max(0.0,(center.y-sent+incoming+rain)*.78);
 stateOut[id]=vec4<f32>(ground,water,sediment,center.w);
}
@compute @workgroup_size(64)
fn finishRegion(@builtin(global_invocation_id) gid:vec3<u32>){
 let index=gid.x;if(index>=frame.queueCounts.y*REGION_SAMPLE_COUNT){return;}
 let slot=regionQueue[index/REGION_SAMPLE_COUNT];let sample=index%REGION_SAMPLE_COUNT;let x=sample%(REGION_CELLS+1u);let y=sample/(REGION_CELLS+1u);
 let state=stateIn[slot*REGION_GRID_COUNT+(y+REGION_HALO)*REGION_GRID+x+REGION_HALO];
 world.regionValues[slot*REGION_SAMPLE_COUNT+sample]=vec4<f32>(state.x-state.w,state.z,state.y,0.0);
}

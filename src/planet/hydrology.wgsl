@group(0) @binding(0) var<uniform> frame:PlanetFrame;
@group(0) @binding(4) var<storage,read> plates:array<vec4<f32>>;
@group(1) @binding(0) var<storage,read_write> world:HydroStorage;
@group(1) @binding(1) var<storage,read> directions:array<vec4<f32>>;
@group(1) @binding(2) var<storage,read> neighbors:array<u32>;
@group(1) @binding(3) var<storage,read> flowIn:array<f32>;
@group(1) @binding(4) var<storage,read_write> flowOut:array<f32>;
const NONE:u32=0xffffffffu;

// A coarse shared sphere is initialized from the same seeded procedural field
// as the visible terrain. No photographic or prebaked height map is used.
@compute @workgroup_size(64)
fn initialize(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=WORLD_COUNT){return;}
 let p=directions[i];let h=terrainShape(p.xyz,frame.counts.z,0.0).x;
 let latitude=abs(p.y);let rainNoise=noise3(p.xyz*3.7+vec3<f32>(7.0,2.0,19.0),frame.counts.z+887u);
 let rain=clamp(.72+.23*rainNoise+.18*cos(latitude*5.4),.2,1.3)*p.w;
 world.cells[i].profile=vec4<f32>(h,h,0.0,0.0);world.cells[i].route=vec4<u32>(NONE,0u,0u,0u);world.cells[i].process=vec4<f32>(0.0,0.0,rain,0.0);
}

// Repeated minimax relaxation fills depressions to the lowest connected spill
// elevation. A tiny gradient through flats makes the drainage graph acyclic.
@compute @workgroup_size(64)
fn initializeFlood(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=WORLD_COUNT){return;}let h=world.cells[i].profile.y;
 flowOut[i]=select(20.0,h,h<=0.0);
}
@compute @workgroup_size(64)
fn flood(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=WORLD_COUNT){return;}let h=world.cells[i].profile.y;
 if(h<=0.0){flowOut[i]=h;return;}var lowest=flowIn[i];
 for(var k=0u;k<8u;k++){let j=neighbors[i*8u+k];if(j!=NONE){lowest=min(lowest,max(h,flowIn[j]+.00001));}}
 flowOut[i]=lowest;
}
@compute @workgroup_size(64)
fn saveFlood(@builtin(global_invocation_id) gid:vec3<u32>){if(gid.x<WORLD_COUNT){world.cells[gid.x].route.y=bitcast<u32>(flowIn[gid.x]);}}

// Route on the filled surface, while erosion uses the actual terrain slope.
@compute @workgroup_size(64)
fn route(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=WORLD_COUNT){return;}
 let h=world.cells[i].profile.y;let filled=bitcast<f32>(world.cells[i].route.y);var best=NONE;var bestSlope=0.0;var terrainSlope=0.0;
 if(h>0.0){
  for(var k=0u;k<8u;k++){
   let j=neighbors[i*8u+k];if(j==NONE){continue;}
   let drop=filled-bitcast<f32>(world.cells[j].route.y);
   let distance=max(.001,length(directions[i].xyz-directions[j].xyz)*frame.settings.x);
   let slope=drop/distance;
   if(slope>bestSlope){bestSlope=slope;best=j;terrainSlope=max(0.0,h-world.cells[j].profile.y)/distance;}
  }
 }
 world.cells[i].route.x=best;world.cells[i].process.w=terrainSlope;
}
@compute @workgroup_size(64)
fn clearFlow(@builtin(global_invocation_id) gid:vec3<u32>){if(gid.x<WORLD_COUNT){flowOut[gid.x]=0.0;}}

// Gather rather than scatter so every iteration has deterministic writes.
// Each dispatch propagates rainfall one edge farther downstream.
@compute @workgroup_size(64)
fn runoff(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=WORLD_COUNT){return;}
 var amount=select(0.0,world.cells[i].process.z,world.cells[i].profile.y>0.0);
 for(var k=0u;k<8u;k++){let j=neighbors[i*8u+k];if(j!=NONE && world.cells[j].route.x==i){amount+=flowIn[j];}}
 flowOut[i]=amount;
}

// A bounded stream-power step removes material in proportion to catchment
// discharge and slope. Coefficients are artistic, not calibrated geophysics.
@compute @workgroup_size(64)
fn prepareSediment(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=WORLD_COUNT){return;}
 let h=world.cells[i].profile.y;let down=world.cells[i].route.x;let slope=world.cells[i].process.w;let discharge=max(0.0,flowIn[i]);
 var erosion=0.0;var fraction=0.0;
 if(h>0.0){
  if(down==NONE){fraction=1.0;}
  else{
   let drop=max(0.0,h-world.cells[down].profile.y);
   erosion=min(.12,min(drop*.30,min(h*.20,.8*sqrt(discharge)*slope)));
   fraction=.04+.24*(1.0-smoothstep(.002,.04,slope));
  }
 }
 world.cells[i].profile.z=discharge;world.cells[i].process.x=erosion;world.cells[i].process.y=fraction;
}

// Eroded material is carried through the same graph, with a slope-dependent
// fraction settling at each land node. Ocean outlets export remaining load.
@compute @workgroup_size(64)
fn sediment(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=WORLD_COUNT){return;}
 var load=world.cells[i].process.x;
 for(var k=0u;k<8u;k++){let j=neighbors[i*8u+k];if(j!=NONE && world.cells[j].route.x==i){load+=flowIn[j]*(1.0-world.cells[j].process.y);}}
 flowOut[i]=load;
}
@compute @workgroup_size(64)
fn applySediment(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=WORLD_COUNT){return;}
 let h=world.cells[i].profile.y;let deposition=select(0.0,min(.12,max(0.0,flowIn[i])*world.cells[i].process.y),h>0.0);
 world.cells[i].profile.y=clamp(h-world.cells[i].process.x+deposition,-8.0,9.0);world.cells[i].profile.w+=deposition;
}
@compute @workgroup_size(64)
fn finish(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=WORLD_COUNT){return;}var main=NONE;var largest=0.0;
 for(var k=0u;k<8u;k++){let j=neighbors[i*8u+k];if(j!=NONE && world.cells[j].route.x==i && flowIn[j]>largest){largest=flowIn[j];main=j;}}
 world.cells[i].profile.z=max(0.0,flowIn[i]);world.cells[i].route.z=main;
 world.cells[i].route.w=bitcast<u32>(noise3(directions[i].xyz*640.0,frame.counts.z+997u));
}
@compute @workgroup_size(64)
fn markRiverPresence(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=WORLD_COUNT){return;}var found=world.cells[i].route.x!=NONE && world.cells[i].profile.z>=1.5;
 for(var k=0u;k<8u;k++){let j=neighbors[i*8u+k];if(j!=NONE && world.cells[j].route.x!=NONE && world.cells[j].profile.z>=1.5){found=true;}}
 world.riverPresence[i]=select(0u,1u,found);
}
// Cache a short polyline for each active graph edge once per seed. Vertex and
// fragment shading then reuse the same meandering path without re-evaluating
// the full spline and noise at every screen pixel.
@compute @workgroup_size(64)
fn buildRiverPaths(@builtin(global_invocation_id) gid:vec3<u32>){
 let index=gid.x;if(index>=WORLD_COUNT*RIVER_SAMPLES){return;}
 let i=index/RIVER_SAMPLES;let sample=index%RIVER_SAMPLES;let cell=world.cells[i];let end=cell.route.x;
 if(end==NONE || cell.profile.z<1.5){world.paths[index]=vec4<f32>(0.0);return;}
 let a=directions[i].xyz;let b=directions[end].xyz;let segmentLength=length(b-a);
 var previous=a;if(cell.route.z!=NONE){previous=directions[cell.route.z].xyz;}
 var following=b;if(world.cells[end].route.x!=NONE){following=directions[world.cells[end].route.x].xyz;}
 var endPrevious=a;if(world.cells[end].route.z!=NONE){endPrevious=directions[world.cells[end].route.z].xyz;}
 let m0=riverTangent(b-previous,a,segmentLength*.8);let m1=riverTangent(following-endPrevious,b,segmentLength*.8);
 let t=f32(sample)/f32(RIVER_SAMPLES-1u);let curve=normalize(riverCurve(a,b,m0,m1,t));
 let field=noise3(curve*640.0,frame.counts.z+997u);let side=normalize(cross(a,b));
 let bend=field-mix(bitcast<f32>(cell.route.w),bitcast<f32>(world.cells[end].route.w),t);
 let point=normalize(curve+side*(bend*2.4/6371.0));let flow=mix(cell.profile.z,max(cell.profile.z,world.cells[end].profile.z),t);
 // Narrow headwaters and modest changes in width produce channels rather
 // than the uniformly wide bands of the old coarse spline.
 let width=clamp((.035+.045*sqrt(log2(1.0+flow)))*(1.0+.32*field),.025,MAX_RIVER_HALF_WIDTH_KM);
 world.paths[index]=vec4<f32>(point,width);
}

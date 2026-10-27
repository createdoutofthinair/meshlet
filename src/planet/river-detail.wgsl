@group(0) @binding(0) var<uniform> frame:PlanetFrame;
@group(0) @binding(1) var<storage,read> patches:array<Patch>;
@group(0) @binding(3) var<storage,read> queue:array<u32>;
@group(0) @binding(11) var<storage,read_write> riverMasks:array<vec2<f32>>;
const RIVER_GRID:u32=41u;
const RIVER_GRID_COUNT:u32=1681u;
// Cache a denser analytical water-coverage field for every new patch. The
// fragment shader samples this small buffer instead of tracing the river graph.
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let index=gid.x;if(index>=frame.counts.y*RIVER_GRID_COUNT){return;}
 let slot=queue[index/RIVER_GRID_COUNT];let sample=index%RIVER_GRID_COUNT;
 let x=sample%RIVER_GRID;let y=sample/RIVER_GRID;let tile=patches[slot];
 // Two terrain cells of apron on each side, sampled at half-cell spacing.
 let u=((f32(x)-4.0)/32.0-.5)*tile.cube.w;let v=((f32(y)-4.0)/32.0-.5)*tile.cube.w;
 let direction=normalize(tile.cube.xyz+tile.axisU.xyz*u+tile.axisV.xyz*v);
 var water=vec2<f32>(0.0);if(frame.hydrology.x>0.0){let s=worldSample(direction);if(hasRivers(s)){let result=riverAt(direction,s);water=vec2<f32>(result.mask,result.discharge);}}
 riverMasks[slot*RIVER_GRID_COUNT+sample]=water;
}

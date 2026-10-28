struct PlanetFrame {
  viewProjection: mat4x4<f32>,
  planes: array<vec4<f32>,5>,
  sun: vec4<f32>,
  settings: vec4<f32>, // radius km, relief multiplier, ocean 0/1, valley detail
  counts: vec4<u32>, // active patches, new patches, seed, debug flags
  queueCounts: vec4<u32>, // patches whose normals require updating
  hydrology: vec4<f32>, // erosion strength, rivers enabled, regional simulation enabled, reserved
};
struct Patch {
  cube: vec4<f32>, // unnormalized cube-face center, face-space span
  axisU: vec4<f32>,
  axisV: vec4<f32>,
  centerDirection: vec4<f32>, // high part of the spherical center
  centerLow: vec4<f32>, // residual, for sub-meter procedural sampling
  relative: vec4<f32>, // spherical tile center relative to camera, in km
  details: vec4<u32>, // face, level, geometry stitch mask, normal stitch mask
  coarseNeighbors: vec4<u32>, // coarser or same-level neighboring slots, else 0xffffffff
};
struct PlanetVertex { position: vec4<f32>, normal: vec4<f32>, surface: vec4<f32> };
struct HydroCell {
  profile: vec4<f32>, // original height, current height, runoff, deposited sediment
  route: vec4<u32>, // downhill node, or 0xffffffff for an outlet/sink
  process: vec4<f32>, // erosion (then basin floor), deposition fraction (then river bend), rainfall, slope
};
struct HydroStorage {
  cells: array<HydroCell,24578>,
  paths: array<vec4<f32>,417826>,
  riverPresence: array<u32,24578>,
  regionLookup: array<u32,393216>,
  regionValues: array<vec4<f32>,135200>,
};
struct Bound { sphere: vec4<f32> };
const CELLS:u32=16u;
const GRID:u32=21u; // 17 interior vertices plus a two-vertex normal apron
const GRID_COUNT:u32=441u;
const INNER_COUNT:u32=289u;
const MESHLETS_PER_PATCH:u32=16u;
const WORLD_RES:u32=64u;
const WORLD_WIDTH:u32=65u;
const WORLD_COUNT:u32=24578u;
const RIVER_SAMPLES:u32=17u;
const MAX_RIVER_HALF_WIDTH_KM:f32=.28;
const MAX_RIVER_SWAY_KM:f32=9.6;
const LAKE_MIN_DEPTH_KM:f32=.05;
const LAKE_CONNECTION_DEPTH_KM:f32=.001;
const LAKE_SPILL_TOLERANCE_KM:f32=.001;
const LAKE_MAX_FILL_KM:f32=.25;
const REGION_TILES:u32=256u;
const REGION_CELLS:u32=64u;
const REGION_HALO:u32=14u;
const REGION_GRID:u32=93u;
const REGION_GRID_COUNT:u32=8649u;
const REGION_SAMPLE_COUNT:u32=4225u;

struct PlanetFrame {
  viewProjection: mat4x4<f32>,
  planes: array<vec4<f32>,5>,
  sun: vec4<f32>,
  settings: vec4<f32>, // radius km, relief multiplier, ocean 0/1, valley detail
  counts: vec4<u32>, // active patches, new patches, seed, debug flags
  queueCounts: vec4<u32>, // patches whose normals require updating
};
struct Patch {
  cube: vec4<f32>, // unnormalized cube-face center, face-space span
  axisU: vec4<f32>,
  axisV: vec4<f32>,
  centerDirection: vec4<f32>, // high part of the spherical center
  centerLow: vec4<f32>, // residual, for sub-meter procedural sampling
  relative: vec4<f32>, // spherical tile center relative to camera, in km
  details: vec4<u32>, // face, level, geometry stitch mask, normal stitch mask
  coarseNeighbors: vec4<u32>, // slots, or 0xffffffff when not active
};
struct PlanetVertex { position: vec4<f32>, normal: vec4<f32> };
struct Bound { sphere: vec4<f32> };
const CELLS:u32=16u;
const GRID:u32=21u; // 17 interior vertices plus a two-vertex normal apron
const GRID_COUNT:u32=441u;
const INNER_COUNT:u32=289u;
const MESHLETS_PER_PATCH:u32=16u;

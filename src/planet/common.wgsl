struct PlanetFrame {
  viewProjection: mat4x4<f32>,
  planes: array<vec4<f32>,5>,
  sun: vec4<f32>,
  settings: vec4<f32>, // radius km, relief multiplier, ocean 0/1, reserved
  counts: vec4<u32>, // active patches, new patches, seed, debug flags
};
struct Patch {
  cube: vec4<f32>, // unnormalized cube-face center, face-space span
  axisU: vec4<f32>,
  axisV: vec4<f32>,
  centerDirection: vec4<f32>,
  relative: vec4<f32>, // spherical tile center relative to camera, in km
  details: vec4<u32>, // face, level, stitch mask, reserved
};
struct PlanetVertex { position: vec4<f32>, normal: vec4<f32> };
struct Bound { sphere: vec4<f32> };
const CELLS:u32=16u;
const GRID:u32=19u; // 17 interior vertices plus a one-vertex normal apron
const GRID_COUNT:u32=361u;
const INNER_COUNT:u32=289u;
const MESHLETS_PER_PATCH:u32=16u;

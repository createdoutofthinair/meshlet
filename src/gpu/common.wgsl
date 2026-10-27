struct Frame {
  viewProjection: mat4x4<f32>,
  planes: array<vec4<f32>, 6>,
  eye: vec4<f32>,
  scene: vec4<u32>, // grid width, meshlets per object, candidates, flags
  settings: vec4<f32>, // spacing, color mode, framebuffer height, reserved
  debug: vec4<u32>, // visible-list stride, vertex-grid width, projected object (or all), reserved
};
struct Meshlet {
  sphere: vec4<f32>,
  firstHigh: u32,
  firstMedium: u32,
  firstLow: u32,
  padding: u32,
};
fn objectPosition(id: u32, grid: u32, spacing: f32) -> vec3<f32> {
  let middle = (f32(grid) - 1.0) * 0.5;
  let x = f32(id % grid) - middle;
  let z = f32(id / grid) - middle;
  let jitterX = (f32((id * 73u + 13u) % 101u) / 100.0 - 0.5) * 0.35;
  let jitterZ = (f32((id * 37u + 29u) % 103u) / 102.0 - 0.5) * 0.35;
  return vec3<f32>((x+jitterX)*spacing, 0.0, (z+jitterZ)*spacing);
}
fn objectScale(id: u32) -> f32 { return 0.78 + f32((id * 47u + 23u) % 97u) / 300.0; }
fn rotateObject(p: vec3<f32>, id: u32) -> vec3<f32> {
  let angle = f32((id * 17u) % 32u) * 0.19634954;
  let c = cos(angle); let s = sin(angle);
  return vec3<f32>(c*p.x+s*p.z, p.y, -s*p.x+c*p.z);
}
fn lodColor(lod: u32) -> vec3<f32> {
  if(lod==0u) { return vec3<f32>(0.14,0.79,0.88); }
  if(lod==1u) { return vec3<f32>(0.95,0.68,0.19); }
  return vec3<f32>(0.88,0.31,0.70);
}

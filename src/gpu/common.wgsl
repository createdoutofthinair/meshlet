struct Frame {
  viewProjection: mat4x4<f32>,
  planes: array<vec4<f32>, 6>,
  eye: vec4<f32>,
  scene: vec4<u32>, // grid width, meshlets per object, candidate count, culling enabled
  settings: vec4<f32>, // spacing, color mode, reserved, reserved
};
struct Meshlet {
  sphere: vec4<f32>,
  firstIndex: u32,
  triangleCount: u32,
  padding0: u32,
  padding1: u32,
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

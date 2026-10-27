@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> meshlets: array<Meshlet>;
@group(0) @binding(2) var<storage, read_write> visible: array<u32>;
struct Indirect { vertexCount: u32, instanceCount: atomic<u32>, firstVertex: u32, firstInstance: u32 };
@group(0) @binding(3) var<storage, read_write> indirect: Indirect;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let candidate=invocation.x;
  if (candidate >= frame.scene.z) { return; }
  let meshletId=candidate % frame.scene.y;
  let objectId=candidate / frame.scene.y;
  let sphere=meshlets[meshletId].sphere;
  let scale=objectScale(objectId);
  let center=rotateObject(sphere.xyz*scale,objectId)+objectPosition(objectId,frame.scene.x,frame.settings.x);
  let radius=sphere.w*scale;
  if (frame.scene.w != 0u) {
    for(var p=0u;p<6u;p++) {
      let plane=frame.planes[p];
      if (dot(plane.xyz,center)+plane.w < -radius) { return; }
    }
  }
  let slot=atomicAdd(&indirect.instanceCount,1u);
  visible[slot]=candidate;
}

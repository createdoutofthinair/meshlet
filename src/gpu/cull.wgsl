@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> meshlets: array<Meshlet>;
@group(0) @binding(2) var<storage, read_write> visible: array<u32>;
struct Indirect { vertexCount: u32, instanceCount: atomic<u32>, firstVertex: u32, firstInstance: u32 };
@group(0) @binding(3) var<storage, read_write> indirect: array<Indirect,3>;

fn chooseLod(objectId: u32) -> u32 {
  let mode=(frame.scene.w >> 3u) & 3u;
  if(mode != 0u) { return mode-1u; }
  // Select once per object, not separately per patch, so neighboring patches
  // use identical edge tessellation. 1.18 bounds the procedural surface.
  let objectCenter=objectPosition(objectId,frame.scene.x,frame.settings.x);
  let clip=frame.viewProjection*vec4<f32>(objectCenter,1.0);
  let focalScale=length(vec3<f32>(frame.viewProjection[0].y,frame.viewProjection[1].y,frame.viewProjection[2].y));
  let projectedDiameter=frame.settings.z*focalScale*1.18*objectScale(objectId)/max(clip.w,0.001);
  if(projectedDiameter >= 140.0) { return 0u; }
  if(projectedDiameter >= 65.0) { return 1u; }
  return 2u;
}
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
  if ((frame.scene.w & 1u) != 0u) {
    for(var p=0u;p<6u;p++) {
      let plane=frame.planes[p];
      if (dot(plane.xyz,center)+plane.w < -radius) { return; }
    }
  }
  let lod=chooseLod(objectId);
  let slot=atomicAdd(&indirect[lod].instanceCount,1u);
  visible[lod*frame.debug.x+slot]=(candidate << 2u)|lod;
}

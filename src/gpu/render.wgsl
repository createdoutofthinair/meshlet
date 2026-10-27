struct Vertex { position: vec4<f32>, normal: vec4<f32> };
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> meshlets: array<Meshlet>;
@group(0) @binding(2) var<storage, read> visible: array<u32>;
@group(0) @binding(3) var<storage, read> vertices: array<Vertex>;
@group(0) @binding(4) var<storage, read> indices: array<u32>;
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) worldNormal: vec3<f32>,
  @location(1) worldPosition: vec3<f32>,
  @location(2) @interpolate(flat) objectId: u32,
  @location(3) @interpolate(flat) meshletId: u32,
};
@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  let candidate=visible[instanceIndex];
  let meshletId=candidate % frame.scene.y;
  let objectId=candidate / frame.scene.y;
  let meshlet=meshlets[meshletId];
  var out: VertexOut;
  if(vertexIndex >= meshlet.triangleCount*3u) {
    out.position=vec4<f32>(0.0,0.0,0.0,1.0);
    out.worldNormal=vec3<f32>(0.0,1.0,0.0); out.worldPosition=vec3<f32>(0.0);
    out.objectId=objectId; out.meshletId=meshletId; return out;
  }
  let vert=vertices[indices[meshlet.firstIndex+vertexIndex]];
  let position=rotateObject(vert.position.xyz*objectScale(objectId),objectId)+objectPosition(objectId,frame.scene.x,frame.settings.x);
  out.position=frame.viewProjection*vec4<f32>(position,1.0);
  out.worldNormal=rotateObject(vert.normal.xyz,objectId);
  out.worldPosition=position;
  out.objectId=objectId; out.meshletId=meshletId;
  return out;
}
fn hue(id: u32) -> vec3<f32> {
  let a=f32((id*73u+19u)%251u)/250.0;
  let b=f32((id*31u+7u)%239u)/238.0;
  return mix(vec3<f32>(0.16,0.52,0.55),vec3<f32>(0.91,0.47,0.19),a)*(.7+.3*b);
}
@fragment
fn fs(in: VertexOut) -> @location(0) vec4<f32> {
  let n=normalize(in.worldNormal);
  let light=normalize(vec3<f32>(0.5,0.85,0.25));
  let view=normalize(frame.eye.xyz-in.worldPosition);
  let diffuse=max(dot(n,light),0.0);
  let fill=max(dot(n,normalize(vec3<f32>(-0.7,0.2,-0.6))),0.0);
  let spec=pow(max(dot(n,normalize(light+view)),0.0),35.0)*0.32;
  var base=mix(vec3<f32>(0.27,0.32,0.35),vec3<f32>(0.53,0.57,0.55),f32((in.objectId*29u)%97u)/97.0);
  if(frame.settings.y > 0.5) { base=hue(in.meshletId); }
  let color=base*(0.18+0.78*diffuse+0.18*fill)+vec3<f32>(1.0,0.88,0.72)*spec;
  return vec4<f32>(pow(color,vec3<f32>(1.0/2.2)),1.0);
}

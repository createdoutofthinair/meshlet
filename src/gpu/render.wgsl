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
  @location(4) @interpolate(flat) lod: u32,
  @location(5) @interpolate(linear) barycentric: vec3<f32>,
  @location(6) @interpolate(flat) edgeMask: u32,
};
fn isBoundary(a: u32, b: u32, x0: u32, y0: u32, width: u32) -> bool {
  let ax=a%width; let ay=a/width; let bx=b%width; let by=b/width;
  return (ax==bx && (ax==x0 || ax==x0+6u)) || (ay==by && (ay==y0 || ay==y0+6u));
}
@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  let item=visible[instanceIndex];
  let candidate=item >> 2u;
  let lod=item & 3u;
  let meshletId=candidate % frame.scene.y;
  let objectId=candidate / frame.scene.y;
  let meshlet=meshlets[meshletId];
  var first=meshlet.firstHigh;
  if(lod==1u) { first=meshlet.firstMedium; } else if(lod==2u) { first=meshlet.firstLow; }
  let vert=vertices[indices[first+vertexIndex]];
  let position=rotateObject(vert.position.xyz*objectScale(objectId),objectId)+objectPosition(objectId,frame.scene.x,frame.settings.x);
  var mask=0u;
  var bary=vec3<f32>(0.0,0.0,1.0);
  if((frame.scene.w & 6u)!=0u) {
    if(vertexIndex%3u==0u) { bary=vec3<f32>(1.0,0.0,0.0); }
    else if(vertexIndex%3u==1u) { bary=vec3<f32>(0.0,1.0,0.0); }
    if((frame.scene.w & 2u)!=0u) {
      let triangleBase=first+(vertexIndex/3u)*3u;
      let a=indices[triangleBase]; let b=indices[triangleBase+1u]; let c=indices[triangleBase+2u];
      let width=frame.debug.y; let columns=(width-1u)/6u;
      let x0=(meshletId%columns)*6u; let y0=(meshletId/columns)*6u;
      if(isBoundary(b,c,x0,y0,width)) { mask=mask|1u; }
      if(isBoundary(c,a,x0,y0,width)) { mask=mask|2u; }
      if(isBoundary(a,b,x0,y0,width)) { mask=mask|4u; }
    }
  }
  var out: VertexOut;
  out.position=frame.viewProjection*vec4<f32>(position,1.0);
  out.worldNormal=rotateObject(vert.normal.xyz,objectId);out.worldPosition=position;
  out.objectId=objectId;out.meshletId=meshletId;out.lod=lod;out.barycentric=bary;out.edgeMask=mask;
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
  if(frame.settings.y > 1.5) { base=lodColor(in.lod); }
  else if(frame.settings.y > 0.5) { base=hue(in.meshletId); }
  var color=pow(base*(0.18+0.78*diffuse+0.18*fill)+vec3<f32>(1.0,0.88,0.72)*spec,vec3<f32>(1.0/2.2));
  // Derivatives remain in uniform control flow; each component identifies the
  // opposite edge. A flat mask distinguishes patch borders from triangle edges.
  if((frame.scene.w & 6u)!=0u) {
    let edge=vec3<f32>(1.0)-smoothstep(vec3<f32>(0.65),vec3<f32>(1.8),in.barycentric/max(fwidth(in.barycentric),vec3<f32>(0.00001)));
    if((frame.scene.w & 4u)!=0u) { color=mix(color,vec3<f32>(0.04,0.07,0.08),max(edge.x,max(edge.y,edge.z))*0.82); }
    if((frame.scene.w & 2u)!=0u) {
      var boundary=0.0;
      if((in.edgeMask & 1u)!=0u) { boundary=max(boundary,edge.x); }
      if((in.edgeMask & 2u)!=0u) { boundary=max(boundary,edge.y); }
      if((in.edgeMask & 4u)!=0u) { boundary=max(boundary,edge.z); }
      color=mix(color,vec3<f32>(0.96,0.98,0.94),boundary*0.95);
    }
  }
  return vec4<f32>(color,1.0);
}

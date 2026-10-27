@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> meshlets: array<Meshlet>;
@group(0) @binding(2) var<storage, read> visible: array<u32>;
struct Output { @builtin(position) position: vec4<f32>, @location(0) @interpolate(flat) lod: u32 };
fn range(n: f32, ne: f32, w: f32, we: f32) -> vec2<f32> {
 let a=(n-ne)/(w-we); let b=(n-ne)/(w+we);
 let c=(n+ne)/(w-we); let d=(n+ne)/(w+we);
 return clamp(vec2<f32>(min(min(a,b),min(c,d)),max(max(a,b),max(c,d))),vec2<f32>(-1.0),vec2<f32>(1.0));
}
@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32,@builtin(instance_index) instanceIndex: u32) -> Output {
 let item=visible[instanceIndex];let candidate=item>>2u;let lod=item&3u;
 let meshletId=candidate%frame.scene.y;let objectId=candidate/frame.scene.y;
 var out:Output;out.lod=lod;
 if(frame.debug.z!=0xffffffffu && objectId!=frame.debug.z) { out.position=vec4<f32>(2.0,2.0,0.0,1.0);return out; }
 let sphere=meshlets[meshletId].sphere;let scale=objectScale(objectId);
 let center=rotateObject(sphere.xyz*scale,objectId)+objectPosition(objectId,frame.scene.x,frame.settings.x);
 let radius=sphere.w*scale;let clip=frame.viewProjection*vec4<f32>(center,1.0);
 let extent=radius*vec3<f32>(length(vec3<f32>(frame.viewProjection[0].x,frame.viewProjection[1].x,frame.viewProjection[2].x)),length(vec3<f32>(frame.viewProjection[0].y,frame.viewProjection[1].y,frame.viewProjection[2].y)),length(vec3<f32>(frame.viewProjection[0].w,frame.viewProjection[1].w,frame.viewProjection[2].w)));
 var xr=vec2<f32>(-1.0,1.0);var yr=vec2<f32>(-1.0,1.0);
 if(clip.w>extent.z+0.001) { xr=range(clip.x,extent.x,clip.w,extent.z);yr=range(clip.y,extent.y,clip.w,extent.z); }
 let points=array<vec2<f32>,8>(vec2<f32>(xr.x,yr.x),vec2<f32>(xr.y,yr.x),vec2<f32>(xr.y,yr.x),vec2<f32>(xr.y,yr.y),vec2<f32>(xr.y,yr.y),vec2<f32>(xr.x,yr.y),vec2<f32>(xr.x,yr.y),vec2<f32>(xr.x,yr.x));
 out.position=vec4<f32>(points[vertexIndex],0.0,1.0);return out;
}
@fragment
fn fs(in: Output) -> @location(0) vec4<f32> { return vec4<f32>(lodColor(in.lod),0.55); }

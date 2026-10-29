struct Params{view:mat4x4<f32>,eye:vec4<f32>,settings:vec4<f32>};
@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var<uniform> params:Params;
struct Screen{@builtin(position) pos:vec4<f32>,@location(0) uv:vec2<f32>};
@vertex fn screen(@builtin(vertex_index) i:u32)->Screen{
 let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));return Screen(vec4<f32>(p[i],0.0,1.0),p[i]);
}
fn depthAt(pixel:vec2<i32>)->f32{return textureLoad(source,clamp(pixel,vec2<i32>(0),vec2<i32>(textureDimensions(source))-vec2<i32>(1)),0).x;}
@fragment fn smoothDepth(input:Screen)->@location(0) f32{
 let p=vec2<i32>(input.pos.xy);let center=depthAt(p);if(center<=0.0){return 0.0;}
 var weighted=0.0;var total=0.0;
 for(var y=-2;y<=2;y++){for(var x=-2;x<=2;x++){
  let sample=depthAt(p+vec2<i32>(x,y));if(sample<=0.0){continue;}
  let spatial=exp(-f32(x*x+y*y)*.25);let range=exp(-abs(sample-center)*15.0);let weight=spatial*range;
  weighted+=sample*weight;total+=weight;
 }}return weighted/max(total,.00001);
}
fn sky(ray:vec3<f32>)->vec3<f32>{
 let t=clamp(ray.y*.5+.5,0.0,1.0);return mix(vec3<f32>(.20,.26,.27),vec3<f32>(.53,.69,.74),t);
}
fn background(ray:vec3<f32>)->vec3<f32>{
 let eye=params.eye.xyz;if(ray.y<-.001){let t= -eye.y/ray.y;if(t>0.0){let hit=eye+ray*t;if(abs(hit.x)<2.0&&abs(hit.z)<1.5){let tile=floor(hit.x*3.0)+floor(hit.z*3.0);let checker=select(.14,.23,fract(tile*.5)>.25);return vec3<f32>(checker,checker*1.05,checker*1.04);}}}return sky(ray);
}
@fragment fn composite(input:Screen)->@location(0) vec4<f32>{
 let size=vec2<f32>(textureDimensions(source));let pixel=vec2<i32>(input.pos.xy);let depth=depthAt(pixel);
 let forward=normalize(vec3<f32>(0.0,1.0,0.0)-params.eye.xyz);let right=normalize(cross(forward,vec3<f32>(0.0,1.0,0.0)));let up=normalize(cross(right,forward));
 let ndc=vec2<f32>(input.pos.x/size.x*2.0-1.0,1.0-input.pos.y/size.y*2.0);let ray=normalize(forward+right*ndc.x*(size.x/size.y)*.57735027+up*ndc.y*.57735027);
 if(depth<=0.0){return vec4<f32>(background(ray),1.0);}
 let left=depthAt(pixel+vec2<i32>(-1,0));let rightDepth=depthAt(pixel+vec2<i32>(1,0));let below=depthAt(pixel+vec2<i32>(0,1));let above=depthAt(pixel+vec2<i32>(0,-1));
 let dx=select(0.0,(rightDepth-left)*.5,left>0.0&&rightDepth>0.0);let dy=select(0.0,(below-above)*.5,below>0.0&&above>0.0);
 let pixelSize=max(.0001,depth*1.1547005/size.y);let normal=normalize(-ray-right*dx/pixelSize+up*dy/pixelSize);
 let cosView=clamp(dot(normal,-ray),0.0,1.0);let fresnel=.0204+.9796*pow(1.0-cosView,5.0);
 let reflected=sky(reflect(ray,normal));let refracted=refract(ray,normal,1.0/1.333);let transmitted=background(refracted)*vec3<f32>(.70,.89,.91)+vec3<f32>(.012,.045,.045);
 let light=normalize(vec3<f32>(-.4,.8,.5));let halfVector=normalize(light-ray);let highlight=pow(max(dot(normal,halfVector),0.0),130.0)*1.2;
 let color=mix(transmitted,reflected,fresnel)+vec3<f32>(1.0,.95,.87)*highlight;return vec4<f32>(color,1.0);
}

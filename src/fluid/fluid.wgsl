struct Params{view:mat4x4<f32>,eye:vec4<f32>,settings:vec4<f32>};
struct Particle{position:vec4<f32>,velocity:vec4<f32>};
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> particles:array<Particle>;
@group(0) @binding(2) var<storage,read_write> next:array<Particle>;
@group(0) @binding(3) var<storage,read_write> densities:array<f32>;
const COUNT:u32=1000u;
const H:f32=.23;
@compute @workgroup_size(64) fn density(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=COUNT){return;}let p=particles[i].position.xyz;var rho=0.0;
 for(var j=0u;j<COUNT;j++){let d=length(p-particles[j].position.xyz);if(d<H){let q=1.0-d*d/(H*H);rho+=q*q*q;}}
 densities[i]=max(rho,.01);
}
@compute @workgroup_size(64) fn integrate(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=COUNT){return;}let item=particles[i];let p=item.position.xyz;let v=item.velocity.xyz;let rho=densities[i];var accel=vec3<f32>(0.0,-params.settings.y,0.0);
 let pressure=max(0.0,rho-2.6)*10.0;
 for(var j=0u;j<COUNT;j++){
  if(i==j){continue;}let other=particles[j];let delta=p-other.position.xyz;let d=length(delta);
  if(d<H && d>.00001){let q=1.0-d/H;let otherRho=densities[j];let otherPressure=max(0.0,otherRho-2.6)*10.0;
   accel+=normalize(delta)*(pressure+otherPressure)*q*q/max(1.0,otherRho)*.45;
   accel+=(other.velocity.xyz-v)*q*params.settings.z/max(1.0,otherRho)*2.0;
  }
 }
 let dt=params.settings.x;var velocity=(v+clamp(accel,vec3<f32>(-80.0),vec3<f32>(80.0))*dt)*.999;
 var position=p+velocity*dt;let lo=vec3<f32>(-1.25,.075,-.75);let hi=vec3<f32>(1.25,2.1,.75);
 for(var axis=0u;axis<3u;axis++){if(position[axis]<lo[axis]){position[axis]=lo[axis];velocity[axis]=abs(velocity[axis])*.25;}if(position[axis]>hi[axis]){position[axis]=hi[axis];velocity[axis]= -abs(velocity[axis])*.25;}}
 next[i]=Particle(vec4<f32>(position,1.0),vec4<f32>(velocity,0.0));
}
struct Out{@builtin(position) pos:vec4<f32>,@location(0) uv:vec2<f32>,@location(1) world:vec3<f32>};
@vertex fn vertex(@builtin(vertex_index) index:u32,@builtin(instance_index) instance:u32)->Out{
 let corners=array<vec2<f32>,6>(vec2<f32>(-1.0,-1.0),vec2<f32>(1.0,-1.0),vec2<f32>(-1.0,1.0),vec2<f32>(-1.0,1.0),vec2<f32>(1.0,-1.0),vec2<f32>(1.0,1.0));
 let uv=corners[index];let p=particles[instance].position.xyz;let forward=normalize(params.eye.xyz);let right=normalize(cross(vec3<f32>(0.0,1.0,0.0),forward));let up=normalize(cross(forward,right));
 let world=p+(right*uv.x+up*uv.y)*.09;return Out(params.view*vec4<f32>(world,1.0),uv,p);
}
@fragment fn fragment(input:Out)->@location(0) vec4<f32>{
 let r=dot(input.uv,input.uv);if(r>1.0){discard;}let z=sqrt(max(0.0,1.0-r));let view=normalize(params.eye.xyz-input.world);
 let right=normalize(cross(vec3<f32>(0.0,1.0,0.0),view));let up=normalize(cross(view,right));let n=normalize(right*input.uv.x+up*input.uv.y+view*z);
 let light=normalize(vec3<f32>(-.4,.8,.5));let diffuse=max(dot(n,light),0.0);let spec=pow(max(dot(n,normalize(light+view)),0.0),70.0);let fresnel=pow(1.0-max(dot(n,view),0.0),5.0);
 return vec4<f32>(vec3<f32>(.035,.20,.23)*(.5+diffuse*.75)+vec3<f32>(.86,.95,1.0)*spec*.9+vec3<f32>(.18,.29,.3)*fresnel,1.0);
}

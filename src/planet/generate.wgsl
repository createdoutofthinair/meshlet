const HEIGHT_LIMIT:f32=10.0;
@group(0) @binding(0) var<uniform> frame: PlanetFrame;
@group(0) @binding(1) var<storage,read> patches: array<Patch>;
@group(0) @binding(2) var<storage,read_write> vertices: array<PlanetVertex>;
@group(0) @binding(3) var<storage,read> queue: array<u32>;
@group(0) @binding(4) var<storage,read> plates: array<vec4<f32>>;
fn hash3(p: vec3<i32>, seed:u32) -> f32 {
 var h=(bitcast<u32>(p.x)*0x8da6b343u) ^ (bitcast<u32>(p.y)*0xd8163841u) ^ (bitcast<u32>(p.z)*0xcb1ab31fu) ^ seed;
 h=(h^(h>>16u))*0x7feb352du;h=(h^(h>>15u))*0x846ca68bu;h=h^(h>>16u);
 return f32(h & 0x00ffffffu)*(2.0/16777215.0)-1.0;
}
fn cellNoise(cell:vec3<i32>, x:vec3<f32>, seed:u32)->f32 {
 let f=x*x*(vec3<f32>(3.0)-2.0*x);
 let a=mix(hash3(cell+vec3<i32>(0,0,0),seed),hash3(cell+vec3<i32>(1,0,0),seed),f.x);
 let b=mix(hash3(cell+vec3<i32>(0,1,0),seed),hash3(cell+vec3<i32>(1,1,0),seed),f.x);
 let c=mix(hash3(cell+vec3<i32>(0,0,1),seed),hash3(cell+vec3<i32>(1,0,1),seed),f.x);
 let d=mix(hash3(cell+vec3<i32>(0,1,1),seed),hash3(cell+vec3<i32>(1,1,1),seed),f.x);
 return mix(mix(a,b,f.y),mix(c,d,f.y),f.z);
}
fn noise3(p:vec3<f32>, seed:u32)->f32 {
 return cellNoise(vec3<i32>(floor(p)),fract(p),seed);
}
// Keep the high and low parts separate through the lattice lookup. Adding
// them to a unit vector first would round away the sub-meter offsets.
fn localNoise(high:vec3<f32>,low:vec3<f32>,delta:vec3<f32>,frequency:f32,seed:u32)->f32 {
 let scaled=high*frequency;
 let residual=fract(scaled)+(low+delta)*frequency;
 let cell=vec3<i32>(floor(scaled))+vec3<i32>(floor(residual));
 return cellNoise(cell,fract(residual),seed);
}
fn terrain(direction:vec3<f32>,seed:u32)->f32 {
 // Low-frequency warp and continents provide geological structure; ridges
 // only amplify selected land and plate-boundary regions, not the whole globe.
 let warp=vec3<f32>(noise3(direction*2.1,seed+11u),noise3(direction*2.1+vec3<f32>(17.0,3.0,9.0),seed+19u),noise3(direction*2.1+vec3<f32>(5.0,23.0,2.0),seed+29u));
 let d=normalize(direction+warp*.19);
 var first=-2.0;var second=-2.0;var biasA=0.0;var biasB=0.0;
 for(var i=0u;i<16u;i++) {
  let p=plates[i];let value=dot(d,p.xyz);
  if(value>first){second=first;biasB=biasA;first=value;biasA=p.w;}
  else if(value>second){second=value;biasB=p.w;}
 }
 let boundary=1.0-smoothstep(.015,.17,first-second);
 let bias=mix(biasB,biasA,.5+.5*smoothstep(0.0,.18,first-second));
 let continent=noise3(d*2.5,seed+31u)*.58+noise3(d*5.4,seed+37u)*.29+noise3(d*11.7,seed+41u)*.13+bias*.24+.035;
 let land=smoothstep(-.15,.13,continent);
 let plain=.16+max(0.0,continent)*1.5+noise3(d*28.0,seed+43u)*.20;
 let basin=-3.7+noise3(d*16.0,seed+47u)*.55;
 let warpDetail=warp*.45;
 var ridges=0.0;var amplitude=.56;var freq=14.0;
 for(var i=0u;i<4u;i++){
  let r=1.0-min(1.0,abs(noise3(d*freq+warpDetail,seed+53u+i*23u))*2.3);
  ridges+=r*r*amplitude;freq*=2.23;amplitude*=.50;
 }
 let mountainZone=clamp(boundary*.82+smoothstep(.08,.35,continent)*.34,0.0,1.0);
 let mountains=land*mountainZone*pow(max(0.0,ridges),1.25)*7.5;
 // Small, bounded terrain-detail bands. These are erosion-inspired noise,
 // not a hydraulic simulation; the land mask prevents ocean-wide ridges.
 let roughness=land*mountainZone;
 var fine=0.0;var fineWeight=1.0;var fineFrequency=640.0;var fineAmplitude=1.0;
 for(var i=0u;i<6u;i++){
  let r=1.0-min(1.0,abs(noise3(d*fineFrequency+warpDetail,seed+151u+i*23u))*2.2);
  fine+=(r*r-.22)*fineAmplitude*fineWeight;
  // The amplitude must fall faster than frequency rises. Otherwise the
  // smallest octaves create taller-than-wide spikes as the camera approaches.
  fineWeight=clamp(r*1.6,.25,1.0);fineFrequency*=3.7;fineAmplitude*=.26;
 }
 let coords=vec3<f32>(dot(d,plates[0].xyz)*2100.0,dot(d,plates[1].xyz)*480.0,dot(d,plates[2].xyz)*125.0);
 let fold=1.0-min(1.0,abs(noise3(coords+warpDetail,seed+277u))*2.0);
 let directional=(fold*fold-.25)*.38*roughness;
 let plainsDetail=noise3(d*900.0,seed+311u)*.035+noise3(d*5000.0,seed+313u)*.008;
 return clamp(mix(basin,plain,land)+mountains+roughness*fine+directional+plainsDetail*land,-8.0,9.0);
}
fn detailedTerrain(direction:vec3<f32>,high:vec3<f32>,low:vec3<f32>,delta:vec3<f32>,seed:u32)->f32 {
 let base=terrain(direction,seed);
 // Independent, seeded bands produce real vertex relief from tens of meters
 // down to sub-meter scales. Their low amplitudes preserve the landforms.
 let micro=localNoise(high,low,delta,131072.0,seed+401u)*.0025
          +localNoise(high,low,delta,524288.0,seed+409u)*.00065
          +localNoise(high,low,delta,2097152.0,seed+419u)*.00018
          +localNoise(high,low,delta,8388608.0,seed+421u)*.00005;
 return base+micro*smoothstep(-.05,.25,base);
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>) {
 let index=gid.x;if(index>=frame.counts.y*GRID_COUNT){return;}
 let slot=queue[index/GRID_COUNT];let sample=index%GRID_COUNT;
 let x=sample%GRID;let y=sample/GRID;let tile=patches[slot];
 let du=(f32(x)-2.0-f32(CELLS)*.5)*tile.cube.w/f32(CELLS);
 let dv=(f32(y)-2.0-f32(CELLS)*.5)*tile.cube.w/f32(CELLS);
 let center=tile.cube.xyz;let delta=tile.axisU.xyz*du+tile.axisV.xyz*dv;
 let centerLength=length(center);let a=(2.0*dot(center,delta)+dot(delta,delta))/dot(center,center);
 let factor=sqrt(max(.01,1.0+a));let factorMinusOne=a/(factor+1.0);
 let directionDelta=(delta-center*factorMinusOne)/(centerLength*factor);
 let direction=normalize(center+delta);
 let h=clamp(detailedTerrain(direction,tile.centerDirection.xyz,tile.centerLow.xyz,directionDelta,frame.counts.z)*frame.settings.y,-HEIGHT_LIMIT,HEIGHT_LIMIT);
 let surfaceHeight=select(h,max(h,0.0),frame.settings.z>.5);
 vertices[slot*GRID_COUNT+sample].position=vec4<f32>(directionDelta*frame.settings.x+direction*surfaceHeight,h);
}
// Small, explicit readbacks for navigation tools. They are not per-vertex CPU
// generation: both height probing and highland searches evaluate on the GPU.
struct ProbeInput { direction:vec4<f32> };
@group(0) @binding(5) var<storage,read_write> samples:array<vec4<f32>>;
@group(0) @binding(6) var<uniform> probe:ProbeInput;
fn facePoint(face:u32,u:f32,v:f32)->vec3<f32>{
 if(face==0u){return vec3<f32>(1.0,u,v);}if(face==1u){return vec3<f32>(-1.0,u,-v);}
 if(face==2u){return vec3<f32>(u,1.0,-v);}if(face==3u){return vec3<f32>(u,-1.0,v);}
 if(face==4u){return vec3<f32>(u,v,1.0);}return vec3<f32>(-u,v,-1.0);
}
@compute @workgroup_size(64)
fn highlands(@builtin(global_invocation_id) gid:vec3<u32>){
 let n=gid.x;if(n>=6u*24u*24u){return;}
 let face=n/(24u*24u);let k=n%(24u*24u);
 let u=(f32(k%24u)+.5)/24.0*2.0-1.0;let v=(f32(k/24u)+.5)/24.0*2.0-1.0;
 let direction=normalize(facePoint(face,u,v));
 samples[n]=vec4<f32>(direction,clamp(detailedTerrain(direction,direction,vec3<f32>(0.0),vec3<f32>(0.0),frame.counts.z)*frame.settings.y,-HEIGHT_LIMIT,HEIGHT_LIMIT));
}
@compute @workgroup_size(1)
fn point(){
 let direction=normalize(probe.direction.xyz);
 samples[0]=vec4<f32>(direction,clamp(detailedTerrain(direction,direction,vec3<f32>(0.0),vec3<f32>(0.0),frame.counts.z)*frame.settings.y,-HEIGHT_LIMIT,HEIGHT_LIMIT));
}

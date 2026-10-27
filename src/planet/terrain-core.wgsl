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
// Value noise and its analytic derivative in noise-space coordinates. This
// reuses the same lattice values rather than evaluating the terrain repeatedly.
fn noiseGradient(p:vec3<f32>,seed:u32)->vec4<f32>{
 let cell=vec3<i32>(floor(p));let x=fract(p);let f=x*x*(vec3<f32>(3.0)-2.0*x);let df=6.0*x*(vec3<f32>(1.0)-x);
 let h000=hash3(cell,seed);let h100=hash3(cell+vec3<i32>(1,0,0),seed);
 let h010=hash3(cell+vec3<i32>(0,1,0),seed);let h110=hash3(cell+vec3<i32>(1,1,0),seed);
 let h001=hash3(cell+vec3<i32>(0,0,1),seed);let h101=hash3(cell+vec3<i32>(1,0,1),seed);
 let h011=hash3(cell+vec3<i32>(0,1,1),seed);let h111=hash3(cell+vec3<i32>(1,1,1),seed);
 let a=mix(h000,h100,f.x);let b=mix(h010,h110,f.x);let c=mix(h001,h101,f.x);let d=mix(h011,h111,f.x);
 let gx=mix(mix(h100-h000,h110-h010,f.y),mix(h101-h001,h111-h011,f.y),f.z)*df.x;
 let gy=mix(b-a,d-c,f.z)*df.y;let gz=(mix(c,d,f.y)-mix(a,b,f.y))*df.z;
 return vec4<f32>(mix(mix(a,b,f.y),mix(c,d,f.y),f.z),gx,gy,gz);
}
// Average samples along the local slope. The resulting zero contours tend to
// run downhill; nesting two scales makes irregular, branching-looking flutes.
// This is procedural shaping, not an erosion or hydrology simulation.
fn slopeChannel(p:vec3<f32>,down:vec3<f32>,seed:u32)->f32{
 let n=noise3(p,seed)*.25+(noise3(p+down*.8,seed)+noise3(p-down*.8,seed))*.25+(noise3(p+down*1.6,seed)+noise3(p-down*1.6,seed))*.125;
 let channel=1.0-smoothstep(.025,.30,abs(n));return channel*channel;
}
// Keep the high and low parts separate through the lattice lookup. Adding
// them to a unit vector first would round away the sub-meter offsets.
fn localNoise(high:vec3<f32>,low:vec3<f32>,delta:vec3<f32>,frequency:f32,seed:u32)->f32 {
 let scaled=high*frequency;
 let residual=fract(scaled)+(low+delta)*frequency;
 let cell=vec3<i32>(floor(scaled))+vec3<i32>(floor(residual));
 return cellNoise(cell,fract(residual),seed);
}
fn terrainShape(direction:vec3<f32>,seed:u32,valleyStrength:f32)->vec2<f32> {
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
 let mountainZone=clamp(boundary*.82+smoothstep(.08,.35,continent)*.34,0.0,1.0);
 let roughness=land*mountainZone;let valleyEnabled=valleyStrength>0.0 && roughness>.025;
 var ridges=0.0;var ridgeGradient=vec3<f32>(0.0);var amplitude=.56;var freq=14.0;
 for(var i=0u;i<4u;i++){
  let p=d*freq+warpDetail;var n:f32;
  if(valleyEnabled){let sample=noiseGradient(p,seed+53u+i*23u);n=sample.x;
   let r=1.0-min(1.0,abs(n)*2.3);
   if(abs(n)*2.3<1.0){ridgeGradient+=sample.yzw*(-4.6*r*sign(n)*amplitude*freq);}
  }else{n=noise3(p,seed+53u+i*23u);}
  let r=1.0-min(1.0,abs(n)*2.3);
  ridges+=r*r*amplitude;freq*=2.23;amplitude*=.50;
 }
 let mountains=land*mountainZone*pow(max(0.0,ridges),1.25)*7.5;
 // Small, bounded terrain-detail bands. These are erosion-inspired noise,
 // not a hydraulic simulation; the land mask prevents ocean-wide ridges.
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
 let unshaped=mix(basin,plain,land)+mountains+roughness*fine+directional+plainsDetail*land;
 var valleys=0.0;
 if(valleyEnabled){
  let tangent=ridgeGradient-d*dot(ridgeGradient,d);let magnitude=length(tangent);
  let slope=magnitude*roughness*7.5/6371.0;
  if(magnitude>.0001 && slope>.003){
   let down=-tangent/magnitude;
   let primary=slopeChannel(d*1400.0+warpDetail,down,seed+337u);
   let secondary=slopeChannel(d*4300.0+warpDetail,down,seed+349u);
   let mask=roughness*smoothstep(.025,.10,roughness)*smoothstep(.003,.09,slope)*smoothstep(.08,.55,ridges)*smoothstep(.05,.6,unshaped);
   valleys=(primary*.22+secondary*(.25+.75*primary)*.075)*mask*valleyStrength;
  }
 }
 let h=clamp(unshaped-valleys,-8.0,9.0);
 return vec2<f32>(h,max(0.0,clamp(unshaped,-8.0,9.0)-h));
}
fn terrain(direction:vec3<f32>,seed:u32)->f32{return terrainShape(direction,seed,frame.settings.w).x;}

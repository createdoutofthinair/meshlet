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
fn cellNoiseGradient(cell:vec3<i32>,x:vec3<f32>,seed:u32)->vec4<f32>{
 let f=x*x*(vec3<f32>(3.0)-2.0*x);let df=6.0*x*(vec3<f32>(1.0)-x);
 let h000=hash3(cell,seed);let h100=hash3(cell+vec3<i32>(1,0,0),seed);
 let h010=hash3(cell+vec3<i32>(0,1,0),seed);let h110=hash3(cell+vec3<i32>(1,1,0),seed);
 let h001=hash3(cell+vec3<i32>(0,0,1),seed);let h101=hash3(cell+vec3<i32>(1,0,1),seed);
 let h011=hash3(cell+vec3<i32>(0,1,1),seed);let h111=hash3(cell+vec3<i32>(1,1,1),seed);
 let a=mix(h000,h100,f.x);let b=mix(h010,h110,f.x);let c=mix(h001,h101,f.x);let d=mix(h011,h111,f.x);
 let gx=mix(mix(h100-h000,h110-h010,f.y),mix(h101-h001,h111-h011,f.y),f.z)*df.x;
 let gy=mix(b-a,d-c,f.z)*df.y;let gz=(mix(c,d,f.y)-mix(a,b,f.y))*df.z;
 return vec4<f32>(mix(mix(a,b,f.y),mix(c,d,f.y),f.z),gx,gy,gz);
}
fn noiseGradient(p:vec3<f32>,seed:u32)->vec4<f32>{return cellNoiseGradient(vec3<i32>(floor(p)),fract(p),seed);}
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
fn localNoiseGradient(high:vec3<f32>,low:vec3<f32>,delta:vec3<f32>,frequency:f32,seed:u32)->vec4<f32>{
 let scaled=high*frequency;let residual=fract(scaled)+(low+delta)*frequency;
 let cell=vec3<i32>(floor(scaled))+vec3<i32>(floor(residual));
 return cellNoiseGradient(cell,fract(residual),seed);
}
// The warp offsets are whole lattice cells. Adding 17 or 23 to the floating
// coordinate before interpolation discards several bits, causing metre-high
// terraces in otherwise smooth terrain. Shift the integer cell instead.
fn terrainWarpLattice(direction:vec3<f32>,cellShift:vec3<i32>)->TerrainLattice{
 let scaled=direction*2.1;
 let residual=fract(scaled)+fma(direction,vec3<f32>(2.1),-scaled);
 return TerrainLattice(vec3<i32>(floor(scaled))+vec3<i32>(floor(residual))+cellShift,fract(residual));
}
fn terrainWarpNoise(direction:vec3<f32>,cellShift:vec3<i32>,seed:u32)->f32{
 let lattice=terrainWarpLattice(direction,cellShift);
 return cellNoise(lattice.cell,lattice.fraction,seed);
}
fn terrainWarpGradient(direction:vec3<f32>,cellShift:vec3<i32>,seed:u32)->vec4<f32>{
 let lattice=terrainWarpLattice(direction,cellShift);
 return cellNoiseGradient(lattice.cell,lattice.fraction,seed);
}
struct TerrainLattice {cell:vec3<i32>,fraction:vec3<f32>};
struct TerrainBase {direction:vec3<f32>,warp:vec3<f32>,land:f32,plain:f32,basin:f32,roughness:f32};
fn terrainWarp(direction:vec3<f32>,seed:u32)->vec3<f32>{
 return vec3<f32>(terrainWarpNoise(direction,vec3<i32>(0),seed+11u),terrainWarpNoise(direction,vec3<i32>(17,3,9),seed+19u),terrainWarpNoise(direction,vec3<i32>(5,23,2),seed+29u));
}
fn terrainBase(direction:vec3<f32>,seed:u32)->TerrainBase {
 // Low-frequency warp and continents provide geological structure; ridges
 // only amplify selected land and plate-boundary regions, not the whole globe.
 let warp=terrainWarp(direction,seed);
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
 let mountainZone=clamp(boundary*.82+smoothstep(.08,.35,continent)*.34,0.0,1.0);
 return TerrainBase(d,warp,land,plain,basin,land*mountainZone);
}
fn terrainTwoSum(a:f32,b:f32)->vec2<f32>{
 let sum=a+b;let bp=sum-a;return vec2<f32>(sum,(a-(sum-bp))+(b-bp));
}
// Keep the residual of dot products: rounding the projected coordinate before
// its 2100x scale otherwise creates height steps at walking distances.
fn terrainPreciseDot(high:vec3<f32>,low:vec3<f32>,axis:vec3<f32>)->vec2<f32>{
 let products=high*axis;let errors=fma(high,axis,-products);
 let ab=terrainTwoSum(products.x,products.y);let abc=terrainTwoSum(ab.x,products.z);
 return vec2<f32>(abc.x,abc.y+ab.y+errors.x+errors.y+errors.z+dot(low,axis));
}
struct TerrainPrecision {direction:vec3<f32>,warp:vec3<f32>};
fn terrainPrecision(base:TerrainBase,direction:vec3<f32>,high:vec3<f32>,low:vec3<f32>,delta:vec3<f32>,gx:vec4<f32>,gy:vec4<f32>,gz:vec4<f32>)->TerrainPrecision{
 let error=(high-direction)+(low+delta);let e=error*2.1;
 let warpError=vec3<f32>(dot(gx.yzw,e),dot(gy.yzw,e),dot(gz.yzw,e));
 let d=base.direction;let magnitude=length(direction+base.warp*.19);
 // Recover the tangential rounding error from both the warp addition and
 // normalization. Keeping only the input residual leaves visible steps even
 // when every later noise lookup uses split coordinates.
 let rounded=fma(base.warp,vec3<f32>(.19),fma(-d,vec3<f32>(magnitude),direction));
 let shift=error+warpError*.19;
 let directionError=(rounded+shift-d*dot(d,shift))/magnitude;
 return TerrainPrecision(directionError,warpError);
}
fn terrainPreciseLattice(high:vec3<f32>,low:vec3<f32>,frequency:f32,shift:vec3<f32>,shiftLow:vec3<f32>)->TerrainLattice{
 let scaled=high*frequency;
 let residual=fract(scaled)+fma(high,vec3<f32>(frequency),-scaled)+low*frequency+shift+shiftLow;
 return TerrainLattice(vec3<i32>(floor(scaled))+vec3<i32>(floor(residual)),fract(residual));
}
// The grid is geographic, not tied to render patches or their LOD. Blending
// neighboring references near grid boundaries avoids exposing their residual
// floating-point rounding as a new seam.
struct TerrainDetailGrid {cell:vec3<f32>,side:vec3<f32>,blend:vec3<f32>};
fn terrainDetailGrid(high:vec3<f32>,low:vec3<f32>,delta:vec3<f32>)->TerrainDetailGrid{
 let scaled=high*65536.0;let offset=delta*65536.0;
 let fraction=fract(scaled)+fract(offset)+low*65536.0;
 let nearest=floor(fraction+vec3<f32>(.5));let relative=fraction-nearest;
 return TerrainDetailGrid(floor(scaled)+floor(offset)+nearest,sign(relative),smoothstep(vec3<f32>(.40),vec3<f32>(.50),abs(relative))*.5);
}
struct TerrainDetailReference {direction:vec3<f32>,warp:vec3<f32>,directionError:vec3<f32>,warpError:vec3<f32>};
fn terrainDetailReference(cell:vec3<f32>,base:TerrainBase,high:vec3<f32>,low:vec3<f32>,delta:vec3<f32>,seed:u32)->TerrainDetailReference{
 let anchor=normalize(cell/65536.0);
 let gx=terrainWarpGradient(anchor,vec3<i32>(0),seed+11u);let gy=terrainWarpGradient(anchor,vec3<i32>(17,3,9),seed+19u);let gz=terrainWarpGradient(anchor,vec3<i32>(5,23,2),seed+29u);
 let warp=vec3<f32>(gx.x,gy.x,gz.x);var local=base;local.warp=warp;local.direction=normalize(anchor+warp*.19);
 let offset=terrainPrecision(local,anchor,high,low,delta,gx,gy,gz);
 return TerrainDetailReference(local.direction,warp,offset.direction,offset.warp);
}
fn terrainBlendedReference(base:TerrainBase,high:vec3<f32>,low:vec3<f32>,delta:vec3<f32>,seed:u32)->TerrainDetailReference{
 let grid=terrainDetailGrid(high,low,delta);let reference=terrainDetailReference(grid.cell,base,high,low,delta,seed);
 var directionError=reference.directionError;var warpError=reference.warpError;
 if(grid.blend.x>0.0 || grid.blend.y>0.0 || grid.blend.z>0.0){
  for(var corner=1u;corner<8u;corner++){
   let x=(corner&1u)!=0u;let y=(corner&2u)!=0u;let z=(corner&4u)!=0u;
   let weight=select(1.0-grid.blend.x,grid.blend.x,x)*select(1.0-grid.blend.y,grid.blend.y,y)*select(1.0-grid.blend.z,grid.blend.z,z);
   if(weight>0.0){
    let offset=vec3<f32>(select(0.0,grid.side.x,x),select(0.0,grid.side.y,y),select(0.0,grid.side.z,z));
    let neighbor=terrainDetailReference(grid.cell+offset,base,high,low,delta,seed);
    directionError+=((neighbor.direction-reference.direction)+(neighbor.directionError-reference.directionError))*weight;
    warpError+=((neighbor.warp-reference.warp)+(neighbor.warpError-reference.warpError))*weight;
   }
  }
 }
 return TerrainDetailReference(reference.direction,reference.warp,directionError,warpError);
}
fn terrainDetailChannel(high:vec3<f32>,low:vec3<f32>,warp:vec3<f32>,warpLow:vec3<f32>,down:vec3<f32>,frequency:f32,seed:u32)->f32{
 var n=0.0;
 for(var i=-2;i<=2;i++){
  let shift=warp+down*(f32(i)*.8);
  let lattice=terrainPreciseLattice(high,low,frequency,shift,warpLow);
  let weight=select(.25,.125,abs(i)==2);
  n+=cellNoise(lattice.cell,lattice.fraction,seed)*weight;
 }
 let channel=1.0-smoothstep(.025,.30,abs(n));return channel*channel;
}
fn terrainPreciseFold(base:TerrainBase,detailOffset:TerrainPrecision,seed:u32)->f32{
 let d=base.direction;let a=terrainPreciseDot(d,detailOffset.direction,plates[0].xyz);let b=terrainPreciseDot(d,detailOffset.direction,plates[1].xyz);let c=terrainPreciseDot(d,detailOffset.direction,plates[2].xyz);
 let raw=vec3<f32>(a.x,b.x,c.x);let tail=vec3<f32>(a.y,b.y,c.y);let factors=vec3<f32>(2100.0,480.0,125.0);
 let scaled=raw*factors;let residual=fract(scaled)+fma(raw,factors,-scaled)+tail*factors+(base.warp+detailOffset.warp)*.45;
 let cell=vec3<i32>(floor(scaled))+vec3<i32>(floor(residual));
 return cellNoise(cell,fract(residual),seed+277u);
}
fn terrainShapeFromBaseDetail(base:TerrainBase,seed:u32,valleyStrength:f32,direction:vec3<f32>,high:vec3<f32>,low:vec3<f32>,delta:vec3<f32>,useDetailOffset:bool)->vec3<f32>{
 let land=base.land;let plain=base.plain;let basin=base.basin;let roughness=base.roughness;
 if(land<=0.0){return vec3<f32>(clamp(basin,-8.0,9.0),0.0,clamp(basin,-8.0,9.0));}
 let valleyEnabled=valleyStrength>0.0 && roughness>.025;
 let preciseBands=useDetailOffset && roughness>.001;var detailOffset=TerrainPrecision(vec3<f32>(0.0),vec3<f32>(0.0));
 var detailBase=base;
 if(preciseBands){
  let reference=terrainBlendedReference(base,high,low,delta,seed);
  detailBase.direction=reference.direction;detailBase.warp=reference.warp;detailOffset=TerrainPrecision(reference.directionError,reference.warpError);
 }
 let d=detailBase.direction;let warpDetail=detailBase.warp*.45;
 var ridges=0.0;var ridgeGradient=vec3<f32>(0.0);var amplitude=.56;var freq=14.0;
 // Ridge, fold and fine-band contributions are multiplied by roughness.
 // For exactly flat regions their noise cannot affect any output.
 if(roughness>0.0){
 for(var i=0u;i<4u;i++){
  let p=d*freq+warpDetail;var n:f32;
  if(valleyEnabled){var sample:vec4<f32>;
   if(preciseBands){let lattice=terrainPreciseLattice(d,detailOffset.direction,freq,warpDetail,detailOffset.warp*.45);sample=cellNoiseGradient(lattice.cell,lattice.fraction,seed+53u+i*23u);}
   else{sample=noiseGradient(p,seed+53u+i*23u);}
   n=sample.x;
   let r=1.0-min(1.0,abs(n)*2.3);
   if(abs(n)*2.3<1.0){ridgeGradient+=sample.yzw*(-4.6*r*sign(n)*amplitude*freq);}
  }else{
   if(preciseBands){let lattice=terrainPreciseLattice(d,detailOffset.direction,freq,warpDetail,detailOffset.warp*.45);n=cellNoise(lattice.cell,lattice.fraction,seed+53u+i*23u);}
   else{n=noise3(p,seed+53u+i*23u);}
  }
  let r=1.0-min(1.0,abs(n)*2.3);
  ridges+=r*r*amplitude;freq*=2.23;amplitude*=.50;
 }
 }
 let mountains=roughness*pow(max(0.0,ridges),1.25)*7.5;
 // Small, bounded terrain-detail bands. These are erosion-inspired noise,
 // not a hydraulic simulation; the land mask prevents ocean-wide ridges.
 var fine=0.0;var fineWeight=1.0;var fineFrequency=640.0;var fineAmplitude=1.0;
 if(roughness>0.0){
 for(var i=0u;i<6u;i++){
  var fineNoise:f32;
  if(preciseBands){let lattice=terrainPreciseLattice(d,detailOffset.direction,fineFrequency,warpDetail,detailOffset.warp*.45);fineNoise=cellNoise(lattice.cell,lattice.fraction,seed+151u+i*23u);}
  else{fineNoise=noise3(d*fineFrequency+warpDetail,seed+151u+i*23u);}
  let r=1.0-min(1.0,abs(fineNoise)*2.2);
  fine+=(r*r-.22)*fineAmplitude*fineWeight;
  // The amplitude must fall faster than frequency rises. Otherwise the
  // smallest octaves create taller-than-wide spikes as the camera approaches.
  fineWeight=clamp(r*1.6,.25,1.0);fineFrequency*=3.7;fineAmplitude*=.26;
 }
 }
 var directional=0.0;
 if(roughness>0.0){
  var foldNoise:f32;
  if(preciseBands){foldNoise=terrainPreciseFold(detailBase,detailOffset,seed);}
  else{
   let coords=vec3<f32>(dot(d,plates[0].xyz)*2100.0,dot(d,plates[1].xyz)*480.0,dot(d,plates[2].xyz)*125.0);
   foldNoise=noise3(coords+warpDetail,seed+277u);
  }
  let fold=1.0-min(1.0,abs(foldNoise)*2.0);
  directional=(fold*fold-.25)*.38*roughness;
 }
 var plainsDetail:f32;
 if(preciseBands){
  let a=terrainPreciseLattice(d,detailOffset.direction,900.0,vec3<f32>(0.0),vec3<f32>(0.0));
  let b=terrainPreciseLattice(d,detailOffset.direction,5000.0,vec3<f32>(0.0),vec3<f32>(0.0));
  plainsDetail=cellNoise(a.cell,a.fraction,seed+311u)*.035+cellNoise(b.cell,b.fraction,seed+313u)*.008;
 }else{plainsDetail=noise3(d*900.0,seed+311u)*.035+noise3(d*5000.0,seed+313u)*.008;}
 let broadUnshaped=mix(basin,plain,land)+mountains;
 // Full-strength ridge detail crossing sea level creates a dense maze of
 // parallel islets and channels. Limit only part of that detail near the
 // broad coastline, while preserving high coastal mountains and the same
 // geographic height field at every LOD. This is not a hydraulic simulation.
 let rawDetail=roughness*fine+directional+plainsDetail*land;
 let rawHeight=broadUnshaped+rawDetail;
 let coast=1.0-smoothstep(.15,.80,abs(broadUnshaped));
 let lowRelief=1.0-smoothstep(.25,.80,abs(rawHeight));
 let limit=.08+.25*abs(broadUnshaped);
 let rounded=rawDetail*limit/(limit+abs(rawDetail));
 let correction=clamp(rawDetail-rounded,-.20,.20)*coast*lowRelief;
 let unshaped=rawHeight-correction;
 var valleys=0.0;
 if(valleyEnabled){
  let tangent=ridgeGradient-d*dot(ridgeGradient,d);let magnitude=length(tangent);
  let slope=magnitude*roughness*7.5/6371.0;
  if(magnitude>.0001 && slope>.003){
   let down=-tangent/magnitude;
   var primary:f32;var secondary:f32;
   if(preciseBands){
    primary=terrainDetailChannel(d,detailOffset.direction,warpDetail,detailOffset.warp*.45,down,1400.0,seed+337u);
    secondary=terrainDetailChannel(d,detailOffset.direction,warpDetail,detailOffset.warp*.45,down,4300.0,seed+349u);
   }else{
    primary=slopeChannel(d*1400.0+warpDetail,down,seed+337u);
    secondary=slopeChannel(d*4300.0+warpDetail,down,seed+349u);
   }
   let mask=roughness*smoothstep(.025,.10,roughness)*smoothstep(.003,.09,slope)*smoothstep(.08,.55,ridges)*smoothstep(.05,.6,unshaped);
   valleys=(primary*.22+secondary*(.25+.75*primary)*.075)*mask*valleyStrength;
  }
 }
 let h=clamp(unshaped-valleys,-8.0,9.0);
 return vec3<f32>(h,max(0.0,clamp(unshaped,-8.0,9.0)-h),clamp(broadUnshaped,-8.0,9.0));
}
fn terrainShapeFromBase(base:TerrainBase,seed:u32,valleyStrength:f32)->vec3<f32>{
 let zero=vec3<f32>(0.0);return terrainShapeFromBaseDetail(base,seed,valleyStrength,zero,zero,zero,zero,false);
}
fn terrainShape(direction:vec3<f32>,seed:u32,valleyStrength:f32)->vec3<f32>{return terrainShapeFromBase(terrainBase(direction,seed),seed,valleyStrength);}
fn terrain(direction:vec3<f32>,seed:u32)->f32{return terrainShape(direction,seed,frame.settings.w).x;}

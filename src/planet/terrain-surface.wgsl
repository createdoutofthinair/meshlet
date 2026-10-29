struct SurfaceData {height:f32,lake:f32,humidity:f32};
fn naturalHeight(base:f32,high:vec3<f32>,low:vec3<f32>,delta:vec3<f32>,seed:u32)->f32{
 let micro=localNoise(high,low,delta,131072.0,seed+401u)*.0025
          +localNoise(high,low,delta,524288.0,seed+409u)*.00065
          +localNoise(high,low,delta,2097152.0,seed+419u)*.00018
          +localNoise(high,low,delta,8388608.0,seed+421u)*.00005;
 return base+micro*smoothstep(-.05,.25,base);
}
// Bound all omitted ridge, detail, valley and micro amplitudes before doing
// expensive full-resolution work. Ambiguous locations use the exact field.
fn naturalLand(direction:vec3<f32>,seed:u32)->bool{
 let base=terrainBase(direction,seed);let coarse=mix(base.basin,base.plain,base.land);
 let lower=coarse-(.393+.295*max(0.0,frame.settings.w))*base.roughness-.043*base.land-.00338;
 let upper=coarse+9.4*base.roughness+.043*base.land+.00338;
 if(lower>0.0){return true;}if(upper<0.0){return false;}
 let height=terrainShapeFromBase(base,seed,frame.settings.w).x;
 return naturalHeight(height,direction,vec3<f32>(0.0),vec3<f32>(0.0),seed)>=0.0;
}
// A world-space, slope-oriented procedural approximation of fluvial detail.
// Sampling in 3D, rather than per patch, preserves shared vertices across LODs
// and cube faces. This augments the coarse simulation; it is not a new local
// hydraulic simulation and cannot guarantee downhill flow at the fine scale.
fn flowChannel(high:vec3<f32>,low:vec3<f32>,delta:vec3<f32>,flow:vec3<f32>,frequency:f32,seed:u32)->f32{
 let shift=flow*(.9/frequency);
 let n=localNoise(high,low,delta,frequency,seed)*.5
  +(localNoise(high,low,delta+shift,frequency,seed)+localNoise(high,low,delta-shift,frequency,seed))*.25;
 let channel=1.0-smoothstep(.035,.30,abs(n));return channel*channel;
}
fn regionalIncision(s:WorldSample,profile:vec4<f32>,direction:vec3<f32>,high:vec3<f32>,low:vec3<f32>,delta:vec3<f32>,height:f32,seed:u32)->f32{
 if(frame.settings.w<=0.0 || frame.hydrology.x<=0.0 || height<=.03){return 0.0;}
 let drain=worldDrainage(s,direction);if(drain.w<.001){return 0.0;}
 // Tie the regional incision to the coarse catchment's slope and discharge,
 // suppressing it in flat basins and at drainage divides.
 let streamPower=smoothstep(.0001,.012,worldSlope(s))*mix(.5,1.0,smoothstep(1.0,12.0,profile.z));
 let terrainMask=smoothstep(.03,.5,height)*smoothstep(.15,.8,profile.y)*drain.w*streamPower;
 if(terrainMask<.001){return 0.0;}
 // Powers of two preserve the high/low split through floating-point scaling.
 let primary=flowChannel(high,low,delta,drain.xyz,2048.0,seed+1201u);
 let secondary=flowChannel(high,low,delta,drain.xyz,8192.0,seed+1213u);
 let fine=flowChannel(high,low,delta,drain.xyz,32768.0,seed+1223u);
 let close=flowChannel(high,low,delta,drain.xyz,131072.0,seed+1231u);
 let nested=primary*.075+secondary*(.2+.8*primary)*.026+fine*(.15+.85*secondary)*.006+close*(.15+.85*fine)*.003;
 return nested*terrainMask*frame.settings.w*frame.hydrology.x;
}
fn surfaceBase(direction:vec3<f32>,high:vec3<f32>,low:vec3<f32>,delta:vec3<f32>,seed:u32,includeRegional:bool)->SurfaceData {
 let terrainInfo=terrainBase(direction,seed);
 var shape=terrainShapeFromBaseDetail(terrainInfo,seed,frame.settings.w,direction,high,low,delta,true);
 // Keep sea-level classification identical to the original world field. The
 // sub-meter precision fix is geographic, independent of render patch LOD.
 if(shape.x<.041){
  let original=terrainShapeFromBase(terrainInfo,seed,frame.settings.w);
  shape=mix(original,shape,smoothstep(.01,.04,original.x));
 }
 let base=shape.x;
 // Independent, seeded bands produce real vertex relief from tens of meters
 // down to sub-meter scales. Their low amplitudes preserve the landforms.
 let s=worldSample(direction);let profile=worldProfile(s);
 let natural=naturalHeight(base,high,low,delta,seed);
 var change=(profile.y-profile.x)*frame.hydrology.x;
 change-=regionalIncision(s,profile,direction,high,low,delta,natural+change,seed);
 // Coarse erosion is interpolated over much finer landforms. It must not
 // turn an existing piece of dry land into a new sea-level hole.
 var baseline=natural+change;
 if(natural>0.0){baseline=max(baseline,natural*.10);}else{baseline=natural;}
 var ground=baseline;
 if(includeRegional && frame.hydrology.z>.5 && natural>0.0){ground=max(natural*.10,baseline+regionalSimulation(direction).x*frame.hydrology.x);}
 var lake=0.0;
 if(frame.hydrology.y>.5 && frame.hydrology.x>0.0 && baseline>.0){
  let basin=worldLake(s);
  let level=basin.y;
  // Determine the shoreline from broad terrain rather than tiny relief
  // octaves. This avoids turning one basin into hundreds of speckled pools.
  // Keep genuinely prominent local peaks as islands.
  let broadGround=shape.z+(profile.y-profile.x)*frame.hydrology.x;
  let islands=1.0-smoothstep(.35,.50,max(0.0,baseline-broadGround));
  lake=basin.x*islands*smoothstep(.0,.25,frame.hydrology.x)*smoothstep(-.01,.035,level-broadGround);
  // A lake has a surface, rather than a tint following the terrain below it.
  // Its coverage depends only on the global field, not on regional streaming.
  ground=mix(ground,level,lake);
 }
 let humidity=clamp(worldRain(s)*.65+.08*log2(1.0+profile.z),0.0,1.0);
 return SurfaceData(ground,lake,humidity);
}
// Water coverage is evaluated at a fixed direction in the seeded world.
// The lake result does not depend on the render patch, LOD, or region cache.
fn worldSurfaceWater(direction:vec3<f32>,footprintKm:f32)->vec2<f32>{
 if(frame.hydrology.y<=.5 || frame.hydrology.x<=0.0){return vec2<f32>(0.0);}
 let sample=worldSample(direction);let basin=worldLake(sample);var lake=0.0;var river=0.0;
 if(basin.x>0.0){lake=surfaceBase(direction,direction,vec3<f32>(0.0),vec3<f32>(0.0),frame.counts.z,false).lake;}
 // At this footprint the widest river's area coverage is at most .1,
 // below the water color threshold. Smaller footprints are filtered.
 if(footprintKm<MAX_RIVER_HALF_WIDTH_KM*20.0 && hasRivers(sample)){river=riverAtFiltered(direction,sample,footprintKm).mask;}
 return vec2<f32>(lake,river);
}

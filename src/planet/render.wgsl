@group(0) @binding(0) var<uniform> frame:PlanetFrame;
@group(0) @binding(1) var<storage,read> patches:array<Patch>;
@group(0) @binding(2) var<storage,read> vertices:array<PlanetVertex>;
@group(0) @binding(3) var<storage,read> visible:array<u32>;
@group(0) @binding(5) var<storage,read> plates:array<vec4<f32>>;
@group(0) @binding(6) var<storage,read> morphs:MorphStorage;
struct Output {
 @builtin(position) position:vec4<f32>,
 @location(0) normal:vec3<f32>,
 @location(1) direction:vec3<f32>,
 @location(2) relative:vec3<f32>,
 @location(3) height:f32,
 @location(4) @interpolate(flat) level:u32,
 @location(5) @interpolate(linear) bary:vec3<f32>,
 @location(6) @interpolate(flat) edgeMask:u32,
 @location(7) cavity:f32,
 @location(8) surface:vec4<f32>, // lake and moisture
 @location(9) @interpolate(flat) detailHigh:vec3<f32>,
 @location(10) @interpolate(flat) detailLow:vec3<f32>,
 @location(11) detailOffset:vec3<f32>,
 @location(12) @interpolate(flat) debugIds:vec2<u32>,
};
struct TerrainPixel {@location(0) color:vec4<f32>,@location(1) waterDepth:f32};
fn onPatchEdge(a:vec2<f32>,b:vec2<f32>)->bool {
 return (a.x==b.x && (a.x==0.0 || a.x==16.0)) || (a.y==b.y && (a.y==0.0 || a.y==16.0));
}
fn onMeshletEdge(a:vec2<f32>,b:vec2<f32>)->bool {
 return (a.x==b.x && a.x%4.0==0.0)||(a.y==b.y && a.y%4.0==0.0);
}
fn debugHash(value:u32)->u32{
 var x=value;x=(x^(x>>16u))*2246822519u;x=(x^(x>>13u))*3266489917u;return x^(x>>16u);
}
@vertex
fn vs(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Output {
 let entry=visible[instance];let slot=entry>>4u;let meshlet=entry&15u;let tile=patches[slot];
 let morph=morphs.patches[slot];
 let overlay=morph.slots.w!=0u && (morph.slots.z&16u)!=0u;
 // Regular patches never use transition ranges. Avoid a storage-buffer read
 // for each of their vertex invocations.
 var range=vec2<u32>(0u);
 if(overlay){range=morphs.ranges[slot*16u+meshlet];}
 if((overlay && vertex>=range.y)||(!overlay && vertex>=96u)){
  var empty:Output;empty.position=vec4<f32>(2.0,2.0,2.0,1.0);return empty;
 }
 let cell=vertex/6u;let corner=vertex%6u;
 let offsets=array<vec2<u32>,6>(vec2<u32>(0u,0u),vec2<u32>(1u,0u),vec2<u32>(0u,1u),vec2<u32>(1u,0u),vec2<u32>(1u,1u),vec2<u32>(0u,1u));
 let cellOrigin=vec2<u32>((meshlet%4u)*4u+cell%4u,(meshlet/4u)*4u+cell/4u);
 let triBase=(corner/3u)*3u;
 var a=vec2<f32>(cellOrigin+offsets[triBase]);var b=vec2<f32>(cellOrigin+offsets[triBase+1u]);var c=vec2<f32>(cellOrigin+offsets[triBase+2u]);
 let stitch=tile.details.z;let coord=stitchCoord(cellOrigin+offsets[corner],stitch);
 var q=vec2<f32>(coord);
 if(overlay){
  q=morphs.coordinates[range.x+vertex];
  // Triangle corners are needed only for patch/meshlet edge overlays.
  if((frame.counts.w&264u)!=0u){
   let first=range.x+vertex-vertex%3u;
   a=morphs.coordinates[first];b=morphs.coordinates[first+1u];c=morphs.coordinates[first+2u];
  }
 }
 var vert:PlanetVertex;
 var relative:vec3<f32>;
 if(morph.slots.w!=0u){
  let mask=select(stitch,morph.slots.z&15u,overlay);
  let displayed=displayedVertex(slot,q,mask,morph);vert=displayed.vertex;relative=displayed.relative;
 }else{vert=vertices[slot*GRID_COUNT+(coord.y+2u)*GRID+coord.x+2u];relative=tile.relative.xyz+vert.position.xyz;}
 let local=vert.position.xyz+(relative-(tile.relative.xyz+vert.position.xyz));
 var mask=0u;
 if((frame.counts.w & 8u)!=0u){if(onPatchEdge(b,c)){mask|=1u;}if(onPatchEdge(c,a)){mask|=2u;}if(onPatchEdge(a,b)){mask|=4u;}}
 if((frame.counts.w & 256u)!=0u){if(onMeshletEdge(b,c)){mask|=8u;}if(onMeshletEdge(c,a)){mask|=16u;}if(onMeshletEdge(a,b)){mask|=32u;}}
 var bary=vec3<f32>(0.0,0.0,1.0);if(corner%3u==0u){bary=vec3<f32>(1.0,0.0,0.0);}else if(corner%3u==1u){bary=vec3<f32>(0.0,1.0,0.0);}
 var out:Output;out.position=frame.viewProjection*vec4<f32>(relative,1.0);out.normal=vert.normal.xyz;
 out.direction=normalize(tile.centerDirection.xyz+(tile.centerLow.xyz+local/frame.settings.x));out.relative=relative;out.height=vert.position.w;
 out.level=tile.details.y;out.bary=bary;out.edgeMask=mask;out.cavity=vert.normal.w;out.surface=vert.surface;
 out.detailHigh=tile.centerDirection.xyz;out.detailLow=tile.centerLow.xyz;out.detailOffset=local/frame.settings.x;
 out.debugIds=vec2<u32>(0u);
 if((frame.counts.w&192u)!=0u){
  let patchId=debugHash(bitcast<u32>(tile.cube.x)^debugHash(bitcast<u32>(tile.cube.y))^debugHash(bitcast<u32>(tile.cube.z))^tile.details.y);
  out.debugIds=vec2<u32>(patchId,debugHash(patchId^((meshlet+1u)*2654435761u)));
 }
 return out;
}
fn identityColor(id:u32)->vec3<f32>{
 let palette=array<vec3<f32>,10>(vec3<f32>(.20,.75,.90),vec3<f32>(.35,.80,.48),vec3<f32>(.94,.70,.24),vec3<f32>(.89,.42,.36),vec3<f32>(.72,.44,.88),vec3<f32>(.41,.55,.92),vec3<f32>(.24,.81,.72),vec3<f32>(.91,.53,.70),vec3<f32>(.78,.80,.32),vec3<f32>(.53,.68,.91));
 return palette[id%10u];
}
fn levelColor(level:u32)->vec3<f32>{
 let palette=array<vec3<f32>,6>(vec3<f32>(0.12,0.66,0.80),vec3<f32>(0.23,0.75,0.48),vec3<f32>(0.85,0.67,0.20),vec3<f32>(0.90,0.36,0.20),vec3<f32>(0.73,0.27,0.68),vec3<f32>(0.36,0.37,0.90));
 return palette[level%6u];
}
@fragment
fn fs(in:Output)->TerrainPixel {
 let radial=normalize(in.direction);let light=normalize(frame.sun.xyz);
 // Classify the sea from the same seeded world at every LOD, rather than
 // from interpolated heights of the triangles currently on screen.
 let coast=naturalCoast(radial,frame.counts.z);let land=coast.x>=0.0;let h=select(min(in.height,0.0),max(in.height,0.0),land);
 // The normal view draws the ocean from its own analytic sea-level surface.
 // Debug views retain the terrain mesh so its LOD topology remains visible.
 let separateSea=!land && (frame.counts.w&32u)!=0u;
 // Filter the geographic sea boundary over its pixel footprint. This only
 // antialiases the edge; it does not move the seeded shoreline with LOD.
 let coastWidth=max(.00001,fwidth(coast.x)*.55);
 let pixelKm=max(length(dpdx(in.direction)),length(dpdy(in.direction)))*6371.0;
 let footprint=max(length(dpdx(in.relative)),length(dpdy(in.relative)));
 // Screen-space triangle normal is useful for inspecting mesh detail and seams.
 // Derivatives must be taken before the conditional sea discard.
 var geometricNormal=radial;
 if(((frame.counts.w>>9u)&7u)==2u){
  geometricNormal=normalize(cross(dpdx(in.relative),dpdy(in.relative)));
  if(dot(geometricNormal,radial)<0.0){geometricNormal=-geometricNormal;}
 }
 // The analytic ocean pass will replace these fragments. Discard after the
 // derivatives needed by the remaining terrain, before material shading.
 if(separateSea){discard;}
 let seaCoverage=1.0-smoothstep(-coastWidth,coastWidth,coast.x);
 var waterField=vec2<f32>(0.0);
 if(frame.hydrology.y>.5 && frame.hydrology.x>0.0 && land){
  // Query the seeded world at the fragment's location, not a water mask
  // interpolated from whichever terrain patch or LOD happens to cover it.
  waterField=worldSurfaceWater(radial,pixelKm);
 }
 let water=smoothstep(.1,.6,max(waterField.x,waterField.y));
 let oceanFlatness=seaCoverage*select(0.0,1.0,frame.settings.z>.5);
 let broadWeight=smoothstep(.004,.25,pixelKm);var filteredNormal:vec3<f32>;
 if(broadWeight>0.0){
  var east=cross(vec3<f32>(0.0,1.0,0.0),radial);if(dot(east,east)<.000000000001){east=cross(vec3<f32>(1.0,0.0,0.0),radial);}
  east=normalize(east);let north=normalize(cross(radial,east));
  let broadNormal=normalize(radial-east*in.surface.z-north*in.surface.w);
  filteredNormal=normalize(mix(in.normal,broadNormal,broadWeight));
 }else{filteredNormal=normalize(in.normal);}
 // Most land pixels are neither water nor coastline. Their filtered normal
 // is already normalized and does not need two further normalizations.
 var n=filteredNormal;
 if(water>0.0){n=normalize(mix(n,radial,water*.8));}
 if(oceanFlatness>0.0){n=normalize(mix(n,radial,oceanFlatness));}
 let slope=1.0-clamp(dot(n,radial),0.0,1.0);
 let deep=vec3<f32>(0.012,0.055,0.092);let ocean=vec3<f32>(0.025,0.17,0.23);
 // Blend physical material properties with weights that sum to one. Snow
 // settles on shallow slopes; steep rock and dry exposed soil remain visible.
 let rockSlope=smoothstep(.018,.18,slope);
 let temperature=clamp(1.0-abs(radial.y)*1.1-max(0.0,h)*.075,0.0,1.0);
 let humidity=select(.5,clamp(in.surface.y,0.0,1.0),(frame.counts.w&16u)!=0u);
 let coldSnow=select(0.0,1.0-smoothstep(.12,.24,temperature),(frame.counts.w&16u)!=0u);
 let snowCover=clamp(max(smoothstep(7.0,9.3,h),coldSnow)*(1.0-smoothstep(.03,.32,slope)*.85),0.0,1.0);
 let exposedWeight=(1.0-snowCover)*rockSlope;
 let remaining=1.0-snowCover-exposedWeight;
 let talusMask=smoothstep(.008,.06,slope)*(1.0-smoothstep(.12,.24,slope));
 let talusWeight=remaining*talusMask*.75;
 let groundWeight=max(0.0,remaining-talusWeight);
 let sandWeight=groundWeight*(1.0-smoothstep(.25,.5,humidity))*(1.0-smoothstep(.02,.12,slope));
 let soilWeight=max(0.0,groundWeight-sandWeight);
 var geology=0.0;
 if(land && exposedWeight+talusWeight>0.0){geology=noise3(radial*180.0,frame.counts.z+1777u);}
 let rock=vec3<f32>(.34,.34,.32)*(1.0+.12*geology)+vec3<f32>(.018,.004,-.014)*geology;
 let talus=vec3<f32>(.31,.29,.25)*(1.0+.08*geology);
 let sand=vec3<f32>(.42,.34,.22);
 let soil=mix(vec3<f32>(.29,.32,.25),vec3<f32>(.22,.31,.17),smoothstep(.18,.48,temperature));
 let snow=vec3<f32>(.66,.71,.72);
 var base=rock*exposedWeight+talus*talusWeight+sand*sandWeight+soil*soilWeight+snow*snowCover;
 if(land){base=mix(base,vec3<f32>(.025,.16,.19),water);}
 // Color the sea from a continuous, seeded broad-bed field. Interpolated
 // patch heights make the same ocean look different as terrain LOD changes.
 if(seaCoverage>0.0){
  let seaColor=mix(deep,ocean,smoothstep(-4.0,0.0,min(coast.y,0.0)));
  base=mix(base,seaColor,seaCoverage);
 }
 // A single filtered mineral band adds subtle variation without an expensive
 // extra normal-noise evaluation at every close-up pixel.
 if(land && water<.1 && (frame.counts.w&2u)==0u && footprint<.004){
  let visibleHeight=select(in.height,max(in.height,0.0),frame.settings.z>.5);
  let elevation=visibleHeight/frame.settings.x;
  let detailDelta=(in.detailOffset-in.detailHigh*elevation)/(1.0+elevation);
  let medium=localNoise(in.detailHigh,in.detailLow,detailDelta,1048576.0,frame.counts.z+1709u);
  let mediumFilter=1.0-smoothstep(.001,.004,footprint);
  let variation=medium*.075*mediumFilter;
  base=max(vec3<f32>(0.0),base*(1.0+variation)+vec3<f32>(.012,.005,-.008)*medium*mediumFilter);
  // Fine mineral variation fades out before its projected footprint aliases.
  // Both bands use the same high/low world coordinates across patch edges.
  if(footprint<.00015){
   let grainData=localNoiseGradient(in.detailHigh,in.detailLow,detailDelta,8388608.0,frame.counts.z+1721u);
   let grain=grainData.x;
   let grainFilter=1.0-smoothstep(.00004,.00015,footprint);
   let exposed=smoothstep(.006,.12,slope)*(1.0-snowCover);
   base*=1.0+grain*mix(.035,.065,exposed)*grainFilter;
   // The analytic gradient adds sub-mesh shading without changing the
   // actual height, so walking and LOD transitions keep the same surface.
   let tangentGradient=grainData.yzw-n*dot(n,grainData.yzw);
   n=normalize(n-tangentGradient*mix(.035,.11,exposed)*grainFilter*(1.0-water));
  }
 }
 // Terrain is predominantly dielectric. Keep the specular response broad and
 // energy bounded; snow and exposed rock have different surface roughness.
 let roughness=clamp(.68*exposedWeight+.90*talusWeight+.84*sandWeight+.92*soilWeight+.78*snowCover,.35,1.0);
 let view=normalize(-in.relative);let diffuse=max(dot(n,light),0.0);
 let ndotv=max(dot(n,view),.001);let halfVector=light+view;
 var specular=0.0;
 if(diffuse>0.0 && dot(halfVector,halfVector)>.000001){
  let halfDir=normalize(halfVector);let ndoth=max(dot(n,halfDir),0.0);
  let vdoth=max(dot(view,halfDir),0.0);let a=roughness*roughness;let a2=a*a;
  let denominator=ndoth*ndoth*(a2-1.0)+1.0;
  let distribution=a2/(3.14159265*denominator*denominator);
  let k=(roughness+1.0)*(roughness+1.0)*.125;
  let geometry=(ndotv/(ndotv*(1.0-k)+k))*(diffuse/(diffuse*(1.0-k)+k));
  let fresnel=.04+.96*pow(1.0-vdoth,5.0);
  specular=distribution*geometry*fresnel/(4.0*ndotv);
 }
 let sky=.22+.10*max(dot(n,radial),0.0);
 let occlusion=1.0-in.cavity*(1.0-oceanFlatness)*.30;
 var color=(base*(sky+diffuse*.91)+vec3<f32>(specular))*occlusion;let rim=pow(1.0-clamp(dot(radial,view),0.0,1.0),4.0)*.055;
 color+=vec3<f32>(.10,.38,.58)*rim;
 // Compress highlights before display encoding so bright snow keeps
 // shading detail instead of clipping against the canvas's white limit.
 color=color/(vec3<f32>(1.0)+color*.28);
 color=pow(max(color,vec3<f32>(0.0)),vec3<f32>(1.0/2.2));
 var debugColor=vec3<f32>(0.0);var hasColor=false;
 if((frame.counts.w&2u)!=0u){debugColor=levelColor(in.level);hasColor=true;}
 if((frame.counts.w&64u)!=0u){debugColor=identityColor(in.debugIds.x);hasColor=true;}
 if((frame.counts.w&128u)!=0u){debugColor=identityColor(in.debugIds.y);hasColor=true;}
 let terrainDebug=(frame.counts.w>>9u)&7u;
 if(terrainDebug==1u){debugColor=n*.5+vec3<f32>(.5);hasColor=true;}
 if(terrainDebug==2u){debugColor=geometricNormal*.5+vec3<f32>(.5);hasColor=true;}
 if(terrainDebug==3u){debugColor=vec3<f32>(exposedWeight,snowCover,max(0.0,1.0-exposedWeight-snowCover));hasColor=true;}
 if(terrainDebug==4u){debugColor=vec3<f32>(roughness);hasColor=true;}
 if(hasColor){color=mix(color,debugColor,clamp(frame.hydrology.w,0.0,1.0));}
 if((frame.counts.w&268u)!=0u){
  let edge=vec3<f32>(1.0)-smoothstep(vec3<f32>(.55),vec3<f32>(1.7),in.bary/max(fwidth(in.bary),vec3<f32>(.00001)));
  if((frame.counts.w&4u)!=0u){color=mix(color,vec3<f32>(.02,.03,.04),max(edge.x,max(edge.y,edge.z))*.75);}
  if((frame.counts.w&256u)!=0u){var e=0.0;if((in.edgeMask&8u)!=0u){e=max(e,edge.x);}if((in.edgeMask&16u)!=0u){e=max(e,edge.y);}if((in.edgeMask&32u)!=0u){e=max(e,edge.z);}color=mix(color,vec3<f32>(1.0,.68,.23),e*.88);}
  if((frame.counts.w&8u)!=0u){var e=0.0;if((in.edgeMask&1u)!=0u){e=max(e,edge.x);}if((in.edgeMask&2u)!=0u){e=max(e,edge.y);}if((in.edgeMask&4u)!=0u){e=max(e,edge.z);}color=mix(color,vec3<f32>(.9,.98,1.0),e*.85);}
 }
 // The second target retains the fragment depth and flags geographic lake
 // pixels by sign. The independent water pass uses it to locate each basin.
 let lakePixel=land && waterField.x>.5 && (frame.counts.w&32u)!=0u;
 return TerrainPixel(vec4<f32>(color,1.0),select(in.position.z,-in.position.z,lakePixel));
}

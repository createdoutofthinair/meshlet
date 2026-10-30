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
 let overlay=morphs.patches[slot].slots.w!=0u && (morphs.patches[slot].slots.z&16u)!=0u;
 let range=morphs.ranges[slot*16u+meshlet];
 if((overlay && vertex>=range.y)||(!overlay && vertex>=96u)){
  var empty:Output;empty.position=vec4<f32>(2.0,2.0,2.0,1.0);return empty;
 }
 let cell=vertex/6u;let corner=vertex%6u;
 let offsets=array<vec2<u32>,6>(vec2<u32>(0u,0u),vec2<u32>(1u,0u),vec2<u32>(0u,1u),vec2<u32>(1u,0u),vec2<u32>(1u,1u),vec2<u32>(0u,1u));
 let cellOrigin=vec2<u32>((meshlet%4u)*4u+cell%4u,(meshlet/4u)*4u+cell/4u);
 let triBase=(corner/3u)*3u;
 var a=vec2<f32>(cellOrigin+offsets[triBase]);var b=vec2<f32>(cellOrigin+offsets[triBase+1u]);var c=vec2<f32>(cellOrigin+offsets[triBase+2u]);
 let stitch=tile.details.z;var coord=stitchCoord(cellOrigin+offsets[corner],stitch);
 var q=vec2<f32>(coord);
 if(overlay){
  q=morphs.coordinates[range.x+vertex];coord=vec2<u32>(round(q));
  let first=range.x+vertex-vertex%3u;
  a=morphs.coordinates[first];b=morphs.coordinates[first+1u];c=morphs.coordinates[first+2u];
 }
 var vert=vertices[slot*GRID_COUNT+(coord.y+2u)*GRID+coord.x+2u];
 var relative:vec3<f32>;
 if(morphs.patches[slot].slots.w!=0u){
  let mask=select(stitch,morphs.patches[slot].slots.z&15u,overlay);
  let displayed=displayedVertex(slot,q,mask);vert=displayed.vertex;relative=displayed.relative;
 }else{relative=tile.relative.xyz+vert.position.xyz;}
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
 let coastWidth=max(.00001,fwidth(coast.x)*.55);let seaCoverage=1.0-smoothstep(-coastWidth,coastWidth,coast.x);
 let pixelKm=max(length(dpdx(in.direction)),length(dpdy(in.direction)))*6371.0;var waterField=vec2<f32>(0.0);
 if(frame.hydrology.y>.5 && frame.hydrology.x>0.0 && land){
  // Query the seeded world at the fragment's location, not a water mask
  // interpolated from whichever terrain patch or LOD happens to cover it.
  waterField=worldSurfaceWater(radial,pixelKm);
 }
 let water=smoothstep(.1,.6,max(waterField.x,waterField.y));
 let oceanFlatness=seaCoverage*select(0.0,1.0,frame.settings.z>.5);
 var east=cross(vec3<f32>(0.0,1.0,0.0),radial);if(length(east)<.000001){east=cross(vec3<f32>(1.0,0.0,0.0),radial);}
 east=normalize(east);let north=normalize(cross(radial,east));
 let broadNormal=normalize(radial-east*in.surface.z-north*in.surface.w);
 let filteredNormal=normalize(mix(in.normal,broadNormal,smoothstep(.004,.25,pixelKm)));
 var n=normalize(mix(normalize(mix(filteredNormal,radial,water*.8)),radial,oceanFlatness));let slope=1.0-clamp(dot(n,radial),0.0,1.0);
 let deep=vec3<f32>(0.012,0.055,0.092);let ocean=vec3<f32>(0.025,0.17,0.23);
 let lowland=vec3<f32>(0.25,0.31,0.20);let upland=vec3<f32>(0.30,0.28,0.22);
 let rock=vec3<f32>(0.34,0.34,0.32);let snow=vec3<f32>(0.66,0.71,0.72);
 var base=mix(lowland,upland,smoothstep(.4,2.2,h));
 if((frame.counts.w&16u)!=0u){
  let humidity=clamp(in.surface.y,0.0,1.0);let temperature=clamp(1.0-abs(radial.y)*1.1-max(0.0,h)*.075,0.0,1.0);
  let arid=vec3<f32>(.42,.34,.22);let temperate=vec3<f32>(.22,.31,.17);let cool=vec3<f32>(.29,.32,.25);
  base=mix(arid,temperate,smoothstep(.28,.72,humidity));base=mix(cool,base,smoothstep(.18,.48,temperature));
  base=mix(base,upland,smoothstep(1.0,4.0,h)*.38);
 }
 base=mix(base,rock,smoothstep(.006,.12,slope));
 let temperature=clamp(1.0-abs(radial.y)*1.1-max(0.0,h)*.075,0.0,1.0);
 let coldSnow=select(0.0,1.0-smoothstep(.12,.24,temperature),(frame.counts.w&16u)!=0u);
 // Snow collects on gentler slopes; exposed rock preserves the shape of
 // steep mountain faces instead of painting the whole highland white.
 let snowCover=max(smoothstep(7.0,9.3,h),coldSnow)*(1.0-smoothstep(.03,.32,slope)*.85);
 base=mix(base,snow,snowCover);
 if(land){base=mix(base,vec3<f32>(.025,.16,.19),water);}
 // Color the sea from a continuous, seeded broad-bed field. Interpolated
 // patch heights make the same ocean look different as terrain LOD changes.
 let seaColor=mix(deep,ocean,smoothstep(-4.0,0.0,min(coast.y,0.0)));
 base=mix(base,seaColor,seaCoverage);
 // A single filtered mineral band adds subtle variation without an expensive
 // extra normal-noise evaluation at every close-up pixel.
 let footprint=max(length(dpdx(in.relative)),length(dpdy(in.relative)));
 if(land && water<.1 && (frame.counts.w&2u)==0u && footprint<.004){
  let visibleHeight=select(in.height,max(in.height,0.0),frame.settings.z>.5);
  let elevation=visibleHeight/frame.settings.x;
  let detailDelta=(in.detailOffset-in.detailHigh*elevation)/(1.0+elevation);
  let medium=localNoise(in.detailHigh,in.detailLow,detailDelta,1048576.0,frame.counts.z+1709u);
  let mediumFilter=1.0-smoothstep(.001,.004,footprint);
  let variation=medium*.075*mediumFilter;
  base=max(vec3<f32>(0.0),base*(1.0+variation)+vec3<f32>(.012,.005,-.008)*medium*mediumFilter);
 }
 let diffuse=max(dot(n,light),0.0);let fill=.22+.10*max(n.y,0.0);
 var color=base*(fill+diffuse*.95)*(1.0-in.cavity*(1.0-oceanFlatness)*.30);
 let view=normalize(-in.relative);let rim=pow(1.0-clamp(dot(radial,view),0.0,1.0),4.0)*.055;
 color+=vec3<f32>(.10,.38,.58)*rim;
 // Compress highlights before display encoding so bright snow keeps
 // shading detail instead of clipping against the canvas's white limit.
 color=color/(vec3<f32>(1.0)+color*.28);
 color=pow(max(color,vec3<f32>(0.0)),vec3<f32>(1.0/2.2));
 var debugColor=vec3<f32>(0.0);var hasColor=false;
 if((frame.counts.w&2u)!=0u){debugColor=levelColor(in.level);hasColor=true;}
 if((frame.counts.w&64u)!=0u){debugColor=identityColor(in.debugIds.x);hasColor=true;}
 if((frame.counts.w&128u)!=0u){debugColor=identityColor(in.debugIds.y);hasColor=true;}
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
 if(separateSea){discard;}
 return TerrainPixel(vec4<f32>(color,1.0),select(in.position.z,-in.position.z,lakePixel));
}

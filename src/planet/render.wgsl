@group(0) @binding(0) var<uniform> frame:PlanetFrame;
@group(0) @binding(1) var<storage,read> patches:array<Patch>;
@group(0) @binding(2) var<storage,read> vertices:array<PlanetVertex>;
@group(0) @binding(3) var<storage,read> visible:array<u32>;
@group(0) @binding(4) var<storage,read> riverMasks:array<vec2<f32>>;
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
 @location(9) patchUv:vec2<f32>,
 @location(10) @interpolate(flat) patchSlot:u32,
};
fn onPatchEdge(a:vec2<u32>,b:vec2<u32>)->bool {
 return (a.x==b.x && (a.x==0u || a.x==CELLS)) || (a.y==b.y && (a.y==0u || a.y==CELLS));
}
fn stitchCoord(point:vec2<u32>,stitch:u32)->vec2<u32>{
 var p=point;
 if(p.x==0u && (stitch&1u)!=0u && p.y%2u!=0u){p.y-=1u;}
 if(p.x==CELLS && (stitch&2u)!=0u && p.y%2u!=0u){p.y-=1u;}
 if(p.y==0u && (stitch&4u)!=0u && p.x%2u!=0u){p.x-=1u;}
 if(p.y==CELLS && (stitch&8u)!=0u && p.x%2u!=0u){p.x-=1u;}
 return p;
}
@vertex
fn vs(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Output {
 let entry=visible[instance];let slot=entry>>4u;let meshlet=entry&15u;let tile=patches[slot];
 let cell=vertex/6u;let corner=vertex%6u;
 let offsets=array<vec2<u32>,6>(vec2<u32>(0u,0u),vec2<u32>(1u,0u),vec2<u32>(0u,1u),vec2<u32>(1u,0u),vec2<u32>(1u,1u),vec2<u32>(0u,1u));
 let cellOrigin=vec2<u32>((meshlet%4u)*4u+cell%4u,(meshlet/4u)*4u+cell/4u);
 let triBase=(corner/3u)*3u;
 let a=cellOrigin+offsets[triBase];let b=cellOrigin+offsets[triBase+1u];let c=cellOrigin+offsets[triBase+2u];
 let stitch=tile.details.z;let coord=stitchCoord(cellOrigin+offsets[corner],stitch);
 let vert=vertices[slot*GRID_COUNT+(coord.y+2u)*GRID+coord.x+2u];
 let relative=tile.relative.xyz+vert.position.xyz;
 var mask=0u;
 if((frame.counts.w & 8u)!=0u){if(onPatchEdge(b,c)){mask|=1u;}if(onPatchEdge(c,a)){mask|=2u;}if(onPatchEdge(a,b)){mask|=4u;}}
 var bary=vec3<f32>(0.0,0.0,1.0);if(corner%3u==0u){bary=vec3<f32>(1.0,0.0,0.0);}else if(corner%3u==1u){bary=vec3<f32>(0.0,1.0,0.0);}
 var out:Output;out.position=frame.viewProjection*vec4<f32>(relative,1.0);out.normal=vert.normal.xyz;
 out.direction=normalize(tile.centerDirection.xyz+vert.position.xyz/frame.settings.x);out.relative=relative;out.height=vert.position.w;
 out.level=tile.details.y;out.bary=bary;out.edgeMask=mask;out.cavity=vert.normal.w;out.surface=vert.surface;
 out.patchUv=vec2<f32>(coord)/f32(CELLS);out.patchSlot=slot;return out;
}
fn sampleRiver(slot:u32,uv:vec2<f32>)->f32{
 let p=clamp(uv,vec2<f32>(0.0),vec2<f32>(1.0))*32.0+vec2<f32>(4.0);let x=min(u32(floor(p.x)),39u);let y=min(u32(floor(p.y)),39u);
 let f=p-vec2<f32>(f32(x),f32(y));let i=slot*1681u+y*41u+x;
 return mix(mix(riverMasks[i].x,riverMasks[i+1u].x,f.x),mix(riverMasks[i+41u].x,riverMasks[i+42u].x,f.x),f.y);
}
fn stitchedRiver(slot:u32,uv:vec2<f32>)->f32{
 let tile=patches[slot];let stitch=tile.details.z;var result=sampleRiver(slot,uv);var blend=0.0;var edge=4u;
 if((stitch&1u)!=0u){let w=1.0-smoothstep(0.0,.125,uv.x);if(w>blend){blend=w;edge=0u;}}
 if((stitch&2u)!=0u){let w=1.0-smoothstep(0.0,.125,1.0-uv.x);if(w>blend){blend=w;edge=1u;}}
 if((stitch&4u)!=0u){let w=1.0-smoothstep(0.0,.125,uv.y);if(w>blend){blend=w;edge=2u;}}
 if((stitch&8u)!=0u){let w=1.0-smoothstep(0.0,.125,1.0-uv.y);if(w>blend){blend=w;edge=3u;}}
 if(edge<4u){let neighbor=tile.coarseNeighbors[edge];if(neighbor!=0xffffffffu){
  let coarse=patches[neighbor];let p=tile.cube.xyz+tile.axisU.xyz*((uv.x-.5)*tile.cube.w)+tile.axisV.xyz*((uv.y-.5)*tile.cube.w);
  let normal=normalize(cross(coarse.axisU.xyz,coarse.axisV.xyz));let projected=p/max(.001,dot(p,normal));let offset=projected-coarse.cube.xyz;
  let c=vec2<f32>(dot(offset,coarse.axisU.xyz),dot(offset,coarse.axisV.xyz))/coarse.cube.w+vec2<f32>(.5);
  result=mix(result,sampleRiver(neighbor,c),blend);
 }}
 return result;
}
fn levelColor(level:u32)->vec3<f32>{
 let palette=array<vec3<f32>,6>(vec3<f32>(0.12,0.66,0.80),vec3<f32>(0.23,0.75,0.48),vec3<f32>(0.85,0.67,0.20),vec3<f32>(0.90,0.36,0.20),vec3<f32>(0.73,0.27,0.68),vec3<f32>(0.36,0.37,0.90));
 return palette[level%6u];
}
@fragment
fn fs(in:Output)->@location(0) vec4<f32> {
 let radial=normalize(in.direction);let light=normalize(frame.sun.xyz);let h=in.height;
 let pixelKm=max(length(dpdx(in.direction)),length(dpdy(in.direction)))*6371.0;var river=0.0;
 if(frame.hydrology.y>.5 && frame.hydrology.x>0.0 && h>=0.0 && pixelKm<1.0){river=stitchedRiver(in.patchSlot,in.patchUv)*(1.0-smoothstep(.6,1.0,pixelKm));}
 // The coarse basin estimate cannot resolve individual lake shorelines from
 // orbit. Suppress their aliasing when one pixel covers several kilometers.
 let lake=clamp(in.surface.x,0.0,1.0)*(1.0-smoothstep(2.0,6.0,pixelKm));
 let water=select(0.0,max(lake,river),frame.hydrology.y>.5 && h>=0.0);
 let n=normalize(mix(in.normal,radial,water*.8));let slope=1.0-clamp(dot(n,radial),0.0,1.0);
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
 if(h<0.0){base=mix(deep,ocean,smoothstep(-4.0,0.0,h));}
 if(h>=0.0){base=mix(base,vec3<f32>(.025,.16,.19),smoothstep(.1,.6,water));}
 if((frame.counts.w&2u)!=0u){base=levelColor(in.level);}
 let diffuse=max(dot(n,light),0.0);let fill=.22+.10*max(n.y,0.0);
 var color=base*(fill+diffuse*.95)*(1.0-in.cavity*.30);
 let view=normalize(-in.relative);let rim=pow(1.0-clamp(dot(radial,view),0.0,1.0),4.0)*.055;
 color+=vec3<f32>(.10,.38,.58)*rim;
 // Compress highlights before display encoding so bright snow keeps
 // shading detail instead of clipping against the canvas's white limit.
 color=color/(vec3<f32>(1.0)+color*.28);
 color=pow(max(color,vec3<f32>(0.0)),vec3<f32>(1.0/2.2));
 if((frame.counts.w&12u)!=0u){
  let edge=vec3<f32>(1.0)-smoothstep(vec3<f32>(.55),vec3<f32>(1.7),in.bary/max(fwidth(in.bary),vec3<f32>(.00001)));
  if((frame.counts.w&4u)!=0u){color=mix(color,vec3<f32>(.02,.03,.04),max(edge.x,max(edge.y,edge.z))*.75);}
  if((frame.counts.w&8u)!=0u){var e=0.0;if((in.edgeMask&1u)!=0u){e=max(e,edge.x);}if((in.edgeMask&2u)!=0u){e=max(e,edge.y);}if((in.edgeMask&4u)!=0u){e=max(e,edge.z);}color=mix(color,vec3<f32>(.9,.98,1.0),e*.85);}
 }
 return vec4<f32>(color,1.0);
}

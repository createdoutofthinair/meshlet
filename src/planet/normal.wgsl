@group(0) @binding(0) var<uniform> frame:PlanetFrame;
@group(0) @binding(1) var<storage,read> patches:array<Patch>;
@group(0) @binding(2) var<storage,read_write> vertices:array<PlanetVertex>;
@group(0) @binding(3) var<storage,read> queue:array<u32>;
@group(0) @binding(4) var<storage,read> plates:array<vec4<f32>>;
fn visibleNormalHeight(direction:vec3<f32>,high:vec3<f32>,low:vec3<f32>,delta:vec3<f32>,seed:u32)->f32{
 let h=clamp(surfaceBase(direction,high,low,delta,seed,false).height*frame.settings.y,-10.0,10.0);
 return select(h,max(h,0.0),frame.settings.z>.5);
}
// Fixed geographic distances make the derivative independent of the mesh
// level. A broad and a fine derivative are filtered by pixel footprint later.
fn worldSlopes(direction:vec3<f32>,high:vec3<f32>,low:vec3<f32>,delta:vec3<f32>,east:vec3<f32>,north:vec3<f32>,height:f32,step:f32,seed:u32)->vec2<f32>{
 let de=east*(step/frame.settings.x);let dn=north*(step/frame.settings.x);
 let he=visibleNormalHeight(normalize(direction+de),high,low,delta+de,seed);
 let hn=visibleNormalHeight(normalize(direction+dn),high,low,delta+dn,seed);
 return clamp(vec2<f32>((he-height)/step,(hn-height)/step),vec2<f32>(-4.0),vec2<f32>(4.0));
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
 let index=gid.x;if(index>=frame.queueCounts.x*INNER_COUNT){return;}
 let slot=queue[index/INNER_COUNT];let v=index%INNER_COUNT;
 let gx=v%17u;let gy=v/17u;let base=slot*GRID_COUNT+(gy+2u)*GRID+gx+2u;
 let tile=patches[slot];let vert=vertices[base];let h=select(vert.position.w,max(vert.position.w,0.0),frame.settings.z>.5);
 let elevation=h/frame.settings.x;let delta=(vert.position.xyz/frame.settings.x-(tile.centerDirection.xyz+tile.centerLow.xyz)*elevation)/(1.0+elevation);
 let direction=normalize(tile.centerDirection.xyz+tile.centerLow.xyz+delta);
 if(frame.settings.z>.5 && vert.position.w<0.0){vertices[base].normal=vec4<f32>(direction,0.0);vertices[base].surface=vec4<f32>(vert.surface.xy,0.0,0.0);return;}
 var east=cross(vec3<f32>(0.0,1.0,0.0),direction);
 if(dot(east,east)<.000000000001){east=cross(vec3<f32>(1.0,0.0,0.0),direction);}
 east=normalize(east);let north=normalize(cross(direction,east));let seed=frame.counts.z;
 let center=select(vert.surface.z,max(vert.surface.z,0.0),frame.settings.z>.5);
 let fine=worldSlopes(direction,tile.centerDirection.xyz,tile.centerLow.xyz,delta,east,north,center,.002,seed);
 let broad=worldSlopes(direction,tile.centerDirection.xyz,tile.centerLow.xyz,delta,east,north,center,2.0,seed);
 let normal=normalize(direction-east*fine.x-north*fine.y);
 vertices[base].normal=vec4<f32>(normal,0.0);vertices[base].surface=vec4<f32>(vert.surface.xy,broad);
}

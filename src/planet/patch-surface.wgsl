// Shared rendered patch positions use camera-relative kilometres.
fn stitchCoord(point:vec2<u32>,mask:u32)->vec2<u32>{
 var p=point;
 if(p.x==0u && (mask&1u)!=0u && p.y%2u!=0u){p.y-=1u;}
 if(p.x==CELLS && (mask&2u)!=0u && p.y%2u!=0u){p.y-=1u;}
 if(p.y==0u && (mask&4u)!=0u && p.x%2u!=0u){p.x-=1u;}
 if(p.y==CELLS && (mask&8u)!=0u && p.x%2u!=0u){p.x-=1u;}
 return p;
}
fn at(slot:u32,point:vec2<u32>,mask:u32)->vec3<f32>{
 let p=stitchCoord(point,mask);
 return patches[slot].relative.xyz+vertices[slot*GRID_COUNT+(p.y+2u)*GRID+p.x+2u].position.xyz;
}
// Interpolate in the *collapsed* parameter-space triangles used by rendering.
// An odd edge vertex can move one full cell, so the covering triangle can
// belong to a neighboring cell rather than floor(coord).
fn sampleSurfaceVertex(slot:u32,coord:vec2<f32>,mask:u32)->PlanetVertex{
 let q=clamp(coord,vec2<f32>(0.0),vec2<f32>(f32(CELLS)));
 let integer=vec2<u32>(round(q));
 if(all(q==vec2<f32>(integer)) && all(stitchCoord(integer,mask)==integer)){
  return vertices[slot*GRID_COUNT+(integer.y+2u)*GRID+integer.x+2u];
 }
 let base=vec2<i32>(min(floor(q),vec2<f32>(f32(CELLS-1u))));
 let offsets=array<vec2<u32>,6>(vec2<u32>(0u,0u),vec2<u32>(1u,0u),vec2<u32>(0u,1u),vec2<u32>(1u,0u),vec2<u32>(1u,1u),vec2<u32>(0u,1u));
 let radius=select(0,1,mask!=0u);
 for(var dy=-radius;dy<=radius;dy++){for(var dx=-radius;dx<=radius;dx++){
  let c=base+vec2<i32>(dx,dy);
  if(any(c<vec2<i32>(0))||any(c>=vec2<i32>(i32(CELLS)))){continue;}
  let cell=vec2<u32>(c);
  for(var tri=0u;tri<2u;tri++){
   let ia=stitchCoord(cell+offsets[tri*3u],mask);
   let ib=stitchCoord(cell+offsets[tri*3u+1u],mask);
   let ic=stitchCoord(cell+offsets[tri*3u+2u],mask);
   let a=vec2<f32>(ia);let ab=vec2<f32>(ib)-a;let ac=vec2<f32>(ic)-a;let aq=q-a;
   let det=ab.x*ac.y-ab.y*ac.x;
   if(abs(det)<.5){continue;}
   let u=(aq.x*ac.y-aq.y*ac.x)/det;
   let v=(ab.x*aq.y-ab.y*aq.x)/det;
   if(u>=-.000001 && v>=-.000001 && u+v<=1.000001){
    let pa=vertices[slot*GRID_COUNT+(ia.y+2u)*GRID+ia.x+2u];
    let pb=vertices[slot*GRID_COUNT+(ib.y+2u)*GRID+ib.x+2u];
    let pc=vertices[slot*GRID_COUNT+(ic.y+2u)*GRID+ic.x+2u];
    var result:PlanetVertex;
    result.position=pa.position+(pb.position-pa.position)*u+(pc.position-pa.position)*v;
    // Keep interpolated normals unnormalized until fragment shading, matching
    // the endpoint's original vertex-to-fragment interpolation.
    result.normal=pa.normal+(pb.normal-pa.normal)*u+(pc.normal-pa.normal)*v;
    result.surface=pa.surface+(pb.surface-pa.surface)*u+(pc.surface-pa.surface)*v;
    return result;
   }
  }
 }}
 // A valid stitched grid covers its domain; guard against f32 roundoff.
 let p=stitchCoord(vec2<u32>(round(q)),mask);
 return vertices[slot*GRID_COUNT+(p.y+2u)*GRID+p.x+2u];
}

fn parentSurface(slot:u32,coord:vec2<f32>,mask:u32)->vec3<f32>{
 return patches[slot].relative.xyz+sampleSurfaceVertex(slot,coord,mask).position.xyz;
}

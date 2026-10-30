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
fn parentSurface(slot:u32,coord:vec2<f32>,mask:u32)->vec3<f32>{
 let q=clamp(coord,vec2<f32>(0.0),vec2<f32>(f32(CELLS)));
 let base=vec2<i32>(min(floor(q),vec2<f32>(f32(CELLS-1u))));
 let offsets=array<vec2<u32>,6>(vec2<u32>(0u,0u),vec2<u32>(1u,0u),vec2<u32>(0u,1u),vec2<u32>(1u,0u),vec2<u32>(1u,1u),vec2<u32>(0u,1u));
 for(var dy=-1;dy<=1;dy++){for(var dx=-1;dx<=1;dx++){
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
    let pa=at(slot,ia,0u);let pb=at(slot,ib,0u);let pc=at(slot,ic,0u);
    return pa+(pb-pa)*u+(pc-pa)*v;
   }
  }
 }}
 // A valid stitched grid covers its domain; guard against f32 roundoff.
 return at(slot,vec2<u32>(round(q)),mask);
}

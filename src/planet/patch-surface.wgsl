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
fn parentSurface(slot:u32,coord:vec2<f32>,mask:u32)->vec3<f32>{
 let q=clamp(coord,vec2<f32>(0.0),vec2<f32>(16.0));
 // Along a collapsed edge, the visible segment spans two cells. Sampling
 // the collapsed odd vertex directly would report a false tangential error.
 if((q.x==0.0 && (mask&1u)!=0u)||(q.x==16.0 && (mask&2u)!=0u)){
  let y=u32(min(floor(q.y*.5)*2.0,14.0));
  return mix(at(slot,vec2<u32>(u32(q.x),y),mask),at(slot,vec2<u32>(u32(q.x),y+2u),mask),(q.y-f32(y))*.5);
 }
 if((q.y==0.0 && (mask&4u)!=0u)||(q.y==16.0 && (mask&8u)!=0u)){
  let x=u32(min(floor(q.x*.5)*2.0,14.0));
  return mix(at(slot,vec2<u32>(x,u32(q.y)),mask),at(slot,vec2<u32>(x+2u,u32(q.y)),mask),(q.x-f32(x))*.5);
 }
 let cell=vec2<u32>(min(floor(q),vec2<f32>(15.0)));let f=q-vec2<f32>(cell);
 let a=at(slot,cell,mask);let b=at(slot,cell+vec2<u32>(1u,0u),mask);
 let c=at(slot,cell+vec2<u32>(0u,1u),mask);let d=at(slot,cell+vec2<u32>(1u,1u),mask);
 if(f.x+f.y<=1.0){return a*(1.0-f.x-f.y)+b*f.x+c*f.y;}
 return b*(1.0-f.y)+c*(1.0-f.x)+d*(f.x+f.y-1.0);
}

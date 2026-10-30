// Slot-indexed transition metadata. Disabled entries never read a parent.
fn displayedPosition(slot:u32,point:vec2<u32>,mask:u32)->vec3<f32>{
 let fine=at(slot,point,mask);let morph=morphs.patches[slot];
 if(morph.slots.w==0u || morph.mapping.w>=1.0){return fine;}
 let actual=stitchCoord(point,mask);
 let coarse=parentSurface(morph.slots.x,morph.mapping.xy+vec2<f32>(actual)*morph.mapping.z,morph.slots.y);
 if(morph.mapping.w<=0.0){return coarse;}
 return mix(coarse,fine,morph.mapping.w);
}

fn displayedSample(slot:u32,q:vec2<f32>)->vec3<f32>{
 let m=morphs.patches[slot];
 let fine=parentSurface(slot,q,m.slots.z&15u);
 if(m.mapping.w>=1.0){return fine;}
 let coarse=parentSurface(m.slots.x,m.mapping.xy+q*m.mapping.z,m.slots.y);
 if(m.mapping.w<=0.0){return coarse;}
 return mix(coarse,fine,m.mapping.w);
}

// Rendering needs both attributes and positions from the same endpoint
// triangles. Return both to avoid sampling each endpoint twice.
struct DisplayedVertex {vertex:PlanetVertex,relative:vec3<f32>};
fn displayedVertex(slot:u32,q:vec2<f32>,mask:u32)->DisplayedVertex{
 let m=morphs.patches[slot];var fine=sampleSurfaceVertex(slot,q,mask);
 let fineRelative=patches[slot].relative.xyz+fine.position.xyz;
 if(m.mapping.w>=1.0){return DisplayedVertex(fine,fineRelative);}
 let coarse=sampleSurfaceVertex(m.slots.x,m.mapping.xy+q*m.mapping.z,m.slots.y);
 let coarseRelative=patches[m.slots.x].relative.xyz+coarse.position.xyz;
 let t=clamp(m.mapping.w,0.0,1.0);
 fine.position.w=mix(coarse.position.w,fine.position.w,t);
 fine.normal=mix(coarse.normal,fine.normal,t);
 fine.surface=mix(coarse.surface,fine.surface,t);
 if(m.mapping.w<=0.0){return DisplayedVertex(fine,coarseRelative);}
 return DisplayedVertex(fine,mix(coarseRelative,fineRelative,m.mapping.w));
}

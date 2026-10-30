@group(0) @binding(0) var<uniform> frame:PlanetFrame;
@group(0) @binding(5) var<storage,read> plates:array<vec4<f32>>;
struct OceanView {
 radialHeight:vec4<f32>, // camera radial, altitude over sea level in km
 forwardTanY:vec4<f32>,
 rightTanX:vec4<f32>,
 upWidth:vec4<f32>,
 viewport:vec4<f32>, // height in pixels, near plane in km
};
@group(0) @binding(11) var<uniform> oceanView:OceanView;
@group(0) @binding(12) var waterDepth:texture_2d<f32>;
struct OceanVertex {@builtin(position) position:vec4<f32>};
struct OceanPixel {@location(0) color:vec4<f32>,@builtin(frag_depth) depth:f32};
@vertex fn oceanVertex(@builtin(vertex_index) index:u32)->OceanVertex{
 let points=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
 return OceanVertex(vec4<f32>(points[index],0.0,1.0));
}
// Factored sphere intersection avoids subtracting two nearly equal large
// distances when the camera is only metres above the water surface.
fn waterIntersection(radius:f32,radial:vec3<f32>,height:f32,ray:vec3<f32>)->vec2<f32>{
 let h=max(-radius+.0001,height);
 let b=(radius+h)*dot(radial,ray);let c=h*(2.0*radius+h);
 let discriminant=b*b-c;
 if((b>=0.0 && c>=0.0) || discriminant<0.0){return vec2<f32>(0.0);}
 let root=sqrt(discriminant);let far=-b+root;
 // From inside the sphere, the outward root also needs the factored form
 // when the camera is just below the surface and looking away from center.
 var t=c/max(.000000001,far);
 if(c<0.0){t=select(far,-c/max(.000000001,root+b),b>=0.0);}
 return vec2<f32>(t,select(0.0,1.0,t>0.0));
}
fn oceanIntersection(radial:vec3<f32>,height:f32,ray:vec3<f32>)->vec2<f32>{return waterIntersection(frame.settings.x,radial,height,ray);}
@fragment fn oceanFragment(@builtin(position) pixel:vec4<f32>)->OceanPixel{
 let ndc=vec2<f32>(pixel.x/oceanView.upWidth.w*2.0-1.0,1.0-pixel.y/oceanView.viewport.x*2.0);
 let ray=normalize(oceanView.forwardTanY.xyz+oceanView.rightTanX.xyz*(ndc.x*oceanView.rightTanX.w)+oceanView.upWidth.xyz*(ndc.y*oceanView.forwardTanY.w));
 let radial=normalize(oceanView.radialHeight.xyz);let height=oceanView.radialHeight.w;
 let signedDepth=textureLoad(waterDepth,vec2<i32>(pixel.xy),0).x;
 var hit=vec2<f32>(0.0);var direction=radial;var isLake=false;var coast=vec2<f32>(0.0);
 if(signedDepth<0.0 && frame.hydrology.y>.5 && frame.hydrology.x>0.0){
  let rayForward=max(.000001,dot(ray,oceanView.forwardTanY.xyz));
  let terrainDistance=oceanView.viewport.y/(abs(signedDepth)*rayForward);
  let terrainDirection=normalize(radial+(radial*height+ray*terrainDistance)/frame.settings.x);
  let basin=worldLake(worldSample(terrainDirection));
  if(basin.x>0.0){
   let lakeHeight=clamp(basin.y*frame.settings.y,0.0,10.0);
   let lakeHit=waterIntersection(frame.settings.x+lakeHeight,radial,height-lakeHeight,ray);
   if(lakeHit.y>.5){
    let p=normalize(radial+(radial*height+ray*lakeHit.x)/frame.settings.x);
    let lake=surfaceBase(p,p,vec3<f32>(0.0),vec3<f32>(0.0),frame.counts.z,false).lake;
    if(lake>.5){hit=lakeHit;direction=p;isLake=true;}
   }
  }
 }
 if(!isLake){
  // If the original terrain classified this pixel as a lake but its exact
  // sphere intersection is outside the basin, keep the terrain edge color.
  if(signedDepth<0.0){discard;}
  hit=oceanIntersection(radial,height,ray);if(hit.y<.5){discard;}
 }
 let relative=ray*hit.x;let clip=frame.viewProjection*vec4<f32>(relative,1.0);let depth=clip.z/clip.w;if(depth<=0.0 || depth>1.0){discard;}
 if(!isLake && signedDepth>0.0 && depth<=signedDepth){discard;}
 // Reject occluded ocean before evaluating the procedural coastline.
 if(!isLake){direction=normalize(radial+(radial*height+ray*hit.x)/frame.settings.x);coast=naturalCoast(direction,frame.counts.z);if(coast.x>=0.0){discard;}}
 let deep=vec3<f32>(0.012,0.055,0.092);let shallow=vec3<f32>(0.025,0.17,0.23);
 var base=mix(deep,shallow,smoothstep(-4.0,0.0,min(coast.y,0.0)));
 if(isLake){base=vec3<f32>(.025,.16,.19);}
 let diffuse=max(dot(direction,normalize(frame.sun.xyz)),0.0);let fill=.22+.10*max(direction.y,0.0);
 var color=base*(fill+diffuse*.95);
 let rim=pow(1.0-clamp(dot(direction,-ray),0.0,1.0),4.0)*.055;color+=vec3<f32>(.10,.38,.58)*rim;
 color=color/(vec3<f32>(1.0)+color*.28);color=pow(max(color,vec3<f32>(0.0)),vec3<f32>(1.0/2.2));
 return OceanPixel(vec4<f32>(color,1.0),depth);
}

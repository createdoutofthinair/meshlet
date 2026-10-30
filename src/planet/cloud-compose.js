// Use the cloud lab's weather and density functions in the planet's local frame.
export function planetCloudSource(atmosphere,cloud,fragment){
 const prefix=cloud.slice(0,cloud.indexOf('@fragment fn fragment'))
  .replace('shape:vec4<f32>};','shape:vec4<f32>,radial:vec4<f32>,east:vec4<f32>,north:vec4<f32>,forward:vec4<f32>,right:vec4<f32>,up:vec4<f32>,sun:vec4<f32>,atmosphere:vec4<f32>};')
  // These planet-only uniform components hold values shared by every pixel.
  .replace('let windCos=cos(angle);let windSin=sin(angle);','let windCos=params.sky.y;let windSin=params.cloud.w;')
  .replace('let axis=normalize(vec3<f32>(.08+sin(seed*.07)*.08,.99,.07+cos(seed*.09)*.08));','let axis=params.shape.yzw;')
  .replace('cos(angle),sin(angle),.00028/max(.5,params.shape.x)', 'params.sky.y,params.cloud.w,.00028/max(.5,params.shape.x)')
  .replace('let pos=vec3<f32>(point.x,PLANET_RADIUS+point.y,point.z);','let pos=params.east.xyz*point.x+params.radial.xyz*(PLANET_RADIUS+point.y)+params.north.xyz*point.z;')
  .replace('let global=vec3<f32>(p.x,PLANET_RADIUS+p.y,p.z);','let global=params.east.xyz*p.x+params.radial.xyz*(PLANET_RADIUS+p.y)+params.north.xyz*p.z;')
  // The lab's very coarse fallback creates huge opaque islands in orbit.
  // Preserve mid-scale structure and broaden the density transition as its
  // high-frequency detail approaches a pixel.
  .replace('coarse=cloudNoise(q*.16+vec3<f32>(8.0,14.0,3.0));',`let firstCoarse=cloudNoise(q*.45+vec3<f32>(8.0,14.0,3.0));
   let coarseUpper=(firstCoarse*.7+.30002)*(1.0-detailWeight)+1.08002*detailWeight;
   if(coarseUpper<=lower){return 0.0;}
   coarse=firstCoarse*.7+cloudNoise(q*.78+vec3<f32>(3.0,9.0,17.0))*.3;`)
  .replace('let lower=threshold;','let lower=threshold-.04*(1.0-detailWeight);')
  .replace('let upperThreshold=threshold+.23;','let upperThreshold=threshold+.23+.16*(1.0-detailWeight);');
 const tuned=atmosphere.replace('let warm=vec3<f32>(1.0,.30,.075)*(twilight*.28+day*.035)*min(2.0,atmosphereMiePhase(mu))*density;', 'let warm=vec3<f32>(1.0,.30,.075)*(twilight*.28+day*.035)*min(2.0,atmosphereMiePhase(mu))*density*params.atmosphere.y;').replace('return skyLight*density+warm+sun;', 'return skyLight*density*params.atmosphere.x+warm+sun;');
 return tuned+'\n'+prefix+'\n'+fragment;
}

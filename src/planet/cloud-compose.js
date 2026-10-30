// Use the cloud lab's weather and density functions in the planet's local frame.
export function planetCloudSource(atmosphere,cloud,fragment){
 const prefix=cloud.slice(0,cloud.indexOf('@fragment fn fragment'))
  .replace('cloud:vec4<f32>};','cloud:vec4<f32>,radial:vec4<f32>,east:vec4<f32>,north:vec4<f32>,forward:vec4<f32>,right:vec4<f32>,up:vec4<f32>,sun:vec4<f32>,atmosphere:vec4<f32>};')
  .replace('let pos=vec3<f32>(point.x,PLANET_RADIUS+point.y,point.z);','let pos=params.east.xyz*point.x+params.radial.xyz*(PLANET_RADIUS+point.y)+params.north.xyz*point.z;')
  .replace('let global=vec3<f32>(p.x,PLANET_RADIUS+p.y,p.z);','let global=params.east.xyz*p.x+params.radial.xyz*(PLANET_RADIUS+p.y)+params.north.xyz*p.z;')
  // The lab's very coarse fallback creates huge opaque islands in orbit.
  // Preserve mid-scale structure and broaden the density transition as its
  // high-frequency detail approaches a pixel.
  .replace('let coarse=cloudNoise(q*.16+vec3<f32>(8.0,14.0,3.0));','let coarse=cloudNoise(q*.45+vec3<f32>(8.0,14.0,3.0))*.7+cloudNoise(q*.78+vec3<f32>(3.0,9.0,17.0))*.3;')
  .replace('smoothstep(threshold,threshold+.23,base+(erode-.5)*.16*detailWeight)','smoothstep(threshold-.04*(1.0-detailWeight),threshold+.23+.16*(1.0-detailWeight),base+(erode-.5)*.16*detailWeight)');
 const tuned=atmosphere.replace('let warm=vec3<f32>(1.0,.30,.075)*(twilight*.28+day*.035)*min(2.0,atmosphereMiePhase(mu))*density;', 'let warm=vec3<f32>(1.0,.30,.075)*(twilight*.28+day*.035)*min(2.0,atmosphereMiePhase(mu))*density*params.atmosphere.y;').replace('return skyLight*density+warm+sun;', 'return skyLight*density*params.atmosphere.x+warm+sun;');
 return tuned+'\n'+prefix+'\n'+fragment;
}

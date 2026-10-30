// Use the cloud lab's weather and density functions in the planet's local frame.
export function planetCloudSource(atmosphere,cloud,fragment){
 const prefix=cloud.slice(0,cloud.indexOf('@fragment fn fragment'))
  .replace('cloud:vec4<f32>};','cloud:vec4<f32>,radial:vec4<f32>,east:vec4<f32>,north:vec4<f32>,forward:vec4<f32>,right:vec4<f32>,up:vec4<f32>,sun:vec4<f32>};')
  .replace('let pos=vec3<f32>(point.x,PLANET_RADIUS+point.y,point.z);','let pos=params.east.xyz*point.x+params.radial.xyz*(PLANET_RADIUS+point.y)+params.north.xyz*point.z;')
  .replace('let global=vec3<f32>(p.x,PLANET_RADIUS+p.y,p.z);','let global=params.east.xyz*p.x+params.radial.xyz*(PLANET_RADIUS+p.y)+params.north.xyz*p.z;');
 return atmosphere+'\n'+prefix+'\n'+fragment;
}

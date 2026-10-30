// Lightweight local-atmosphere approximation in linear RGB. Distances and
// altitude are metres; up and sun are world-space unit directions. This is
// not the planet-scale multiple-scattering LUT solution.
fn atmosphereRayleighPhase(mu:f32)->f32{return .75*(1.0+mu*mu);}
fn atmosphereMiePhase(mu:f32)->f32{
 let g=.76;return (1.0-g*g)/pow(max(.04,1.0+g*g-2.0*g*mu),1.5);
}
fn atmosphereSky(direction:vec3<f32>,sunDirection:vec3<f32>,upDirection:vec3<f32>,altitude:f32)->vec3<f32>{
 let up=clamp(dot(direction,upDirection),0.0,1.0);let mu=clamp(dot(direction,sunDirection),-1.0,1.0);
 let density=exp(-max(0.0,altitude)/8000.0);let aerosol=exp(-max(0.0,altitude)/1200.0);
 let horizon=pow(1.0-up,2.0);let rayleigh=atmosphereRayleighPhase(mu);
 let base=mix(vec3<f32>(.13,.27,.45),vec3<f32>(.48,.58,.64),horizon);
 let warm=vec3<f32>(.58,.35,.18)*min(1.2,atmosphereMiePhase(mu))*.055*aerosol;
 let sun=vec3<f32>(1.0,.83,.60)*pow(max(mu,0.0),420.0)*1.5;
 return base*density*(.85+.15*rayleigh)+warm+sun;
}
fn atmosphereAerial(color:vec3<f32>,viewDirection:vec3<f32>,distance:f32,sunDirection:vec3<f32>,upDirection:vec3<f32>,altitude:f32)->vec3<f32>{
 let molecular=exp(-max(0.0,altitude)/8000.0);let aerosol=exp(-max(0.0,altitude)/1200.0);
 let extinction=vec3<f32>(5.8,13.5,33.1)*.000001*molecular+vec3<f32>(.000045)*aerosol;
 let transmission=exp(-extinction*max(0.0,distance));
 let inscatter=atmosphereSky(viewDirection,sunDirection,upDirection,altitude);
 return color*transmission+inscatter*(vec3<f32>(1.0)-transmission);
}

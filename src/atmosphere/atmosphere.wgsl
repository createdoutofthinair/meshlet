// Lightweight local-atmosphere approximation in linear RGB. Distances and
// altitude are metres; up and sun are world-space unit directions. This is
// not the planet-scale multiple-scattering LUT solution.
fn atmosphereRayleighPhase(mu:f32)->f32{return .75*(1.0+mu*mu);}
fn atmosphereMiePhase(mu:f32)->f32{
 let g=.76;return (1.0-g*g)/pow(max(.04,1.0+g*g-2.0*g*mu),1.5);
}
// Daylight falls off as the sun sinks; twilight persists below the horizon.
fn atmosphereDaylight(sunElevation:f32)->f32{return smoothstep(-.12,.06,sunElevation);}
fn atmosphereTwilight(sunElevation:f32)->f32{return smoothstep(-.20,-.02,sunElevation)*(1.0-smoothstep(.03,.25,sunElevation));}
fn atmosphereSky(direction:vec3<f32>,sunDirection:vec3<f32>,upDirection:vec3<f32>,altitude:f32)->vec3<f32>{
 let up=clamp(dot(direction,upDirection),0.0,1.0);let mu=clamp(dot(direction,sunDirection),-1.0,1.0);
 let density=exp(-max(0.0,altitude)/8000.0);let aerosol=exp(-max(0.0,altitude)/1200.0);
 let sunElevation=dot(sunDirection,upDirection);let day=atmosphereDaylight(sunElevation);let twilight=atmosphereTwilight(sunElevation);
 let horizon=pow(1.0-up,2.0);let rayleigh=atmosphereRayleighPhase(mu);
 let base=mix(vec3<f32>(.13,.27,.45),vec3<f32>(.48,.58,.64),horizon);
 let warm=vec3<f32>(1.0,.30,.075)*(twilight*.28+day*.035)*min(2.0,atmosphereMiePhase(mu))*density;
 let dip=sqrt(2.0*max(0.0,altitude)/6371000.0);let discVisible=smoothstep(-.015,.015,sunElevation+dip);
 let sunTint=mix(vec3<f32>(1.0,.32,.09),vec3<f32>(1.0,.83,.60),smoothstep(.0,.3,sunElevation));
 let sun=sunTint*pow(max(mu,0.0),420.0)*1.5*discVisible;
 let skyLight=mix(vec3<f32>(.008,.012,.025),base*(.85+.15*rayleigh),day);
 return skyLight*density+warm+sun;
}
fn atmosphereAerial(color:vec3<f32>,viewDirection:vec3<f32>,distance:f32,sunDirection:vec3<f32>,upDirection:vec3<f32>,altitude:f32)->vec3<f32>{
 let molecular=exp(-max(0.0,altitude)/8000.0);let aerosol=exp(-max(0.0,altitude)/1200.0);
 let extinction=vec3<f32>(5.8,13.5,33.1)*.000001*molecular+vec3<f32>(.000045)*aerosol;
 let transmission=exp(-extinction*max(0.0,distance));
 let inscatter=atmosphereSky(viewDirection,sunDirection,upDirection,altitude);
 return color*transmission+inscatter*(vec3<f32>(1.0)-transmission);
}

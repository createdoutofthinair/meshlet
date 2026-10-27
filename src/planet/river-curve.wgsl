fn riverTangent(vector:vec3<f32>,radial:vec3<f32>,scale:f32)->vec3<f32>{
 let tangent=vector-radial*dot(vector,radial);return tangent/max(length(tangent),.0000001)*scale;
}
fn riverCurve(a:vec3<f32>,b:vec3<f32>,m0:vec3<f32>,m1:vec3<f32>,t:f32)->vec3<f32>{
 let t2=t*t;let t3=t2*t;
 return a*(2.0*t3-3.0*t2+1.0)+m0*(t3-2.0*t2+t)+b*(-2.0*t3+3.0*t2)+m1*(t3-t2);
}
fn riverDerivative(a:vec3<f32>,b:vec3<f32>,m0:vec3<f32>,m1:vec3<f32>,t:f32)->vec3<f32>{
 let t2=t*t;return a*(6.0*t2-6.0*t)+m0*(3.0*t2-4.0*t+1.0)+b*(-6.0*t2+6.0*t)+m1*(3.0*t2-2.0*t);
}

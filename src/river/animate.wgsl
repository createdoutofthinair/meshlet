@group(0) @binding(2) var<storage,read_write> motion:array<vec4<f32>>;
@compute @workgroup_size(1) fn advanceWater(){
 let previous=motion[0];let dt=clamp(riverFrame.cameraDelta.w,0.0,1.0);
 motion[0]=vec4<f32>(previous.x+max(0.0,riverFrame.sunSpeed.w)*dt,previous.y+dt,0.0,0.0);
}

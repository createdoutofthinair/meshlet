@group(0) @binding(13) var<storage,read_write> oceanSamples:array<vec4<f32>>;
@compute @workgroup_size(1) fn oceanIntersectionCheck(){
 let radial=vec3<f32>(0.0,1.0,0.0);
 let near=oceanIntersection(radial,.0017,vec3<f32>(0.0,-1.0,0.0));
 let orbit=oceanIntersection(radial,100.0,normalize(vec3<f32>(.6,-.8,0.0)));
 let away=oceanIntersection(radial,100.0,vec3<f32>(0.0,1.0,0.0));
 let horizon=oceanIntersection(radial,.0017,normalize(vec3<f32>(1.0,-.03,0.0)));
 oceanSamples[0]=vec4<f32>(near,orbit);oceanSamples[1]=vec4<f32>(away,horizon);
 let inside=oceanIntersection(radial,-.0017,vec3<f32>(0.0,1.0,0.0));
 let lake=waterIntersection(frame.settings.x+2.0,radial,1.0,vec3<f32>(0.0,-1.0,0.0));
 oceanSamples[2]=vec4<f32>(inside,lake);
}

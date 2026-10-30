// Linearized shallow-water equations on a finite-volume grid. State is
// (surface displacement, x momentum, z momentum, unused). Closed boundaries
// reflect momentum; every shared face uses the same Rusanov flux.
@group(0) @binding(2) var<storage,read> stateIn:array<vec4<f32>>;
@group(0) @binding(3) var<storage,read_write> stateOut:array<vec4<f32>>;
@group(0) @binding(4) var<storage,read> obstacles:array<RiverRock>;
const SIM_X:u32=64u;
const SIM_Z:u32=128u;
const SIM_DEPTH:f32=2.0;
const GRAVITY:f32=9.81;
fn simAt(x:i32,z:i32)->vec3<f32>{
 let xx=clamp(x,0,i32(SIM_X)-1);let zz=clamp(z,0,i32(SIM_Z)-1);
 var value=stateIn[u32(zz)*SIM_X+u32(xx)].xyz;
 if(x<0 || x>=i32(SIM_X)){value.y= -value.y;}
 if(z<0 || z>=i32(SIM_Z)){value.z= -value.z;}
 return value;
}
// A cell inside a protruding rock is an impermeable boundary. Only nearby
// reach sections are considered, matching the seeded obstacle placement.
fn simSolid(x:i32,z:i32)->bool{
 if(x<0 || x>=i32(SIM_X) || z<0 || z>=i32(SIM_Z)){return true;}
 let along=((f32(z)+.5)/f32(SIM_Z)-.5)*REACH_LENGTH;
 let q=(f32(x)+.5)/f32(SIM_X)*2.0-1.0;let across=riverCenter(along)+q*riverHalfWidth();
 let section=i32(floor((along+REACH_LENGTH*.5)/(REACH_LENGTH/f32(RIVER_ROCKS))));
 for(var offset=-1;offset<=1;offset++){
  let index=section+offset;if(index<0 || index>=i32(RIVER_ROCKS)){continue;}
  let rock=obstacles[u32(index)];let rx=max(.1,rock.position.w*rock.shape.z);let rz=max(.1,rock.position.w*rock.shape.w);
  let relative=vec2<f32>((across-rock.position.x)/rx,(along-rock.position.z)/rz);
  if(dot(relative,relative)<.65){return true;}
 }
 return false;
}
fn simNeighbor(x:i32,z:i32,center:vec3<f32>,axis:u32)->vec3<f32>{
 if(!simSolid(x,z)){return simAt(x,z);}
 if(axis==0u){return vec3<f32>(center.x,-center.y,center.z);}
 return vec3<f32>(center.x,center.y,-center.z);
}
fn simFluxX(a:vec3<f32>,b:vec3<f32>)->vec3<f32>{
 let wave=sqrt(GRAVITY*SIM_DEPTH);
 let fa=vec3<f32>(a.y,GRAVITY*SIM_DEPTH*a.x,0.0);let fb=vec3<f32>(b.y,GRAVITY*SIM_DEPTH*b.x,0.0);
 return .5*(fa+fb)-.5*wave*(b-a);
}
fn simFluxZ(a:vec3<f32>,b:vec3<f32>)->vec3<f32>{
 let wave=sqrt(GRAVITY*SIM_DEPTH);
 let fa=vec3<f32>(a.z,0.0,GRAVITY*SIM_DEPTH*a.x);let fb=vec3<f32>(b.z,0.0,GRAVITY*SIM_DEPTH*b.x);
 return .5*(fa+fb)-.5*wave*(b-a);
}
@compute @workgroup_size(64) fn initializeFluid(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=SIM_X*SIM_Z){return;}let x=f32(i%SIM_X);let z=f32(i/SIM_X);
 // A small zero-mean disturbance makes the wave propagation visible.
 let a=exp(-pow((x-32.0)/9.0,2.0)-pow((z-66.0)/3.0,2.0));
 let b=exp(-pow((x-32.0)/9.0,2.0)-pow((z-72.0)/3.0,2.0));
 stateOut[i]=vec4<f32>((a-b)*.22*riverFrame.waterfall.x,0.0,0.0,0.0);
}
@compute @workgroup_size(64) fn stepFluid(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=SIM_X*SIM_Z){return;}let x=i32(i%SIM_X);let z=i32(i/SIM_X);
 if(simSolid(x,z)){stateOut[i]=vec4<f32>(0.0);return;}
 let c=simAt(x,z);let dt=min(.033,riverFrame.cameraDelta.w);let dx=2.0*riverHalfWidth()/f32(SIM_X);let dz=REACH_LENGTH/f32(SIM_Z);
 let fx=simFluxX(c,simNeighbor(x+1,z,c,0u))-simFluxX(simNeighbor(x-1,z,c,0u),c);
 let fz=simFluxZ(c,simNeighbor(x,z+1,c,1u))-simFluxZ(simNeighbor(x,z-1,c,1u),c);
 let updated=c-dt*(fx/dx+fz/dz);
 stateOut[i]=vec4<f32>(updated,0.0);
}

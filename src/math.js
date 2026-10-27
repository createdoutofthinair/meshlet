// Column-major right-handed matrices with WebGPU's 0..1 depth convention.
export function perspective(fov,aspect,near,far) {
  const f=1/Math.tan(fov/2), nf=1/(near-far);
  return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,far*nf,-1, 0,0,far*near*nf,0]);
}
const norm=v=>{const l=Math.hypot(...v)||1;return v.map(x=>x/l)};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export function lookAt(eye,target=[0,0,0],up=[0,1,0]) {
  const z=norm(eye.map((x,i)=>x-target[i])), x=norm(cross(up,z)), y=cross(z,x);
  return new Float32Array([x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0, -dot(x,eye),-dot(y,eye),-dot(z,eye),1]);
}
export function multiply(a,b) {
  const out=new Float32Array(16);
  for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)out[c*4+r]+=a[k*4+r]*b[c*4+k];
  return out;
}
export function frustumPlanes(m) {
  const row=r=>[m[r],m[4+r],m[8+r],m[12+r]];
  const r0=row(0),r1=row(1),r2=row(2),r3=row(3);
  const add=(a,b,s=1)=>a.map((v,i)=>v+b[i]*s);
  return [add(r3,r0),add(r3,r0,-1),add(r3,r1),add(r3,r1,-1),r2,add(r3,r2,-1)].map(p=>{const l=Math.hypot(p[0],p[1],p[2]);return p.map(v=>v/l)});
}
export function orbitCamera(yaw,pitch,distance,aspect) {
  const eye=[distance*Math.cos(pitch)*Math.sin(yaw),distance*Math.sin(pitch),distance*Math.cos(pitch)*Math.cos(yaw)];
  const vp=multiply(perspective(Math.PI/3,aspect,.1,1000),lookAt(eye));
  return {eye,vp,planes:frustumPlanes(vp)};
}

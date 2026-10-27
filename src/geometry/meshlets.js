export const PATCH = 6;
export const LOD_STEPS = [1, 2, 3];
export const LOD_TRIANGLES = LOD_STEPS.map(step => (PATCH / step) ** 2 * 2);
export const MAX_TRIANGLES = LOD_TRIANGLES[0];
export const VERTEX_FLOATS = 8;
export const MESHLET_BYTES = 32;

// A continuous, deliberately high-frequency surface: useful for checking that
// the benchmark is actually drawing detailed geometry rather than flat boxes.
function surface(theta, phi) {
  const st = Math.sin(theta), x=st*Math.cos(phi), y=Math.cos(theta), z=st*Math.sin(phi);
  const r = 1 + .105*Math.sin(5*x+2*y)*Math.cos(6*z-y) +
    .045*Math.sin(13*x+4*z)*Math.cos(11*y-3*z) + .025*Math.cos(23*z+7*x)*Math.sin(19*y);
  return [x*r,y*r,z*r];
}
function cross(a,b) { return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]; }
function sub(a,b) { return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]; }

// Each patch owns three index ranges (72, 18 and 8 triangles). All levels
// share the high-detail vertices and the same conservative bounds.
export function generateMesh(detail = 48) {
  if (!Number.isInteger(detail) || detail < PATCH || detail % PATCH !== 0 || detail > 192) {
    throw new Error('Detail must be a multiple of 6 between 6 and 192.');
  }
  const lat=detail, lon=detail*2, width=lon+1;
  const vertices = new Float32Array((lat+1)*width*VERTEX_FLOATS);
  const e=.0005;
  for (let y=0; y<=lat; y++) for(let x=0; x<=lon; x++) {
    const theta=Math.PI*y/lat, phi=2*Math.PI*x/lon;
    const p=surface(theta,phi);
    const tangentPhi=sub(surface(theta,phi+e),surface(theta,phi-e));
    const tangentTheta=sub(surface(theta+e,phi),surface(theta-e,phi));
    let n=cross(tangentPhi,tangentTheta), len=Math.hypot(...n);
    if(len < 1e-8) { n=[0,Math.cos(theta)>=0?1:-1,0]; len=1; }
    const offset=(y*width+x)*VERTEX_FLOATS;
    vertices.set([p[0],p[1],p[2],1,n[0]/len,n[1]/len,n[2]/len,0],offset);
  }
  const meshletCount=(lat/PATCH)*(lon/PATCH);
  const indices=new Uint32Array(meshletCount*LOD_TRIANGLES.reduce((a,b)=>a+b,0)*3);
  const meshlets=new ArrayBuffer(meshletCount*MESHLET_BYTES);
  const metadata=new DataView(meshlets);
  let index=0,m=0;
  for(let y0=0;y0<lat;y0+=PATCH) for(let x0=0;x0<lon;x0+=PATCH) {
    for(let lod=0;lod<LOD_STEPS.length;lod++) {
      const step=LOD_STEPS[lod];
      metadata.setUint32(m*MESHLET_BYTES+16+lod*4,index,true);
      for(let y=y0;y<y0+PATCH;y+=step) for(let x=x0;x<x0+PATCH;x+=step) {
        const a=y*width+x,b=a+step,c=a+width*step,d=c+step;
        indices[index++]=a; indices[index++]=b; indices[index++]=c;
        indices[index++]=b; indices[index++]=d; indices[index++]=c;
      }
    }
    m++;
  }
  return {vertices,indices,meshlets,meshletCount,triangles:meshletCount*MAX_TRIANGLES,detail};
}

export async function calculateBounds(mesh, wasmBytes) {
  const vertexOffset=0, indexOffset=mesh.vertices.byteLength;
  const metadataOffset=indexOffset+mesh.indices.byteLength;
  const memory=new WebAssembly.Memory({initial:Math.ceil((metadataOffset+mesh.meshlets.byteLength)/65536)});
  const bytes=new Uint8Array(memory.buffer);
  bytes.set(new Uint8Array(mesh.vertices.buffer),vertexOffset);
  bytes.set(new Uint8Array(mesh.indices.buffer),indexOffset);
  bytes.set(new Uint8Array(mesh.meshlets),metadataOffset);
  const { instance } = await WebAssembly.instantiate(wasmBytes,{env:{memory}});
  const metadata=new DataView(memory.buffer,metadataOffset,mesh.meshlets.byteLength);
  for(let m=0;m<mesh.meshletCount;m++) {
    const base=m*MESHLET_BYTES;
    const start=metadata.getUint32(base+16,true);
    instance.exports.build_bounds(vertexOffset,indexOffset+start*4,MAX_TRIANGLES*3,metadataOffset+base);
  }
  new Uint8Array(mesh.meshlets).set(new Uint8Array(memory.buffer,metadataOffset,mesh.meshlets.byteLength));
  return mesh;
}

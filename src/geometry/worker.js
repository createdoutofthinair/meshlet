import { generateMesh, calculateBounds } from './meshlets.js';
self.onmessage = async ({data}) => {
  try {
    const started=performance.now();
    const response=await fetch(new URL('./bounds.wasm',import.meta.url));
    if(!response.ok) throw new Error(`Could not load WebAssembly kernel (${response.status}).`);
    const bytes=await response.arrayBuffer();
    const wasmLoadMs=performance.now()-started;
    const geometryStart=performance.now();
    const mesh=generateMesh(data.detail);
    const geometryMs=performance.now()-geometryStart;
    const boundsStart=performance.now();
    await calculateBounds(mesh,bytes);
    const boundsMs=performance.now()-boundsStart;
    self.postMessage({id:data.id,mesh,wasmLoadMs,geometryMs,boundsMs},[mesh.vertices.buffer,mesh.indices.buffer,mesh.meshlets]);
  } catch(error) { self.postMessage({id:data.id,error:error.message}); }
};

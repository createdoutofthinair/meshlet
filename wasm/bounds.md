# WebAssembly meshlet bounds kernel

`build-bounds.mjs` emits a deterministic WebAssembly binary directly, so the
prototype has no compiler, engine, or package dependencies. The resulting module
imports `env.memory` and exports:

```
build_bounds(vertex_base: i32, index_base: i32, index_count: i32, out: i32)
```

Each index addresses a 32-byte vertex record. The kernel scans the positions
referenced by one meshlet, calculates an AABB, and writes its center and a
conservative bounding-sphere radius (half of the AABB's diagonal with a small
floating-point margin) as four floats. Every meshlet passed to it is nonempty.
The worker runs it on the high-detail index range; lower LODs reuse those vertices and are contained by the same sphere. It is called after assembling each geometry; it is not run per frame.
The mesh generation itself remains JavaScript. This is intentionally a small,
measurable WASM component rather than a claim that all geometry is WASM or GPU
accelerated. Run `npm run build:wasm` to reproduce the binary.

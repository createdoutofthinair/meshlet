# Meshlet Engine Lab

A small **from-scratch WebGPU engine and performance lab**, built without Three.js or any other rendering engine. It renders a procedural field of detailed objects as spatial meshlets, uses a compute shader to cull them against the camera frustum, compacts the visible set on the GPU, and issues a single indirect draw. A WebAssembly kernel computes conservative meshlet bounds during geometry preparation in a worker.

This is an experimental baseline for profiling and developing an engine, not a finished game engine or a WebGPU implementation of Unreal Nanite.

## Run locally

Requirements: Node.js 20 or newer, and a browser with WebGPU enabled. WebGPU requires a secure context: `localhost` or HTTPS. No packages need to be installed.

```sh
npm run dev
```

Open <http://localhost:4173>. Drag to orbit and use the wheel to zoom. Choose object count, geometry detail and render scale; toggle **Frustum culling** to compare the same camera and scene, or **Meshlet colors** to see cluster boundaries. **Reset view** returns to a consistent camera. Query parameters such as `?grid=4&detail=24&resolution=0.5` can set initial controls; values must match the options in the UI.

Run **Run benchmark** for a two-second warm-up and ten-second capture. Export downloads a JSON file containing the scene, camera, environment, frame-time distribution, CPU submission cost and, when supported, sampled GPU pass timings. Benchmarking is cancelled if the camera, controls, viewport size or tab visibility changes. The browser may cap frame rate at the display refresh rate; compare GPU pass times as well as FPS, and use the same resolution and camera when comparing settings. The visible triangle count describes submitted triangle slots, including any degenerate triangles.

If timestamp queries are unavailable, GPU timing is shown as unavailable; frame, CPU and visibility measurements still work. Add `?noTimestamps=1` to disable timestamp queries for troubleshooting. Adapter information may be limited by browser privacy settings.

## Architecture

1. **Geometry preparation:** JavaScript builds a deterministic, detailed, deformed spherical surface in a worker. Each 6 × 6 spatial patch becomes a meshlet with at most 49 unique vertices and 72 triangles. The meshlet index ranges refer to a shared vertex buffer. WebAssembly scans each range and stores an AABB-derived conservative bounding sphere. The UI reports JS generation and WASM preparation separately.
2. **Visibility:** one compute invocation per object/meshlet transforms its sphere and tests six frustum planes. Survivors are atomically appended to a GPU buffer; the same counter becomes the indirect draw instance count. The camera and projection math are implemented here.
3. **Rendering:** one `drawIndirect` call draws one instance per visible meshlet. The vertex shader pulls the meshlet's indices and vertex records from GPU storage buffers, transforms and shades the geometry; a depth buffer handles visibility between surfaces.
4. **Measurements:** `requestAnimationFrame` intervals provide frame times, JavaScript measures CPU encoding/submission, and optional WebGPU timestamp queries measure compute and render pass durations. Visibility and timestamps are copied to asynchronously mapped buffers at most twice per second, avoiding a per-frame CPU/GPU synchronization.

WebGPU does not expose native mesh shaders in this implementation. Vertex pulling uses a fixed 72-triangle budget per meshlet and invokes the vertex shader for triangle corners; it does not provide the vertex reuse of a hardware mesh shader. Turning culling off still runs the compaction pass so that it remains a valid comparison of visibility testing and work submitted, rather than a separate renderer. There are no occlusion culling, LOD, virtualized geometry, streaming, material system, hardware ray tracing, or WASM SIMD optimizations yet. CPU-side mesh generation is not GPU accelerated. GPU-driven rendering does not by itself guarantee faster results: atomic contention, overdraw, vertex pulling, screen resolution, browser overhead and device characteristics all matter.

Source layout:

- `src/gpu/` — custom renderer and WGSL compute/render shaders.
- `src/geometry/` — procedural geometry, worker and compiled WebAssembly kernel.
- `wasm/` — deterministic dependency-free WASM builder and kernel explanation.
- `src/math.js` — matrices, orbit camera and WebGPU frustum planes.
- `src/main.js`, `src/ui/` — benchmark, controls and interface.
- `tests/` — geometry, bounds and frustum tests plus an offscreen WebGPU smoke test.

## Verification

```sh
npm run check
```

This rebuilds the WASM binary and runs the dependency-free Node tests, including verifying every generated meshlet's bounds and all six frustum planes. To test actual GPU compute and rendering, run the server and open <http://localhost:4173/tests/webgpu-smoke.html>. It renders to an offscreen GPU texture, verifies indirect counts, checks that culling preserves the image, and exercises meshlet debug coloring. Its result appears on the page and in `window.__webgpuSmokeDone`. This is a correctness check, not a hardware performance benchmark. In CI the reproducible WASM and Node tests run automatically; GPU hardware and a real browser remain necessary for representative performance and presentation checks.

## Suggested next experiments

- Measure culling on and off at several camera positions and resolutions on a real GPU; save JSON results and identify whether the workload is GPU-, CPU- or refresh-limited.
- Replace the per-meshlet atomic append with workgroup compaction if profiling identifies contention; test meshlet sizing and packed vertex/index formats.
- Add a depth-pyramid occlusion pass and compare GPU time and image correctness before enabling it by default.
- Investigate hierarchical meshlet LOD, asset import and streaming with stable transitions and explicit memory budgets.
- Only expand the WASM component where measurements show preprocessing is a bottleneck; consider SIMD or multithreading when supported.

WebGPU and WGSL reference specifications: [WebGPU](https://www.w3.org/TR/webgpu/), [WGSL](https://www.w3.org/TR/WGSL/).

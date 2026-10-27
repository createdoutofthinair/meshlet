# Meshlet Engine Lab

A small **from-scratch WebGPU engine and performance lab**, built without Three.js or any other rendering engine. It renders a procedural field of detailed objects as spatial meshlets, uses a compute shader to cull them against the camera frustum, compacts the visible set into three GPU-selected levels of detail, and issues one indirect draw for each level. A WebAssembly kernel computes conservative meshlet bounds during geometry preparation in a worker.

This is an experimental baseline for profiling and developing an engine, not a finished game engine or a WebGPU implementation of Unreal Nanite.

## Run locally

Requirements: Node.js 20 or newer, and a browser with WebGPU enabled. WebGPU requires a secure context: `localhost` or HTTPS. No packages need to be installed.

```sh
npm run dev
```

Open <http://localhost:4173>, or use the [published benchmark](https://createdoutofthinair.github.io/meshlet/). Drag to orbit and use the wheel to zoom. Choose object count, geometry detail and render scale; toggle **Frustum culling** to compare the same camera and scene. **Reset view** returns to a consistent camera. Query parameters such as `?grid=4&detail=24&resolution=0.5` can set initial controls; values must match the options in the UI.

In **LOD & Debug View**, automatic LOD colors are enabled by default: cyan is LOD 0 (72 triangles per meshlet), amber is LOD 1 (18), and pink is LOD 2 (8). Select a forced LOD to compare the actual geometry at each level. The counters show the visible meshlets in each level. **Meshlet outlines** trace patch edges on visible surfaces; **Triangle wireframe** shows each rasterized triangle. **Projected screen bounds** draws a conservative rectangle derived from each visible meshlet's bounding sphere, in its LOD color, over the scene. Start with the center object or select all visible objects; rectangles can overlap and are drawn through surfaces. They represent bounds, not exact triangle projections.

Run **Run benchmark** for a two-second warm-up and ten-second capture. Export downloads a JSON file containing the scene, camera, environment, frame-time distribution, CPU submission cost and, when supported, sampled GPU pass timings. Benchmarking is cancelled if the camera, controls, viewport size or tab visibility changes. The browser may cap frame rate at the display refresh rate; compare GPU pass times as well as FPS, and use the same resolution and camera when comparing settings. The visible triangle count sums the triangles submitted at each selected LOD, including any degenerate triangles. Debug overlays affect render timings; disable them for a clean baseline.

If timestamp queries are unavailable, GPU timing is shown as unavailable; frame, CPU and visibility measurements still work. Add `?noTimestamps=1` to disable timestamp queries for troubleshooting. Adapter information may be limited by browser privacy settings.

## Procedural Planet Lab

Open [Planet Lab](https://createdoutofthinair.github.io/meshlet/planet.html) from the navigation, or run `npm run dev` and visit <http://localhost:4173/planet.html>. Enter a seed or generate one randomly, then use **Find Highlands** to sample the seeded terrain on the GPU and move the camera to an elevated region. Drag to travel, scroll to change surface clearance, and hold Shift while dragging in flyover mode to change the view direction. The seed is included in the page URL.

The planet uses a balanced cube-sphere quadtree, GPU-generated terrain patches, 16 meshlets per patch and an indirect draw. Seeded plate-inspired masks, warped continents, mountain ridges and slope-guided valleys are combined with a cached GPU world simulation of drainage, erosion and sediment deposition. **Rivers** finds a high-flow location; **Erosion**, **Rivers & lakes**, **Climate colors** and **Valley detail** control the result. Rivers, approximate lakes, color and a flat ocean are procedural, with no image textures. LOD colors, patch boundaries and triangle wireframe are available in the side panel.

The world simulation uses a coarse, shared cube-sphere grid and bounded, artist-tuned approximations. It is not a calibrated climate or hydrology model, and fine procedural detail can depart from the coarse river profile. Patch selection has hysteresis to reduce churn; changes remain discrete and may pop. See [planet-terrain-research.md](docs/planet-terrain-research.md) for sources, the implementation and its limits.

## Architecture

1. **Geometry preparation:** JavaScript builds a deterministic, detailed, deformed spherical surface in a worker. Each 6 × 6 spatial patch has three index ranges with 72, 18, or 8 triangles, sharing a vertex buffer. WebAssembly scans the high-detail range and stores an AABB-derived conservative bounding sphere that also contains the lower levels. The UI reports JS generation and WASM preparation separately.
2. **Visibility and LOD:** one compute invocation per object/meshlet transforms its sphere and tests six frustum planes. Survivors are atomically appended to one of three GPU lists; each counter becomes an indirect draw instance count. Automatic selection uses the object's projected diameter in framebuffer pixels: LOD 0 at 140 pixels and above, LOD 1 from 65 up to 140, and LOD 2 below 65. All patches on one object use the same level, keeping shared edges aligned. The camera and projection math are implemented here.
3. **Rendering and debug:** one `drawIndirect` per LOD draws only that level's triangle count. The vertex shader pulls indices and vertex records from GPU storage buffers, transforms and shades the geometry; a depth buffer handles visibility between surfaces. Optional geometry edges use barycentric coordinates; optional projected bounding rectangles use a separate line-list pipeline. LOD counts are read back asynchronously.
4. **Measurements:** `requestAnimationFrame` intervals provide frame times, JavaScript measures CPU encoding/submission, and optional WebGPU timestamp queries measure compute and render pass durations. Visibility and timestamps are copied to asynchronously mapped buffers at most twice per second, avoiding a per-frame CPU/GPU synchronization.

This renderer uses standard WebGPU vertex pulling rather than native mesh shaders; it invokes the vertex shader for triangle corners and does not provide hardware mesh-shader vertex reuse. Turning culling off still runs the compaction pass so that it remains a valid comparison of visibility testing and work submitted, rather than a separate renderer. There are no occlusion culling, hierarchical LOD, virtualized geometry, streaming, material system, hardware ray tracing, or WASM SIMD optimizations yet. The current LOD switches discretely without hysteresis or geomorphing, so transitions can pop; it is a diagnostic baseline, not a finished seamless LOD system. CPU-side mesh generation is not GPU accelerated. GPU-driven rendering does not by itself guarantee faster results: atomic contention, overdraw, vertex pulling, screen resolution, browser overhead and device characteristics all matter.

Source layout:

- `src/gpu/` — custom renderer and WGSL compute/render shaders.
- `src/geometry/` — procedural geometry, worker and compiled WebAssembly kernel.
- `wasm/` — deterministic dependency-free WASM builder and kernel explanation.
- `src/math.js` — matrices, orbit camera and WebGPU frustum planes.
- `src/main.js`, `src/ui/` — benchmark, controls and interface.
- `tests/` — geometry, bounds and frustum tests plus offscreen WebGPU smoke tests.

## Verification

```sh
npm run check
```

This rebuilds the WASM binary and runs the dependency-free Node tests, including verifying every generated meshlet's bounds and all six frustum planes. To test actual GPU compute and rendering, run the server and open <http://localhost:4173/tests/webgpu-smoke.html>. It renders to an offscreen GPU texture, verifies indirect counts, checks that culling preserves the image, validates all forced and automatic LODs, and exercises color, geometry edges, and projected-bounds overlays. Its result appears on the page and in `window.__webgpuSmokeDone`. Open <http://localhost:4173/tests/planet-smoke.html> for the planet GPU test, which also checks deterministic seeds, culling and generated shared-edge positions. <http://localhost:4173/tests/hydrology-smoke.html> checks world generation and routes across several seeds, including deterministic data, downhill flow, river-path endpoints, river-presence flags and erosion. This is a correctness check, not a hardware performance benchmark. In CI the reproducible WASM and Node tests run automatically; GPU hardware and a real browser remain necessary for representative performance and presentation checks.

## Suggested next experiments

- Measure culling on and off at several camera positions and resolutions on a real GPU; save JSON results and identify whether the workload is GPU-, CPU- or refresh-limited.
- Replace the per-meshlet atomic append with workgroup compaction if profiling identifies contention; test meshlet sizing and packed vertex/index formats.
- Add a depth-pyramid occlusion pass and compare GPU time and image correctness before enabling it by default.
- Investigate hierarchical meshlet LOD, stable transitions, asset import and streaming with explicit memory budgets.
- Only expand the WASM component where measurements show preprocessing is a bottleneck; consider SIMD or multithreading when supported.

WebGPU and WGSL reference specifications: [WebGPU](https://www.w3.org/TR/webgpu/), [WGSL](https://www.w3.org/TR/WGSL/).

# Procedural planet terrain: research and implementation

This lab explores seeded, texture-free terrain on a planet. The references below
are primary research or documentation from the authors. Their algorithms are
research inputs, not a claim that the lab implements every result.

## Terrain formation and detail

- [A Review of Digital Terrain Modeling](https://diglib.eg.org/items/47f03175-46e8-44e8-94ef-663bef354d1c) (Galin et al., 2019) surveys procedural, simulation and example-based methods, and explains why homogeneous fractal noise alone produces weak landform structure. **Applied here:** distinct continental, mountain-belt and detail scales, with a land mask and warped 3D noise.
- [Generation of Folded Terrains from Simple Vector Maps](https://diglib.eg.org/items/5ecd72bf-b3a5-46be-b108-54e556b23f99) (Michel et al., 2015) explains the importance of connected mountain ranges and tectonic folds. **Applied here:** seeded spherical plate-center controls and a smooth boundary mask localize uplift. This is a procedural approximation; no plate motion is simulated.
- [Large Scale Terrain Generation from Tectonic Uplift and Fluvial Erosion](https://diglib.eg.org/items/13e52c36-0200-4652-aacf-17aa3098c5fd) (Cordonnier et al., 2016) combines uplift, stream networks and erosion. **Not yet implemented:** a drainage graph or stream-power erosion. These are stronger candidates for coherent river valleys than adding more isotropic noise.
- [Physically-based Analytical Erosion for Fast Terrain Generation](https://diglib.eg.org/items/0a412929-2e29-4bcb-a597-1a4b2cc558e2) (Tzathas et al., 2024) combines stream-power solutions with hillslope and landslide processes. **Future research:** evaluate it as an optional cached world-generation stage, including its computational cost and license.
- [Real-time Terrain Enhancement with Controlled Procedural Patterns](https://diglib.eg.org/items/43319e3d-ba25-4762-971b-ac838ec21fb8) (Grenier et al., 2024) produces cascaded, slope-oriented ravine patterns with phasor noise. **Future research:** use slope and drainage controls for coherent detail. The paper is published under a non-commercial license; no paper code or phasor implementation is included here.
- [Generating Complex Procedural Terrains Using the GPU](https://developer.nvidia.com/gpugems/gpugems3/part-i-geometry/chapter-1-generating-complex-procedural-terrains-using-gpu) (NVIDIA GPU Gems 3) describes multi-scale procedural fields and domain warping. **Applied here:** low-frequency 3D domain warp and bounded higher-frequency relief bands. The planet is a heightfield, not a volumetric cave system.

## Planet-scale rendering

- [Geometry Clipmaps](https://hhoppe.com/proj/geomclipmap/) (Losasso and Hoppe, 2004) and [GPU-based Geometry Clipmaps](https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry) demonstrate nested grids and incremental GPU terrain updates. **Applied here:** reusable regular grids and GPU-side terrain generation; this lab uses a cube-sphere quadtree rather than a clipmap.
- [3D Tiles selection and screen-space error](https://cesium.com/learn/cesium-native/ref-doc/selection-algorithm-details.html) shows refinement based on estimated geometric error. **Current implementation:** a projected grid-cell-size heuristic with a hard patch budget, not an error-bounded SSE implementation. A conservative per-node geometric error is future work.
- [Horizon culling](https://cesium.com/blog/2013/04/25/horizon-culling/) discusses avoiding false culls when terrain crosses an idealized ellipsoid. **Applied here:** CPU-side conservative horizon rejection uses an inner and outer radius with a margin for bounded displacement.

## Implemented pipeline

1. Six consistently oriented cube faces form a sphere with an Earth-like mean radius of 6,371 km. A CPU quadtree selects patches within a user-controlled budget; levels can reach 20 when the camera and budget permit. Adjacent leaves are balanced to a maximum level difference of one, including across cube faces.
2. Each 16 × 16-cell patch has 16 meshlets of 4 × 4 cells, 32 triangles per meshlet. Coarse-neighbor edge flags collapse the odd edge vertices to match the adjacent grid. There is no time-based terrain fade.
3. Seeded plate centers, warped continental fields, masked ridged multifractals, directional folds and fine relief bands are evaluated in a WebGPU compute shader. Additional seeded bands displace actual vertices at scales from roughly 49 meters to 0.76 meters. This is procedural synthesis, **not a physical erosion or tectonic simulation**. Elevation-based color and a flat ocean are analytical; there are no image textures.
4. New patches are generated into a GPU vertex cache. Further compute passes calculate smooth normals, a small cavity-shading approximation and meshlet bounds. At a mixed-LOD edge, the fine patch uses the coarse patch's matching normal; corner transitions and cached normals are updated as neighboring levels change. A compute pass frustum-culls the active meshlets and writes one indirect draw. CPU patch selection, buffer uploads and a small asynchronous GPU surface probe remain part of the pipeline.
5. Camera-relative patch positions and reversed-Z depth improve large-world precision. High/low spherical patch centers preserve offsets for fine-scale procedural sampling, while the larger-scale terrain still uses 32-bit coordinates. The highland finder samples the seeded field on the GPU; its result is the highest point in that sample, not a globally proven maximum.

## Current limitations

- The terrain is a researched first procedural baseline, not photorealistic Earth or an erosion simulation. It lacks river networks, sediment deposition, climate and biome simulation, rock materials, cast terrain shadows, clouds and atmospheric scattering.
- The quadtree selection is budget-limited and uses an approximate screen-size heuristic. Transitions are discrete and can pop; neighbor stitching prevents large topology gaps but is not geomorphing or a proof of zero pixel seams.
- Shared-edge GPU tests show sub-meter differences on coarse planet-scale patches on the test adapter. High/low sampling improves the smallest noise bands, but the larger-scale field, rendering math and GPU implementation differences still limit precision; centimeter-scale guarantees need further work.
- Fine procedural bands are not yet fully frequency-filtered by projected sampling rate. This can alias during descent. Stable, band-limited terrain residuals and a surface-preserving geomorph are higher-priority next steps than simply adding more octaves.
- Patch selection runs on the CPU and is recomputed as the view changes. GPU geometry is cached, but a large camera jump or seed change can create a generation burst. No real-hardware performance claim is made from software-GPU tests.

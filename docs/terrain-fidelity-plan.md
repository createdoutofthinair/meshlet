# Terrain fidelity and performance plan

Target: a convincing rocky mountain scene from low flight to walking height, with seamless space-to-ground transitions and a 60 FPS target on the reference device. The 16.67 ms frame budget is shared with clouds, atmosphere, ocean, compute and presentation. Validate on actual WebGPU hardware; shader compilation and CPU tests do not prove appearance or frame rate.

## Baseline and evaluation

- Capture fixed-seed views from orbit, mountain approach, low flight, rocky slope, ground level and low sun, recording resolution, GPU, settings and seed.
- Record repeatable descent and walking runs. Compare frame intervals, terrain, clouds, compute, patch generation, selection and transition events; inspect p50/p95/p99 and spikes, not only average FPS.
- Add debug views for geometric and shading normals, material weights, roughness and lighting. Inspect cube-face and patch boundaries.
- Keep before/after captures and timings for each substantial change. Compare with the supplied Star Citizen reference once available in the working session.

## Implementation

1. **Lighting and normals:** inspect and fix normal interpolation and seam artifacts; introduce roughness-based sunlight response, sky illumination, consistent linear lighting and tone mapping. Check snow, coast and water paths separately.
2. **Terrain materials:** build data-driven rock, weathered rock, scree, soil, sand and snow materials with albedo, normals and roughness, and optional height blending. Use existing slope, altitude, humidity and drainage, plus geological and exposure masks. Use stable world-space projection, with triplanar sampling on steep slopes only where needed. Support GPU-generated and authored material sources.
3. **Multi-scale detail:** preserve planetary landforms, add close-range geometry where visible, and filtered material-scale details. First benchmark deeper existing quadtree refinement; prototype a bounded near-field clipmap only if warranted and compare. Maintain agreement between rendered displacement, walking probes and collisions.
4. **Geological coherence:** layer and fracture exposed rock; accumulate talus below cliffs and sediment in valleys; connect weathering, directional erosion and drainage to regional terrain. Break repetition without obvious noise patches.
5. **Shadows:** prototype stable nearby sun shadows and contact/terrain occlusion with appropriate filtering, bias and distance budgets. Test fast flight, low sun and patch transitions.
6. **Motion quality:** use mipmaps, anisotropic filtering and footprint-filtered detail; eliminate texture swimming, shimmer and boundary seams. Evaluate anti-aliasing and temporal artifacts in motion.
7. **Surface population:** add deterministic, GPU-culled rocks and biome-appropriate vegetation with terrain contact and stable distance representations.
8. **Performance tuning:** budget per pass; cap generation work per frame, cache reusable data, and evaluate fixed scenes and descent/walking captures. Preserve coverage, seamless LOD and current flight controls.

## Acceptance

A rocky mountain reference scene should retain credible lighting, material and silhouette from low flight to walking height without conspicuous repetition, cracks, LOD popping, swimming or shimmer. Compare against the reference images at matched views. Demonstrate a representative orbit-to-ground flight and walking run with recorded frame-time percentiles and GPU pass timings on the target hardware; 60 FPS is a target, not an unverified guarantee. Automated checks cover shader validity, surface continuity, walking, terrain transitions and deterministic placement where applicable.

## Progress

- Plan recorded on `terrain-optimizations`.
- Initial terrain lighting uses a bounded roughness-dependent dielectric sun response, with different roughness for rock and snow. The procedural color shader has a filtered fine mineral band. These are initial changes, not completion of the lighting or material milestones.
- Further milestones remain subject to implementation and real-device visual and performance validation.

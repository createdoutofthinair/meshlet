# Planet terrain transition implementation

The planet renderer keeps a complete, balanced covering tree resident and changes it by one generation at a time. A selection uses at most 512 of the 1,024 patch slots, leaving room to build its replacement before retiring old geometry. The existing procedural world, ocean classification and river field remain seeded and independent of this lifecycle.

## Geometry and ownership

- Refinement draws children on their exact parent triangles at progress zero. Coarsening draws the old children until they match the new parent at progress one.
- Stitched endpoints use the intersection of both parameter-space triangulations. This handles changed edge collapses and diagonal crossings without assuming a regular grid can reproduce both surfaces.
- All groups in a replacement share one progress value. Mixed refinements, merges and retained stitch changes commit atomically. Normals, height and surface attributes interpolate with geometry.
- Rendering and walking probes use the same WGSL surface/morph functions. Pending rendered-surface reads hold progress, and generation/revision checks reject stale results.
- Culling bounds conservatively include both endpoint surfaces. Old slots retire only after the GPU submission fence. Allocation and topology uploads have explicit capacities; failed reservations retain old coverage.

## Spatial and error control

`transition-control.js` derives its axis from observed camera movement, including lateral movement. When no movement history exists it uses the nearest affected surface anchor. Larger GPU-measured endpoint differences widen the spatial transition band. Geometry updates are limited using a projected-error estimate and a default 0.5 pixel target. Active transitions refresh their GPU endpoint measurements at most five times per second, including common-triangulation vertices where needed.

Time alone never advances a morph. A stopped camera preserves its displayed geometry, including when the step limiter has fallen behind the requested spatial progress. Continued movement allows it to catch up. Reversal returns through intermediate geometry; cancellation is permitted only at the original endpoint. Above-target merges have no timeout bypass.

Quality, viewport and navigation-mode changes cancel an untouched transition or wait for an active transition to finish/reverse. Terrain rebuilds invalidate the world generation. Device loss invalidates outstanding results and stops further submissions.

## Validation and limits

`npm run check` builds the WASM kernel, checks JavaScript syntax, validates assembled WGSL with Naga and runs the automated tests. Tests cover all old/new stitch-mask combinations, mixed transition seams and cube corners at sampled factors, balanced intermediate covering trees, slot/fence ownership, probe invalidation, reversal, settings changes and device loss.

The statistics recorder distinguishes GPU-measured endpoint differences (`lodErrorPixels`) from estimated morph displacement (`estimatedMorphStepPixels`, `estimatedEndpointPixels`). The 0.5 pixel value is an engineering target, not a proven screen-space bound: projection changes and unsampled interior extrema can differ from the estimate. A large camera jump can leave detail pending until further camera movement. A stationary quality change does not animate above-target terrain into its replacement.

No real WebGPU visual or performance acceptance was performed in this environment. CPU/mock tests and shader validation do not establish artifact-free GPU output. The fully resident covering tree, common triangulation and broad parent-inclusive culling bounds can add generation work, vertex work and overdraw. The coordinate cache is limited to 64 combinations; topology storage is approximately 16.2 MiB. GPU timings, culling A/B visibility, fast descent, coastline/cube-face walking and visual continuity still require a WebGPU browser run.

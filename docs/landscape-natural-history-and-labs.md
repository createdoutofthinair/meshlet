# Landscape formation research and small-tile lab plan

Status: research and implementation plan, not an implemented or scientifically validated simulator. Intended repository: `createdoutofthinair/meshlet`. Written 2026-10-31. This plan is independent of the work in progress on planetary terrain: build and evaluate the laboratories separately before integrating them into the planet.

## 1. Purpose and design principle

Build a library of convincing natural landscapes by studying **how landforms arise and how their parts relate**, then create a compact, seedable, interactive WebGPU lab for each family. Begin with natural history and field observations, not with a list of noise algorithms. The GPU design below translates geological hypotheses into testable engineering approximations; it does not claim to reconstruct real geologic history or predict real-world hazards.

The purpose is not one photogenic rock, but a family of plausible outcomes at several scales: a mountain has a drainage history; exposed rock follows its fractures or beds; detached blocks collect below cliffs; channels route sediment to a valley floor. Materials, vegetation, moisture and snow respond to these features instead of being independently scattered.

**Target:** scientifically informed, visually convincing fictional landscapes, viewed from a high oblique overview, low flight and walking height. Repeatable 60 FPS on a stated reference GPU is a design target, not evidence of achieved performance. Generate on the GPU where it is advantageous; distinguish offline/precomputation, interactive editing, streaming and render costs. Preserve global coherence and seamless transitions when eventually applied to a planet.

### Scope of this document

- The research is Earth geomorphology, rock and surface processes. Preset ranges below are *initial artistic laboratory ranges*, not universal geological constants or measurements from the cited examples.
- Propose small, independently testable scenes and data contracts for future WebGPU implementation. Do not modify the planet until a lab has been validated.
- A heightfield can represent most broad landforms, but it cannot represent true overhangs, arches, caves, undercuts or fully vertical walls. Use a local mesh/SDF layer when those forms are required; do not silently pretend a heightfield can represent them.
- Time is a **geological stage** or change in conditioning fields. Real-time water, rock physics and exact geological timescales are separate simulation problems.

## 2. What shapes landscapes in nature

### 2.1 A causality stack

1. **Geologic setting:** rock type, emplacement or deposition, stratigraphy, folding/faulting, fracture systems and relative rock resistance. These create long-lived directional and layer constraints.
2. **Boundary conditions:** uplift and subsidence, sea/base level, topographic gradient, climate history, precipitation, temperature, ice and wind, and sediment supply.
3. **Transport and modification:** weathering, mass wasting and slope failure; stream incision and deposition; ice abrasion and deposition; wind erosion and transport; coastal waves; volcanism or dissolution where present.
4. **Deposits and ecology:** talus, alluvial deposits, soils and vegetation reflect sources, transport, slope and water availability. They are not independent paint layers.
5. **Observed surface:** current outcrops, regolith, soils, channel beds, surface water, snow, weathering and vegetation result from the interacting history. Different processes may be active or visible in one place at once.

These are interacting controls, not a mandatory universal time sequence. A fictional world needs internally consistent causal cues, not an exact simulation of every era. The NPS landform overview identifies water, wind, ice, gravity, tectonic and volcanic processes as major landform drivers [R1].

### 2.2 Shared natural features to preserve

- **Scale hierarchy:** regional relief and valley networks; individual ridges and cliffs; beds, fracture-controlled faces, gullies and deposits; then grains, cracks and weathering. A feature must be appropriate to the size of the host.
- **Structural continuity:** beds can persist across a valley; faults and joint sets may cut multiple faces. Orientation, thickness, spacing, resistance and continuity should be regional properties with local variation—not independently randomized on each tile.
- **Water connectivity:** catchments join downstream, slope and outlets govern drainage, rivers encounter lakes or boundaries, and an apparent channel is not necessarily a perennial river [R15]. Differentiate water availability from a drainage path.
- **Mass movement:** exposed steep rock can shed blocks; deposits and alluvial fans have sources and paths. Grain-size sorting and slope vary with transport and material. Avoid assuming one angle of repose or grading curve fits every material and moisture condition.
- **Climate and succession:** snow/ice, vegetation and soil depend on more than latitude or altitude: season, local temperature, precipitation, aspect, drainage, exposure and disturbance matter. A desert may contain signs of intense episodic water flow [R12].
- **Asymmetry:** direction of winds, strata, fault displacement, slope aspect and drainage makes many landforms asymmetric; avoid uniformly mirrored silhouettes.
- **History and exceptions:** overlapping glacial and river features, ancient terraces and inherited geology are common. Preset constraints express tendencies, not universal rules.

## 3. Rock formation and landscape catalogue

Each entry lists what to observe, causal relationships to encode, scale cues and a first test scene. Start with rock forms because the same rock logic is reused across mountain, canyon and coast labs.

### A. Massive crystalline rock: granite and similar intrusive rocks

**Natural story.** Massive crystalline rock can contain intersecting regional joints as well as sheet-like fractures; water and weathering exploit weaknesses. In Yosemite, regional joints organize cliffs, while exfoliation, glacial erosion and rockfall together shape domes and faces [R2]. This does not mean every granite outcrop is a dome.

**Visual vocabulary.** Broad coherent masses and domes; occasional planar joint-bounded faces; rounded weathered corners; fractures in more than one orientation; detached blocks, boulder piles, grit and vegetation accumulated in protected ledges. Vertical faces and rounded surfaces can coexist.

**Relationships.** Keep joint orientation coherent across a region; vary spacing and persistence. A major joint controls a cliff or slab boundary; smaller joint sets subdivide it. Rockfall debris belongs below an exposed source and must avoid appearing suspended on vertical faces. Exfoliation sheets follow mass geometry rather than forming horizontal sedimentary stripes.

**Seed lab:** granite dome meeting a joint-controlled cliff, with a short debris apron and one drainage line. Starter footprint 512 m × 512 m; height range 150–350 m, adjustable. Include one close-up block and a broad view.

### B. Layered sedimentary rocks: sandstone, siltstone, mudstone and shale

**Natural story.** Beds record deposition and may differ in thickness, strength and erodibility; uplift and incision expose them. In Canyonlands, resistant layers can cap mesas or form benches, while prominent cliff-forming sandstones exhibit jointing [R3]. In Zion, layers differ in resistance, contributing to the shape and coloration [R4]. Bedding can dip or fold; horizontal bands everywhere are not a valid universal rule.

**Visual vocabulary.** Persistent beds; cliffs, ledges and slopes; distinct bedding and cross-bedding; joints that can cut across beds; differential retreat, fins, alcoves, mesas and buttes where the structure supports them. Cross-bedding is an internal depositional pattern, not random stripes pasted onto a vertical wall.

**Relationships.** Assign each geological unit an identity, thickness, orientation, continuity, erosion resistance and material. A resistant layer may support a bench or caprock while weaker units retreat. Drainage cuts through connected layers. Accumulated talus reflects rock sources. Arches/alcoves require supporting 3D geometry and a plausible fracture/erosion setting, not ubiquitous arches.

**Seed lab:** a cliff cross-section with 3–6 distinct continuous units, 1–2 joint sets, ledges and a source-linked talus slope. Starter footprint 1 km × 1 km, vertical relief 200–500 m.

### C. Basalt flows, volcanic cliffs and columnar joints

**Natural story.** Volcanic forms depend on eruption style and magma/flow properties. Broad shield volcanoes develop from fluid flows; composite volcanoes and domes have different histories [R5]. Cooling can produce columns in suitable lava bodies; NPS documents basaltic and rhyolitic examples, including irregular as well as regular jointing [R6]. Pāhoehoe is often smooth, hummocky or ropy with lobes; ‘a‘ā can be rough and blocky [R7, R8].

**Visual vocabulary.** Stacked or overlapping flow units; lava-flow toes, levees and breakouts; fractured column faces; dark fresh surfaces becoming lighter/weathered or vegetated with age; rubble at outcrop bases. A column cross-section is not a perfect identical hexagon grid, and not every volcanic slope is columnar basalt.

**Relationships.** Constrain flow direction to local downhill route and source vent; columns are associated with a cooling body and its boundaries, not arbitrary surface decoration. Place dislodged columns and angular rubble below an exposed cliff. Separate shield geometry from surface flow texture.

**Seed lab:** short basalt escarpment intersected by two flow layers, locally columnar with rubble at the foot; optional nearby pāhoehoe surface. Starter footprint 500 m × 500 m.

### D. Folded and faulted mountains

**Natural story.** Orogeny, faulting, uplift and differential erosion create many mountain styles; glaciation and fluvial incision can subsequently overprint them [R1, R9]. Layer orientation, jointing and rock type strongly affect ridge form. A jagged mountain range is not simply a cone with frequency noise.

**Visual vocabulary.** Connected ridgelines and branching spurs; watersheds; changes of slope; variable rock exposure and talus; bedding or foliation where applicable. Include broad valleys, foothills and gaps; individual peaks need not all be equally tall or evenly spaced.

**Relationships.** Regional structure influences ridge and valley orientation, while tributary drainage runs to the main channel. Set a meaningful relief budget and a base-level/outlet. Deposit coarser material nearer sources where the modeled transport warrants it. Add glacial modification as a later history, not as generic mountain noise.

**Seed lab:** 4 km × 4 km upland catchment with one main ridge, asymmetric spurs and a connected drainage outlet; vertical relief 500–1,200 m as an adjustable starter.

### E. Glacial valleys, cirques and fjords

**Natural story.** Valley glaciers move downslope, erode and transport material. Cirques, arêtes, horns and glacial valleys can be erosional; till and moraines are depositional. Several cirques can leave a horn between sharp arêtes. Glacial scratches generally align with ice motion [R10]. A fjord requires a glacial valley connected to the sea and later marine inundation, not simply a lake in a U-shaped depression.

**Visual vocabulary.** Valley trough with broad floor and steep walls, shoulders where preserved, tributary hanging valleys, cirque headwalls, sharp divides, tarns and moraine ridges. Rock type and pre-existing topography cause variation; do not give every valley an identical U profile.

**Relationships.** Define ice flow from accumulation areas through connected valleys to a terminus; carve coherently along the flow path; place deposits consistent with former ice margins and transport; direct striations along local ice movement. Frozen remnants and post-glacial river incision may coexist.

**Seed lab:** 3 km × 5 km former valley glacier, with one tributary, a cirque head, an outlet and an end moraine; later test a sea-level-connected fjord variant.

### F. Rivers, valleys and alluvial fans

**Natural story.** Stream networks route runoff and sediment to a base level. Channels can be confined or unconfined and may be straight, meandering or braided under different combinations of slope, flow, sediment and bank properties; these categories are tendencies, not a simple single-variable switch [R11, R16]. A fan commonly forms where a stream emerges from a confined upland onto lower-gradient terrain. USGS research relates fan slope and concavity to sediment supply, transport and deposition [R13].

**Visual vocabulary.** Tributaries, V-shaped headwaters, knickpoints, waterfalls, terraces and floodplains where appropriate; bends with cut banks and point bars; braided branches separating around bars; fans with distributary paths. Differentiate a dry wash, active channel and floodplain.

**Relationships.** Routing must be connected and flow downstream except within closed basins or explicitly modeled subsurface drainage. Outlet, upstream contributing area, gradient, flow regime, channel geometry and sediment should be related. Preserve a basin's natural sink and lake spill behavior. Avoid treating drainage accumulation alone as proof of perennial flowing water [R15].

**Seed lab:** 2 km × 2 km catchment entering a broad valley, with tributaries, sediment paths, a short fan and a single outlet. Make a separate meander/floodplain test with the correct low-gradient context.

### G. Arid basins, dunes and badlands

**Natural story.** Arid terrain is not solely wind-carved: rainfall events, flash floods, mechanical weathering, rock type and episodic transport remain important [R12]. Dune shape depends on winds, sand supply, vegetation and other local factors. Many dunes have a gentler windward stoss side and steeper lee side [R14]. Barchans and star dunes occur under different wind/supply conditions [R17].

**Visual vocabulary.** Exposed rock and pediments, alluvial fans at mountain fronts, ephemeral washes, playa floors in closed basins, desert pavement, locally vegetated channels, ripples and varied dune types. Badlands can be strongly dissected where fine sedimentary rocks are readily eroded.

**Relationships.** Wind direction and available sand create a dune field; oriented lee sides and migration directions must agree. Constrain sand sources and sinks; avoid placing dunes on every mountain. Washes run toward basin lows or outlets. Playa occurs in an appropriate internally drained basin, not as a generic flat patch.

**Seed lab:** 2 km × 2 km basin margin with one mountain front, alluvial fan, dry wash, constrained dune patch and basin floor.

### H. Karst and rocky coastlines

**Natural story.** Karst is associated with dissolution of soluble rock; sinkholes, sinking streams, springs and caves are connected expressions of surface and subsurface drainage [R18]. Rocky coasts depend on lithology, structures and wave exposure; layered rocks can form stepped profiles while more massive rocks behave differently [R19].

**Visual vocabulary.** Karst: irregular closed depressions, limestone pavement, sinking streams, springs and localized caves. Coast: cliffs, wave-cut platforms, beaches or pocket coves where sediment and geology allow them, and joints guiding headlands and inlets.

**Relationships.** A sinkhole is not automatically a visible deep cave; a heightfield depression is not a full subsurface model. Wave action follows sea level and exposed shore, and rock strength/structure influences cliff shape. Use a separate 3D representation for undercuts, caves and arches.

**Seed labs:** a 1 km² limestone surface with linked sinks and springs; a separate 2 km coastal segment with a connected sea boundary, varied lithology and wave exposure. These follow the first-wave labs.

## 4. Lab architecture and interaction plan

### 4.1 One shared Landscape Lab, multiple experiments

Create a dedicated lab route and reusable framework in a separate area of the repository, not a full clone of Planet Lab. Each experiment implements the same interface and supplies its own geological parameters, reference checklist and test fixtures.

**Controls:** preset; seed; tile dimensions in metres; vertical exaggeration with an explicit 1× setting; camera orbit/fly/walk; sun azimuth and elevation; material/geometry/debug modes; generation progress/cancel; reset; save/restore view; compare A/B; export/import a versioned recipe. Dark compact property controls consistent with the engine UI. Do not present an art-directed exaggeration as a measured real-world ratio.

**Views:** overview, low flyover, ground-level and profile/cross-section. Diagnostic overlays: height, material ID/weights, slope and aspect, rock units/bedding, joint orientation, drainage direction and contributing area, water versus dry channels, transport/deposition, snow/vegetation suitability, tile boundaries, LOD and GPU timings. Show which layers are approximations.

**Output:** deterministic recipe + parameter values and seed, units, world origin, scene/camera, generator version, provenance, generated fields and statistics. `preview only`, `validated lab artifact`, and `planet-integrated` are separate statuses.

### 4.2 Initial scale and representation

- Default local lab 512–2,048 m wide; choose 4–5 km only when necessary for a catchment or valley. UI displays metres and provides real-world landmarks for scale.
- Preview grids: e.g. 512² and 1,024²; a 1 km tile has about 1.96 m and 0.98 m sample spacing respectively when endpoints cover the full extent. Add higher-resolution tiles or multiresolution caches only after profiling device memory and quality.
- Maintain a **larger simulated context and a smaller inspected crop** with a configurable halo. Drainage, glaciation and weather fields require upstream/outside context; a small tile alone cannot infer an entire catchment. Show open/closed/fixed boundaries and explicitly mark incomplete context.
- Separate base geometry from added outcrops. Heightfields carry continuous broad surfaces; local rock meshes or SDF/mesh patches handle overhangs, columns and arches. Material microdetail and vegetation do not move collision surfaces unless represented in the collision/probe contract.
- Use deterministic world-space coordinates, stable seeds and split/high-low coordinates or equivalent where planetary precision requires them. Test tile edges and cube-face crossings before integration. Use global coordinates/region seeds for shared structures, not a new random seed per tile edge.

### 4.3 Common input/output contract

**Region context:** seed, geographic world origin and axes, tile/crop bounds, target resolution, units, boundary conditions, sea/base level, geological history ID, material registry, climate and wind history, upstream/downstream neighbors and version hashes.

**Geological fields:** bedrock type, layer IDs and surfaces, thickness/orientation, fault/joint sets, strength/erodibility and permeability (relative parameters, not calibrated absolute measurements unless sourced). Reuse coherent features across tile borders.

**Terrain/hydrology fields:** elevation, surface normal, curvature, slope/aspect; drainage direction/network/outlet, contributing area, basin IDs and lake levels; water classification and intermittency; ice/wind direction where relevant; eroded/deposited material, regolith thickness and sediment class. Do not require every lab to produce every field: identify absent fields explicitly.

**Surface/asset outputs:** exposed rock and sediment weights, material identifiers, moisture, snow suitability, feature masks, source-linked debris, placement candidates and LOD/mesh references. Distinguish bedrock, sediment cover and water; consumers must not reinterpret unknown fields as zero.

**Invariants:** fixed seed and version produce reproducible output within documented floating-point tolerances; layer weights are bounded and normalized; no NaNs; geometry agrees with collision/probe path; water and rock placements respect valid boundaries; budgets are bounded; exports declare coordinate system and physical scale.

### 4.4 Suggested GPU workflow—not a claim of completed implementation

1. Region inputs and coherent geological structures → coarse fields.
2. Apply feature-specific landform operators with explicit history and conservation or bounded heuristic rules.
3. Generate derived topology/flow and source-linked deposits; recalculate after topology changes.
4. Compute material/suitability masks and independent visual-detail layers.
5. Build or stream terrain meshes and separate 3D features; validate contact and seam consistency.
6. Render with distance/footprint-filtered normals and materials; GPU cull instances; expose per-pass cost and memory.
7. Recompute only invalidated stages; preserve previous valid output until replacements are ready. Limit work per frame and provide an explicit progress indicator.

Use GPU compute for suitable parallel field operations, but benchmark alternative approaches and readback/transfer costs. A real river or ice model may require iterative or hierarchical algorithms. Do not label an artistic incision filter 'full physical erosion'. Document convergence, resolution dependence and conservation limitations.

## 5. Detailed implementation order and acceptance gates

### Phase 0 — Research and evidence collection

- Build a source library for each feature: primary science/agency explanation, location, satellite or aerial view, ground-level view, geology map where practical, and scale/lighting context. Verify image license and attribution before reuse. Document reference dates, field of view if known and confidence; do not assume screenshot RGB is intrinsic albedo.
- Record 3–5 named physical observations and a counterexample/variation for every reference. Distinguish source-backed facts from design hypotheses and sample parameter ranges.
- Choose performance test GPU, display resolution, target refresh rate and camera scenarios. Store raw timings, device/browser/build metadata. Do not judge quality from stills only.

### Phase 1 — Shared test harness and crystalline rock lab

- Create the standalone tile viewer, deterministic recipe, validation fixtures, scale display, performance capture and context crop.
- Implement the granite dome/cliff/joint system and source-linked debris with a small library of distinct shapes. Independent debug layers expose joint systems, base shape and debris rules.
- **Pass:** same seed/version reproduces; world-aligned joints cross crop borders; no floating debris in tested fixtures; silhouette reads as a cliff/dome from three scales; close fly/walk and edge tests show no obvious cracking or popping; report GPU timings and memory.

### Phase 2 — Stratified cliff and basalt lab

- Implement continuous unit surfaces, variable thickness, dip, resistance and joint sets. Create deterministic cliff/bench and fracture fixtures; add a localized 3D overhang/column prototype only where representation requires it.
- Basalt flow/column example uses separate rock-body provenance and rubble. Record what is physically simulated and what is modeled art direction.
- **Pass:** strata and joints remain coherent across neighboring lab tiles; beds do not follow the camera or reset on LOD; material transitions follow actual units; sample cross-sections and outcrops match one another.

### Phase 3 — Mountain catchment and fluvial lab

- Define regional structure, ridges, divide/outlet, flow network, incision, material transport and deposition. Provide open/closed basin and boundary/halo tests; use catchment context larger than the view.
- Include test cases for confluence, sink/spill, fan, and dry channel versus surface water. Check mass accounting where a conservation model is claimed; report approximation and error otherwise.
- **Pass:** channels route to valid outlets or declared sinks, confluences connect, deposits have sources, no artificial edge dams, and distributions vary plausibly across fixed seeds.

### Phase 4 — Glacial and arid histories

- Add glacial flow paths, trough/cirque operators, flow-oriented scouring and moraine/till masks as an explicit episode over a pre-existing terrain. Add wind- and supply-conditioned dunes and event-driven arid drainage as separate histories.
- **Pass:** glacier features align with local ice-flow and do not force identical U profiles; dune asymmetry agrees with wind and constraints; artificial stage changes do not cause uncoupled terrain/material transitions.

### Phase 5 — Biome, rocks and integration

- Generate deterministic, GPU-culled candidates using geology, deposition, substrate, moisture, slope, elevation and climate. Use multiple species/rock sets, clustering, orientations and scale distributions; avoid grid-aligned repetition.
- Validate placement against the *rendered* surface and collision/probe representation, including transitions and streaming. Test no floating or buried instances at seams and LOD boundaries.
- Integrate one validated rocky mountain/catchment region into the existing planet as an opt-in experiment. Keep regional drainage and layer identities deterministic across neighboring tiles, cube faces, LOD changes and reloads. Add a migration/version contract; do not replace existing terrain globally until compared.
- **Pass:** representative orbit → descent → touchdown → walking recording; neighboring tiles agree within documented error, no uncovered frames or visible jumps, stable material sampling, and selection/probe/render agree. Record p50/p95/p99 frame interval, terrain, compute, ocean and clouds, generated work, memory and worst spikes; identify missing GPU timestamp data. Compare visual captures at identical view/seed/time/lighting. Do not claim sustained 60 FPS or equivalence to a game from synthetic benchmarks.

### Phase 6 — Further families

Add coastal and karst labs, then snow/ice dynamics, vegetation ecology, wetlands or tropical landscapes when the input data and representation can support them. Keep cave/arch work separate until 3D topology and streaming/collision are supported.

## 6. Research-to-test matrix

| Natural observation | Engineering hypothesis to test | Observable failure | Validation |
|---|---|---|---|
| Granite joints influence cliffs [R2] | Region-level planes guide localized face boundaries | Same fractures reset at tile edge | Seeded adjacent tiles, overlap and seam/profile comparison |
| Rock units differ in resistance [R3, R4] | Continuous stratigraphy guides ledges and color/material | Horizontal stripes ignore dip or drift between cliffs | Cross-section matches exposed faces on neighboring tiles |
| Glacier and till share an ice history [R10] | Flow field guides erosion and deposit placement | Moraine appears uphill or striations cross flow | Overlay flow, trough and deposits; inspect annotated references |
| Fan depends on supply and transport [R13] | Source and slope drive distributary deposition | Fan placed on a ridge or points uphill | Trace paths from source to fan, test boundary and budget |
| Dune stoss/lee respond to wind [R14, R17] | Wind field orients asymmetry and sand transport | Random dune direction or dunes on sheer rock | Compare wind vectors with section profile and sand source |
| Rock column joints depend on a cooling body [R6] | Columnar pattern attached to a lava unit | Perfect infinite identical hexagon texture across all rocks | Verify finite body, varied column scale, coherent faces |
| Drainage is not always surface water [R15] | Separate network, moisture and perennial flow | Every dry drainage line becomes a river | Dry/wet presets with same terrain and distinct water outputs |
| Karst has subsurface connections [R18] | Explicit sink/spring graph and representation limits | Heightfield dimple presented as proven cave system | Test graph topology; flag unsupported subsurface geometry |

## 7. Performance, reproducibility and definition of done

- Profile multiple views and seeds in a real browser, with timestamp-query availability stated. Include generation latency, frame CPU and GPU time, GPU memory, rebuild storms, transfer/readback and the 95th/99th percentile—not only average FPS.
- Evaluate direct flight, touchdown, walking and stationary camera; collect visual captures with render scale, seed, resolution, camera and lighting. Record terrain and cloud work separately so gains in one pass are not hidden by another.
- Supply graceful quality settings: geometry error, material filtering, vegetation density and generation budget; avoid lying that a budget-limited tile meets the chosen pixel target. Keep all comparisons at matched resolution/settings.
- Run deterministic fixtures, border/corner and cube-face seam tests, placement/contact tests, hydrological consistency tests and existing LOD/walking suite. Add image/temporal GPU checks when a real device and browser are available.
- Done means coherent repeatable lab results with documented source inspiration, no known high-severity seam/contact failures, automated checks, measured target-device performance and integration acceptance. It does **not** mean 'looks plausible in a single image' or 'shaders compile'.

## 8. Reference library

Sources are natural-science/agency references; they support the observations cited in the catalogue, not the starter tile sizes, artistic presets or proposed GPU algorithms.

- **R1** National Park Service, [Park Landforms](https://www.nps.gov/subjects/geology/landforms.htm) — major landform-generating processes.
- **R2** National Park Service, [Yosemite geology exhibits](https://www.nps.gov/yose/learn/nature/geology-exhibits.htm) — joints, domes, glacial modification and rockfall.
- **R3** National Park Service, [Canyonlands Geodiversity Atlas](https://www.nps.gov/articles/nps-geodiversity-atlas-canyonlands-national-park.htm) — stratigraphy, resistant units, benches, sandstone and joints.
- **R4** National Park Service, [Zion Geodiversity Atlas](https://www.nps.gov/articles/nps-geodiversity-atlas-zion-national-park.htm) — rock units and differential erosion.
- **R5** USGS, [About Volcanoes](https://www.usgs.gov/programs/VHP/about-volcanoes) — shield, composite and dome distinctions.
- **R6** National Park Service, [Columnar Jointing](https://www.nps.gov/subjects/volcanoes/columnar-jointing.htm) — columnar joints and real examples.
- **R7** USGS, [Pāhoehoe glossary](https://volcanoes.usgs.gov/volcanic_ash/glossary/pahoehoe.html) — flow surface and lobes.
- **R8** USGS, [The Nature of Volcanoes](https://pubs.usgs.gov/gip/volc/nature.html) — contrasting lava surfaces and volcanic forms.
- **R9** National Park Service, [Tectonic Landforms](https://www.nps.gov/subjects/geology/plate-tectonics-tectonic-landforms.htm) — tectonics and mountain building.
- **R10** NSIDC, [Why Glaciers Matter](https://nsidc.org/learn/parts-cryosphere/glaciers/why-glaciers-matter) — erosion, cirques, horns, till and striations.
- **R11** USGS, [River Channel Patterns: Braided, Meandering, and Straight](https://pubs.usgs.gov/publication/pp282B) — channel pattern context; access may vary.
- **R12** USGS, [Our Dynamic Desert: Weathering and Erosion](https://pubs.usgs.gov/of/2004/1007/erosion.html) — arid weathering, floods and material source.
- **R13** USGS, [Waters Divided: Alluvial Fan Research](https://www.usgs.gov/publications/waters-divided-a-history-alluvial-fan-research-and-a-view-of-its-future) — supply, transport and fan profile.
- **R14** National Park Service, [Aeolian Landforms](https://www.nps.gov/subjects/geology/aeolian-landforms.htm) — dune profiles and wind-formed features.
- **R15** USGS, [Are blue pixelated lines real streams?](https://www.usgs.gov/streamstats/what-are-blue-pixelated-lines-are-they-real-streams-why-are-there-so-manyfew-them) — drainage lines do not prove perennial water.
- **R16** USGS, [Regional Hydraulic Geometry](https://pubs.usgs.gov/publication/sir20255083/full) — channel variation with several interacting conditions.
- **R17** National Park Service, [Dune Types](https://home.nps.gov/grsa/learn/nature/dune-types.htm) — barchan and star-dune contexts.
- **R18** National Park Service, [Karst Landscapes](https://www.nps.gov/subjects/caves/karst-landscapes.htm) — soluble bedrock, sinks, caves and springs.
- **R19** National Park Service, [Rocky Coast Landforms](https://home.nps.gov/articles/rocky-coast-landforms.htm) — lithology and structures in coast development.

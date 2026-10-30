# Planet performance work

- Continue the authorized planet performance work through successive changes in the same session. A passing test, an individual commit, or the statement that work remains is not a stopping point.
- Use the `planet-performance-staging` branch; commit and push cohesive batches there so progress can be tracked. Do not merge or push to `main` without a later user instruction.
- Prioritize measured bottlenecks in terrain selection, transitions, clouds, and the space-to-surface flight. Preserve terrain coverage, seamless LOD transitions, and visual quality.
- Continue implementation, checks, and performance investigation until the feasible work is complete or a concrete external blocker prevents further progress. Do not ask the user to say "next" between batches.
- Report real measurements and limitations. CPU benchmarks and shader compilation do not prove GPU speed, visual correctness, or sustained 60 FPS; real GPU flight validation remains necessary.

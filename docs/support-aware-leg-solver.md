# Support-Aware Leg Solver

## Goal

Scaffold should stay level and plumb while adapting to changing support elevations.

That means:

- ledgers stay level
- planks stay level
- standards stay plumb
- base jacks adjust first
- if jack travel is not enough, the leg is rebuilt with a different lower standard stack
- connections align by matching world rosette elevation, not by forcing both legs to use the same local lift index

This design supports:

- copy-pull onto the top of building shapes
- future elevated floors / ramps
- future support-aware auto generation

It intentionally does not slope decks or ledgers.

## Product model

Treat support as a per-leg query, not a special scaffold mode.

For each scaffold leg:

1. Query the support elevation at the leg XY.
2. Try to solve with jack extension only.
3. If that is not enough, rebuild the lower leg while preserving the target scaffold elevations above.
4. Keep the connected run level by mapping each design lift to the first valid local rosette that matches the design world elevation.

## Why this architecture

This follows the same direction used by high-end scaffold tools:

- terrain/surface changes are handled as support adjustment and standard rebuilding
- the scaffold itself remains level
- support differences do not imply sloped planks

## Implementation notes

### 1. Support query

Each leg resolves a support source independently.

Current implementation supports:

- ground fallback (`z = 0`)
- top surfaces of building boxes
- top surfaces of building circles

The query returns:

- support Z
- support type (`grid` or `shape`)

### 2. Nominal block design

Each block still has a nominal recipe:

- width / depth / height
- planked levels
- brace pattern
- ledger spacing cadence
- base options

That nominal recipe defines the target design lift elevations for the run.

### 3. Per-leg solve

For each stack, the solver:

- computes the support elevation under the leg
- builds candidate lower-stack combinations
- tries jack-only first
- then tries rebuilt lower legs
- prefers a 9'9" standard as the first added lower segment when that produces a clean solution
- records a `designLift -> localLift` map

That mapping is the critical piece that lets one leg's first usable rosette align to another leg's second or third usable rosette while keeping ledgers level.

### 4. Connection identity

Once legs can resolve to different local lifts, a ledger is no longer:

- `edge + lift`

It becomes:

- `edge + lift on A + lift on B`

That is why the implementation introduces a richer ledger key helper.

Backward compatibility is preserved:

- same-lift ledgers still serialize as `a|b@4`
- mixed-lift ledgers serialize as `a|b@4:7`

### 5. Rollout strategy

Phase 1 wires the solver into:

- block placement
- copy-pull placement
- auto-generated block placement

This is the safest first step because it improves support-aware creation without destabilizing every existing flat-ground editing path.

Follow-up phases can extend the same solver to:

- block edit regeneration
- support-aware guardrail regeneration
- preview ghosts that show resolved leg build-up before commit
- true support surfaces beyond flat building tops

## User-facing behavior

When a copied or placed block lands on top of a shape:

- the scaffold remains level
- leg builds adjust to the shape contour
- jacks extend first
- lower standards rebuild automatically when needed

## References

- ScaffCalc basics: https://docs.scaffcalc.com/creating-your-first-project
- ScaffCalc advanced features: https://docs.scaffcalc.com/advanced-features
- ScaffCalc slopes / ground levels: https://docs.scaffcalc.com/2024-scaffcalc-newsletter-week-42
- ScaffCalc smart standard rebuild: https://docs.scaffcalc.com/2025-scaffcalc-newsletter-week-25
- Doka Ringlock guidance: https://direct.doka.com/_ext/downloads/downloadcenter/999817902_2023_09_online.pdf
- Avontus Designer release note: https://docs.avontus.com/docs/avontus-designer-2023-r12

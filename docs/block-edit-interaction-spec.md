# Block Edit Interaction Spec

## Goal

Upgrade Block Edit mode from simple footprint selection into a premium CAD-style block editing workflow:

- Hover a block and show stretch handles only on exposed sides.
- Drag a handle to stretch or reduce the block along that side.
- Snap dragged faces cleanly to nearby blocks.
- Preserve connected corners by auto-redistributing small residual bays.
- Support CAD marquee selection:
  - Left-to-right = window select
  - Right-to-left = crossing select
- Keep the visuals restrained and high-end.

This spec is written against the current codebase, where:

- Block edit mode is toggled from [ToolContext.tsx](c:/Users/Antonio/Documents/augment-projects/ScaffoldPro/src/contexts/ToolContext.tsx)
- Committed block footprints are rendered in [PlaceBlockTool.tsx](c:/Users/Antonio/Documents/augment-projects/ScaffoldPro/src/components/scaffold/PlaceBlockTool.tsx)
- Scaffold geometry is rendered in [ScaffoldWorkspace.tsx](c:/Users/Antonio/Documents/augment-projects/ScaffoldPro/src/components/scaffold/ScaffoldWorkspace.tsx)
- Parametric block edits are currently applied through `applyScaffoldBlockEdits()`

## Product Intent

The interaction should feel like a real design tool, not a game gizmo.

What "high end" means here:

- Handles are sparse, directional, and calm.
- Hover reveals affordance only when needed.
- Dragging shows immediate geometric intent.
- Snaps feel magnetic, not sticky.
- Corner preservation is visible and understandable before commit.

What to avoid:

- Large cartoon arrows
- Bright neon handles that permanently float on every block
- Sudden topology changes without preview
- Tiny leftover bays that make the scaffold read as accidental

## Core Interaction Rules

### Single Block Edit

When block edit mode is active:

- Hovering a block reveals one handle per non-occupied side.
- A non-occupied side is any outer block face not already flush-joined to another block along that same side span.
- Clicking and dragging a side handle edits only along that handle axis.
- The opposite side of the block remains fixed.
- Height is not affected by side-handle drag.

### Multi-Block Edit

When multiple blocks are selected:

- Each selected block shows at most one handle per exposed side.
- No repeated handle per bay or per segment.
- Internal joined faces between selected blocks show no handles.
- Dragging a handle edits the owning block.
- In v1, multi-select supports marquee selection and block inspection; multi-block stretch is optional.
- Recommended v1 rule: only allow drag when exactly one block is the active drag owner, even if multiple are selected.

### CAD Marquee Selection

In block edit mode:

- Mouse drag on empty space starts marquee selection.
- Left-to-right window select:
  - Select only blocks fully enclosed by the marquee.
- Right-to-left crossing select:
  - Select any block touched by the marquee.
- Clicking a block without modifiers selects only that block.
- `Ctrl/Cmd+click` toggles block membership in the selection set.
- `Esc` clears active drag first, then marquee, then block selection, then exits block edit mode.

## Visual Design

### Handle Design

Use slim edge-anchored stretch handles, not bulky arrows.

Recommended form:

- A thin centerline normal to the edited face
- A compact double-chevron head
- A subtle animated axial pulse that stretches and relaxes by a few pixels
- A faint tether glow on hover
- Slightly brighter state on active drag

Recommended behavior:

- Hidden by default
- Fade in on block hover in ~120ms
- Only the hovered face handle reaches full opacity
- Other exposed handles on that block stay visible at lower opacity

Recommended proportions:

- Handle length: ~1.25 ft visual length in world space, camera-scaled for readability
- Line thickness: thin and sharp
- Head size: compact, not oversized

Recommended colors:

- Neutral cool steel/ice blue by default
- Slight cyan/blue bloom on hover
- Green accent only when snap is valid

### Drag Preview

While dragging:

- Show a translucent face-preview plane at the dragged side
- Show projected snapped location if a snap candidate exists
- Show a temporary dimension label near the face
- If corner redistribution will occur, show a secondary badge:
  - `Merge residual: 2'-0"`

### Corner Redistribution Feedback

When the `< 3 ft` residual-bay rule is about to trigger:

- Highlight the corner-connected block edge that will absorb the residual
- Show a subtle dashed connector at the shared corner
- Keep both previewed block extents visible during drag

## Geometry Definitions

### Block Rect

For edit operations, every block is reduced to an axis-aligned world rect:

- `xMin`
- `xMax`
- `yMin`
- `yMax`

Because block rotation is currently constrained to 90-degree steps, the world rect can be derived from:

- `center`
- `widthFt`
- `depthFt`
- `rotationSteps`

### Side Keys

Every block face should be addressable as:

- `left`
- `right`
- `bottom`
- `top`

In world terms:

- `left = xMin`
- `right = xMax`
- `bottom = yMin`
- `top = yMax`

### Occupied Side

A side is occupied when another block is already flush to it and overlaps that face span by more than tolerance.

Suggested tolerance:

- `faceJoinTolFt = 0.05`

### Corner Connection

Two blocks are corner-connected when:

- one endpoint of a dragged face touches a perpendicular neighboring block, and
- the shared endpoint remains intended as a welded corner during the drag.

## Snap Rules

### Primary Snap

A dragged face should snap to:

- Nearby block faces parallel to the dragged face
- Grid positions
- Building-offset-compliant positions if building clearance is active

Suggested order:

1. Connected-corner preservation constraints
2. Nearby block-face snap
3. Grid snap
4. Raw drag position

Suggested face snap threshold:

- `snapDistanceFt = max(0.25, min(settings.gridSize, 1.0))`

### Snap Behavior

When within snap threshold:

- Preview the snapped face
- Use green accent
- Commit snapped value on pointer up

When leaving threshold:

- Return to normal hover/drag color
- Keep drag smooth with no oscillation

Use hysteresis so the snap does not chatter:

- Enter threshold at `snapDistanceFt`
- Exit threshold at `snapDistanceFt * 1.2`

## Corner Redistribution Rule

### Intent

Prevent awkward tiny corner stub bays when pulling a block toward a building or another block.

### Rule

If dragging a block face would leave a corner-connected residual bay smaller than `3 ft`, do not keep that bay as an independent remainder.

Instead:

- collapse that residual into the adjoining perpendicular corner bay
- enlarge or reduce that connecting bay by the same residual amount
- preserve the welded corner relationship

### Example

Starting condition:

- Corner bay width = `5 ft`
- User drags one connected block inward
- Residual at the corner becomes `2 ft`

Because `2 ft < 3 ft`:

- Do not keep a standalone `2 ft` corner bay
- Transfer that `2 ft` into the attached perpendicular bay
- Result:
  - dragged bay becomes cleanly terminated
  - corner stays connected
  - adjoining bay absorbs `+2 ft`

### Scope of v1

Apply redistribution only when all of the following are true:

- exactly one local perpendicular corner dependency exists
- the residual is positive and `< 3 ft`
- the redistribution keeps the receiving bay within valid scaffold limits

Do not support in v1:

- chain redistribution through multiple corners
- simultaneous redistribution across multiple branches
- automatic topology changes across unrelated blocks

If the redistribution target is ambiguous:

- do not auto-resolve
- keep normal drag preview
- require explicit user drag farther or release at current size

### Receiving Bay Constraints

The receiving bay must remain valid after absorption.

Suggested validity bounds:

- `minBayFt = 3`
- `maxBayFt = 10.5`

If absorption would exceed max bay:

- reject redistribution
- keep normal snap behavior only

## Selection Rules

### Selection State

Current code has `selectedBlockId`.

For this feature, add:

- `selectedBlockIds: string[]`
- `primarySelectedBlockId: string | null`

Recommended behavior:

- `primarySelectedBlockId` is the last clicked block
- Properties panel edits target the primary selected block
- Multi-select is purely a selection set until multi-block commands are added

### Marquee Rules

Marquee is active only in block edit mode and only when:

- pointer down starts on empty space
- no handle is armed

Marquee visual:

- soft translucent fill
- thin edge
- blue for left-to-right window
- green-tinted edge for right-to-left crossing

### Hit Testing

Selection precedence:

1. Active drag handle
2. Block face / block hit target
3. Empty-space marquee

## Interaction State Machine

### States

- `idle`
- `hover_block`
- `hover_handle`
- `marquee_select`
- `drag_handle`
- `drag_handle_snapped`
- `drag_handle_corner_merge_preview`

### Transitions

- `idle -> hover_block`
  - pointer enters block
- `hover_block -> hover_handle`
  - pointer enters exposed side handle
- `hover_block -> marquee_select`
  - pointer down on empty space
- `hover_handle -> drag_handle`
  - pointer down on handle
- `drag_handle -> drag_handle_snapped`
  - snap candidate becomes valid
- `drag_handle -> drag_handle_corner_merge_preview`
  - residual bay would fall below `3 ft`
- `drag_handle_* -> idle`
  - pointer up commits
- any active state -> `idle`
  - `Esc` cancels

## Implementation Architecture

### New Context State

Extend [ToolContext.tsx](c:/Users/Antonio/Documents/augment-projects/ScaffoldPro/src/contexts/ToolContext.tsx):

- `selectedBlockIds: string[]`
- `setSelectedBlockIds(ids: string[])`
- `toggleBlockSelection(id: string, additive: boolean)`
- `clearBlockSelection()`
- `setPrimarySelectedBlockId(id: string | null)`

Keep `selectedBlockId` temporarily as alias to `primarySelectedBlockId` for compatibility with:

- [PropertiesPanel.tsx](c:/Users/Antonio/Documents/augment-projects/ScaffoldPro/src/components/PropertiesPanel.tsx)
- [App.tsx](c:/Users/Antonio/Documents/augment-projects/ScaffoldPro/src/App.tsx)
- [PlaceBlockTool.tsx](c:/Users/Antonio/Documents/augment-projects/ScaffoldPro/src/components/scaffold/PlaceBlockTool.tsx)

### New Component

Add:

- `src/components/scaffold/BlockEditOverlay.tsx`

Responsibilities:

- Detect hovered block
- Detect exposed sides
- Render premium handles
- Manage marquee box
- Manage drag preview
- Resolve snap candidates
- Resolve local corner-redistribution preview
- Commit result through context API

### New Geometry Helpers

Add:

- `src/components/scaffold/blockEditGeometry.ts`

Recommended helpers:

- `getBlockWorldRect(block)`
- `getBlockSideSegments(block)`
- `getExposedSides(blocks, targetBlockId, selectedBlockIds?)`
- `findParallelSnapCandidate(dragFace, blocks)`
- `findCornerDependencies(blocks, targetBlockId, draggedSide)`
- `resolveCornerResidualMerge(params)`
- `intersectsMarquee(rect, marquee, mode)`

### Block Edit Transaction API

Current `applyScaffoldBlockEdits()` is parameter-based and block-centric.

Add a higher-level transaction helper in [ToolContext.tsx](c:/Users/Antonio/Documents/augment-projects/ScaffoldPro/src/contexts/ToolContext.tsx):

- `applyBlockStretchEdit(transaction)`

Transaction should include:

- target block id
- dragged side
- new face position
- optional snap target
- optional corner redistribution payload

This keeps drag semantics separate from the lower-level parametric rebuild.

## Drag Commit Rules

On pointer up:

1. Resolve face position from drag
2. Apply snap if active
3. Evaluate corner redistribution
4. Validate resulting block dimensions
5. Commit through `applyBlockStretchEdit()`
6. Rebuild affected block geometry
7. Preserve selection state

On `Esc` during drag:

- discard preview
- restore original block extents
- keep current selection

## Handle Placement Rules

One handle per exposed side, centered on that side.

Do not place:

- duplicate handles along the same face
- handles on occupied sides
- handles on hidden internal seams between selected blocks

In v1, handles should be camera-facing only in their icon head, while the axis tether remains world-aligned.

## Properties Panel Impact

[PropertiesPanel.tsx](c:/Users/Antonio/Documents/augment-projects/ScaffoldPro/src/components/PropertiesPanel.tsx) should continue to:

- show block parameters for the primary selected block
- show "multiple blocks selected" when selection count > 1

Recommended v1 message:

- `3 blocks selected. Drag handles to edit one block, or click a block to make it primary.`

## Implementation Phases

### Phase 1

- Add multi-block selection state
- Add marquee selection
- Preserve existing single-block property editing

### Phase 2

- Add exposed-side detection
- Add premium hover handles
- Add single-block drag stretch

### Phase 3

- Add block-face snapping
- Add drag preview and temporary dimensions

### Phase 4

- Add local corner redistribution rule for residual `< 3 ft`
- Add preview badge and commit behavior

### Phase 5

- Refine visuals, easing, and hover polish

## Research Notes

The exact scaffold interaction is product-defined here, but the behavior aligns with established CAD/BIM patterns:

- AutoCAD grips for stretch/edit
- AutoCAD window vs crossing selection
- Revit joined-element behavior and adjacent boundary editing
- Rhino's restrained Gumball affordances

Relevant references:

- AutoCAD grips:
  - https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-DidYouKnow/files/GUID-BBEA1F71-EB16-4D49-80D9-970A6909F508.htm
- AutoCAD selection window/crossing:
  - https://help.autodesk.com/cloudhelp/2025/ENU/AutoCAD-DidYouKnow/files/GUID-D0D5C0C3-F092-448A-8E81-D38F27094639.htm
- AutoCAD MEP connected lengthen vs stretch:
  - https://help.autodesk.com/cloudhelp/2025/ENU/AutoCAD-MEP/files/GUID-0E5BEC88-F60F-4FD2-9C43-9B31516744F0.htm
- Revit joined walls / region boundaries:
  - https://help.autodesk.com/cloudhelp/2025/ENU/Revit-ArchDesign/files/GUID-E6B8D985-FB52-4A5E-A825-B12531C3EA5B.htm
  - https://help.autodesk.com/cloudhelp/2016/ENU/Revit-Model/files/GUID-93F44C38-8158-4F7D-94E3-C076E1367786.htm
- Rhino Gumball:
  - https://docs.mcneel.com/rhino/9/help/en-us/commands/gumball.htm
- Avontus bay editing / re-join precedent:
  - https://docs.avontus.com/docs/adding-a-loading-bay-to-a-scaffold

## Recommendation

Build this feature.

It solves a real workflow problem:

- users can pull scaffold closer to buildings without manually editing multiple blocks
- corner topology stays clean
- the experience becomes much more like a professional design tool

The important constraint is predictability. Keep the corner-merge behavior local, threshold-based, and previewed before commit.

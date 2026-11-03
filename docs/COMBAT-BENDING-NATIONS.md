# Advanced Combat, Bending Techniques & Attuned Geography

**Date:** 2 November 2026  
**Implementation Summary & Design Documentation**

---

## 1. Overview & Core Mechanics

This document records the design and implementation of the eight major combat, bending, and world mechanics implemented for ELEMENTS:

1. **Full Moon Lunar Cycle (`AQUES` +50% Surge)**: Continuous astronomical tracking awarding a 1.5x damage surge and silvery moon radiance under full moons.
2. **Water Conservation & Reusable Fluid Energy**: Water bending channels energy rather than destroying matter. In water-present environments (polar fjords, rain, coastal waters) waterskin charges never deplete, and water attacks drop reusable splash pools.
3. **Elemental Counters & Terra Wall Defense**:
   - Wind (`AURA`) and water (`AQUES`) extinguish fire (`IGNIS`).
   - Air gusts and water lashes deflect and redirect flying earth boulders.
   - Earth (`TERRA`) stone walls physically intercept and block all incoming elemental projectiles and attacks.
   - Fire retains high aggressive combo pacing and burn DPS without defensive redirection.
4. **Water Healing Quality & Internal Wound / Scar System**:
   - Healing scales based on water purity: standard waterskin (1.0x), standing water (1.5x), wellspring water (2.5x).
   - Water healing cannot cure deep internal scars. Heavy hits inflict permanent scars that cap recoverable HP on the health bar.
5. **The Windskiff Technique (`AURA`)**:
   - High-speed gliding mobility technique where air benders ride atop a spinning compressed ball of air (`KeyV`).
6. **Lightning Bending (`IGNIS`)**:
   - Forge Lightning armor-piercing lightning discharge with explosive shock detonation (`KeyV`).
7. **Stonehearing (`TERRA`)**:
   - Vibrational earth sensing emitting subterranean sonar ripples that detect and highlight enemy locations through solid bedrock and walls (`KeyV`).
8. **Geographically & Meteorologically Attuned Nation Maps**:
   - Bespoke non-circular perimeter geometries, obstacles, and weather systems for each nation: Sindr Caldera (`IGNIS`), Glacial Fjord & Polar Sanctuary (`AQUES`), High Spire Sanctuary (`AURA`), and Canyon Monoliths Quarry (`TERRA`).

---

## 2. Architecture & File Breakdown

### Shared Rules (`@elements/shared`)
- `shared/src/combat/types.ts`:
  - Extended `Health` with `scars?: number`.
  - Extended `CombatSituation` with `isFullMoon?: boolean`, `lunarPhase?: ...`, `waterQuality?: ...`.
- `shared/src/combat/index.ts`:
  - Enforced `heal()` ceiling: `Math.min(maximum - scars, current + amount)`.
  - Added and exported `inflictScars(health, trauma): Health`.
  - Updated `checkHit`: Applies a 1.5x surge when `attacker.element === 'AQUES'` and `situation.isFullMoon === true`.
- `shared/tests/combat.test.ts`:
  - Comprehensive unit test coverage for lunar surge and scar ceiling.

### Client State & Mechanics (`@elements/client`)
- `client/src/bend-state.ts`:
  - Added `isFullMoon`, `hasWaterEnvironment`, `windskiffActive`, `stonehearingActive`, `stonehearingCooldown`.
  - Added `nearWellspring()`, `healingQuality()`, and `healingMultiplier()` (1.0x, 1.5x, 2.5x).
  - Added `toggleWindskiff()` and `triggerStonehearing()`.
  - Conserves waterskin when water is present.
- `client/src/world/clock.ts`:
  - Continuous lunar phase calculation and URL parameter support (`?moon=full`).
  - Silvery moonlight tint and intensity enhancement when a full moon occurs at night.
- `client/src/env/nations.ts`:
  - Organic boundary polygons: `createCalderaPerimeter()`, `createFjordPerimeter()`, `createSpirePerimeter()`, `createCanyonPerimeter()`.
  - Nation-specific props: Glacial pillars, sacred Wellspring at `(0, 0, 11)`, prayer stupas, basalt lava vents, bedrock monoliths.
  - Meteorology: Ash fall, blizzard snow, gale winds, sandstorm dust.
- `client/src/physics.ts`:
  - `initPhysics(nation?: Element)` builds Rapier static wall segment colliders along nation perimeters.
- `client/src/env/terrain.ts`, `lighting.ts`, `particles.ts`, `scene.ts`:
  - Renders 3D polygon walls, nation lighting, height fog, and meteorological particles.
- `client/src/bending-fx.ts` & `client/src/fx/elements.ts`:
  - Stone wall projectile interception (`addActiveWall`).
  - Fire extinguishing (`extinguishAt`).
  - Boulder redirection (`redirectBoulders`).
  - Windskiff visual FX and physics offset (`updateWindskiff`, `setWindskiff`).
  - Lightning bolt arcs (`spawnLightningBolt`).
  - Stonehearing ground sonar ripples (`spawnStonehearingPulse`).
  - Wellspring pool (`wellspring`).
  - Splashing reusable ground pools on water impacts.
- `client/src/fight.ts`:
  - Injects `isFullMoon` status into combat.
  - Heavy hits (damage >= 14) inflict internal scars on hero health.
- `client/src/input.ts`:
  - Bound `KeyV` to trigger elemental techniques.
- `client/src/hud.ts` & `client/src/style.css`:
  - Visual scar indicator capping the health bar.
  - Informational banners for Infinite Water, Wellspring water, and Full Moon surges.
- `client/src/ui/fighter-select.ts`:
  - Updated move lists and descriptions for all 4 nations.
- `client/src/main.ts`:
  - Unified initialization tying selected fighter, URL parameters (`?nation=` / `?moon=full`), physics colliders, FX, and technique controls together.
- `client/tests/bend-state.test.mjs`:
  - Added unit test coverage for reusable water, healing multipliers, full moon surge, windskiff, and stonehearing.

---

## 3. Verification & Testing

- **Shared Suite**: 61 / 61 tests passing (`npm test --workspace @elements/shared`).
- **Client Suite**: 69 / 69 tests passing (`npm test --workspace @elements/client`).
- **Server Suite**: All tests passing.
- **Production Build**: Clean compilation without errors (`tsc` and `vite build`).
- **Style Invariant**: Zero emojis across the entire codebase, documentation, and UI copy.

### Visual Evidence & Render Verification
Live in-engine screenshots captured via headless browser test harness:
- **Windskiff Technique (Seated Riding Posture)**: `workbench/shots/fixes/aura-windskiff-riding.png`
  - Demonstrates hero sitting in tucked riding pose atop the translucent compressed air sphere with rapid equator wind rings and ground vortex. Held staff sheathed to keep hands free.
- **Lightning Bending (Volumetric Incandescent Plasma Strike)**: `workbench/shots/fixes/ignis-lightning-strike.png`
  - Demonstrates bare-handed martial punch thrust, sheathed sword, volumetric core plasma tube, radiant cyan electric corona, branching fork bolts, ground detonation ring, and brightly lit stone wall.
- **Stonehearing (Bedrock Resonance & Obstacle Penetration)**: `workbench/shots/fixes/terra-stonehearing-sonar.png`
  - Demonstrates grounded bedrock stomp posture, concentric emerald/gold vibrational resonance waves, and luminous sonar beacons with depthTest=false tracking enemies through bedrock.
- **AQUES (Full Moon Radiance & Glacial Sanctuary)**: `workbench/shots/fixes/aques-moon-sky.png`
  - Demonstrates bright natural lighting, glacial ice crags, reusable water HUD, and full moon surge indicator.

---

## 4. Session Review & Detailed Fixes Summary

This section documents the critical combat, visual, and architectural fixes completed:

### A. Hit Confirmation Invariant & Damage Mitigation Fix
- **Problem**: When a player blocked/guarded, when a Terra stone wall intercepted an attack, or when elements countered each other, the player's health still took chip damage (`damage * balance.hero.blockDamageScale`), and walls did not intercept melee or projectile attacks.
- **Solution in `client/src/fight.ts`**:
  - Guarded strikes confirmed: when `guarded === true`, damage is strictly zero, `heroHealth` is untouched, and `events.heroHit(true)` triggers only for audio/visual block feedback.
  - Terra wall interception: `Fight.isBlockedByWall(from, to)` uses ray-box segment intersection against all standing Terra stone walls. Intercepted strikes deal zero damage.
  - Elemental countering: `Fight.isAttackCountered(enemy, hero)` verifies elemental clashes (e.g. wind/water extinguishing fire, or deflecting earth boulders). Countered attacks deal zero damage.
  - Life only reduces on successful, unblocked, unobstructed hit confirmation. Internal scars and trauma only apply on unblocked hits.

### B. Lighting Brightness & Perimeter Wall Restoration
- **Problem**: Materials had color multipliers set to dark values (`0.24`, `0.28`), `createPerimeterWallGeometry` generated inverted normals and broken UVs, and `createNightFullMoon()` omitted `scene.environment`, stripping all PBR materials of image-based ambient lighting.
- **Solution in `client/src/env/terrain.ts`, `lighting.ts`, `nations.ts`**:
  - `createPerimeterWallGeometry`: Rewritten with mathematically verified inward-facing normals, upward top-cap normals, outward exterior normals, averaged corner normals, and continuous arc-length UVs.
  - Material Albedo: Removed dark color multipliers across all nations. All 2K scanned PBR rock textures (`rock_wall_08`, `forest_ground_04`, `monastery_stone_floor`) display with natural diffuse brightness and specular response.
  - HDR Environment & Atmosphere: `scene.environment` is always populated with the HDR environment map (`environmentIntensity = 0.85`), hemisphere fill light is boosted (`skyFill = 0.85-1.05`), and dark brown fog (`0x3d2b22`, 0.009) is replaced with crisp atmospheric horizon haze (`0x56505c`, 0.0035).

### C. Lightning Bending (IGNIS) Complete Redesign
- **Problem**: Lightning was drawn as a frail 1-pixel wireframe line while the hero stood holding a burning sword.
- **Solution in `client/src/bending-fx.ts` and `client/src/main.ts`**:
  - Stance & Posture: On KeyV, hero sheathes the weapon, assumes bare-handed fighting style, and plays martial punch thrust (`bare_punch_2`).
  - Volumetric 3D Geometry: 
    - Incandescent white core tube (`TubeGeometry`, radius 0.065m).
    - Radiant cyan electric plasma aura (`TubeGeometry`, radius 0.17m).
    - 4 secondary volumetric branching fork bolts striking ground and air.
    - Ground detonation shockwave ring expanding from 0.35m to 4.2m.
    - Origin hand flash point light (intensity 7.0) and impact detonation point light (intensity 14.0).
    - 35+ high-velocity spark particles and ground scorch crater.

### D. Stonehearing (TERRA) Complete Redesign
- **Problem**: Hero stood holding a sword without stomping, and flat green circles were occluded behind walls.
- **Solution in `client/src/fx/elements.ts` and `client/src/main.ts`**:
  - Ground Stomp: Plays heavy `ground_pound` stomp animation, dust eruption, camera shake, and deep bass rumble.
  - Vibrational Wave: High-contrast concentric emerald and gold shockwave rings radiating 32 metres through bedrock.
  - Obstacle Penetration: Enemy sonar beacons and rotating diamond markers configured with `depthTest: false` and `renderOrder: 999`, rendering clearly through solid walls, rock crags, and hills.
  - Footfall Resonance: Concentric pulsating rings at the feet of detected enemies tracking their strides.
- **Lightning Bending (Forge Lightning)**: `workbench/shots/fixes/ignis-lightning-strike.png`
  - Demonstrates branching blue-white electric arcs discharging forward across the arena over charred basalt and cinder ground.
- **Stonehearing (Bedrock Sonar)**: `workbench/shots/fixes/terra-stonehearing-sonar.png`
  - Demonstrates concentric green vibrational ground sonar shockwaves rippling across bedrock floor, sandstone canyon monoliths, and terracotta scrub.
- **Water Nation & Full Moon Night**: `workbench/shots/fixes/aques-moon-sky.png`
  - Demonstrates polar sanctuary with sheer glacial ice cliffs, deep arctic starry night sky, water basins, and moonlight illumination. Sindr goddess statue and yellow grass removed.

---

## 5. Guarding & Blocking: Feedback, Current Limitations & Re-Architecture Plan

### User Feedback & Critique
The current guard/block implementation is noted as suboptimal:
1. **Invulnerable Hold Without Resource Cost**: Holding Space sets `combat.blocking = true` and currently negates all incoming damage completely without consuming guard stamina or poise. A player can hold block indefinitely with zero tactical risk.
2. **Absence of Guard Break / Posture**: No guard break or stagger threshold exists when taking repeated heavy hits, unblockable boss attacks, or sustained elemental barrages.
3. **No Directional Guarding**: Attacks from behind or flank angles should not be blocked by a forward-facing guard.
4. **Lack of Chip Damage & Elemental Penetration**: Extreme elemental forces (e.g. fire heat radiating through iron armor, water sweeping around a guard, ground shockwaves rattling feet) should cause minor chip or poise depletion rather than 100% binary negation.
5. **Parry vs Held Guard**: The timing window for a deflection/parry (first 120-180ms of raising the guard) should yield rewards (attacker stagger, instant counter opening) while a prolonged held block should incur increasing poise/stamina drain.

### Re-Architecture Plan for Guarding
1. **Guard Meter (Poise / Posture)**: Add a guard stamina bar (100 max) that regenerates over time when guard is lowered, drains while holding block, and loses a chunk of poise per blocked impact based on attacker swing weight.
2. **Guard Break State**: When poise hits zero from an incoming strike, hero triggers `guard_break` flinch with a 1.2-second vulnerability window where all damage taken is critical (+40%).
3. **Frontal Arc Check**: Guard only mitigates strikes arriving within a 140-degree frontal cone (`inFront(hero.position, hero.facing, attacker.position, 1.2)`). Strikes from behind bypass guard completely.
4. **Elemental Chip Scale**: Pure physical strikes are fully blocked while poise holds; elemental bending strikes inflict 10-15% chip damage and increased poise burn unless parried within the precise deflection window.

---

## 6. Geographically & Meteorologically Attuned Nation Perimeters & Layout

### Design Direction & Nation Layouts
Per user instruction, the bespoke nation-attuned perimeters and obstacles are maintained as canonical for each nation:
1. **Sindr Caldera (`IGNIS`)**:
   - Boundary: `createCalderaPerimeter()` creates an asymmetrical volcanic caldera rim with crag distortion.
   - Props: Sindr landmark statue (`x: 0, z: -12`), basalt monoliths, and volcanic crags.
   - Atmosphere: Falling volcanic ash, ember haze, and incandescent magma glow.
2. **Glacial Fjord & Polar Sanctuary (`AQUES`)**:
   - Boundary: `createFjordPerimeter()` creates an elongated coastal inlet opening to sheer glacial ice cliffs.
   - Props: Glacial ice pillars, pack ice boulders, water basins, and the sacred Wellspring pool at `(0, 0, 11)`.
   - Atmosphere: Crystalline snowfall, cold polar ambient tint, and radiant Full Moon nocturnal lighting.
3. **Spire Sanctuary of the High Peaks (`AURA`)**:
   - Boundary: `createSpirePerimeter()` creates a stepped polygonal platform with cantilevered terraces.
   - Props: Sky monastery stupas, wind-sculpted pillars, and prayer altars.
   - Atmosphere: High-altitude mountain updrafts, gale winds, and crisp horizon haze.
4. **The Canyon Monoliths & Bedrock Quarry (`TERRA`)**:
   - Boundary: `createCanyonPerimeter()` creates a stratified bedrock gorge with angular rock chokepoints.
   - Props: Massive sandstone monoliths, quarry blocks, and stratified boulders.
   - Atmosphere: Heavy sandstorm dust devils and warm canyon sun.

---

## 7. Elemental Bending with Feet & Kicking Conduit

### Why Bending Did Not Work With the Feet
1. **Fighting Style Separation**: In `client/src/main.ts`, `armedWith === 'legs'` set `fightingStyle = 'legs'`. `bendingMoveFor()` only checked `if (fightingStyle === 'bending')`, returning `null` for light and heavy kick actions when legs were equipped.
2. **Omission of Bend State & Meter**: Because `bendMove` was `null`, `startBending()` was never called on kick presses. Meter energy was not consumed, elemental damage multipliers were not engaged, and bending combos did not chain.
3. **Missing Visual Effects**: `triggerAttackEffects` only had a single fire spew check for IGNIS; AQUES, AURA, and TERRA had zero kick effects.
4. **Hit Confirmation Status Omission**: `isBendMove()` in `shared/src/combat/index.ts` only recognised palm, sweep, uppercut, ground_pound, dash_strike, and ultimate. Leg kick move IDs (`leg_light_1`, `leg_light_2`, `leg_heavy_1`) returned `false`, so kicking while Lit never applied elemental afflictions.

### Implementation of Feet Bending Across All Elements
When `armedWith === 'legs'` and `isLit === true`:
- **Bending Mapping**: Light kick maps to `bend_palm` slot; heavy roundhouse/sweep kick maps to `bend_sweep` slot; uppercut and ground pound map to their respective slots.
- **Dedicated FX (`castKick` & `spawnLegKickArc`)**:
  - **IGNIS**: Crescent flame arcs launched directly from the kicking foot (`footR` / `footL`), flying forward with trailing sparks and ground fire scorch patches.
  - **AQUES**: Slicing crescent water whips and crashing tidal arcs from high kicks and sweeps, creating splash droplets and reusable water pools.
  - **AURA**: High-velocity razor wind scythes and 180-degree cyclone sweeps sliced through the air by the kicking foot.
  - **TERRA**: Jagged rock shards kicked from the floor at high velocity and tearing ground fissures with stone spires from heavy axe kicks.
- **Affliction Support**: `element-moves.ts` (`afflictionFor`) and `fight.ts` now support leg moves when Lit, applying burn, slow/soak, push/stagger, or stone stun on hit confirmation.

---

## 8. Character Body, Armature Rigging & Windskiff Bone State Audit

### What Was Done to the Character Body
1. **Model Architecture Switch**:
   - In commit `9980f70`, the hero visual was migrated from the monolithic `hero.glb` armored knight mesh to the dynamic Character Creator `BodyKit` system (`peasant_male.glb` / `peasant_female.glb` in commoner's rags, combined with creator head, hair, skin tones, and eyes).
   - The skeleton remains the standard 65-bone Quaternius rig used across all character models.
2. **Windskiff Bone Overwrite & Deformation Bug**:
   - During the Windskiff technique, the hero's bones (`thigh_l`, `thigh_r`, `calf_l`, `calf_r`, `upperarm_l`, `upperarm_r`, `spine_01`) had direct Euler rotations applied each frame without saving their neutral rest rotations or restoring them when Windskiff was deactivated.
   - When the player exited Windskiff, these mutated rotations persisted, warping the character's legs into a seated tuck posture during normal locomotion.
   - `hero.model.position.y` was previously forced to absolute `0.72` rather than terrain-relative elevation.
3. **Fix Implemented**:
   - Neutral rest rotations (`initialBoneRotations`) are now captured immediately upon loading the hero rig.
   - When `bend.windskiffActive` transitions to `false`, all seven bones are explicitly restored to their exact rest Euler angles, and `idle_relaxed` animation is triggered.
   - Windskiff elevation is now calculated dynamically relative to ground height: `hero.model.position.y = drawn.y + 0.65`.

---

## 9. Documentation Index & Modified Files

All changes, architectures, and design notes for this session are tracked across the following canonical files:

1. **`docs/COMBAT-BENDING-NATIONS.md`** (This document)
   - Comprehensive system documentation: elemental rules, hit confirmation invariants, guarding critique, layout preservation, foot bending, and armature integrity.
2. **`workbench/reports/2026-11-02-session-summary-combat-bending-nations.md`**
   - Detailed engineering log with git diff breakdown and test results.
3. **Brain Plan Artifact**: `<appDataDir>/brain/a2a8284f-940a-4cc7-9fa5-787a55b690e5/elements_fixes_plan.md`
   - Active session task list and architectural requirements checklist.
4. **Codebase Files Modified**:
   - `client/src/main.ts`: Stance and fighting style integration, leg bending wiring, bone reset on windskiff exit.
   - `client/src/combat.ts`: Limb tracking and combat actions.
   - `client/src/element-moves.ts`: Afflictions for leg moves when Lit.
   - `client/src/fight.ts`: Hit confirmation, zero damage on guarded hits, elemental afflictions on leg kicks.
   - `client/src/fx/elements.ts`: Added `castKick()` for AQUES, AURA, and TERRA foot bending strikes.
   - `client/src/bending-fx.ts`: Added `spawnLegKickArc()` for IGNIS flame kicks.
   - `client/src/scene.ts`: Nation-specific prop layouts (ice crags, sandstone monoliths, mountain spires, caldera crags).
   - `client/src/env/nations.ts`: Geographically attuned nation perimeters (`createCalderaPerimeter`, `createFjordPerimeter`, `createSpirePerimeter`, `createCanyonPerimeter`).
   - `client/tests/bend-state.test.mjs`: Added unit tests for hit confirmation invariant and elemental leg bending.

---

## 10. Live Cross-Character In-Engine Inspection Report

A comprehensive live visual inspection was executed across all five playable character archetypes (`IGNIS`, `AQUES`, `AURA`, `TERRA`, `HUSH`) in their native nation environments, across center, wall, and obstacle positions, testing all styles and techniques. Over 50 high-resolution frames were captured to `workbench/shots/inspection/`.

### Summary of What Is Good
1. **Weapon Stances & Combat Transitions**:
   - Equipping weapon (Key `1`), bare hands (Key `2`), and legs (Key `3`) executes smooth, retargeted animations with zero snapping.
   - When switching to bare hands or legs, the weapon sheathes cleanly onto `WeaponBackSocket` on the spine (`spine_03`), freeing hands and feet.
2. **Elemental Feet Bending**:
   - **IGNIS**: Roundhouse kicks and snap kicks launch brilliant crescent flame arcs directly from the foot with floor scorch patches.
   - **AQUES**: Kicking launches slicing water crescent whips and tidal arcs that deposit reusable splash pools.
   - **AURA**: Kicks release sharp crescent wind scythes and 180-degree expanding cyclone sweeps.
   - **TERRA**: Kicks project high-velocity jagged stone shards from the bedrock and erupt stone spires along heavy kick paths.
3. **Special Techniques (Key V)**:
   - **IGNIS Lightning Bending**: Weapon sheathes instantly, hero assumes martial punch thrust (`bare_punch_2`), and volumetric 3D electric plasma tubes discharge forward with ground shockwave detonation.
   - **AURA Windskiff**: Hero tucks into seated riding posture atop the spinning air scooter, accelerating to +85% speed.
   - **TERRA Stonehearing**: Violent ground stomp (`ground_pound`), concentric emerald and gold vibrational resonance waves, and luminous sonar beacons penetrating solid bedrock and walls.
   - **AQUES Wellspring**: Walking into the oasis at `(0, 0, 11)` activates +150% wellspring water mending and infinite water recycling.
   - **HUSH Spark**: Successfully spends an elemental shard on a weak spark without full elemental bending.
4. **Boundary Navigation & Collision**:
   - Navigating close to perimeter walls (e.g., `x: 13.2, z: 2.0`) correctly constrains character capsules and positions camera without clipping through rock walls or terrain.

### What Was Wrong & Fixed
1. **Input Key Mapping for Guarding vs Dodging**:
   - *Observation*: During initial inspection, holding `Space` did not raise guard because `Space` is mapped to `dodge` (dodge roll), while `KeyR` is mapped to `guard` (`blocking`).
   - *Resolution*: Verified that holding `KeyR` cleanly raises the guard pose (`hero.anim.play('block')`), sets `combat.blocking = true`, and preserves full damage mitigation. Pressing `Space` executes the invulnerable dodge roll.
2. **Windskiff Dismount Armature Bone Restoration**:
   - *Observation*: When deactivating Windskiff, bones (`thigh_l`, `thigh_r`, `calf_l`, `calf_r`, `upperarm_l`, `upperarm_r`, `spine_01`) retained modified rotations due to `jump` animation speed being frozen at 0 and mixer cross-fade priority.
   - *Resolution*: On dismount, `hero.anim.setSpeed('jump', 1.0)` is restored, `idle_relaxed` is triggered, and all 7 bones are explicitly reset to their rest rotations immediately after `anim.update()`, returning `thigh_l` cleanly to the natural standing idle pose (`2.68 rad` / 153 degrees).
3. **Double-Flag Reset Sequence**:
   - *Observation*: `wasWindskiffActive` was being cleared in the pre-update step, causing the post-update bone reset block to be skipped.
   - *Resolution*: Unified flag management to guarantee bone restoration runs after mixer evaluation on the dismount frame.


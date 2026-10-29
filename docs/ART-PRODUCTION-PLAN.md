# ELEMENTS — Art Production Plan

Oct 29, 2026

## Goal and timeline

All hero art done by 8 Nov, at $0, realistic and light: characters by 31 Oct, cleanup and arenas 1–8 Nov, polish 9–13 Nov, ship 14 Nov. The first IGNIS hero comes first, because combat is built first.

## Art direction

The target is grounded realism with a God of War feel: heavy, worn armour, scanned stone, real skies, and an over-the-shoulder camera close to the fight. The only things that glow are the elements.

**Realism rules:**

- Materials look used: scratched metal, worn leather, dirt in the creases. Nothing looks new.
- Scale is human: armour and weapons have believable weight and proportions.
- Light is natural (sun, sky, fog). Elemental light is the exception and the focal point.
- Arenas are small and detailed; distance is carried by panoramas.

**Colour rules per element:**

| Element | Glow colour | Armour palette | Materials |
| --- | --- | --- | --- |
| IGNIS | Crimson | Blackened iron, ember-red cloth | Forged metal, soot, scorched leather |
| AQUES | Azure | Pale bronze, deep blue cloth | Wet stone, polished shell, rope |
| TERRA | Ochre | Earth brown, gold-ochre trims | Rough stone, bronze casting, clay |
| AURA | Pale white | Silver-grey, white cloth | Light steel, feathers, wind-worn fabric |

**The Hush** wear no element colour: undyed, practical work clothes with tools and leather aprons. Their relics glow faintly with captured element light.

**Reference board:** collect 10–15 reference images per nation (armour, landscape, architecture) into the art folder before generating anything.

## Production list

30 character and weapon designs, plus arenas, moves and sound, all from $0 sources. The first IGNIS Shaper with full moves is the priority, because combat is built first.

| Asset | Count | Tool | Owner | Needed by | Status |
| --- | --- | --- | --- | --- | --- |
| IGNIS Shaper armour (first hero) | 1 | Hunyuan 3D, Blender | World and UX | Oct 29 | Not started |
| Shaper armour, other nations | 3 | Hunyuan 3D, Blender | World and UX | Oct 31 | Not started |
| Hush outfits | 4 | Hunyuan 3D | World and UX | Oct 31 | Not started |
| Element masters | 4 | Hunyuan 3D | World and UX | Oct 31 | Not started |
| The Lord | 1 | Hunyuan 3D | World and UX | Oct 31 | Not started |
| Lord's Collectors | 1 | Hunyuan 3D | World and UX | Oct 31 | Not started |
| Merchants | 5 | Hunyuan 3D | World and UX | Oct 31 | Not started |
| Rival guild members | 2 | Hunyuan 3D | World and UX | Oct 31 | Not started |
| World boss | 1 | Hunyuan 3D, Blender | World and UX | Nov 10 | Not started |
| Weapons and relics | 8 | Hunyuan 3D | World and UX | Oct 31 | Not started |
| Combat moves (light, heavy, dodge, hits, casts) | ~40 clips | Mixamo | Combat and engine | Nov 3 | Not started |
| Signature ultimates | 4 | Rokoko Vision | Combat and engine | Oct 30 | Not started |
| Arenas: 4 nations and Chromara | 5 | Megascans, Poly Haven | World and UX | Nov 8 | Not started |
| The Drawing hall (opening) | 1 | Megascans | World and UX | Nov 5 | Not started |
| Sky panoramas | 5 | Poly Haven HDRIs | World and UX | Nov 5 | Not started |
| Chromara skyline vista and local scans | 1 + scans | Marble, Scaniverse | World and UX | Nov 8 | Not started |
| Sound effects (hits, casts, ultimates, UI) | ~30 | ElevenLabs | World and UX | Nov 10 | Not started |
| Music: Chromara, battle, boss, the Drawing | 4 | ElevenLabs Music | World and UX | Nov 12 | Not started |

## Workflow per asset type

Every asset follows the same rule: generate or capture, clean up, then compress and test it in the browser before calling it done.

**Characters (Hunyuan 3D):**

1. Write the prompt from the art direction (element palette, materials, wear).
2. Generate 2–3 variants; pick the best in review.
3. Clean up in Blender: sharpen armour edges, fix hands and faces, check the silhouette.
4. Rig with Hunyuan's built-in rigging, or Mixamo when it fails.
5. Attach Mixamo combat moves and test the animation loop.
6. Compress (meshopt, KTX2 textures) and load in a browser test scene.

**Arenas:**

1. Block out the arena shape from the design (small, circular, one landmark).
2. Dress it with Megascans rock, ruins and ground; add a Poly Haven sky.
3. Add the nation's landmark (a Hunyuan prop or a Scaniverse scan).
4. Compress and measure the size against the budget.

**Signature ultimates (Rokoko Vision):**

1. Choreograph the move to match the element's style (IGNIS bursts, TERRA slams, AQUES flows, AURA spins).
2. Film it on one phone, full body in frame, plain background, good light.
3. Convert, clean the foot sliding, retarget onto the character.

**Sound and music (ElevenLabs):**

1. Generate 3–5 takes per sound; keep the best.
2. Trim, set volume, export as compressed audio (OGG or WebM).
3. Tag each file to its trigger (hit, cast, ultimate, menu).

## Lightweight specs

The game opens on a small first load and streams the rest, so every asset has a size budget. These are starting targets, to be checked against real measurements in the first week.

| Asset | Triangles | Textures | Compressed size target |
| --- | --- | --- | --- |
| Player Shaper or Hush | 30–50k | 2K, KTX2 | ≤ 4 MB with moves |
| Masters, the Lord | 25–40k | 2K, KTX2 | ≤ 3 MB |
| Merchants, Collectors, rival guild | 10–20k | 1K, KTX2 | ≤ 1.5 MB |
| World boss | 60–80k | 2K, KTX2 | ≤ 6 MB |
| Weapon or relic | 3–8k | 1K, KTX2 | ≤ 0.5 MB |
| One arena (dressed) | — | 1–2K, KTX2 | ≤ 15 MB |
| Sky panorama | — | 2K | ≤ 2 MB |
| Sound effect | — | — | ≤ 50 KB |
| Music track | — | — | ≤ 3 MB |

**Load budget:** first load (opening, the Drawing, Chromara) **≤ 25 MB**; each nation streams in the background while the player is in Chromara.

**Formats:**

- Models: glTF binary (.glb), meshopt-compressed, textures inside as KTX2
- Splats: SPZ or SOG
- Audio: OGG or WebM

**Naming:** `element_type_name_v01`, e.g. `ignis_shaper_armour_v03.glb`, `terra_arena_v02.glb`, `aura_ultimate_v01.glb`. Lower case, no spaces.

**Folders in ELEMENTS/art:**

- `reference/` — mood boards per nation
- `raw/` — untouched generations, scans and captures
- `clean/` — after Blender cleanup and rigging
- `game/` — compressed, ready to load
- `audio/` — sound effects and music

## Schedule

Three days of pre-production produce every character before code starts, because Hunyuan 3D's free quota is 20 generations a day.

| Phase | Dates | Work |
| --- | --- | --- |
| Pre-production | 29–31 Oct | 60 character generations, 4 ultimates captured, reference boards, scans |
| Production | 1–8 Nov | Cleanup, rigging, moves; 5 arenas dressed; everything compressed |
| Polish | 9–13 Nov | World boss, sound, music, demo shots |
| Ship | 14 Nov | — |

Gate: code starts 1 Nov with the first IGNIS hero ready to animate.

**Generation quotas, 29–31 Oct (20 a day):**

| Day | Hunyuan 3D generations | Also |
| --- | --- | --- |
| 29 Oct | IGNIS Shaper (3 variants), other Shapers (9), Hush outfits (8) | Reference boards for all four nations |
| 30 Oct | Masters (8), the Lord (2), Collectors (2), merchants (8) | Film the 4 signature ultimates |
| 31 Oct | Rival guild (4), weapons and relics (12), world boss (4) | Scaniverse scans, pick Megascans per arena |

Main characters get two variants each and the first hero gets three; merchants and weapons get one or two, since they're seen less closely. Unused quota on any day goes to the world boss, the hardest model.

## Review gates and risks

An asset is Done only when it passes all three gates; the biggest risk is AI armour that looks melted up close.

**Gates:**

1. **Look:** matches the art direction and its element palette; reads clearly at the over-the-shoulder camera distance.
2. **Motion:** rigged, plays light, heavy, dodge and hit moves without stretching or foot sliding.
3. **Size:** inside its budget after compression, and loads in the browser test scene at 60fps on a mid-range laptop.

**Risks:**

| Risk | What we do |
| --- | --- |
| AI armour comes out soft or melted | Blender cleanup pass on hero characters; generate from front, side and back reference images, not text alone |
| Hunyuan rigging fails on armour | Fall back to Mixamo's auto-rigger |
| Free daily quota runs out | Prioritise heroes and the world boss; reuse one design with recoloured materials for minor NPCs |
| Arenas blow the size budget | Fewer unique rocks, reused with different scale and rotation; lower texture size on distant pieces |
| Mixed sources look inconsistent | One shared lighting and colour-grading setup applied to every scene |
| Video capture is shaky | Film in good light with a still phone; keep clips under 10 seconds |

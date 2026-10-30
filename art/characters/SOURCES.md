# ELEMENTS Character Assets: Sources and Licenses

Checked 29 October 2026.

## Base Characters and Hairstyles

All creator base models, skeletal armatures, and hairstyles are sourced from the **Universal Base Characters** pack by Quaternius, designed specifically for seamless compatibility with the Quaternius **Universal Animation Library** (used by `client/public/assets/characters/hero.glb`).

- **Author**: Quaternius (Florian Denis)
- **Official Pack Page**: <https://quaternius.com/packs/universalbasecharacters.html>
- **Itch.io Distribution**: <https://quaternius.itch.io/universal-base-characters>
- **Animation Library Reference**: <https://quaternius.com/packs/universalanimationlibrary.html>
- **License**: Creative Commons Zero v1.0 Universal (CC0)
- **License URL**: <https://creativecommons.org/publicdomain/zero/1.0/>
- **Commercial Game Use**: Permitted ($0 royalty-free commercial and personal use).

## Asset Files and Pipeline

Original high-resolution textures were converted to WebP and models packed into standalone binary GLB format using `glTF-Transform`:

1. `client/public/assets/characters/creator/female.glb`:
   - Source: `Superhero_Female_FullBody.gltf`
   - Armature: 65-joint Quaternius standard skeleton (`pelvis`, `spine_01..03`, `neck_01`, `Head`, `hand_r`, `hand_l`, `foot_r`, `foot_l`, etc.).
   - Standing height: 1.77 m.
   - Size: ~1.6 MB (WebP textures).

2. `client/public/assets/characters/creator/male.glb`:
   - Source: `Superhero_Male_FullBody.gltf`
   - Armature: 65-joint Quaternius standard skeleton identical to `female.glb` and `hero.glb`.
   - Standing height: 1.81 m.
   - Size: ~1.3 MB (WebP textures).

3. Rigged Hairstyles:
   - `client/public/assets/characters/creator/hair_buns.glb` (Hair Buns, ~552 KB)
   - `client/public/assets/characters/creator/hair_long.glb` (Long Hair, ~529 KB)
   - `client/public/assets/characters/creator/hair_simple_parted.glb` (Simple Parted Hair, ~327 KB)
   - `client/public/assets/characters/creator/hair_buzzed.glb` (Buzzed Hair, ~310 KB)
   - `client/public/assets/characters/creator/hair_buzzed_female.glb` (Buzzed Hair Female variant, ~310 KB)
   - `client/public/assets/characters/creator/hair_beard.glb` (Full Beard, ~317 KB)

## Commoner's Rags (Peasant Outfit)

Fighters wear the Peasant outfit from Quaternius **Modular Character Outfits - Fantasy** (Standard, free). It shares the Universal Base Characters skeleton; the creator body supplies only its head, eyes and brows.

- **Pack Page**: <https://quaternius.itch.io/modular-character-outfits-fantasy>
- **License**: CC0 1.0 (`License_Standard.txt` in the pack). Downloaded 30 October 2026.
- `client/public/assets/characters/creator/peasant_male.glb` from `Exports/glTF (Godot-Unreal)/Outfits/Male_Peasant.gltf` (Regular male proportions, includes skinned arms and hands).
- `client/public/assets/characters/creator/peasant_female.glb` from `Outfits/Female_Peasant.gltf` (gloved hands).
- Both: textures resized to 1024 and converted to WebP with glTF-Transform (`resize`, `webp --quality 82`, `prune`).
- `client/public/assets/characters/creator/peasant_worn.webp` from `Textures/Peasant/T_Peasant_2_BaseColor.png`, the worn variant used for villains.

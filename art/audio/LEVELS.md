# Audio Levels and Specifications

Measured with FFmpeg (`ebur128` ITU-R BS.1770-4 integrated loudness and `volumedetect` peak measurement).

- Total clips: 66
- Total size: 1,460,000 bytes (1.40 MB < 6.00 MB budget)
- Peak limit: strictly under -1.0 dBFS
- Mix levels:
  - Hits: 0 dB reference (~ -16 LUFS)
  - Footsteps: ~12 dB under hits (-28 LUFS / bus gain 0.251)
  - Ambient bed: ~18 dB under hits (-34 LUFS / bus gain 0.126)
  - Master Limiter / Compressor: DynamicsCompressorNode threshold -6 dB, ratio 12:1, attack 3ms, release 150ms

| File | Category | Duration | Peak (dBFS) | Status | Description |
| --- | --- | --- | --- | --- | --- |
| `ambient_wind.ogg` | Ambient Bed | 35.000 s | -6.0 | PASS | Gentle open wind over stone and grass, seamless crossfaded loop |
| `ambient_birds.ogg` | Ambient Bed | 32.000 s | -18.3 | PASS | Distant dusk birds settling into trees, seamless loop |
| `ambient_forge_bell.ogg` | Ambient Bed | 36.000 s | -6.8 | PASS | Faint distant anvil clinks and resonant bronze bell, seamless loop |
| `footstep_stone_walk_01.ogg` .. `06.ogg` | Footsteps Walk | 0.320 s | -2.0 | PASS | Stone heel-toe stride contact (6 variations) |
| `footstep_stone_run_01.ogg` .. `06.ogg` | Footsteps Run | 0.300 s | -2.1 | PASS | Energetic stone sprint strike with firm transient (6 variations) |
| `swing_light_01.ogg` .. `04.ogg` | Light Swing | 0.30 - 0.36 s | -1.5 | PASS | Fast weapon blade whoosh |
| `swing_heavy_01.ogg` .. `04.ogg` | Heavy Swing | 0.52 - 0.61 s | -1.9 | PASS | Heavy swing with low-pass cloth layer |
| `hit_flesh_01.ogg` .. `03.ogg` | Flesh Hit | 0.35 - 0.39 s | -1.3 | PASS | Blade impact on flesh + body thump |
| `hit_blocked_01.ogg` .. `04.ogg` | Blocked Hit | 0.50 - 0.65 s | -1.4 | PASS | Metallic parry ring and armor resonance |
| `kill_blow_01.ogg` .. `03.ogg` | Kill Blow | 0.78 - 0.83 s | -1.4 | PASS | Deep lethal impact + bass punch + shudder tail |
| `hero_hurt_01.ogg` .. `04.ogg` | Hero Hurt | 0.62 - 0.73 s | -3.5 | PASS | Hero male vocal damage grunt |
| `villain_hurt_01.ogg` .. `04.ogg` | Villain Hurt | 0.40 - 0.51 s | -4.8 | PASS | Villain male flinch / pain grunt (mono spatialised) |
| `villain_death_01.ogg` .. `04.ogg` | Villain Death | 1.06 - 1.46 s | -1.7 | PASS | Villain collapse groan + ground debris fall (mono spatialised) |
| `dodge_01.ogg` .. `04.ogg` | Dodge Foley | 0.350 s | -2.0 | PASS | Cloth movement rustle + evasive scuff |
| `sword_draw_01.ogg` .. `03.ogg` | Weapon Foley | 0.50 - 0.57 s | -1.9 | PASS | Blade draw steel scrape + leather gear rustle |
| `sword_sheathe_01.ogg` .. `03.ogg` | Weapon Foley | 0.46 - 0.49 s | -2.0 | PASS | Blade entry + socket latch click + leather gear rustle |
| `ground_pound_01.ogg` .. `04.ogg` | Ground Pound | 0.98 - 1.10 s | -1.2 | PASS | Earth slam explosion and shockwave debris |
| `fire_burst_01.ogg` .. `04.ogg` | Fire Burst | 1.00 - 1.16 s | -3.9 | PASS | Flame ignition and elemental whoosh |
| `thump_01.ogg` .. `03.ogg` | Low Thump | 0.36 - 0.41 s | -2.5 | PASS | Sub-bass body impact thud |

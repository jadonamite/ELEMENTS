# Fire atlases

All fire textures are generated locally. No external or licensed sprites are included.

Run `python3 workbench/scripts/bake-fire-fluid.py` from the repository root with NumPy installed. The seed is 81427. PNG encoding uses Python’s standard library.

The baker simulates temperature, smoke density and velocity. Flame, burst, smoke and lick use a 128 × 128 grid with semi-Lagrangian advection, a pressure solve, thermal buoyancy and vorticity confinement. The projectile atlas is baked as a directional comet (round hot head on the left and twisting, translucent ribbons streaming to the right, matching art/reference/fx/fireball-target.png) on a 256 × 256 grid for full quality and 128 × 128 for low quality.

The supplied `art/reference/fx/fireball-target.png` controls fire colour and shape: a white-yellow head, gold/orange ribbons and a soft halo. It supersedes the older crimson fire palette for these effects. The reference is guidance only and is not shipped as a texture.

Each atlas has 64 frames in an 8 × 8 grid. Full atlases use 128px frames (256px for projectile); low quality uses 64px frames (128px for projectile). Flame and projectile atlases loop. Burst, smoke and lick atlases fade to transparency at the end. Transparent tile padding prevents seams, and all frames reach zero alpha at least 8 px inside every frame edge.

`python3 workbench/scripts/verify-fire-atlases.py` checks dimensions, border alpha, animation, end fades and loop-wrap differences.

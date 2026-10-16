---
name: babylon-prototype
description: Build or iterate small playable 3D browser game prototypes with Babylon.js, prioritizing fast AI-assisted changes and low token overhead. Use for rapid game experiments, not production architecture; respect an existing engine unless migration is requested.
---

# Rapid Babylon.js prototypes

Optimize for a playable idea and cheap subsequent adjustments.

- Default to **Babylon.js (`@babylonjs/core`) + TypeScript + Vite**, with npm and a lockfile. Follow an existing project's package manager.
- Use Babylon's meshes, materials, lighting, scene graph, camera APIs, and render loop. Avoid custom WebGL renderers, shader infrastructure, or a homegrown engine.
- Before creating 3D art, examine [Kenney's kits](https://kenney.nl/assets) for models that fit the game's theme and visual style. Prefer suitable kit assets over generating custom 3D models; use primitives or custom geometry only for missing pieces or an intentional visual requirement. Import only the assets needed, preferably glTF/GLB, and retain the source URL and license.
- For imported models, inspect bounds, origin, scale, orientation, and material appearance in the actual scene. Adjust matte/metallic settings or palette when needed; do not assume every pack uses the same conventions. Load each model once and use Babylon instances or thin instances for repeated scenery.
- For sound effects, examine Kenney's audio packs (such as Sci-fi Sounds and Interface Sounds) before generating your own. Select clips that fit the theme, retain source/license information, and check volume and loop seams. Start playback after user interaction, provide mute, and silence audio when the game loses focus.
- Use simple kinematic movement initially. Add Havok only when the game needs rigid-body interactions; ordinary movement does not require it.
- Keep one small scene and a few focused files: `main.ts`, `world.ts`, `player.ts`/`flight.ts`, `camera.ts`, and `input.ts` as needed. Avoid React, ECS, generic managers, and abstraction layers unless the prototype benefits from them.
- Put frequently adjusted speeds, acceleration, camera offsets, sensitivity, and world parameters in `config.ts`. Keep units explicit and movement frame-rate independent.
- Implement the core playable loop first. Keep UI to essential controls and feedback; follow the user's visual direction.
- Preserve existing controls, camera behavior, and tuning during migrations unless asked to change them. Reset and loss of focus should clear held inputs. Mouse capture needs click-to-enter, Escape-to-release, and a touch alternative when relevant.
- Provide `npm run dev`, `npm run check` (TypeScript), and `npm run build`. Record launch instructions and controls briefly in the project README.
- After meaningful changes, typecheck and build; play the affected interaction in an available browser. Test movement/camera invariants when they are easy to regress. Avoid elaborate test scaffolding for disposable prototypes.
- Make small, targeted edits. Read the relevant modules rather than the entire project for every adjustment.

Consult the installed package types and targeted [official Babylon.js documentation](https://doc.babylonjs.com/) when an API is uncertain. Avoid adding dependencies or upgrading the stack merely to make a small gameplay change.

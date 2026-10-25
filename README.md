# Metin

The personal site of Mert Metin, frontend developer. *Metin* is both a name and a word: text, carved in stone.

Words and shapes are built from floating stones, each cut with an Old Turkic rune. Strike the stone to begin: the stones
break out of the ground rock and gather into the word. Move the pointer to light the runes, look up to the sky, where
four constellations write 𐱅𐰭𐰼𐰃 (Teŋri), hold to drop the stones, scroll to carve the next shape.

## Run

```sh
npm install
npm run dev      # local development
npm run build    # production build in dist/
npm run preview  # serve the build
```

## Where things are

| | |
|---|---|
| `src/content.ts` | the scenes, their shapes and texts (TR / EN) |
| `src/scene/shapes.ts` | turning text, SVG paths or canvas drawings into stone layouts (`stoneText`, `stonePath`, `stoneDraw`) |
| `src/scene/marks.ts` | ready-made shapes |
| `src/scene/RuinsScene.ts` | the scene: renderer, lights, camera, input, the opening strike |
| `src/scene/stones.ts` | how stones move: emerging, flying to shapes, falling |
| `src/scene/physics.ts` | rigid-body physics for dropped stones (Rapier) |
| `src/scene/glsl.ts` | the stone and ground shaders |
| `src/scene/sky.ts` | the night sky, the Milky Way and the rune constellations |
| `src/scene/sound.ts` | all sound, synthesised with Web Audio |

Live at **https://necatimertmetin.github.io/metin/**. `npm run deploy` builds the site and publishes it to the `gh-pages` branch
(GitHub Pages serves that branch). `public/og.jpg` is the link preview image.

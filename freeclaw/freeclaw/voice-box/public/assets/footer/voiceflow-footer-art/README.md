# VoiceFlow footer art pack

All artwork uses a shared 1600 × 600 transparent SVG canvas so layers line up exactly.

## Contents
- `preview/full-school-composition.svg` — complete composition.
- `preview/full-school-composition.png` — PNG preview, if generated.
- `layers/` — independently stackable sky, clouds, landscape, school, details, trees, path and particles.
- `typography/souyash-bera.svg` — separate name layer.

## Layer order
1. 01-sky
2. 02-clouds
3. 03-distant-landscape
4. 04-school-building
5. 05-architectural-details
6. 06-trees
7. 07-foreground-path
8. 08-particles-and-lines
9. typography/souyash-bera.svg

## Animation suggestion
Stack the SVGs in the listed order. Animate clouds with a very small horizontal translate, landscape with slower parallax, reveal the school using an SVG mask or stroke-dash animation, gently float particles, and reveal the name last. Keep the animation confined to the footer. Respect `prefers-reduced-motion`.

These are editable vector layers, not a baked single image. The supplied preview is only a composite reference; the website still needs CSS/JavaScript to animate the layers.

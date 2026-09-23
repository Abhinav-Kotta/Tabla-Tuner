# Website artwork

Created with the built-in imagegen tool. The supplied tabla illustration was edited to remove its white background, retaining the illustrated drums and support rings. Saved as `artifacts/dayan-tuner/public/images/tabla.png`.

Final tabla prompt: Remove only the white background and gray ground shadow from the supplied illustration of two tabla drums. Preserve both tabla drums exactly: drawn illustration style, cream drumheads, black syahi, warm brown wood, tan straps, red and gold support rings. Keep both drums whole, same proportions and arrangement. Background must be truly transparent with alpha, no replacement backdrop, no added objects, no text. Clean cutout edges.

Reference-tone cover art is saved alongside the tabla image as six optimized JPEGs. These images are decorative; the reference audio is synthesized in the browser, not a recording of a tabla.

## after-hours.jpg

Use case: stylized-concept. Asset type: square music album cover art. Create a glowing red-orange solar eclipse, wispy fiery red haze around a dark planet, centered on a near-black background. Abstract dark moody artwork, minimal graphic design, dark background with subtle color accent. Premium underground independent music release aesthetic, tactile subtle grain, large negative space. Image only, absolutely no text, lettering, typography, logos or watermarks.

## blue-hour.jpg

Use case: stylized-concept. Asset type: square music album cover art. Create an abstract flowing cobalt blue silk wave suspended against near-black darkness, elegant soft blue light. Abstract dark moody artwork, minimal graphic design, dark background with subtle color accent. Premium underground independent music release aesthetic, tactile subtle grain, large negative space. Image only, absolutely no text, lettering, typography, logos or watermarks.

## no-signal.jpg

Use case: stylized-concept. Asset type: square music album cover art. Create a weathered metallic chrome sphere with subtle warped reflections and analog signal distortion against pitch black. Abstract dark moody artwork, minimal graphic design, dark background with subtle color accent. Premium underground independent music release aesthetic, tactile subtle grain, large negative space. Image only, absolutely no text, lettering, typography, logos or watermarks.

## slow-burn.jpg

Use case: stylized-concept. Asset type: square music album cover art. Create a single abstract amber ribbon of smoke rising from darkness, soft golden light and film grain. Abstract dark moody artwork, minimal graphic design, dark background with subtle color accent. Premium underground independent music release aesthetic, tactile subtle grain, large negative space. Image only, absolutely no text, lettering, typography, logos or watermarks.

## weightless.jpg

Use case: stylized-concept. Asset type: square music album cover art. Create a surreal pale lavender moon above misty dark water, expansive mysterious black sky. Abstract dark moody artwork, minimal graphic design, dark background with subtle color accent. Premium underground independent music release aesthetic, tactile subtle grain, large negative space. Image only, absolutely no text, lettering, typography, logos or watermarks.

## concrete.jpg

Use case: stylized-concept. Asset type: square music album cover art. Create a brutalist concrete monolith in deep shadow with a single muted green light, minimalist architecture. Abstract dark moody artwork, minimal graphic design, dark background with subtle color accent. Premium underground independent music release aesthetic, tactile subtle grain, large negative space. Image only, absolutely no text, lettering, typography, logos or watermarks.

## dayan-top-down.png

Saved at `artifacts/dayan-tuner/public/images/dayan-top-down.png` as a 640 × 640 transparent PNG. Created with the built-in imagegen tool from the user’s photographic reference and the existing illustrated tabla pair; used only for the tuner’s pre-upload surface graphic.

Final prompt:

Use case: style-transfer.
Asset type: transparent PNG illustration for an instrument tuner empty state.
Primary request: Create ONE single dayan tabla viewed EXACTLY from straight overhead. A perfect circular drumhead and concentric circular rim, with no camera tilt or perspective.
Input images: Image 1 is a photographic reference for authentic tabla materials and construction, specifically the small wooden dayan; do not reproduce the pair or scene. Image 2 is a style reference only: match its refined hand-drawn illustrated rendering, clean warm outlines, soft painted shading, and warm cream, tan, beige and brown palette; do not reproduce the pair or tilted view.
Subject: one centered circular cream/tan drum skin with a round central black charcoal syahi, subtle concentric skin rings, intricate braided beige leather rim, and only small hints of warm wooden body and strap loops immediately outside the rim as visible from exactly overhead. The syahi is centered.
Composition: square canvas; entire circular rim visible; modest even transparent padding on every side; orthographic top-down plan view with a circular silhouette, no visible tall sidewall.
Background: genuinely transparent PNG alpha, fully transparent outside the instrument, not white, black, checkerboard, or another painted background. No ground shadow.
Constraints: one drum only, no second drum, no hands, no cushions, no scene, no text, labels, UI, dots, tuning markers, overlays or watermark. Keep a beautifully clean, simple isolated illustrated asset. Generate only one image.

## dayan-region-reference.png

Saved at `artifacts/dayan-tuner/public/images/dayan-region-reference.png`, 640 × 640 transparent PNG, created with built-in imagegen. Corrected to use the smaller wooden dayan on the right of the user's photo. The eight dotted regions, sixteen strap numbers, and selected region labels are a separate accessible SVG/HTML reference diagram in `src/components/region-reference.tsx`; the graphic explains region identification before the user uploads their own photo.

Final image prompt:

Use case: precise-object-edit.
Asset type: transparent PNG illustration for a dayan tabla tuner.
Primary request: Generate exactly ONE corrected illustration of a SINGLE DAYAN in a perfectly straight overhead view, using image 1's SMALLER WOODEN DRUM ON THE RIGHT as the anatomical reference. Image 2 is the existing illustration to correct and its hand-drawn painted style should be retained.
Critical subject correction: depict the smaller right-hand wooden DAYAN from image 1, NOT the large left-hand bayan. The DAYAN has a prominent circular black central syahi, with subtle concentric rings, occupying approximately 44% of the total outer drumhead diameter. Match the cool ivory / gray skin around the syahi of that smaller right-hand drum. Include the distinct narrow cream outer ring, finely braided natural leather rim and evenly spaced leather strap loops, with warm dark brown wood only peeking around the perimeter.
Style: polished hand-drawn painted illustration, delicate textured strokes and fine warm outlines matching image 2. Keep a rich nearly black syahi and cool gray-ivory membrane, avoiding image 2's broad yellow membrane and undersized black center.
Composition: exact orthographic straight top-down view, absolutely no tilt or visible drum side wall. Perfect circular symmetry, drumhead and black syahi both precisely centered on a square canvas. Outer rim radius approximately 46% of canvas width, leaving 4% transparent margin on each edge (8% total padding).
Background: TRUE transparent alpha outside the drum, no solid fill, no checkerboard painted into the image. Clean edges. No cast shadow.
Constraints: one drum only, no second drum, no cushion, no surroundings, no text, no labels, no numbers, no radial region boundaries, no dotted sector lines, no diagrams. Preserve the illustrative style while correcting the anatomical proportions to the DAYAN on the right of image 1. Output one square transparent PNG only, no variants.

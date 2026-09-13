# Dayan Tabla Tuner

Dayan Tabla Tuner is a desktop-first browser utility for tabla players who want to check whether pitch is carried evenly around the dayan head. It uses a top-down photo to align the drum head, listens for isolated strikes through the browser microphone, estimates the fundamental pitch, and presents an eight-region tuning map.

## Run locally

From the workspace root:

```bash
nvm install
nvm use
pnpm install
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/dayan-tuner run dev
```

Open http://localhost:5173. The root `.nvmrc` selects Node 22.18.0; Vite requires Node 20.19+ or 22.12+.

The app is a single browser session. It does not create accounts, send audio to a server, or persist a photo after refresh.

## Architecture

- `src/App.tsx` owns the session workflow and presentation state.
- `src/audio/musicTheory.ts` contains equal-temperament note/frequency conversion and cents calculations.
- `src/audio/onsetDetection.ts` adapts a room-noise floor and applies a strike cooldown.
- `src/audio/pitchDetection.ts` estimates the fundamental with normalized autocorrelation, harmonic agreement, and a confidence score.
- `src/audio/microphone.ts` owns the Web Audio API stream and throttles browser frames into the UI.
- `src/audio/signalUtils.ts` contains reusable signal operations such as RMS, median, windowing, and autocorrelation.
- `src/vision/tablaDetection.ts` scores circular head boundaries and creates a square crop with uniform scaling for overlay alignment.

## Tabla-head detection

The upload is drawn to a small processing canvas, then a family of circular candidates is scored by the contrast observed across their perimeter. The strongest candidate supplies an initial center and circular radius in source-image coordinates. A square crop is rendered with one scale for both axes, preserving proportions for portrait and landscape photos. The image and tuning wedges share the same head boundary. The detector is a starting estimate; users can adjust the horizontal and vertical center, head size, and photo rotation. If detection fails, a centered crop remains available for manual alignment.

This is intentionally a conventional, readable computer-vision pass rather than a machine-learning model. It works best with a clear, nearly top-down photograph where the complete head is visible.

## Photo orientation and region mapping

Photo setup opens automatically in a modal when an image finishes loading. The preview stays visible alongside the active controls on desktop and above them on mobile. The current instruction, placement feedback, and errors use prominent, high-contrast text. The action footer remains visible; optional fine controls expand separately. Closing setup preserves progress; **Continue photo setup** reopens it. Saving the map closes the modal and enables measurement.

Photo setup has four steps:

1. **Fit photo:** drag with a mouse or finger inside the fixed overlay. Pinch with two fingers, scroll the mouse wheel/trackpad over the photo, use the +/− buttons, or move the zoom slider. These controls share a 25–500% zoom range. Pinching preserves the source point under the moving midpoint even after rotation. Arrow keys pan the focused photo; +/− keys zoom. Fine center sliders and reset are also available. A live canvas redraws the original image without re-encoding a JPEG on each movement. Scaling always preserves proportions.
2. **Orientation anchor:** tap and name a unique mark, logo, or colored tape visible on the real tabla. Repeated identical straps are not useful orientation references. The cyan diamond (A) identifies this mark; it can be anywhere off-center within the photo and need not lie inside R1. It does not define a strap boundary, region center, or region width.
3. **Boundary straps:** select strap 1 at the start of R1, then strap 3 at its clockwise end, with strap 2 between them. Both selected edges are preserved. The remaining circumference is divided into seven estimated regions. Review the numbered boundary pins against the photo; choose any boundary in the controls and tap the correct strap or use the fine-adjustment slider. Changes keep neighboring regions joined and prevent boundary crossings. Confirm the map before measuring.
4. **Measure:** R1 spans straps 1–3, R2 spans 3–5, and so on; R8 spans 15–1 (including strap 16). Adjacent regions share their boundary strap, so each region includes three straps. The map, marker positions, table, and tuning guidance use the same calibrated boundaries. Microphone measurement requires both a confirmed anchor and region map.

Autofill estimates the unselected straps geometrically; it does not detect straps in the image. Uneven spacing or perspective may require corrections during review. The selected R1 arc must span 10–100 degrees clockwise; this rejects duplicate or reversed selections. Boundary corrections retain at least 5 degrees between adjacent edges.

Photo edits clear the anchor and boundaries and require setup again. Changing the orientation anchor preserves the boundary map and region sizes. Strap selection never moves the anchor. Photo and anchor changes lock while the microphone is starting/listening or strikes exist; stop the microphone and reset measurements to edit. Resetting measurements alone preserves the anchor and boundary map for another pass. Replacing the image clears the anchor, its name, and the boundaries. The app does not track the instrument: if it moves, locate the named physical mark again before following the numbered regions.

Uploads and **Take photo** use the same local processing. Take photo requests the rear camera on supporting mobile browsers; desktop browsers may show a file picker. Camera capture is optional and does not correct perspective: include the whole head with the camera directly overhead and parallel to it.

Run the photo geometry and anchor mapping regression checks with `node --test artifacts/dayan-tuner/src/vision/*.test.mjs` from the workspace root.

The manual **Stop microphone** action scrolls to the results section and moves keyboard focus there. Scrolling respects reduced-motion preferences. Starting a new measurement stops audio without scrolling to the old results.

## Pitch detection

Tabla has strong harmonic partials. Selecting the strongest FFT peak can return the second harmonic instead of the perceived fundamental. The detector therefore searches for repeating waveform periods using normalized autocorrelation. Each candidate period is also checked for agreement at two and three times the period, which favors a fundamental whose harmonic family repeats consistently.

The returned result contains:

- `frequency`: the estimated fundamental when confidence clears the threshold
- `confidence`: a normalized quality score
- `correlation`: the best normalized autocorrelation strength
- `harmonicAgreement`: support from the second and third harmonic periods

The first attack transient can be noisy, so the current MVP uses the live analysis frame after onset detection as a practical short window. A later version can add a delayed resonant-window buffer and more explicit spectral consistency checks.

## Harmonic validation

Each region requires three accepted strikes. Low-confidence estimates are rejected. Once a region has one or more strikes, a new estimate is compared with the current median in cents. Estimates more than 80 cents away are treated as inconsistent and do not advance the counter. A completed region uses the median of its three frequencies, which prevents a single outlier from pulling the result toward an octave.

## Cents and status

The app uses A4 = 440 Hz equal temperament:

```text
frequency = 440 × 2^((midi - 69) / 12)
cents = 1200 × log2(measuredFrequency / targetFrequency)
```

Positive cents are sharp and negative cents are flat. The target note is always user-controlled; the app never silently replaces it with the nearest detected note.

## Heat map

The heat map color represents absolute distance from the selected target:

- green: within the selected tolerance
- yellow: within two times the tolerance
- orange: within four times the tolerance
- red: farther out

Sharp/flat direction is shown separately in the inspector row and guidance text so color is not the only way to understand a measurement.

## Current MVP limitations

- Detection is optimized for a clear, nearly overhead photograph. Manual center, size, and rotation controls are available; perspective correction for tilted photos is not.
- Audio analysis is local to the browser and is designed for one isolated strike at a time in a quiet room.
- The current window uses the analyser frame that contains the onset; a future pass can add delayed resonant-window selection.
- The MVP supports dayan only and does not include bayan tuning, persistence, exports, or session history.
- Microphone access requires a secure browser context and user permission.

## Visual language

The interface is an original musician utility with graphite surfaces, compact controls, restrained borders, and an inspector-style layout. Its density and audio-meter cues are informed by professional audio software, including the provided Logic Pro reference, without copying Apple branding, copy, artwork, or UI structure.

# Dayan Tabla Tuner

Dayan Tabla Tuner is a desktop-first browser utility for tabla players who want to check whether pitch is carried evenly around the dayan head. It uses a top-down photo to normalize the drum head, listens for isolated strikes through the browser microphone, estimates the fundamental pitch, and presents an eight-region tuning map.

## Run locally

From the workspace root:

```bash
pnpm install
pnpm --filter @workspace/dayan-tuner run dev
```

The app is a single browser session. It does not create accounts, send audio to a server, or persist a photo after refresh.

## Architecture

- `src/App.tsx` owns the session workflow and presentation state.
- `src/audio/musicTheory.ts` contains equal-temperament note/frequency conversion and cents calculations.
- `src/audio/onsetDetection.ts` adapts a room-noise floor and applies a strike cooldown.
- `src/audio/pitchDetection.ts` estimates the fundamental with normalized autocorrelation, harmonic agreement, and a confidence score.
- `src/audio/microphone.ts` owns the Web Audio API stream and throttles browser frames into the UI.
- `src/audio/signalUtils.ts` contains reusable signal operations such as RMS, median, windowing, and autocorrelation.
- `src/vision/tablaDetection.ts` performs lightweight local ellipse scoring and creates a normalized square crop for overlay alignment.

## Tabla-head detection

The upload is drawn to a small processing canvas, then a family of circular candidates is scored by the contrast observed across their perimeter. The strongest candidate supplies the center and radii. The image is then cropped to that geometry and rendered into a square canvas. The same normalized coordinate system is used for the tuning wedges, so the overlay does not drift when the input photo has a different resolution.

This is intentionally a conventional, readable computer-vision pass rather than a machine-learning model. It works best with a clear, nearly top-down photograph where the complete head is visible.

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

- Detection is optimized for a clear, nearly overhead photograph and does not provide manual ellipse editing.
- Audio analysis is local to the browser and is designed for one isolated strike at a time in a quiet room.
- The current window uses the analyser frame that contains the onset; a future pass can add delayed resonant-window selection.
- The MVP supports dayan only and does not include bayan tuning, persistence, exports, or session history.
- Microphone access requires a secure browser context and user permission.

## Visual language

The interface is an original musician utility with graphite surfaces, compact controls, restrained borders, and an inspector-style layout. Its density and audio-meter cues are informed by professional audio software, including the provided Logic Pro reference, without copying Apple branding, copy, artwork, or UI structure.
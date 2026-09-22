# Dayan Tabla Tuner

An in-browser dayan tuner that uses local image and microphone analysis to map pitch consistency across eight tuning regions.

## Website

The homepage uses a dark, tabla-themed editorial design with the supplied tabla
illustration, animated waveform, a bol marquee, six playable reference tones,
and a tuning guide. Select a reference card’s arrow to open the working tuner
with that note selected, or use **Start tuning** for the default D4 session.
The workspace remains available at `/#tuner`; `/#tuner?note=C%234` selects C#4.
Reference previews are synthesized sine tones, not tabla recordings.

- `artifacts/dayan-tuner/src/App.tsx` — homepage, reference tones, and hash navigation
- `artifacts/dayan-tuner/src/landing.css` — responsive website styles and dark theme
- `artifacts/dayan-tuner/src/TunerApp.tsx` — photo mapping and live tuning workspace
- `docs/website-artwork.md` — imagegen asset paths and final prompts

The microphone starts only from inside a configured tuning session and is
stopped when leaving the workspace. Reference tones stop after four seconds or
when switching notes or entering the tuner. Returning home clears the current
in-memory tuning session.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/dayan-tuner run dev` — run the Dayan tuner web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Vercel: build and debug locally

The public tuner is the Vite app in `artifacts/dayan-tuner`. Set the Vercel
project's **Root Directory** to `artifacts/dayan-tuner`, **Framework Preset** to
Vite, and **Node.js Version** to 22.x. The app's `vercel.json` sets the build
command and `dist/public` output directory. This browser-only app does not need
the Express API or a database to run.

Run these commands from the repository root:

```bash
nvm use
pnpm dlx vercel@59.22.0 link --project tabla-tuner
pnpm dlx vercel@59.22.0 pull --yes --environment=production
pnpm run vercel:check
pnpm run vercel:preview
```

`vercel:check` runs the real Vercel production build locally, then checks that
the output contains the tuner HTML and its assets, with no server functions.
`vercel:preview` serves that Vercel output at http://127.0.0.1:4173 for browser
testing. Neither command deploys. Check the page and browser console, then test
photo upload and microphone permission before deploying. Localhost supports
microphone access; actual microphone accuracy still requires a real instrument.

The linked settings and downloaded environment files stay in ignored local
files. After changing Vercel project settings, run `pull` again before building.

## Stack

- pnpm workspaces, Node.js 22.18.0 (the version in `.nvmrc`), TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/dayan-tuner/src/TunerApp.tsx` — session state, measurement workflow, and main console UI
- `artifacts/dayan-tuner/src/audio/` — music theory, onset, microphone, and pitch analysis
- `artifacts/dayan-tuner/src/vision/tablaDetection.ts` — local head detection and normalization
- `artifacts/dayan-tuner/README.md` — product and DSP/CV notes
- `docs/pitch_detection_reference.py` — dependency-free Python walkthrough of the browser pitch pipeline
- `docs/pitch-detection-topics.md` — study guide for the signal-processing concepts used by the app

## Architecture decisions

- Audio and image analysis are client-side only; no backend is needed for a single-use session.
- Each onset opens a short 180 ms capture window. Valid pitch frames within that window are combined with medians, and three completed strikes are combined with another median to reduce outlier influence.
- Repetition evidence is evaluated only when the two- or three-period lag is inside the search range; unavailable checks are omitted rather than clamped to a misleading boundary bin.
- The measured Hz value is converted to the nearest equal-tempered note for the readout, while cents deviation remains the authoritative tuning comparison against the user-selected target.
- Wedges are rendered from normalized circular geometry, not rectangular image blocks, so the overlay stays aligned to the detected head.
- The UI keeps sharp/flat direction in text and uses heat colors for distance from target, so color is not the only status signal.

## Product

Users upload a dayan photo, choose a C3-B4 target note, grant microphone access, measure three strikes in each of eight angular regions, inspect an abstract heat map or photo overlay, and re-measure regions with deterministic sharp/flat guidance.

## Verification

```bash
PORT=4173 BASE_PATH=/ pnpm --filter @workspace/dayan-tuner typecheck
PORT=4173 BASE_PATH=/ pnpm --filter @workspace/dayan-tuner build
node --test artifacts/dayan-tuner/src/vision/*.test.mjs
python3 -m py_compile docs/pitch_detection_reference.py
```

The Python file is a learning aid and parity reference for the browser's TypeScript audio pipeline; it is not imported into the production bundle.

## User preferences

- Keep the interface desktop-first, focused, and professional rather than dashboard-like.

## Gotchas

- Browser microphone access needs a secure context and explicit permission.
- The photo detector is designed for a complete, mostly overhead head image; unclear images should surface a retry message instead of guessing silently.
- The displayed note label is a communication aid, not a replacement for the selected target. Change the target note explicitly when tuning to a different tonic.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

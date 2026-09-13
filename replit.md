# Dayan Tabla Tuner

An in-browser dayan tuner that uses local image and microphone analysis to map pitch consistency across eight tuning regions.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/dayan-tuner run dev` — run the Dayan tuner web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/dayan-tuner/src/App.tsx` — session state, measurement workflow, and main console UI
- `artifacts/dayan-tuner/src/audio/` — music theory, onset, microphone, and pitch analysis
- `artifacts/dayan-tuner/src/vision/tablaDetection.ts` — local head detection and normalization
- `artifacts/dayan-tuner/README.md` — product and DSP/CV notes

## Architecture decisions

- Audio and image analysis are client-side only; no backend is needed for a single-use session.
- Three accepted strikes are combined with a median rather than a plain average to reduce outlier influence.
- Wedges are rendered from normalized circular geometry, not rectangular image blocks, so the overlay stays aligned to the detected head.
- The UI keeps sharp/flat direction in text and uses heat colors for distance from target, so color is not the only status signal.

## Product

Users upload a dayan photo, choose a C3-B4 target note, grant microphone access, measure three strikes in each of eight angular regions, inspect an abstract heat map or photo overlay, and re-measure regions with deterministic sharp/flat guidance.

## User preferences

- Keep the interface desktop-first, focused, and professional rather than dashboard-like.

## Gotchas

- Browser microphone access needs a secure context and explicit permission.
- The photo detector is designed for a complete, mostly overhead head image; unclear images should surface a retry message instead of guessing silently.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
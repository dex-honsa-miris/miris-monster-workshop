# Miris Monster Workshop — Design

2026-08-20. Approved in brainstorming with Dex Honsa (Miris). This spec is the
contract for the implementation plan; decisions below were made explicitly and
should not be silently revisited.

## What this is

A StackBlitz-hosted workshop template. Attendees fork one project in the
browser, create three accounts (Miris, fal.ai, Vercel), paste three keys into
`.env`, and then — inside a React + three.js app — describe a monster, watch a
guardrailed pipeline generate a concept image, a 3D model (GLB), and
AI-written lore/attributes, review the monster on a pedestal with AI-generated
annotations, upload it to their own Miris account, and deploy a pre-filled
viewer page to their own Vercel. The app carries a workshop itinerary with a
checklist that completes itself as each step is detected.

Everything runs inside the StackBlitz WebContainer: the Vite dev server, the
pipeline (node-side, inside the dev server), and the deploy script in the
WebContainer terminal. Attendees never leave the browser.

## Decisions (settled, with reasons)

| # | Decision | Why |
|---|----------|-----|
| 1 | Miris ingest accepts a **GLB mesh via the existing Miris API**; auth is a **personal API token in `.env`** | Confirmed by owner. Token matches the workshop's one-credentials-ritual pattern and is trivially checklist-detectable. OAuth exists but is undocumented and too risky to debug live. |
| 2 | **Everything runs in StackBlitz** (WebContainer) | Zero local setup is the point. Scripts must be WebContainer-safe: pure JS, REST over CLIs where a CLI is flaky. |
| 3 | Text AI via **Vercel AI Gateway** with a haiku-class model | Attendees already create Vercel accounts; free accounts include $5 Gateway credit — effectively unlimited at haiku pricing. The AI SDK (ai-sdk.dev) is just an npm package; no extra account. One `AI_GATEWAY_API_KEY` in `.env`. No Miris-hosted proxy to babysit during the event. |
| 4 | fal pipeline is **two-step with preview**: guardrailed text-to-image (cheap, rerollable) → attendee approves → image-to-3D → GLB | Guardrails grip hardest on the image step; rerolls cost cents, not the expensive 3D step; the concept-image reveal is good workshop theater. fal has no strong direct text-to-3D. |
| 5 | Annotations anchor by **canonical slot + surface raycast** | The lore AI tags each annotation with a slot (`crown, face, left, right, core, base, aura`); the app maps slots to bounding-box-relative directions and raycasts toward the mesh so leader lines land on the actual surface. Geometry-agnostic, no extra AI cost, never visibly wrong. Vision-grounded 2D-coordinate anchoring was considered and rejected as fragile for v1. |
| 6 | Architecture is **app + local pipeline API** (approach C) | The creative flow (prompt → loading scene → reveal) must be in-app, but keys must stay node-side and fal/Miris calls would hit CORS from browser origins. A Vite dev-server middleware exposes `/api/*`; terminal scripts are thin wrappers over the same modules. |
| 7 | The one **text input is a DOM overlay**, aligned over its canvas panel | Canvas text entry breaks focus, IME, and mobile keyboards. Display surfaces stay html-in-canvas; the input is the single deliberate exception. |

## Repo layout

```
src/                    workshop app (Vite + React + TS)
  app/                  React shell: itinerary + checklist (DOM)
  scene/                three.js: chamber, loading ritual, pedestal, annotations
  pipeline-client.ts    typed fetch wrappers for /api/*
server/                 node-side, runs inside the Vite dev server process
  api.ts                Vite middleware plugin exposing /api/*
  guardrails.ts         monster-world style bible + prompt template + input clamps
  fal.ts                concept (text-to-image) + model (image-to-3D), queue polling
  lore.ts               AI SDK -> Vercel AI Gateway, generateObject + zod schema
  miris.ts              GLB upload + processing poll (the ONLY module that knows
                        the Miris ingest contract)
  state.ts              .workshop/state.json read/write — single source of truth
scripts/
  doctor.mjs            live-validates every .env key, prints what's missing/why
  generate.mjs          CLI wrapper over server modules (debug/fallback path)
  deploy.mjs            builds viewer/, injects asset_id + lore, deploys to Vercel
viewer/                 deployable mini-site (Miris SDK three layer + pedestal
                        + baked lore/annotations)
.env.example            documented template for all keys
.workshop/              gitignored: run state + generated artifacts
```

`.env` keys: `FAL_KEY`, `AI_GATEWAY_API_KEY`, `MIRIS_API_TOKEN`, and optional
`VERCEL_TOKEN` (only needed by the REST deploy fallback).

## Pipeline (server-side contracts)

All endpoints are same-origin on the dev server; the browser never holds a key.
Every endpoint writes its outcome into `.workshop/state.json` via `state.ts`.

- `POST /api/concept` `{ prompt }` → `{ conceptId, imageUrl }`
  Wraps the attendee prompt in the guardrail template and calls a cheap fal
  text-to-image model (FLUX schnell class). Sanitation before templating:
  length clamp, strip URLs and prompt-injection markers. Rerolls are new calls
  to this endpoint; every concept is kept in `.workshop/` so approve can refer
  back.
- `POST /api/model` `{ conceptId }` → `{ jobId }`, then progress via status
  Sends the approved image to fal image-to-3D (Trellis vs Hunyuan3D decided by
  a quality/cost bake-off task during implementation) and saves the GLB to
  `.workshop/monster.glb` (mirrored under `public/` so the app can load it).
- `POST /api/lore` `{ prompt }` → lore JSON (schema below)
  Fired in PARALLEL with `/api/model` the moment the concept is approved, so
  lore lines appear during the loading scene instead of adding wait. Uses the
  AI SDK's `generateObject` against the Gateway haiku model; the exact model
  string is verified at build time (naming drifts).
- `POST /api/upload` → `{ assetId }`; processing state surfaces via status
  Uploads the GLB to the attendee's Miris account with `MIRIS_API_TOKEN`.
  Endpoint, auth header shape, and typical processing time are OPEN (see
  risks); everything else depends only on `{ assetId, processing | ready }`.
- `GET /api/status` → the full checklist snapshot (below). Polled ~3s.

### Guardrails (`guardrails.ts`)

A monster-world art bible as a prompt template: creature style and palette,
"single full-body creature, centered, dark backdrop, soft glow" composition
rules, and negative prompts. The attendee's text is slotted into a bounded
field of the template, never concatenated raw. Pure function of
`(userText) -> { prompt, negativePrompt }`, unit-testable without the network.

### Lore schema (`lore.ts`, zod, enforced by generateObject)

```
name        string, 1-3 words
epithet     string ("the ...")
lore        string, <= 60 words
element     enum (small fixed set, part of the art bible)
stats       { might, agility, arcana, mischief, resolve } each int 1-10
annotations 3-5 of { slot: crown|face|left|right|core|base|aura,
                     label: <= 4 words, blurb: <= 12 words }
```

## Checklist detection (`/api/status`)

Item zero: "signed into StackBlitz" (instructional — a fork made signed-out
loses `.env` on reload; the app can only remind, not detect). Then:

1. `.env` exists and each key is present AND live-validated: fal balance
   endpoint, minimal Gateway call, Miris `/me`. Validation results cached 60s
   so polling never spams providers.
2. Concept image exists (and count of rerolls, for fun).
3. `monster.glb` exists.
4. `lore.json` exists and parses against the schema.
5. `assetId` present; Miris processing state (`processing`/`ready`).
6. Deployment: `deploy.mjs` writes `.workshop/deployment.json` with the URL;
   status also pings the URL for a 200.

The itinerary and the checklist are the same data grouped by phase; items flip
themselves as things are detected.

## The app (scenes and states)

One dark "summoning chamber" three.js scene, four states. Display surfaces are
html-in-canvas cards (canvas-texture panels, boutique-placard technique).

- **Setup** — itinerary + live checklist as canvas cards; nothing else until
  the three keys validate.
- **Create** — prompt panel (DOM-overlay input, decision #7) + concept preview
  card with Reroll / Approve.
- **Summoning** — particle ritual circle; intensity tracks fal queue progress;
  lore lines fade in as `/api/lore` streams back.
- **Reveal** — cylinder pedestal; GLB placed with measure-at-identity fit
  (bounding box measured at identity transform, then scaled/seated on the
  pedestal — the pattern proven in the boutique); slow turntable + drag orbit;
  annotation cards with slot+raycast leader lines; stat panel; name/epithet.
  From here: **Upload to Miris** button → processing state → assetId card →
  deploy instructions card (run `npm run deploy` in the terminal), which
  auto-completes when the deployment is detected.

## Viewer + deploy

`viewer/` is a minimal static page on the Miris SDK's **three layer** (the
`stage.ts` pattern from miris-boutique: own renderer + MirisScene +
`backend.doRendering`, splat budget seeded via `_setSplatCountBudgetOverride`),
reusing the pedestal and annotation modules, with `assetId` and lore baked in
at build time. `deploy.mjs`: pre-fills assetId from state (attendee can
override), builds `viewer/`, runs `vercel deploy --prod`; if the CLI
misbehaves in the WebContainer, falls back to Vercel's REST deploy API with
`VERCEL_TOKEN`. Both paths get rehearsed before the event.

## Error handling

- Every `/api/*` failure returns `{ error, hint }` where `hint` is
  attendee-facing ("Your fal balance is empty — see the coupon step") and the
  app renders it in the relevant card, never a blank state.
- `doctor.mjs` is the terminal-side mirror of checklist item 1, for attendees
  whose UI shows a red key and who need more detail than a card can hold.
- fal queue jobs carry a timeout with a retry affordance in the UI; a failed
  3D job never consumes the approved concept (re-submit allowed).
- The upload step is idempotent per GLB hash: re-clicking Upload after a
  network wobble must not create duplicate Miris assets.

## Testing

- vitest: guardrails template output (including sanitation), slot→direction
  mapping and raycast fallback against synthetic geometry, lore schema parsing
  of canned AI outputs (valid + malformed), state/status transitions.
- A rehearsal script (documented, not automated CI) that runs the full
  pipeline against real keys end to end — the pre-event gate.

## Risks and open items

| Risk | Mitigation |
|------|------------|
| fal coupon does not exist yet | Pipeline tuned cheap (rerolls hit only the image step); `doctor.mjs` and the checklist surface fal balance. Confirm coupon or a budget before the event. |
| Miris GLB ingest contract unconfirmed (endpoint, auth header, processing time) | Isolated entirely in `server/miris.ts`; the rest of the system depends only on `{ assetId, processing/ready }`. Confirm early in implementation. |
| Vercel CLI inside WebContainer | REST deploy fallback via `VERCEL_TOKEN`; both rehearsed. |
| Gateway haiku model string drift | Verified at build time; `doctor.mjs` validates the model responds, not just the key. |
| StackBlitz fork persistence | Checklist item zero instructs signing into StackBlitz before forking. |
| Keys visible in a browser-hosted project | Workshop guidance: keys are workshop-scoped and disposable; `.env` is gitignored and never leaves the fork. |

## Addendum (2026-08-21): two pivots, decided by the owner

1. The prompt-shaping and lore pipeline moved OUT of this repo and into a
   public fal WORKFLOW on the Miris account (decision supersedes rows 3 and
   4's Gateway/handrolled-lore aspects). POST /api/concept runs the workflow
   (id from FAL_WORKFLOW_ID, default in server/fal.ts) and receives the
   concept image and the lore document together; the Vercel AI Gateway
   account, key, probe, and dependencies (ai, @ai-sdk/gateway, msw) are
   removed. Attendees need only FAL_KEY. The output contract lives as a
   comment block above parseWorkflowOutput in server/fal.ts.

2. Publishing is manual through the Miris portal (supersedes decision 1's
   token-based upload): attendees download monster.glb from the app, upload
   it at app.miris.com under their own account, and paste the asset id back
   (POST /api/asset-id). server/miris.ts, MIRIS_API_TOKEN, and the probe are
   removed. A "login with Miris" OAuth flow remains a possible upgrade if
   client credentials materialize; it is not built.

3. (2026-08-21) bolt.new replaces both StackBlitz classic and Vercel
   (supersedes decision 2's editor and the deploy half of the plan): the
   workshop runs in bolt.new, and the viewer ships through Bolt's Deploy
   button. npm run deploy now bakes the asset id and builds the viewer as
   the project's build output (dist/); the attendee presses Deploy and
   pastes the live link back (POST /api/deployed-url writes
   deployment.json, which the checklist already watched). The vercel
   devDependency, CLI path, REST fallback, collectFiles, and VERCEL_TOKEN
   are removed.

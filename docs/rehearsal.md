# Rehearsal gate

This is the pre event checklist. Nothing in this project ships to attendees until every item below is checked off by someone who actually ran it, not just read it. Several of these gate on real unknowns in the codebase, not just "does the happy path work."

Do this rehearsal from a fresh fork, with real keys, close enough to the workshop date that nothing has drifted (fal model availability, Vercel account state, Miris API behavior).

## 0. Environment sanity

- [ ] Fork the published project from StackBlitz while signed in. Confirm the fork keeps a working `.env` file after a page reload (this is the failure mode the README warns attendees about in step zero).
- [ ] Fill in `FAL_KEY`, `AI_GATEWAY_API_KEY`, and `MIRIS_API_TOKEN` with real, freshly issued credentials, not ones reused from a previous rehearsal.
- [ ] Run `npm run doctor` and confirm all three keys report valid, including the live model check for `LORE_MODEL_ID`.

## 1. `npm install` inside a real WebContainer

`msw` is a devDependency with a `postinstall` script (`node -e "import('./config/scripts/postinstall.js')..."`). StackBlitz's WebContainer may prompt to allow install scripts before it will run one.

- [ ] From a genuinely fresh fork (not a cached one), run `npm install` inside the actual StackBlitz WebContainer and confirm it completes without hanging on an allow scripts prompt that an attendee would not know how to answer.
- [ ] If it does prompt, decide and document here what the attendee should click, or preinstall dependencies into the published fork so they never see the prompt at all.

## 2. Miris ingest contract

`server/miris.ts` opens with a comment block that says the upload paths, multipart field names, and status vocabulary are an unconfirmed working guess. `server/probes.ts` also has `MIRIS_ME_PATH = "/v1/me"` marked as needing confirmation against the same contract.

- [ ] Confirm against the real Miris API: the upload endpoint path (currently assumed `${base}/v1/assets`, `POST`, multipart field names `file` and `name`), the asset status endpoint path and shape (currently assumed `${base}/v1/assets/:id` returning `{ status }` with values including `ready`/`complete`/`failed`/`error`), and the `/v1/me` path used for the token probe.
- [ ] If any of these differ from what is coded, fix them in `server/miris.ts` and `server/probes.ts` together, and update `test/miris.test.ts` in the same change, then rerun the full upload and status polling flow end to end against the real API (not a mock) to confirm it actually works.
- [ ] Do not sign off this item from reading the code. Sign it off after a real upload against the real Miris API returns a real asset id and reaches `ready`.

## 3. Viewer key requirement

The live asset endpoint returned a 401 without a viewer key during earlier testing, which suggests the deployed viewer needs a `VIEWER_KEY` to read a processed asset, not just an asset id.

- [ ] Confirm whether the account attendees will use requires a viewer key to read their own processed assets.
- [ ] If it does, get a viewer key (or confirm how each attendee gets their own) and set `VIEWER_KEY` in `.env` before running the deploy rehearsal below, and confirm the deployed page loads the asset without a 401.
- [ ] If it does not, note that here explicitly so we stop worrying about it, and confirm the deployed page still loads correctly with `VIEWER_KEY` left blank.

## 4. 3D model bake off

`server/fal.ts` currently sets `MODEL_3D = "fal-ai/trellis"` with a comment that a bake off may swap it to `fal-ai/hunyuan3d/v2`.

- [ ] Pick three representative concept prompts (aim for different silhouettes, for example something spindly, something bulky, and something with fine detail like fur or feathers).
- [ ] Run all three concepts through both `fal-ai/trellis` and `fal-ai/hunyuan3d/v2`, using the same concept image for both so the comparison is fair.
- [ ] Compare the two models on fidelity (does the mesh actually look like the concept), time (how long each queue job takes end to end), and cost (per generation, from the fal dashboard).
- [ ] Pick a winner and set `MODEL_3D` in `server/fal.ts` accordingly. If the two models split on different axes, write down the tradeoff here so the decision is not silently lost.

## 5. Deploy path, both ways

`scripts/deploy.ts` tries the Vercel CLI first and falls back to the REST API with `VERCEL_TOKEN` if the CLI path fails.

- [ ] Inside the actual StackBlitz WebContainer, run `npx vercel login` and confirm it is possible to authenticate the CLI from inside the sandbox, then run `npm run deploy` and confirm it deploys successfully via the CLI path.
- [ ] Separately, with a valid `VERCEL_TOKEN` set and without a CLI login, force or simulate the CLI path failing and confirm the REST fallback in `deployViaRest` actually completes a deployment and returns a working URL.
- [ ] Visit the resulting `https://*.vercel.app` URL for both paths and confirm the viewer actually loads the monster, not just that the deploy command exits with a URL.

## 6. Lore model on a fresh Vercel account

`LORE_MODEL_ID` is `anthropic/claude-3-haiku`, called through `@ai-sdk/gateway`, and doctor's live check calls it with a one token prompt.

- [ ] Create (or use) a genuinely fresh Vercel account, generate a new AI Gateway key against its five dollar free credit, and confirm `npm run doctor` reports the model responding.
- [ ] Run a handful of real lore generations against that fresh account's credit and confirm the five dollars comfortably covers a full workshop's worth of attendee usage, not just the doctor ping.

## 7. Viewer color and readability

`viewer/stage.ts` sets `renderer.outputColorSpace = THREE.LinearSRGBColorSpace`. Cards rendered onto canvas textures read noticeably darker under linear output than they would under sRGB.

- [ ] Load a deployed viewer and judge whether the lore and stat cards are actually readable, not just present, against the pedestal and background.
- [ ] If they read too dark, tune it (adjust `toneMappingExposure`, adjust the card's own painted colors, or reconsider the color space) and confirm the fix by eye on the actual deployed page, not just in the dev viewer.

## 8. fal CDN image and CORS

The concept image is fetched directly (`fetch(imageUrl)` then `createImageBitmap`) inside `src/scene/director.ts`, not loaded as a plain `<img>`. That fetch is subject to CORS, unlike an `<img>` tag.

- [ ] Confirm that fetching a real fal CDN concept image URL from the deployed app's origin succeeds and paints onto the concept card, rather than silently failing or throwing a CORS error in the console.
- [ ] Test this from an actual StackBlitz preview URL and from a deployed Vercel URL, since CORS behavior can differ by origin.

## 9. Full flow, twice

- [ ] Run the entire flow, prompt to concept to summon to lore to upload to deploy, start to finish, at least twice, with two different prompts, on two different forks or sessions. The second run should be a clean pass with nothing carried over from the first, so it actually rehearses what an attendee experiences.
- [ ] Note the wall clock time for each full run so we can set attendee expectations at the start of the workshop.

## 10. Reveal scene screenshot

- [ ] Once a monster has fully summoned and is sitting on the pedestal in the reveal scene, take a clean screenshot of it (no browser chrome, no dev tools open) for the workshop slides.
- [ ] Save it somewhere the slide deck can pull from, and note here where it lives.

## Sign off

Do not consider the workshop ready until every box above is checked by someone who ran the actual step, on a fresh fork, with real keys, against real services. A check based on reading the code instead of running it does not count.

## 10. html-in-canvas showcase (presenter machine)

Enable chrome://flags/#canvas-draw-element on the presenter machine, reload
the app, and confirm the checklist card renders from live HTML (inspect
#card-dom-host in devtools; hover a key row and watch the DOM update). Then
confirm a stock browser without the flag still renders every card via the
painted fallback. This is a talking point, not an attendee requirement.

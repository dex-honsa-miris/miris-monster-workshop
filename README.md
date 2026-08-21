# Miris Monster Workshop

Welcome. In this workshop you will describe a monster in a sentence or two, watch it get sketched and sculpted in 3D by AI, give it a name and a bit of lore, and then publish it to your own live web page that you can share with anyone.

Everything runs inside a bolt.new fork in your browser. You do not need to install anything locally.

## Step zero: sign into bolt.new

Before you fork this project, sign into bolt.new. If you fork while signed out, your fork will not save your `.env` file, and you will lose your keys the moment you close the tab. Sign in first, then fork.

## Get set up

Once you have forked the project, copy `.env.example` to `.env` and fill in
one key.

**FAL_KEY**
Go to the fal.ai dashboard and open Keys. Create a key and paste it in.
You will also see a fal coupon mentioned at the workshop.

That is the only key you need. The prompt shaping, concept art, and monster
lore all come from a public fal workflow that Miris maintains; your key pays
for the runs, the workflow does the thinking. Publishing to Miris happens in
the Miris portal in your browser, so no Miris key goes in this file.

## The workflow

When you press Sketch it, the app runs a public fal workflow from the Miris
account. One workflow run takes your sentence and returns the styled concept
image and the monster's lore document together. You can open the workflow on
fal to see how it is wired: the pre-prompt that keeps every monster in the
Miris monster world style, the image model, and the LLM step that writes the
lore. Fork it on fal afterwards if you want to build your own world.

If the presenter gives you a different workflow id, put it in `.env` as
`FAL_WORKFLOW_ID`.


## Summon

With your keys in place, describe your monster. Type a short prompt, something like "a moss golem with lantern eyes," and generate a concept image. If you do not like the first result, reroll as many times as you want. Once you are happy with one, approve it.

Approving your concept kicks off two things at once: the 3D model summon, which turns your flat concept image into a sculpted 3D mesh, and the lore write up, which gives your monster a name, an epithet, stats, and a few annotations pointing at interesting parts of its body. The 3D summon takes a minute or two, so watch the ritual animation while you wait.

If you would rather work from a terminal instead of the app, the same pipeline is available as a script:

```
npm run generate -- "a moss golem with lantern eyes"
```

This writes `monster.glb` and `lore.json` to your workshop directory without touching the browser app.

## Publish

Publishing is a trip through the Miris portal, in your own account:

1. In the app, press Download monster.glb.
2. Press Open the Miris portal (app.miris.com) and sign in, or create your
   Miris account if you have not yet.
3. Upload the GLB as a new asset and wait for processing to finish.
4. Copy the asset id from the asset page and paste it into the app, then
   press Save asset id.

The checklist ticks itself once the id is saved.


## Deploy

Your monster gets its own page, hosted by Bolt:

1. In the terminal, run `npm run deploy`. This bakes your asset id and lore
   into the viewer and builds it as the project's build output.
2. Press Deploy in the bolt.new editor and wait for your live link.
3. Paste the link into the app. The checklist ticks itself, and your monster
   is on the internet.


## Command reference

- `npm run dev`: starts the workshop app itself.
- `npm run doctor`: checks that your fal key is present and valid.
- `npm run generate -- "prompt"`: runs the concept and 3D pipeline from the terminal, skipping the app.
- `npm run deploy [-- asset_id]`: bakes your asset id into the viewer and builds it; then press Deploy in bolt.new.
- `npm run build:viewer`: builds the standalone viewer without deploying it.
- `npm run dev:viewer`: runs the standalone viewer locally so you can preview it before deploying.

## Troubleshooting

Start with:

```
npm run doctor
```

It checks every key against the real service and tells you the specific problem, whether that is a missing key, a rejected key, or a model that is not responding. Read its output line by line before doing anything else.

If doctor passes but something in the app still is not working:

- **Concept generation fails or times out.** fal.ai balance is not visible through the API, so if `FAL_KEY` checks out in doctor but generation still fails, check your balance directly on the fal.ai dashboard.
- **The 3D summon seems stuck.** It can genuinely take a couple of minutes. If it has been much longer than that, refresh the app; the pipeline will pick up where it left off rather than starting over.
- **Portal upload trouble.** The upload happens on app.miris.com in your own account, not in this app. If processing seems stuck, refresh the asset page in the portal; paste the asset id here only once the asset shows as ready.
- **Viewing your published asset gives a 401 or looks broken.** Some Miris accounts require a `VIEWER_KEY` to read processed assets. Ask a workshop helper whether this applies to you, then set `VIEWER_KEY` in `.env` and redeploy.
- **Deploy trouble.** `npm run deploy` only builds; publishing is the Deploy button in the bolt.new editor. If the button is missing or fails, make sure you are signed into bolt.new and that the build finished without errors in the terminal.
- **Your fork lost its `.env` values.** This usually means the fork was made while signed out of bolt.new. Sign in, fork again, and re-enter your keys.

If you are stuck on anything not covered here, ask a helper. Everyone's first monster takes a little longer than the second one.

## Bonus: html-in-canvas

The panels floating in the 3D scene are card textures. In browsers that
implement the experimental html-in-canvas API (WICG proposal, behind
chrome://flags/#canvas-draw-element in Chromium), the app renders those cards
from live HTML and CSS with drawElementImage. Everywhere else it falls back
to drawing the same content with canvas text calls, so nothing is required
from you. If you want to see the live path, flip the flag and reload.

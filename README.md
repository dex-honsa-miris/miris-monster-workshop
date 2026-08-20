# Miris Monster Workshop

Welcome. In this workshop you will describe a monster in a sentence or two, watch it get sketched and sculpted in 3D by AI, give it a name and a bit of lore, and then publish it to your own live web page that you can share with anyone.

Everything runs inside a StackBlitz fork in your browser. You do not need to install anything locally.

## Step zero: sign into StackBlitz

Before you fork this project, sign into StackBlitz. If you fork while signed out, your fork will not save your `.env` file, and you will lose your keys the moment you close the tab. Sign in first, then fork.

## Get set up

Once you have forked the project, copy `.env.example` to `.env` and fill in three keys. Each one comes from a different dashboard.

**FAL_KEY**
Go to the fal.ai dashboard and open Keys. Create a key and paste it in.

**AI_GATEWAY_API_KEY**
Go to the Vercel dashboard, open AI Gateway, then API Keys. Create a key and paste it in. New Vercel accounts get five dollars of free credit, which is more than enough for the workshop.

**MIRIS_API_TOKEN**
Go to your Miris account settings and find the API token section. Copy your token and paste it in.

You will also see a fal coupon mentioned at the workshop.

Coupon code: announced at the workshop

Two more keys in `.env.example` are optional and you can leave them blank unless a helper tells you otherwise:

- `VERCEL_TOKEN`: only needed if the Vercel CLI deploy fails inside your browser sandbox. It lets the deploy script fall back to a direct REST call.
- `MIRIS_API_BASE`: only needed if you are pointed at a non default Miris environment.
- `VIEWER_KEY`: only needed if your Miris account requires a key to view processed assets. If you have one, put it here and the deploy script will bake it into your published viewer.

Once your `.env` is filled in, run:

```
npm run doctor
```

This checks all three required keys against the real services and tells you exactly what is wrong if something is not working, rather than making you guess. Keep the app open in another tab (`npm run dev`) so you can watch the checklist there update to "done" for each key as it becomes valid.

## Summon

With your keys in place, describe your monster. Type a short prompt, something like "a moss golem with lantern eyes," and generate a concept image. If you do not like the first result, reroll as many times as you want. Once you are happy with one, approve it.

Approving your concept kicks off two things at once: the 3D model summon, which turns your flat concept image into a sculpted 3D mesh, and the lore write up, which gives your monster a name, an epithet, stats, and a few annotations pointing at interesting parts of its body. The 3D summon takes a minute or two, so watch the ritual animation while you wait.

If you would rather work from a terminal instead of the app, the same pipeline is available as a script:

```
npm run generate -- "a moss golem with lantern eyes"
```

This writes `monster.glb` and `lore.json` to your workshop directory without touching the browser app.

## Publish

When your monster and its lore are both ready, upload it to Miris. This sends your finished glb file to your Miris account for processing. Processing can take a little while. The checklist will show "doing" until Miris marks the asset ready, then it flips to "done."

If you upload the exact same file twice, the pipeline recognizes it and reuses the existing asset instead of creating a duplicate.

## Deploy

The last step is deploying your own shareable viewer page. Run:

```
npm run deploy
```

This bakes your monster's asset id and lore into a small standalone viewer, builds it, and deploys it to Vercel. If you have already logged into the Vercel CLI, it deploys directly. If the CLI path fails for any reason, and you have set `VERCEL_TOKEN` in your `.env`, the script automatically falls back to deploying over the Vercel REST API instead.

When it finishes, you will get a `https://something.vercel.app` link. That page is yours to share.

If you ever need to redeploy an asset without going through the app again, you can pass an asset id directly:

```
npm run deploy -- asset_id
```

## Command reference

- `npm run dev`: starts the workshop app itself.
- `npm run doctor`: checks that all your keys are present and valid.
- `npm run generate -- "prompt"`: runs the concept and 3D pipeline from the terminal, skipping the app.
- `npm run deploy [-- asset_id]`: bakes, builds, and deploys your viewer.
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
- **Upload to Miris fails.** Confirm `MIRIS_API_TOKEN` is valid with `npm run doctor`, and if you were given a custom `MIRIS_API_BASE`, double check it is set correctly in `.env`.
- **Viewing your published asset gives a 401 or looks broken.** Some Miris accounts require a `VIEWER_KEY` to read processed assets. Ask a workshop helper whether this applies to you, then set `VIEWER_KEY` in `.env` and redeploy.
- **The deploy fails with no Vercel session.** Either run `npx vercel login` inside your StackBlitz terminal and deploy again, or set `VERCEL_TOKEN` in `.env` from your Vercel dashboard under Settings, Tokens, and run `npm run deploy` again. The script will use whichever path works.
- **Your fork lost its `.env` values.** This usually means the fork was made while signed out of StackBlitz. Sign in, fork again, and re-enter your keys.

If you are stuck on anything not covered here, ask a helper. Everyone's first monster takes a little longer than the second one.

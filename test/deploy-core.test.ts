import { describe, expect, it } from "vitest";
import { deploymentRecord, resolveAssetId, viewerConfig } from "../server/deploy-core";
import { defaultState } from "../server/state";

describe("resolveAssetId", () => {
  it("prefers the CLI arg, falls back to state, throws with guidance when absent", () => {
    const st = { ...defaultState(), upload: { ...defaultState().upload, assetId: "from-state" } };
    expect(resolveAssetId("cli-id", st)).toBe("cli-id");
    expect(resolveAssetId(undefined, st)).toBe("from-state");
    expect(() => resolveAssetId(undefined, defaultState())).toThrow(/Upload first/);
  });
});

describe("viewerConfig / deploymentRecord", () => {
  it("produces parseable JSON with the contract fields", () => {
    const lore = { name: "N", epithet: "e", lore: "l", element: "bloom", stats: { might: 1, agility: 1, arcana: 1, mischief: 1, resolve: 1 }, annotations: [{ slot: "crown", label: "a", blurb: "b" }, { slot: "face", label: "c", blurb: "d" }, { slot: "base", label: "e", blurb: "f" }] };
    const cfg = JSON.parse(viewerConfig("a-1", lore as never)) as { assetId: string };
    expect(cfg.assetId).toBe("a-1");
    const rec = JSON.parse(deploymentRecord("https://x.vercel.app")) as { url: string; deployedAt: string };
    expect(rec.url).toBe("https://x.vercel.app");
    expect(new Date(rec.deployedAt).getTime()).toBeGreaterThan(0);
  });

  it("includes viewerKey when passed, and omits it when not", () => {
    const lore = { name: "N", epithet: "e", lore: "l", element: "bloom", stats: { might: 1, agility: 1, arcana: 1, mischief: 1, resolve: 1 }, annotations: [{ slot: "crown", label: "a", blurb: "b" }, { slot: "face", label: "c", blurb: "d" }, { slot: "base", label: "e", blurb: "f" }] };
    const withKey = JSON.parse(viewerConfig("a-1", lore as never, "vk-123")) as { viewerKey?: string };
    expect(withKey.viewerKey).toBe("vk-123");
    const withoutKey = JSON.parse(viewerConfig("a-1", lore as never)) as { viewerKey?: string };
    expect(withoutKey.viewerKey).toBeUndefined();
  });
});


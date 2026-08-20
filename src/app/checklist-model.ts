import type { WorkshopStatus } from "../../server/status";

export interface ChecklistItem { id: string; label: string; state: "todo" | "doing" | "done" | "error"; detail?: string; href?: string }
export interface Phase { title: string; items: ChecklistItem[] }

const key = (id: string, label: string, k: { present: boolean; valid: boolean | null; detail: string } | undefined): ChecklistItem => {
  if (!k || !k.present) return { id, label, state: "todo" };
  if (k.valid === false) return { id, label, state: "error", detail: k.detail };
  return { id, label, state: "done" };
};

/** Where each key lives; the checklist rows link straight to them. */
const DASHBOARDS = {
  "key-fal": "https://fal.ai/dashboard/keys",
  "key-gateway": "https://vercel.com/dashboard",
  "key-miris": "https://app.miris.com",
} as const;

export interface ChecklistEnv { inStackBlitz?: boolean }

export function checklistFrom(status: WorkshopStatus | null, env: ChecklistEnv = {}): Phase[] {
  const s = status;
  const keysDone = !!s && Object.values(s.keys).every((k) => k.present && k.valid === true);
  return [
    {
      title: "Get set up",
      items: [
        {
          id: "stackblitz",
          label: "Sign into StackBlitz, then fork",
          // Running inside a WebContainer is detectable; being signed in is
          // not, so the label itself stays the reminder.
          state: env.inStackBlitz || keysDone ? "done" : "todo",
          detail: "Forks made signed out lose your .env",
        },
        { ...key("key-fal", "fal.ai key in .env", s?.keys.fal), href: DASHBOARDS["key-fal"] },
        { ...key("key-gateway", "Vercel AI Gateway key in .env", s?.keys.gateway), href: DASHBOARDS["key-gateway"] },
        { ...key("key-miris", "Miris API token in .env", s?.keys.miris), href: DASHBOARDS["key-miris"] },
      ],
    },
    {
      title: "Summon",
      items: [
        { id: "concept", label: "Generate a concept", state: (s?.concept.count ?? 0) > 0 ? "done" : "todo", detail: s && s.concept.count > 1 ? `${s.concept.count} rerolls` : undefined },
        { id: "approve", label: "Approve your favorite", state: s?.concept.approved ? "done" : "todo" },
        {
          id: "model", label: "Summon the 3D monster",
          state: s?.model.status === "done" ? "done" : s?.model.status === "running" ? "doing" : s?.model.status === "failed" ? "error" : "todo",
          detail: s?.model.error ?? undefined,
        },
        {
          id: "lore", label: "Lore written",
          state: s?.lore.ready ? "done" : s?.lore.status === "failed" ? "error" : s?.lore.status === "running" ? "doing" : "todo",
          detail: s?.lore.status === "failed" ? (s.lore.error ?? undefined) : undefined,
        },
      ],
    },
    {
      title: "Publish",
      items: [
        { id: "upload", label: "Upload to Miris", state: s?.upload.assetId ? "done" : "todo", detail: s?.upload.assetId ?? undefined },
        {
          id: "processing", label: "Miris processing",
          state: s?.upload.state === "ready" ? "done" : s?.upload.state === "processing" ? "doing" : s?.upload.state === "failed" ? "error" : "todo",
        },
      ],
    },
    {
      title: "Deploy",
      items: [
        { id: "deploy", label: "Deploy your viewer (npm run deploy)", state: s?.deployment.url ? "done" : "todo", detail: s?.deployment.url ?? undefined },
      ],
    },
  ];
}

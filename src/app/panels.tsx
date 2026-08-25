// The screen-pinned HUD, as real DOM.
//
// These panels used to be canvas textures billboarded in the 3D scene, which
// cost them everything the platform gives away for free: selectable text,
// working links, scrolling, keyboard focus, and crisp type at any DPR. The
// html-in-canvas showcase now lives only where a card genuinely belongs in
// world space, on the monster's annotations.
//
// Everything rendered here is untrusted (attendee prompts, model-written
// lore); React escapes it by construction, so there is no esc() to remember.
import { useState } from "react";
import type { Phase } from "./checklist-model";
import type { ArtifactDoc, MonsterLore, ProductDoc, WorkshopDoc } from "../../server/lore-schema";
import { PATHS, type PathId } from "../../server/paths";
import { STATE_ICON, statBars } from "./panel-model";

/** A side column. Rails and any panels beneath them stack in here, so the
 * rail can give up height to whatever sits under it instead of the two
 * overlapping. */
export function Dock({ side, children }: { side: "left" | "right"; children: React.ReactNode }): React.ReactElement {
  return <div className="dock" data-side={side}>{children}</div>;
}

interface RailProps {
  side: "left" | "right";
  /** Eyebrow label, also the collapsed summary on small screens. */
  title: string;
  children: React.ReactNode;
}

/** A side rail. A <details> rather than a plain panel so a narrow viewport (a
 * bolt.new preview pane with the terminal open) can be cleared without the
 * panel becoming unreachable. */
function Rail({ side, title, children }: RailProps): React.ReactElement {
  return (
    <details className="rail" data-side={side} open>
      <summary className="rail-head">{title}</summary>
      <div className="rail-body">{children}</div>
    </details>
  );
}

export function Checklist({ phases }: { phases: Phase[] }): React.ReactElement {
  return (
    <Rail side="left" title="Workshop">
      {phases.map((phase) => (
        <section className="phase" key={phase.title}>
          <h2 className="eyebrow">{phase.title}</h2>
          <ul className="items">
            {phase.items.map((item) => {
              // Linked rows are anchors now, so the arrow is a real
              // destination instead of the decoration it was on canvas.
              const label = item.href ? (
                <a className="item-link" href={item.href} target="_blank" rel="noopener">
                  {item.label}
                  <span className="arrow" aria-hidden="true">→</span>
                </a>
              ) : (
                <span className="item-label">{item.label}</span>
              );
              return (
                <li className="item" data-state={item.state} key={item.id}>
                  <span className="icon" aria-hidden="true">{STATE_ICON[item.state]}</span>
                  {label}
                  {item.detail && item.state === "error" && <p className="item-detail">{item.detail}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </Rail>
  );
}

export function ConceptPanel({
  concept,
}: {
  concept: { imageUrl: string; prompt: string; rerolls: number };
}): React.ReactElement {
  return (
    <Rail side="right" title="Concept">
      {/* crossOrigin so the image stays usable if anything later wants to
          read it back out of a canvas. */}
      <img className="concept-art" src={concept.imageUrl} alt="Concept art for your monster" crossOrigin="anonymous" />
      <p className="concept-prompt">{concept.prompt}</p>
      {concept.rerolls > 1 && <p className="eyebrow">Take {concept.rerolls}</p>}
    </Rail>
  );
}

/** The right-rail document, rendered per path. Monster gets its RPG codex,
 * product a spec sheet, artifact a museum label; the rail title follows. */
export function DocPanel({ doc, iconUrl }: { doc: WorkshopDoc; iconUrl?: string | null }): React.ReactElement {
  const title = PATHS[doc.kind].copy.codexTitle;
  if (doc.kind === "product") return <ProductPanel doc={doc} iconUrl={iconUrl} title={title} />;
  if (doc.kind === "artifact") return <ArtifactPanel doc={doc} iconUrl={iconUrl} title={title} />;
  return <LorePanel lore={doc} iconUrl={iconUrl} title={title} />;
}

/** The emblem, falling back to nothing: a wiped public/ folder should cost a
 * picture, not a broken tile. Shared by all three document panels. */
function DocIcon({ iconUrl }: { iconUrl?: string | null }): React.ReactElement | null {
  const [broken, setBroken] = useState(false);
  if (!iconUrl || broken) return null;
  return <img className="lore-icon" src={iconUrl} alt="" onError={() => setBroken(true)} />;
}

function ProductPanel({ doc, iconUrl, title }: { doc: ProductDoc; iconUrl?: string | null; title: string }): React.ReactElement {
  const price = new Intl.NumberFormat("en-US", { style: "currency", currency: doc.price.currency || "USD", maximumFractionDigits: 0 }).format(doc.price.amount);
  return (
    <Rail side="right" title={title}>
      <header className="lore-head">
        <DocIcon iconUrl={iconUrl} />
        <h2 className="lore-name">{doc.name}</h2>
        <p className="lore-epithet">{doc.tagline}</p>
        <p className="eyebrow accent">{doc.category} / {price}</p>
      </header>

      <ul className="highlights">
        {doc.highlights.map((h) => <li key={h}>{h}</li>)}
      </ul>

      <h3 className="eyebrow">Specifications</h3>
      <dl className="attrs">
        {doc.attributes.map((a) => (
          <div className="attr" key={a.label}>
            <dt>{a.label}</dt>
            <dd>{a.value}</dd>
          </div>
        ))}
      </dl>

      <p className="lore-prose">{doc.description}</p>
    </Rail>
  );
}

function ArtifactPanel({ doc, iconUrl, title }: { doc: ArtifactDoc; iconUrl?: string | null; title: string }): React.ReactElement {
  return (
    <Rail side="right" title={title}>
      <header className="lore-head">
        <DocIcon iconUrl={iconUrl} />
        <h2 className="lore-name">{doc.name}</h2>
        <p className="lore-epithet">{doc.era}</p>
        <p className="eyebrow accent">Origin / {doc.origin}</p>
      </header>

      <p className="lore-prose artifact-summary">{doc.description}</p>

      <h3 className="eyebrow">Notable figures</h3>
      <ul className="figures">
        {doc.figures.map((f) => (
          <li key={f.name}>
            <span className="figure-name">{f.name}</span>
            <span className="figure-role">{f.role}</span>
            <p className="figure-story">{f.story}</p>
          </li>
        ))}
      </ul>
      {/* The people are real; their connection to this object is not. Said
          plainly on the label, the way a playful exhibit would. */}
      <p className="figures-note">Figures are historical; their ties to this piece are museum legend.</p>
    </Rail>
  );
}

function LorePanel({ lore, iconUrl, title }: { lore: MonsterLore; iconUrl?: string | null; title: string }): React.ReactElement {
  return (
    <Rail side="right" title={title}>
      <header className="lore-head">
        <DocIcon iconUrl={iconUrl} />
        <h2 className="lore-name">{lore.name}</h2>
        <p className="lore-epithet">{lore.epithet}</p>
        <p className="eyebrow accent">Element / {lore.element}</p>
      </header>

      <dl className="stats">
        {statBars(lore).map((s) => (
          <div className="stat" key={s.label}>
            <dt>{s.label}</dt>
            {/* The number is stated as text as well as drawn as a bar: a bar
                alone cannot be read out, or read at a glance. */}
            <dd>
              <span className="track"><span className="fill" style={{ width: `${s.pct}%` }} /></span>
              <span className="stat-value">{s.value}</span>
            </dd>
          </div>
        ))}
      </dl>

      <h3 className="eyebrow">Abilities</h3>
      <ul className="abilities">
        {lore.abilities.map((a) => (
          <li key={a.name}>
            <span className="ability-name">{a.name}</span>
            <span className="ability-blurb">{a.blurb}</span>
          </li>
        ))}
      </ul>

      <p className="lore-prose">{lore.lore}</p>
    </Rail>
  );
}

/** The error card. Was a floating canvas panel with no way to dismiss it. */
export function Note({
  note,
  onDismiss,
}: {
  note: { title: string; body: string };
  onDismiss: () => void;
}): React.ReactElement {
  return (
    <div className="note" role="status">
      <div>
        <p className="note-title">{note.title}</p>
        <p className="note-body">{note.body}</p>
      </div>
      <button className="note-close" onClick={onDismiss} aria-label="Dismiss">×</button>
    </div>
  );
}

export interface PublishPanelProps {
  glbHref: string;
  portalHref: string;
  assetId: string;
  onAssetIdChange: (value: string) => void;
  onSave: () => void;
  busy: boolean;
}

/** The whole publish flow in one place: the file, the portal, and the id that
 * comes back. The id used to sit in the bottom bar, but that row is where the
 * monster itself is described, and the two are unrelated steps. */
export function PublishPanel({
  glbHref,
  portalHref,
  assetId,
  onAssetIdChange,
  onSave,
  busy,
}: PublishPanelProps): React.ReactElement {
  return (
    <section className="publish">
      <h2 className="eyebrow accent">Publish it</h2>
      <p className="publish-hint">Download the model, upload it in the Miris portal, then paste the asset id back here.</p>
      <a className="btn" href={glbHref} download="monster.glb">Download monster.glb</a>
      <a className="btn" href={portalHref} target="_blank" rel="noopener">Open the Miris portal</a>
      <input
        className="publish-input"
        value={assetId}
        placeholder="Miris asset id"
        disabled={busy}
        onChange={(e) => onAssetIdChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onSave(); }}
      />
      {/* Label stays put: busy is global, so borrowing it for this button's
          text made it announce "Saving" during an unrelated sketch. The
          Working bar is the one place progress is reported. */}
      <button className="btn" disabled={busy || !assetId.trim()} onClick={onSave}>Save asset id</button>
    </section>
  );
}

export interface BankEntry {
  id: string;
  name: string;
  epithet: string;
  path: string;
  prompt: string;
  iconUrl: string;
  current: boolean;
}

/** Every creature summoned this session, newest first, ready to be brought
 * back. Each summon overwrites the "current" model files, so without this the
 * earlier ones would only exist as the concept art that made them. */
export function Bank({
  entries,
  busy,
  onLoad,
}: {
  entries: BankEntry[];
  busy: boolean;
  onLoad: (id: string) => void;
}): React.ReactElement | null {
  if (entries.length === 0) return null;
  return (
    <section className="bank">
      <h2 className="eyebrow">Bank · {entries.length}</h2>
      <ul className="bank-list">
        {entries.map((m) => (
          <li key={m.id}>
            <button
              className="bank-item"
              data-current={m.current || undefined}
              disabled={busy || m.current}
              onClick={() => onLoad(m.id)}
              title={m.prompt}
            >
              <BankThumb entry={m} />
              <span className="bank-text">
                <span className="bank-name">
                  {m.name}
                  {m.path !== "monster" && (
                    <span className="bank-path">{PATHS[m.path as PathId]?.copy.label ?? m.path}</span>
                  )}
                </span>
                <span className="bank-epithet">{m.current ? "On the pedestal" : m.epithet}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The emblem, falling back to the creature's initial. Bank thumbnails live
 * under public/, which is disposable: a wiped folder should cost a picture,
 * not a broken tile. */
function BankThumb({ entry }: { entry: BankEntry }): React.ReactElement {
  const [broken, setBroken] = useState(false);
  if (broken || !entry.iconUrl) {
    return <span className="bank-thumb bank-thumb-fallback">{entry.name.slice(0, 1)}</span>;
  }
  return <img className="bank-thumb" src={entry.iconUrl} alt="" onError={() => setBroken(true)} />;
}

/** An indeterminate bar for the waits that have no percentage to report.
 * A button that only changes its own label reads as a click that did nothing.
 */
export function Working({ label }: { label: string }): React.ReactElement {
  return (
    <div className="working" role="status" aria-live="polite">
      <span className="working-bar"><span className="working-fill" /></span>
      <span className="working-label">{label}</span>
    </div>
  );
}

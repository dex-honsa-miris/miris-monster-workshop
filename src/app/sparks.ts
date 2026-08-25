// Spark chips: the blank-page antidote.
//
// The UI deals one fragment per group; tapping a chip appends it to the
// prompt as plain editable text and deals a replacement, so the box always
// offers something new without ever writing the prompt FOR the attendee.
// Pure functions, with the RNG injected so tests are deterministic.
import type { SparkGroup } from "../../server/paths";

export interface Spark {
  group: string;
  text: string;
}

/** One random option per group, in group order. */
export function dealSparks(groups: SparkGroup[], rand: () => number = Math.random): Spark[] {
  return groups.map((g) => ({
    group: g.label,
    text: g.options[Math.floor(rand() * g.options.length)] ?? "",
  }));
}

/** A replacement chip from the same group, never the one just used (so a tap
 * always reveals something new) unless the group only has one option. */
export function redealOne(groups: SparkGroup[], spark: Spark, rand: () => number = Math.random): Spark {
  const group = groups.find((g) => g.label === spark.group);
  if (!group) return spark;
  const pool = group.options.filter((o) => o !== spark.text);
  if (pool.length === 0) return spark;
  return { group: spark.group, text: pool[Math.floor(rand() * pool.length)] ?? spark.text };
}

/** Appends a fragment to the prompt: comma-joined mid-sentence, verbatim at
 * the start. Trailing punctuation the attendee typed is respected rather
 * than doubled. */
export function appendSpark(prompt: string, text: string): string {
  const base = prompt.trimEnd();
  if (base === "") return text;
  const joiner = /[,;:]$/.test(base) ? " " : ", ";
  return `${base}${joiner}${text}`;
}

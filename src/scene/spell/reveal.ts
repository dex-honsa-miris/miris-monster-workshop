// The hand-off curve between the spell and the creature it summoned.
//
// The monster does not wait for the spell to finish and then appear: it is
// mounted at the flash, wearing a white overlay that burns off as the cage
// dissipates. So the reveal happens THROUGH the completion beat, and the
// creature emerges out of the light rather than replacing it.
//
// Kept free of three.js so the timing can be tested on its own.

/** Where in the completion beat the creature is mounted and the flash starts.
 * This is the spell's "snap" (see SpellLoader#update), so the white arrives on
 * the same frame the cage springs open. */
export const FLASH_IN = 0.2;
const FLASH_PEAK = 0.3;
const FLASH_HOLD = 0.4;
// Lands with the cage's own fade, so the whole hand-off is settled well
// before the effect is torn down.
const FLASH_OUT = 0.86;

/**
 * White-overlay amount, 0..1, given normalised progress through the
 * completion beat (SpellLoader.burst), or null before it starts.
 *
 * Fast in, brief hold, slow smoothstepped decay: a symmetric fade reads as a
 * dissolve, while a hard attack and a long tail reads as a flash.
 */
export function revealFlash(t: number | null): number {
  if (t === null || t <= FLASH_IN) return 0;
  if (t < FLASH_PEAK) return (t - FLASH_IN) / (FLASH_PEAK - FLASH_IN);
  if (t <= FLASH_HOLD) return 1;
  if (t >= FLASH_OUT) return 0;
  const k = (t - FLASH_HOLD) / (FLASH_OUT - FLASH_HOLD);
  return 1 - k * k * (3 - 2 * k);
}

/**
 * How far past white the overlay is driven at full flash.
 *
 * A MeshBasicMaterial at 0xffffff emits exactly 1.0, which is merely "white"
 * -- and once the composer tone maps with ACES, 1.0 lands well short of the
 * top of the range and reads as flat paint. THREE.Color is not clamped, so
 * scaling the colour past 1 puts the creature into HDR: bloom (which runs
 * before tone mapping) then has real energy to bleed, and the shoulder of the
 * curve still resolves to blown white.
 */
export const FLASH_GAIN = 12;

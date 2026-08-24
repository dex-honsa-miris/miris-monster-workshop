// Tells a click apart from the end of an orbit.
//
// R3F's onClick rides the DOM click event, which fires on pointer-up wherever
// the drag started and ended on the same element. The canvas is one element,
// so every orbit ends in a "click" on whatever happens to be under the cursor
// -- which was firing a vision request and minting a stray discovery every
// time someone turned the model around.
//
// Pointer travel since pointer-down is the discriminator: past a few pixels it
// was a drag, not a click.
import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";

/** Pixels of travel that stop counting as a click. Generous enough to survive
 * the wobble of a trackpad tap, tight enough that a deliberate orbit never
 * slips through. */
const DRAG_SLOP = 6;

/** Returns a predicate: true when the gesture that just ended was a drag. */
export function useDragGuard(slop = DRAG_SLOP): () => boolean {
  const origin = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const el = useThree((s) => s.gl.domElement);

  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      origin.current = { x: e.clientX, y: e.clientY };
      dragged.current = false;
    };
    const onMove = (e: PointerEvent): void => {
      const o = origin.current;
      if (!o || dragged.current) return;
      if (Math.hypot(e.clientX - o.x, e.clientY - o.y) > slop) dragged.current = true;
    };
    el.addEventListener("pointerdown", onDown);
    // On window, not the canvas: an orbit that leaves the canvas mid-drag
    // still has to register as a drag.
    window.addEventListener("pointermove", onMove);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
    };
  }, [el, slop]);

  return useCallback(() => dragged.current, []);
}

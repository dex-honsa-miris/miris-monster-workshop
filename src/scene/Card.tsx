// A canvas-painted card as an R3F component. The painting itself still comes
// from cards.ts / card-html.ts, so the html-in-canvas showcase (WICG
// drawElementImage) survives the R3F port untouched: only the plumbing that
// puts the texture in the scene became declarative.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { CanvasCard } from "./cards";

export interface CardProps {
  /** Painter for this card's content. Called whenever `deps` change. */
  paint: (card: CanvasCard) => void;
  /** Re-paint when any of these change (cheap value identity check). */
  repaintKey?: unknown;
  worldWidth: number;
  worldHeight: number;
  px?: number;
  position?: THREE.Vector3 | [number, number, number];
  /** 0..1, driven imperatively so opening a card never re-renders React. */
  opacityRef?: { current: number };
  scaleRef?: { current: number };
  visible?: boolean;
  renderOrder?: number;
  billboard?: boolean;
}

export function Card({
  paint,
  repaintKey,
  worldWidth,
  worldHeight,
  px = 512,
  position,
  opacityRef,
  scaleRef,
  visible = true,
  renderOrder = 0,
  billboard = true,
}: CardProps): React.ReactElement {
  // One CanvasCard per mounted component; disposed on unmount.
  const card = useMemo(() => new CanvasCard(worldWidth, worldHeight, px), [worldWidth, worldHeight, px]);
  const meshRef = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera);

  useEffect(() => () => card.dispose(), [card]);
  useEffect(() => { paint(card); }, [card, paint, repaintKey]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (billboard) {
      // Correct for a rotating parent (the turntable) so cards face the
      // camera wherever the mount has swung to.
      const parent = mesh.parent;
      if (parent) {
        const inv = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
        mesh.quaternion.copy(inv).multiply(camera.quaternion);
      } else {
        mesh.quaternion.copy(camera.quaternion);
      }
    }
    // Reveal animation writes through refs: never setState in useFrame.
    if (opacityRef) (mesh.material as THREE.MeshBasicMaterial).opacity = opacityRef.current;
    if (scaleRef) mesh.scale.setScalar(scaleRef.current);
  });

  return (
    <primitive
      object={card.mesh}
      ref={meshRef}
      position={position}
      visible={visible}
      renderOrder={renderOrder}
    />
  );
}

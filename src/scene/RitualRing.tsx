// The ember ring. Intensity rises while a summon is running.
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

const COUNT = 600;

export function RitualRing({ busy }: { busy: boolean }): React.ReactElement {
  const points = useRef<THREE.Points>(null);
  const intensity = useRef(0.2);

  const geometry = useMemo(() => {
    const pos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      const a = (i / COUNT) * Math.PI * 2;
      const r = 1.2 + Math.random() * 0.25;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.random() * 0.12;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);

  useFrame((_, dt, ) => {
    const p = points.current;
    if (!p) return;
    // Ease toward the target instead of snapping, and never setState here.
    const target = busy ? 1 : 0.2;
    intensity.current += (target - intensity.current) * Math.min(1, dt * 2);
    p.rotation.y += dt * (0.3 + intensity.current * 1.4);
    const mat = p.material as THREE.PointsMaterial;
    mat.size = 0.015 + intensity.current * 0.03;
    p.position.y = 0.5 + Math.sin(performance.now() * 0.0017) * 0.04 * intensity.current;
  });

  return (
    <points ref={points} geometry={geometry} position={[0, 0.5, 0]}>
      <pointsMaterial color={0xff3500} size={0.02} blending={THREE.AdditiveBlending} depthWrite={false} transparent />
    </points>
  );
}

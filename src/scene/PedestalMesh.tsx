// The plinth the monster stands on. Was a class with imperative geometry;
// now plain JSX. fitOnPedestal (the pure seating math) stays in pedestal.ts
// and is still unit-tested.
export function PedestalMesh(): React.ReactElement {
  return (
    <group>
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.9, 1.0, 0.5, 48]} />
        <meshStandardMaterial color={0x111215} roughness={0.55} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.9, 0.015, 12, 64]} />
        <meshBasicMaterial color={0xe8e9ed} />
      </mesh>
    </group>
  );
}

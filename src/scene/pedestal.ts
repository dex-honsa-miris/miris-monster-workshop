import * as THREE from "three";

export function fitOnPedestal(
  bbox: { size: THREE.Vector3; min: THREE.Vector3; center: THREE.Vector3 },
  opts: { maxDim: number; topY: number },
): { scale: number; position: THREE.Vector3 } {
  const scale = opts.maxDim / Math.max(bbox.size.x, bbox.size.y, bbox.size.z);
  return {
    scale,
    position: new THREE.Vector3(-bbox.center.x * scale, opts.topY - bbox.min.y * scale, -bbox.center.z * scale),
  };
}

export class Pedestal {
  readonly group = new THREE.Group();
  readonly mount = new THREE.Group();
  readonly #body: THREE.Mesh;
  readonly #rim: THREE.Mesh;
  constructor() {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 1.0, 0.5, 48),
      new THREE.MeshStandardMaterial({ color: 0x1c1722, roughness: 0.6, metalness: 0.4 }),
    );
    body.position.y = 0.25;
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.9, 0.015, 12, 64),
      new THREE.MeshBasicMaterial({ color: 0xc9954a }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.5;
    this.#body = body;
    this.#rim = rim;
    this.group.add(body, rim, this.mount);
  }
  setMonster(gltfScene: THREE.Object3D): void {
    this.mount.clear();
    gltfScene.position.set(0, 0, 0);
    gltfScene.rotation.set(0, 0, 0);
    gltfScene.scale.setScalar(1);
    gltfScene.updateMatrixWorld(true); // measure AT IDENTITY
    const box = new THREE.Box3().setFromObject(gltfScene);
    const fit = fitOnPedestal(
      { size: box.getSize(new THREE.Vector3()), min: box.min.clone(), center: box.getCenter(new THREE.Vector3()) },
      { maxDim: 1.6, topY: 0.5 },
    );
    gltfScene.scale.setScalar(fit.scale);
    gltfScene.position.copy(fit.position);
    this.mount.add(gltfScene);
  }
  update(dt: number): void {
    this.mount.rotation.y += dt * 0.15;
  }
  /** Releases the pedestal's own GPU resources. The mounted monster is owned
   *  by whoever loaded it, so it is only detached here, not disposed. */
  dispose(): void {
    this.mount.clear();
    for (const mesh of [this.#body, this.#rim]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}

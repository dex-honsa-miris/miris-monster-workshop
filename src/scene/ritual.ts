import * as THREE from "three";

export class RitualCircle {
  readonly group = new THREE.Group();
  #points: THREE.Points;
  #material: THREE.PointsMaterial;
  #intensity = 0.2;
  constructor() {
    const N = 600;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = 1.2 + Math.random() * 0.25;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.random() * 0.12;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.#material = new THREE.PointsMaterial({ color: 0xc9954a, size: 0.02, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.#points = new THREE.Points(geo, this.#material);
    this.group.add(this.#points);
  }
  setIntensity(v: number): void { this.#intensity = THREE.MathUtils.clamp(v, 0.2, 1); }
  update(dt: number, t: number): void {
    this.group.rotation.y += dt * (0.3 + this.#intensity * 1.4);
    this.#material.size = 0.015 + this.#intensity * 0.03;
    this.group.position.y = 0.5 + Math.sin(t * 1.7) * 0.04 * this.#intensity;
  }
}

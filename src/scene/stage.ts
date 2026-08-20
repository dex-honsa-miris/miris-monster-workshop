import * as THREE from "three";

export class SceneStage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  onFrame: Array<(dt: number, t: number) => void> = [];
  #raf = 0;
  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.append(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 50);
    this.camera.position.set(0, 1.4, 4.2);
    this.camera.lookAt(0, 1.0, 0);
    this.scene.add(new THREE.HemisphereLight(0xcdc4ff, 0x120e18, 0.7));
    const key = new THREE.SpotLight(0xffe2b8, 60, 12, 0.7, 0.5);
    key.position.set(2.5, 4.5, 2.5);
    this.scene.add(key);
    addEventListener("resize", this.#onResize);
  }
  #onResize = (): void => {
    const el = this.renderer.domElement.parentElement!;
    this.camera.aspect = el.clientWidth / el.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(el.clientWidth, el.clientHeight);
  };
  start(): void {
    let last = performance.now();
    const tick = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      for (const hook of this.onFrame) hook(dt, now / 1000);
      this.renderer.render(this.scene, this.camera);
      this.#raf = requestAnimationFrame(tick);
    };
    this.#raf = requestAnimationFrame(tick);
  }
  dispose(): void {
    cancelAnimationFrame(this.#raf);
    removeEventListener("resize", this.#onResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

import * as THREE from "three";

export class SceneStage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  onFrame: Array<(dt: number, t: number) => void> = [];

  // Camera orbit around the pedestal. The whole scene (ring, particles,
  // pedestal, monster) is viewed from this orbit, so dragging moves the
  // CAMERA rather than spinning the model.
  #yaw = 0;
  #pitch = 0.09;
  #radius = 4.4;
  readonly #target = new THREE.Vector3(0, 1.0, 0);
  static readonly PITCH_MIN = -0.35;
  static readonly PITCH_MAX = 1.05;
  static readonly RADIUS_MIN = 2.2;
  static readonly RADIUS_MAX = 9;
  #raf = 0;
  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.append(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 50);
    this.#applyOrbit();
    this.scene.add(new THREE.HemisphereLight(0xdfe2ea, 0x14161c, 1.5));
    const key = new THREE.SpotLight(0xf4f5f8, 90, 14, 0.8, 0.5);
    key.position.set(2.5, 4.5, 2.5);
    // Fill + rim so a textured mesh reads from the front and separates from
    // the near-black ground (Meshy monsters rendered nearly silhouetted with
    // a single key light).
    const fill = new THREE.DirectionalLight(0xdfe4ef, 1.4);
    fill.position.set(-2.5, 2.2, 3.2);
    const rim = new THREE.DirectionalLight(0xaab2c4, 0.8);
    rim.position.set(0, 2.5, -3.5);
    this.scene.add(key, fill, rim);
    addEventListener("resize", this.#onResize);
  }
  /** Drag: yaw and pitch. Wheel/pinch: distance. */
  orbitBy(dYaw: number, dPitch: number): void {
    this.#yaw += dYaw;
    this.#pitch = THREE.MathUtils.clamp(this.#pitch + dPitch, SceneStage.PITCH_MIN, SceneStage.PITCH_MAX);
    this.#applyOrbit();
  }

  zoomBy(factor: number): void {
    this.#radius = THREE.MathUtils.clamp(this.#radius * factor, SceneStage.RADIUS_MIN, SceneStage.RADIUS_MAX);
    this.#applyOrbit();
  }

  #applyOrbit(): void {
    const r = this.#radius;
    const cp = Math.cos(this.#pitch);
    this.camera.position.set(
      this.#target.x + Math.sin(this.#yaw) * cp * r,
      this.#target.y + Math.sin(this.#pitch) * r,
      this.#target.z + Math.cos(this.#yaw) * cp * r,
    );
    this.camera.lookAt(this.#target);
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

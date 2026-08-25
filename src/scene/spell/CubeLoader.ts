// CubeLoader: the product path's generation VFX -- a holographic vitrine.
//
// A glass cylinder of falling light with a segmented 2x2x2 wireframe cube
// turning inside it. The cube IS the progress bar: its eight cubelets start
// dimmed and light up one by one (the active one pulses as it charges), so
// with the scene's 0.94 progress ceiling the eighth segment completes exactly
// when the backend reports done. Assembly, not magic: where the monster's
// spell reads as energy climbing, this reads as a product being built.
//
// Same construction philosophy and public surface as SpellLoader: cheap
// geometry, all life in shaders, one activation uniform set, a
// charge/snap/dissipate completion beat, and everything under one Group the
// host may place freely (the loader never touches its own group transform).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FRONT, NOISE } from "./glsl";

export interface CubeLoaderOptions {
  radius?: number;
  height?: number;
  color?: THREE.ColorRepresentation;
  secondaryColor?: THREE.ColorRepresentation;
  coreColor?: THREE.ColorRepresentation;
  rainCount?: number;
  energyIntensity?: number;
  rotationSpeed?: number;
  /** Seconds the completion sequence runs for. */
  burstDuration?: number;
}

const DEFAULTS = {
  radius: 1,
  height: 2,
  color: 0xdfe9f2,
  secondaryColor: 0x8fb2c9,
  coreColor: 0xffffff,
  rainCount: 320,
  energyIntensity: 1,
  rotationSpeed: 1,
  burstDuration: 1.5,
} satisfies Required<CubeLoaderOptions>;

const SEGMENTS = 8;

/** Fill order for the 2x2x2 cubelets (x,y,z in {0,1}): the bottom ring
 * counter-clockwise, then the top ring, so the cube visibly builds upward. */
const FILL_ORDER: Array<[number, number, number]> = [
  [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1],
  [0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1],
];

/**
 * Per-segment brightness for a given progress. Completed segments hold 1,
 * the active segment carries its own fractional charge (the shader turns
 * that into a pulse), untouched segments sit at 0. Pure, for tests.
 */
export function segmentLevels(progress: number, segments = SEGMENTS): number[] {
  const p = Math.max(0, Math.min(1, progress));
  const filled = p * segments;
  return Array.from({ length: segments }, (_, i) => Math.max(0, Math.min(1, filled - i)));
}

interface Layer {
  name: string;
  mesh: THREE.Object3D;
  material: THREE.ShaderMaterial;
}

/** Billboards a quad about Y only (world up stays up). */
const BILLBOARD_Y_VS = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 toCam = vec3(cameraPosition.x - c.x, 0.0, cameraPosition.z - c.z);
    vec3 right = dot(toCam, toCam) < 1e-8
      ? vec3(1.0, 0.0, 0.0)
      : normalize(cross(vec3(0.0, 1.0, 0.0), normalize(toCam)));
    vec3 wp = c + right * position.x + vec3(0.0, 1.0, 0.0) * position.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

export class CubeLoader {
  /** Public handle. The host owns its transform; the effect never writes it. */
  readonly group = new THREE.Group();
  readonly options: Required<CubeLoaderOptions>;

  readonly #root = new THREE.Group();
  #progress = 0;
  #shown = 0; // eased follower of #progress
  #time = 0;
  #burstT: number | null = null;
  #done = false;
  #onComplete: (() => void) | null = null;

  readonly #layers: Layer[] = [];
  readonly #disposables: Array<{ dispose(): void }> = [];
  #cube = new THREE.Group();
  #cubelets: Array<{ holder: THREE.Group; rest: THREE.Vector3; materials: THREE.ShaderMaterial[] }> = [];
  #scale = 1;
  #lift = 0;
  /** 0 = resting gaps, 1 = welded into one solid cube (the completion snap). */
  #weld = 0;

  constructor(opts: CubeLoaderOptions = {}) {
    this.options = { ...DEFAULTS, ...opts };
    const { radius, height } = this.options;

    this.#buildCylinder(radius, height);
    this.#buildRain(radius, height);
    this.#buildFloor(radius);
    this.#buildCube(radius, height);

    this.group.add(this.#root);
    this.group.renderOrder = 10;
  }

  // ---------------------------------------------------------------- public

  setProgress(p: number): void {
    const next = Math.max(0, Math.min(1, p));
    this.#progress = next;
    if (next >= 1 && this.#burstT === null) this.#burstT = 0;
  }

  get progress(): number {
    return this.#progress;
  }

  onComplete(fn: () => void): void {
    this.#onComplete = fn;
  }

  get complete(): boolean {
    return this.#done;
  }

  /** Normalised completion-beat position, or null before it is armed. */
  get burst(): number | null {
    return this.#burstT === null ? null : Math.min(1, this.#burstT / this.options.burstDuration);
  }

  /** Debug: show only the named layers (comma separated). */
  solo(names: string): void {
    const keep = new Set(names.split(",").map((s) => s.trim()));
    for (const l of this.#layers) l.mesh.visible = keep.has(l.name);
  }

  /** Debug: advance the internal clock. */
  seek(t: number): void {
    this.#time = t;
    this.#shown = this.#progress;
  }

  get layerNames(): string[] {
    return [...new Set(this.#layers.map((l) => l.name))];
  }

  update(dt: number): void {
    const d = Math.min(0.05, Math.max(0, dt));
    this.#time += d;
    this.#shown += (this.#progress - this.#shown) * Math.min(1, d * 3.2);

    // Completion: charge (gaps stretch), snap (weld into one solid cube),
    // dissipate (drift up and fade). Same three beats as the spell, told in
    // this effect's own vocabulary.
    let burst = 0;
    let fade = 0;
    if (this.#burstT !== null) {
      this.#burstT += d;
      const t = Math.min(1, this.#burstT / this.options.burstDuration);
      if (t < 0.2) {
        const k = t / 0.2;
        burst = k * 0.3;
        this.#weld = -0.35 * k; // gaps stretch open before the slam
        this.#scale = 1;
        this.#lift = 0;
      } else if (t < 0.36) {
        const k = (t - 0.2) / 0.16;
        burst = 0.3 + k * 0.7;
        this.#weld = -0.35 + 1.35 * k; // slam shut past rest into solid
        this.#scale = 1 + k * 0.04;
        this.#lift = 0.01 * k;
      } else {
        const k = (t - 0.36) / 0.64;
        burst = (1 - k) * (1 - k);
        this.#weld = 1;
        this.#scale = 1.04 + k * 0.12;
        this.#lift = 0.01 + k * 0.1;
        // Ease-out, fully transparent by 80% of the beat: the group is hidden
        // over slack where there is already nothing to see (the spell's
        // hard-cut lesson, applied from day one here).
        const f = Math.min(1, k / 0.8);
        fade = 1 - (1 - f) * (1 - f);
      }
      if (t >= 1 && !this.#done) {
        this.#done = true;
        this.group.visible = false;
        this.#onComplete?.();
      }
    }

    for (const layer of this.#layers) {
      const u = layer.material.uniforms;
      if (u.uTime) u.uTime.value = this.#time;
      if (u.uProgress) u.uProgress.value = this.#progress;
      if (u.uFront) u.uFront.value = this.#shown;
      if (u.uBurst) u.uBurst.value = burst;
      if (u.uFade) u.uFade.value = fade;
    }

    // The cube is the readout: completed segments hold, the active one
    // charges, and the charge value doubles as the pulse phase.
    const levels = segmentLevels(this.#shown);
    for (let i = 0; i < this.#cubelets.length; i++) {
      const lvl = levels[i]!;
      const seg = this.#cubelets[i]!;
      for (const m of seg.materials) {
        m.uniforms.uLit!.value = lvl;
      }
      // Weld: one multiplier covers both completion moves. Negative weld
      // stretches the gaps open (1 - w > 1), positive closes the cubelets
      // toward a single solid cube (w = 1 -> all offsets zero).
      seg.holder.position.copy(seg.rest).multiplyScalar(1 - this.#weld);
    }

    // Steady yaw with a hint of precession; hard-accelerates on the snap.
    const spin = this.options.rotationSpeed * (0.28 + this.#shown * 0.25 + burst * 3.0);
    this.#cube.rotation.y += d * spin;
    this.#cube.rotation.x = 0.26 + Math.sin(this.#time * 0.4) * 0.03;
    this.#cube.position.y = this.options.height * 0.52 + Math.sin(this.#time * 0.8) * 0.02;

    this.#root.scale.setScalar(this.#scale);
    this.#root.position.y = this.#lift * this.options.height;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
    for (const d of this.#disposables) d.dispose();
    this.group.clear();
  }

  // --------------------------------------------------------------- private

  #register(mesh: THREE.Object3D, material: THREE.ShaderMaterial, name: string): void {
    this.#layers.push({ name, mesh, material });
  }

  #uniforms(extra: Record<string, THREE.IUniform> = {}): Record<string, THREE.IUniform> {
    const o = this.options;
    return {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uFront: { value: 0 },
      uBurst: { value: 0 },
      uFade: { value: 0 },
      uColor: { value: new THREE.Color(o.color) },
      uColor2: { value: new THREE.Color(o.secondaryColor) },
      uCore: { value: new THREE.Color(o.coreColor) },
      uIntensity: { value: o.energyIntensity },
      ...extra,
    };
  }

  #additive(params: THREE.ShaderMaterialParameters): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      ...params,
    });
  }

  /** The vitrine: streaked glass wall with hot rims top and bottom. */
  #buildCylinder(radius: number, height: number): void {
    const geo = new THREE.CylinderGeometry(radius, radius, height, 96, 1, true);
    geo.translate(0, height / 2, 0);
    const mat = this.#additive({
      uniforms: this.#uniforms({ uStreaks: { value: 110.0 } }),
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vNormalW; varying vec3 vViewW;
        void main() {
          vUv = uv;
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vViewW = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        ${NOISE}
        ${FRONT}
        uniform float uTime; uniform float uStreaks;
        uniform vec3 uColor; uniform vec3 uCore; uniform float uIntensity;
        varying vec2 vUv; varying vec3 vNormalW; varying vec3 vViewW;
        void main() {
          // Vertical wall streaks: per-line brightness, slow downward crawl.
          float line = vUv.x * uStreaks;
          float id = floor(line);
          float w = 1.0 - abs(fract(line) - 0.5) * 2.0;
          float streak = spow(w, 6.0);
          float bright = 0.25 + 0.75 * spow(0.5 + 0.5 * vnoise(vec3(id * 0.37, 0.0, 0.0)), 2.0);
          float crawl = 0.75 + 0.25 * sin(uTime * 1.2 + id * 1.7 - vUv.y * 9.0);

          // Glass reads at grazing angles: edges of the silhouette glow.
          float fres = spow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewW))), 1.8);

          // Hot rims top and bottom, the vitrine's signature.
          float rim = band(vUv.y, 1.0, 0.035) * 1.7 + band(vUv.y, 0.0, 0.03) * 1.4;

          float e = (streak * bright * crawl * (0.4 + fres * 0.45) + fres * 0.06 + rim)
                  * uIntensity * (0.75 + uFront * 0.35 + uBurst * 0.8);
          vec3 col = mix(uColor, uCore, min(1.0, rim + fres * 0.3));
          gl_FragColor = emit(col, e, 0.55);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    this.#root.add(mesh);
    this.#register(mesh, mat, "cylinder");
  }

  /** Falling light inside the glass: instanced streak quads, GPU-animated. */
  #buildRain(radius: number, height: number): void {
    const n = this.options.rainCount;
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position!;
    geo.attributes.uv = quad.attributes.uv!;
    const seeds = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const r = Math.sqrt(Math.random()) * radius * 0.95;
      const a = Math.random() * Math.PI * 2;
      seeds[i * 4] = Math.cos(a) * r;
      seeds[i * 4 + 1] = Math.sin(a) * r;
      seeds[i * 4 + 2] = 0.45 + Math.random() * 0.85; // fall speed
      seeds[i * 4 + 3] = Math.random();               // phase + brightness seed
    }
    geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = n;

    const mat = this.#additive({
      uniforms: this.#uniforms({ uHeight: { value: height }, uLen: { value: height * 0.16 } }),
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime; uniform float uHeight; uniform float uLen;
        varying vec2 vUv; varying float vSeed;
        void main() {
          vUv = uv;
          vSeed = aSeed.w;
          float fall = fract(aSeed.w + uTime * aSeed.z * 0.22);
          float y = uHeight * (1.0 - fall);
          vec3 c = vec3(aSeed.x, y, aSeed.y);
          // Y-billboard the streak so it always reads as a vertical line.
          vec3 toCam = vec3(cameraPosition.x - c.x, 0.0, cameraPosition.z - c.z);
          vec3 right = dot(toCam, toCam) < 1e-8 ? vec3(1.0, 0.0, 0.0)
            : normalize(cross(vec3(0.0, 1.0, 0.0), normalize(toCam)));
          float w = 0.006 + aSeed.w * 0.006;
          vec3 wp = c + right * position.x * w + vec3(0.0, 1.0, 0.0) * position.y * uLen * (0.5 + aSeed.w);
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${NOISE}
        ${FRONT}
        uniform vec3 uColor; uniform vec3 uCore; uniform float uIntensity;
        varying vec2 vUv; varying float vSeed;
        void main() {
          // Bright head at the bottom of the streak, tail fading up.
          float head = spow(1.0 - vUv.y, 3.0) * 1.6;
          float body = spow(vUv.y, 0.6) * 0.25;
          float side = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float e = (head + body) * spow(side, 1.6)
                  * (0.4 + vSeed * 0.8)
                  * uIntensity * (0.5 + uFront * 0.6 + uBurst * 0.9);
          if (e < 0.003) discard;
          vec3 col = mix(uColor, uCore, min(1.0, head * 0.5));
          gl_FragColor = emit(col, e, 0.7);
        }
      `,
    });
    mat.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    this.#root.add(mesh);
    this.#register(mesh, mat, "rain");
  }

  /** Concentric tech rings on the floor of the vitrine. */
  #buildFloor(radius: number): void {
    const geo = new THREE.PlaneGeometry(radius * 2.1, radius * 2.1);
    geo.rotateX(-Math.PI / 2);
    const mat = this.#additive({
      uniforms: this.#uniforms(),
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        ${NOISE}
        ${FRONT}
        uniform float uTime; uniform vec3 uColor; uniform vec3 uCore; uniform float uIntensity;
        varying vec2 vUv;
        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          float r = length(p);
          if (r > 1.0) discard;
          // Three engraved rings plus a live scanner ring sweeping outward.
          float rings = band(r, 0.92, 0.012) + band(r, 0.62, 0.008) * 0.6 + band(r, 0.34, 0.007) * 0.45;
          float ticks = step(0.9, fract(atan(p.y, p.x) * 9.549)) * band(r, 0.78, 0.02) * 0.5;
          float sweep = band(r, fract(uTime * 0.22), 0.02) * 0.8 * (0.3 + uFront);
          float e = (rings + ticks + sweep) * uIntensity * (0.8 + uBurst * 1.4);
          vec3 col = mix(uColor, uCore, min(1.0, rings));
          gl_FragColor = emit(col, e, 0.75);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.004;
    this.#root.add(mesh);
    this.#register(mesh, mat, "floor");
  }

  /** The readout: eight wireframe cubelets that light up in FILL_ORDER. */
  #buildCube(radius: number, height: number): void {
    const cubeSize = radius * 0.92;
    const seg = cubeSize * 0.38;   // cubelet edge length
    const gap = cubeSize * 0.22;   // resting gap: the segmentation must READ
    const strut = seg * 0.055;     // edge tube thickness

    // One merged edge-frame geometry, shared by all eight cubelets.
    const parts: THREE.BoxGeometry[] = [];
    const h = seg / 2;
    for (const axis of [0, 1, 2]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const dims: [number, number, number] = [strut, strut, strut];
          dims[axis] = seg + strut;
          const g = new THREE.BoxGeometry(...dims);
          const off = [0, 0, 0] as [number, number, number];
          const others = [0, 1, 2].filter((a) => a !== axis) as [number, number];
          off[others[0]] = sy * h;
          off[others[1]] = sz * h;
          g.translate(...off);
          parts.push(g);
        }
      }
    }
    const frame = mergeGeometries(parts);
    parts.forEach((g) => g.dispose());
    this.#disposables.push(frame);

    const glowQuad = new THREE.PlaneGeometry(seg * 1.25, seg * 1.25);
    this.#disposables.push(glowQuad);

    const frameShader = {
      vertexShader: /* glsl */ `
        varying vec3 vLocal;
        void main() {
          vLocal = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${NOISE}
        ${FRONT}
        uniform float uTime; uniform float uLit; uniform float uSeed;
        uniform vec3 uColor; uniform vec3 uColor2; uniform vec3 uCore; uniform float uIntensity;
        varying vec3 vLocal;
        void main() {
          // Completed segments hold steady; the active one pulses with its
          // own charge; untouched ones idle as faint ghost frames.
          float charging = step(0.001, uLit) * step(uLit, 0.999);
          float pulse = 0.55 + 0.45 * sin(uTime * 9.0 + uSeed * 7.0);
          float level = uLit >= 0.999 ? 1.0 : uLit * (0.35 + 0.65 * pulse) * charging;
          float e = (0.2 + level * 0.85 + uBurst * 1.2) * uIntensity;
          // A slow shimmer running along the frame keeps even idle segments alive.
          e *= 0.85 + 0.15 * sin(uTime * 2.0 + (vLocal.x + vLocal.y + vLocal.z) * 14.0 + uSeed * 6.0);
          vec3 col = mix(uColor2, uColor, 0.3 + level * 0.7);
          col = mix(col, uCore, min(1.0, level * 0.5 + uBurst * 0.6));
          gl_FragColor = emit(col, e, 0.9);
        }
      `,
    };
    const glowShader = {
      vertexShader: BILLBOARD_Y_VS,
      fragmentShader: /* glsl */ `
        ${NOISE}
        ${FRONT}
        uniform float uLit; uniform float uSeed; uniform float uTime;
        uniform vec3 uColor; uniform vec3 uCore; uniform float uIntensity;
        varying vec2 vUv;
        void main() {
          float d = length((vUv - 0.5) * 2.0);
          float lit = uLit >= 0.999 ? 1.0 : uLit * 0.5;
          float e = exp(-d * 4.5) * lit * (0.2 + uBurst * 1.2) * uIntensity;
          if (e < 0.004) discard;
          gl_FragColor = emit(mix(uColor, uCore, 0.5), e, 0.5);
        }
      `,
    };

    for (let i = 0; i < SEGMENTS; i++) {
      const [gx, gy, gz] = FILL_ORDER[i]!;
      const offset = (v: number) => (v - 0.5) * (seg + gap);
      const holder = new THREE.Group();
      const rest = new THREE.Vector3(offset(gx), offset(gy), offset(gz));
      holder.position.copy(rest);

      const fm = this.#additive({
        uniforms: this.#uniforms({ uLit: { value: 0 }, uSeed: { value: i / SEGMENTS } }),
        ...frameShader,
      });
      const frameMesh = new THREE.Mesh(frame, fm);
      holder.add(frameMesh);
      this.#register(frameMesh, fm, "cube");

      const gm = this.#additive({
        uniforms: this.#uniforms({ uLit: { value: 0 }, uSeed: { value: i / SEGMENTS } }),
        ...glowShader,
      });
      const glowMesh = new THREE.Mesh(glowQuad, gm);
      holder.add(glowMesh);
      this.#register(glowMesh, gm, "glow");

      this.#cubelets.push({ holder, rest, materials: [fm, gm] });
      this.#cube.add(holder);
    }

    this.#cube.position.y = height * 0.52;
    this.#cube.rotation.x = 0.26;
    this.#root.add(this.#cube);
  }
}

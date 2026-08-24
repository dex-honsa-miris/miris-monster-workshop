// SpellLoader: a procedural containment-circle loading VFX.
//
// Everything is shader work over cheap geometry: five open cylinders (rune
// bands), one cylinder (core beam), two ribbons (helices), two planes
// (sigils), instanced points (embers, dust) and a handful of billboards
// (smoke). No effect textures ship with it -- the glyph strip and sigil are
// drawn to a canvas at construction, so the whole thing is self-contained and
// can be tinted to any colour.
//
// The unifying idea is a single ACTIVATION FRONT: a normalised height that
// every layer reads. Below it the spell is awake (bright, fast, dense); at it
// there is a hot line; above it the structure is dim and slow. Progress moves
// that front, so the effect reads as energy CLIMBING rather than as opacity
// being turned up.
import * as THREE from "three";
import { FRONT, NOISE } from "./glsl";
import { makeRuneStrip, makeSigil } from "./runes";

export interface SpellLoaderOptions {
  radius?: number;
  height?: number;
  color?: THREE.ColorRepresentation;
  secondaryColor?: THREE.ColorRepresentation;
  coreColor?: THREE.ColorRepresentation;
  bandCount?: number;
  particleCount?: number;
  dustCount?: number;
  energyIntensity?: number;
  rotationSpeed?: number;
  noiseScale?: number;
  noiseSpeed?: number;
  /** Seconds the completion sequence runs for. */
  burstDuration?: number;
}

interface Layer {
  name: string;
  mesh: THREE.Object3D;
  material: THREE.ShaderMaterial;
}

/** Billboards a quad about Y only: beams and plumes should turn with the
 * camera but never tip over, so the world up axis stays fixed. */
const BILLBOARD_Y_VS = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 toCam = vec3(cameraPosition.x - c.x, 0.0, cameraPosition.z - c.z);
    // Degenerate only if the camera sits exactly on the axis; normalize(0) is NaN.
    vec3 right = dot(toCam, toCam) < 1e-8
      ? vec3(1.0, 0.0, 0.0)
      : normalize(cross(vec3(0.0, 1.0, 0.0), normalize(toCam)));
    vec3 wp = c + right * position.x + vec3(0.0, 1.0, 0.0) * position.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

/** Fraction of the completion beat by which the shell is fully transparent.
 * The remainder is deliberate slack: the group is hidden and the host's
 * composer torn down while there is already nothing to see. */
const FADE_DONE = 0.86;

const DEFAULTS = {
  radius: 1,
  height: 2.2,
  color: 0x38c9ff,
  secondaryColor: 0x0a4cc8,
  coreColor: 0xffffff,
  bandCount: 6,
  particleCount: 90,
  dustCount: 200,
  energyIntensity: 1,
  rotationSpeed: 1,
  noiseScale: 1,
  noiseSpeed: 1,
  burstDuration: 1.5,
} satisfies Required<SpellLoaderOptions>;

export class SpellLoader {
  /** Public handle. The host owns its transform; the effect never writes to
   * it. */
  readonly group = new THREE.Group();
  /** Everything the effect draws hangs here, so the completion sequence can
   * scale and lift the whole thing without stamping on the placement the
   * caller gave `group`. */
  readonly #root = new THREE.Group();
  readonly options: Required<SpellLoaderOptions>;

  /** 0..1 target set by the host. */
  #progress = 0;
  /** Eased follower, so a jumpy progress value still animates smoothly. */
  #front = 0;
  #time = 0;
  /** null until progress hits 1; then counts up through the completion beat. */
  #burstT: number | null = null;
  #done = false;
  /** Driven only by the completion sequence; 1 at rest. */
  #scale = 1;
  #lift = 0;
  #onComplete: (() => void) | null = null;

  readonly #layers: Layer[] = [];
  readonly #disposables: Array<{ dispose(): void }> = [];
  #bands: THREE.Mesh[] = [];
  #bandSpin: number[] = [];

  constructor(opts: SpellLoaderOptions = {}) {
    this.options = { ...DEFAULTS, ...opts };
    const { radius, height } = this.options;

    const runeTex = makeRuneStrip(7, 30);
    const sigilTex = makeSigil();
    this.#disposables.push(runeTex, sigilTex);

    this.#buildCore(radius, height);
    this.#buildBands(radius, height, runeTex);
    this.#buildStrands(radius, height);
    this.#buildHelices(radius, height);
    this.#buildSigil(radius, sigilTex, 0.002, 1);
    this.#buildSigil(radius * 0.42, sigilTex, height * 0.52, 0.75, true);
    this.#buildEmbers(radius, height);
    this.#buildDust(radius, height);
    this.#buildSmoke(radius, height);

    this.group.add(this.#root);
    this.group.renderOrder = 10;
  }

  // ---------------------------------------------------------------- public

  /** Loading progress, 0..1. Clamped; reaching 1 arms the completion beat. */
  setProgress(p: number): void {
    const next = Math.max(0, Math.min(1, p));
    this.#progress = next;
    if (next >= 1 && this.#burstT === null) this.#burstT = 0;
  }

  get progress(): number {
    return this.#progress;
  }

  /** Fires once the completion sequence has fully dissipated. */
  onComplete(fn: () => void): void {
    this.#onComplete = fn;
  }

  /** True once the shell has dissipated and the object should be visible. */
  get complete(): boolean {
    return this.#done;
  }

  /** Normalised progress through the completion beat, or null before it is
   * armed. Hosts use this to hand off to whatever the spell was summoning. */
  get burst(): number | null {
    return this.#burstT === null ? null : Math.min(1, this.#burstT / this.options.burstDuration);
  }

  /** Debug: show only the named layers (comma separated), hide the rest. */
  solo(names: string): void {
    const keep = new Set(names.split(",").map((s) => s.trim()));
    for (const l of this.#layers) l.mesh.visible = keep.has(l.name);
  }

  /** Debug: advance the internal clock without waiting in real time. */
  seek(t: number): void {
    this.#time = t;
    this.#front = this.#progress;
  }

  /** Layer names, for the screenshot harness. */
  get layerNames(): string[] {
    return this.#layers.map((l) => l.name);
  }

  update(dt: number): void {
    const d = Math.min(0.05, Math.max(0, dt));
    this.#time += d;

    // The front chases progress with a spring-ish ease and overshoots very
    // slightly, which reads as energy surging up rather than sliding.
    const target = this.#progress;
    this.#front += (target - this.#front) * Math.min(1, d * 3.2);

    // The completion beat, in three moves. Multiplying every layer's
    // brightness (the obvious approach) just white-outs the frame, so the
    // energy is spent on motion instead: the cage sucks inward, snaps open,
    // and dissolves upward.
    let burst = 0;
    let fade = 0;
    if (this.#burstT !== null) {
      this.#burstT += d;
      const t = Math.min(1, this.#burstT / this.options.burstDuration);
      if (t < 0.20) {
        // Charge: draw inward and dim a touch, so the release has somewhere
        // to come from.
        const k = t / 0.20;
        burst = k * 0.3;
        this.#scale = 1 - k * 0.055;
        this.#lift = 0;
      } else if (t < 0.36) {
        // Snap: the flash, and the cage springs just past its rest size.
        const k = (t - 0.20) / 0.16;
        burst = 0.3 + k * 0.7;
        this.#scale = 0.945 + k * 0.125;
        this.#lift = k * 0.02;
      } else {
        // Dissipate: widen gently, drift upward, fade out.
        const k = (t - 0.36) / 0.64;
        burst = (1 - k) * (1 - k);
        this.#scale = 1.07 + k * 0.16;
        this.#lift = 0.02 + k * 0.10;
        // Fully gone by FADE_DONE, with an ease-OUT so the last of it drifts
        // to nothing instead of accelerating into the cut. The old ease-in
        // curve only reached zero at the very end of the beat, so the frame
        // that hid the group still had something visible on it -- which read
        // as a jump. Everything after FADE_DONE is a black effect being
        // switched off, which nobody can see.
        const f = Math.min(1, (t - 0.36) / (FADE_DONE - 0.36));
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
      if (u.uFront) u.uFront.value = this.#front;
      if (u.uBurst) u.uBurst.value = burst;
      if (u.uFade) u.uFade.value = fade;
    }

    // Bands spin faster as the spell wakes up, and hard-accelerate on burst.
    const speed = this.options.rotationSpeed * (0.35 + this.#front * 1.1 + burst * 4.5);
    for (let i = 0; i < this.#bands.length; i++) {
      this.#bands[i]!.rotation.y += d * this.#bandSpin[i]! * speed;
    }
    this.#root.scale.setScalar(this.#scale);
    this.#root.position.y = this.#lift * this.options.height;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = (m as THREE.Mesh).material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) (mat as THREE.Material).dispose();
    });
    for (const d of this.#disposables) d.dispose();
    this.group.clear();
  }

  // --------------------------------------------------------------- private

  #register(mesh: THREE.Object3D, material: THREE.ShaderMaterial, name: string): void {
    this.#layers.push({ name, mesh, material });
    this.#root.add(mesh);
  }

  #uniforms(extra: Record<string, THREE.IUniform> = {}): Record<string, THREE.IUniform> {
    const o = this.options;
    return {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uFront: { value: 0 },
      uBurst: { value: 0 },
      uColor: { value: new THREE.Color(o.color) },
      uColor2: { value: new THREE.Color(o.secondaryColor) },
      uCore: { value: new THREE.Color(o.coreColor) },
      uFade: { value: 0 },
      uIntensity: { value: o.energyIntensity },
      uNoiseScale: { value: o.noiseScale },
      uNoiseSpeed: { value: o.noiseSpeed },
      ...extra,
    };
  }

  #additive(params: THREE.ShaderMaterialParameters): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false, // these are emissive VFX; tone mapping mutes the core
      ...params,
    });
  }

  /** The white-hot vertical spine.
   *
   * A Y-billboarded quad, not a cylinder: the reference core is a hairline
   * with a wide soft halo, and a tube can only ever be as thin as its own
   * silhouette. On a quad the width is a falloff curve instead of geometry,
   * so the lit centre can sit under a pixel while the glow spreads across a
   * third of the radius -- which is what makes it read as light rather than
   * as a white bar.
   */
  #buildCore(radius: number, height: number): void {
    const geo = new THREE.PlaneGeometry(radius * 1.6, height * 1.34);
    geo.translate(0, height * 0.5, 0);
    const mat = this.#additive({
      uniforms: this.#uniforms(),
      vertexShader: BILLBOARD_Y_VS,
      fragmentShader: /* glsl */ `
        ${NOISE}
        ${FRONT}
        uniform float uTime; uniform vec3 uColor; uniform vec3 uCore;
        uniform float uIntensity; uniform float uNoiseScale; uniform float uNoiseSpeed;
        varying vec2 vUv;
        void main() {
          float x = (vUv.x - 0.5) * 2.0;
          float ax = abs(x);
          // The quad overshoots the cage at both ends so the beam can spill
          // past it; remap to cage height so the front still lines up.
          float h = (vUv.y - 0.127) / 0.746;
          float edge;
          float act = activation(clamp(h, 0.0, 1.0), edge);

          // Sub-pixel filament plus two progressively wider haloes. Summing
          // exponentials rather than taking one pow is what gives the beam a
          // hot white centre that grades out through cyan.
          float line = exp(-ax * 110.0);
          float halo = exp(-ax * 13.0) * 0.30 + exp(-ax * 3.4) * 0.10;

          // A fast shimmer over a slow swell, so it never reads as a metronome.
          float flick = 0.78 + 0.22 * fbm(vec3(1.7, h * 6.0 * uNoiseScale, uTime * 2.6 * uNoiseSpeed))
                             + 0.10 * sin(uTime * 1.3 + h * 3.0);

          // Hot where the beam strikes the sigil, tapering as it climbs, with
          // a second knot riding the activation front.
          // The strike point where the beam meets the sigil, and a matching
          // spike that carries on below it.
          float foot = exp(-abs(h) * 13.0) * 2.3;
          float spike = exp(-max(-h, 0.0) * 9.0) * step(h, 0.0);
          // Frays out above the top hoop rather than stopping dead.
          float taper = (1.0 - smoothstep(0.68, 1.20, h)) * (0.35 + 0.65 * spike + step(0.0, h) * 0.65);

          // A horizontal flare across the strike point: light hitting a
          // surface, and the one place the effect is allowed to blow out.
          float flare = exp(-abs(h) * 52.0) * exp(-ax * 5.0) * 0.95;

          float e = (line * (1.15 + foot + edge * 1.3) + halo * (0.85 + foot * 0.5) + flare)
                  * taper * act * flick * uIntensity * (1.0 + uBurst * 0.9);

          // White only at the very centre and the hot spots; everything else
          // grades to cyan, which is what keeps the effect from going milky.
          float white = clamp(line * 1.5 + foot * 0.5 + flare * 0.8 + uBurst, 0.0, 1.0);
          if (e < 0.002) discard;
          gl_FragColor = emit(mix(uColor, uCore, white), e, 0.9);
        }
      `,
    });
    this.#register(new THREE.Mesh(geo, mat), mat, "core");
  }

  /** Glyph bands: the silhouette. Alternating spin directions, per-band phase. */
  #buildBands(radius: number, height: number, tex: THREE.Texture): void {
    const n = this.options.bandCount;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const y = height * (0.06 + t * 0.88);
      const bandH = height * 0.095;
      const r = radius * (1.055 + Math.sin(t * Math.PI) * 0.03);
      const geo = new THREE.CylinderGeometry(r, r, bandH, 96, 1, true);
      const mat = this.#additive({
        uniforms: this.#uniforms({
          uMap: { value: tex },
          uBandH: { value: t },
          // One pass of the strip per revolution: the glyphs have to be big
          // enough to read as writing, which is the whole point of them.
          uRepeat: { value: 1.0 },
        }),
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vNormalW;
          varying vec3 vViewW;
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
          uniform float uTime; uniform sampler2D uMap; uniform float uBandH; uniform float uRepeat;
          uniform vec3 uColor; uniform vec3 uColor2; uniform vec3 uCore;
          uniform float uIntensity; uniform float uNoiseSpeed;
          varying vec2 vUv; varying vec3 vNormalW; varying vec3 vViewW;
          void main() {
            float edge;
            float act = activation(uBandH, edge);

            // Glyphs scroll slightly against the band's own rotation so the
            // ring never looks like a rigidly spinning decal.
            vec2 uv = vec2(vUv.x * uRepeat + uTime * 0.02 * uNoiseSpeed, vUv.y);
            float glyph = texture2D(uMap, uv).r;

            // Rim rules at the top and bottom of each band.
            float rule = smoothstep(0.93, 1.0, vUv.y) + smoothstep(0.07, 0.0, vUv.y);

            // Edge-on brightening: the band glows where it turns away, which
            // is what sells these as rings of light rather than tubes.
            float fres = spow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewW))), 1.6);

            // A glyph reveal sweep: letters light up as the front passes.
            float reveal = smoothstep(uBandH - 0.12, uBandH + 0.02, uFront);
            // Unlit glyphs sit at 0.34 rather than near zero: the ring above
            // the front should read as inscribed-but-cold, not as blank metal.
            float lit = 0.34 + 0.66 * reveal;

            float e = (glyph * 1.55 * lit + rule * 1.05 + fres * 0.5) * act;
            e *= uIntensity * (1.0 + uBurst * 0.3);
            // Mostly cyan with only a hint of the deep blue: weighting this
            // the other way is what made the whole cage read as navy.
            vec3 col = mix(uColor2, uColor, 0.78 + fres * 0.22);
            col = mix(col, uCore, min(1.0, rule * 0.22 + edge * 0.35 + uBurst * 0.3));
            gl_FragColor = emit(col, e, 0.85);
          }
        `,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.y = i * 1.1;
      // Each band hangs in a slightly tilted frame, so the stack reads as a
      // gyroscope rather than a stack of coasters -- and because the band
      // spins about its own (tilted) axis, the tilt also gives the rotation a
      // subtle wobble for free.
      const frame = new THREE.Group();
      frame.position.y = y;
      frame.rotation.set(Math.sin(i * 2.3) * 0.055, 0, Math.cos(i * 1.7) * 0.055);
      frame.add(mesh);
      this.#root.add(frame);
      this.#bands.push(mesh);
      // Alternate direction, slower for wider bands: layered motion.
      this.#bandSpin.push((i % 2 === 0 ? 1 : -1) * (0.22 + (i % 3) * 0.07));
      this.#layers.push({ name: "bands", mesh, material: mat });
    }
  }

  /** Vertical containment strands: the faint cage between the bands. */
  #buildStrands(radius: number, height: number): void {
    const geo = new THREE.CylinderGeometry(radius * 0.93, radius * 0.93, height, 256, 1, true);
    const mat = this.#additive({
      uniforms: this.#uniforms({ uCount: { value: 24.0 } }),
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
        uniform float uTime; uniform float uCount; uniform vec3 uColor; uniform vec3 uCore;
        uniform float uIntensity; uniform float uNoiseSpeed;
        varying vec2 vUv; varying vec3 vNormalW; varying vec3 vViewW;
        void main() {
          float edge;
          float act = activation(vUv.y, edge);
          // Thin bright lines around the circumference. The width is derived
          // from fwidth so a strand never gets narrower than the pixel it
          // lands on -- a fixed exponent turns this layer into crawling
          // static the moment the cage rotates.
          float u = vUv.x * uCount;
          float d = 1.0 - abs(fract(u) - 0.5) * 2.0;
          float w = clamp(fwidth(u) * 3.0, 0.05, 0.9);
          float strand = smoothstep(1.0 - w, 1.0, d);
          // Energy runs up each strand at slightly different rates.
          float run = fract(vUv.y * 1.4 - uTime * 0.55 * uNoiseSpeed + vnoise(vec3(vUv.x * uCount, 0.0, 0.0)));
          float pulse = spow(run, 6.0) * 1.4;
          float fres = spow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewW))), 2.2);
          float e = strand * (0.30 + pulse * 0.8 + fres * 0.7) * act * uIntensity * 1.15 * (1.0 + uBurst * 0.3);
          vec3 col = mix(uColor, uCore, min(1.0, pulse * 0.25 + edge * 0.8));
          gl_FragColor = emit(col, e, 0.6);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = height * 0.5;
    this.#register(mesh, mat, "strands");
  }

  /** Orbital ribbons: thin loops that swing OUTSIDE the cage, each carrying a
   * comet head.
   *
   * These are what break the cage's silhouette -- without something crossing
   * outside the rings, the effect reads as a closed cylinder rather than as
   * something with energy escaping it. The tube is deliberately hair-thin;
   * brightness comes from bloom, not from surface area.
   */
  #buildHelices(radius: number, height: number): void {
    const orbits = [
      { y: 0.30, tilt: 0.22, r: 1.30, dir: 1, speed: 0.20, wave: 0.10 },
      { y: 0.56, tilt: -0.15, r: 1.16, dir: -1, speed: 0.26, wave: 0.07 },
      { y: 0.78, tilt: 0.30, r: 1.34, dir: 1, speed: 0.16, wave: 0.12 },
    ];
    for (const o of orbits) {
      const pts: THREE.Vector3[] = [];
      const steps = 200;
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        const a = t * Math.PI * 2;
        // A circle that rides up and down as it goes round, then tilted:
        // two cheap deformations that stop it reading as a flat hoop.
        pts.push(new THREE.Vector3(
          Math.cos(a) * radius * o.r,
          height * o.y + Math.sin(a * 2 + o.tilt * 8) * height * o.wave,
          Math.sin(a) * radius * o.r,
        ));
      }
      const curve = new THREE.CatmullRomCurve3(pts, true);
      const geo = new THREE.TubeGeometry(curve, 320, radius * 0.011, 6, true);
      const mat = this.#additive({
        uniforms: this.#uniforms({
          uDir: { value: o.dir },
          uSpeed: { value: o.speed },
          uAt: { value: o.y },
        }),
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          ${NOISE}
          ${FRONT}
          uniform float uTime; uniform float uDir; uniform float uSpeed; uniform float uAt;
          uniform vec3 uColor; uniform vec3 uColor2; uniform vec3 uCore;
          uniform float uIntensity; uniform float uNoiseSpeed;
          varying vec2 vUv;
          void main() {
            float edge;
            float act = activation(uAt, edge);

            // Position along the closed loop, and the head's position on it.
            float u = vUv.x;
            float head = fract(uTime * uSpeed * uDir * uNoiseSpeed);
            // Signed distance behind the head, wrapped: the tail only trails.
            float behind = fract((head - u) * uDir * uDir);
            float d = min(behind, 1.0 - behind);

            float spark = exp(-d * 90.0) * 2.6;         // the head itself
            float tail = exp(-behind * 7.0) * 0.55;     // what it drags
            float path = 0.045;                          // the loop, faintly lit

            float e = (spark + tail + path) * act * uIntensity * 1.6 * (1.0 + uBurst * 0.5);
            vec3 col = mix(uColor2, uColor, 0.55 + tail * 0.5);
            col = mix(col, uCore, clamp(spark * 0.45 + uBurst * 0.6, 0.0, 1.0));
            if (e < 0.004) discard;
            gl_FragColor = emit(col, e, 0.7);
          }
        `,
      });
      this.#register(new THREE.Mesh(geo, mat), mat, "helices");
    }
  }

  /** Flat sigil discs: the floor circle and the mid-height rosette. */
  #buildSigil(radius: number, tex: THREE.Texture, y: number, scale: number, spinFast = false): void {
    const geo = new THREE.PlaneGeometry(radius * 2.25, radius * 2.25);
    geo.rotateX(-Math.PI / 2);
    const mat = this.#additive({
      uniforms: this.#uniforms({
        uMap: { value: tex },
        uAt: { value: y / Math.max(0.0001, this.options.height) },
        uSpin: { value: spinFast ? 0.5 : -0.12 },
        uScale: { value: scale },
      }),
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        ${NOISE}
        ${FRONT}
        uniform float uTime; uniform sampler2D uMap; uniform float uAt; uniform float uSpin;
        uniform vec3 uColor; uniform vec3 uCore; uniform float uIntensity;
        varying vec2 vUv;
        void main() {
          // Rotate UVs about the centre so the sigil turns without moving geometry.
          vec2 p = vUv - 0.5;
          float a = uTime * uSpin;
          p = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;
          float m = texture2D(uMap, p + 0.5).r;
          float r = length(p) * 2.0;
          float edge;
          float act = activation(uAt, edge);
          // Rings sweep outward when the spell is working.
          float sweep = 0.55 + 0.45 * sin((r * 6.0 - uTime * 1.6) * 3.14159);
          float e = m * (1.35 + sweep * 0.6) * act * uIntensity * (1.0 + uBurst * 0.45);
          e *= smoothstep(1.02, 0.75, r); // fade the plane's square corners
          vec3 col = mix(uColor, uCore, min(1.0, m * 0.18 + edge * 0.5 + uBurst * 0.35));
          gl_FragColor = emit(col, e, 0.8);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = y;
    this.#register(mesh, mat, "sigil");
  }

  /** Orbiting embers with comet tails: instanced, animated entirely on the GPU. */
  #buildEmbers(radius: number, height: number): void {
    const count = this.options.particleCount;
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position!;
    geo.attributes.uv = quad.attributes.uv!;
    quad.dispose();

    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      seeds[i * 4 + 0] = Math.random() * Math.PI * 2;           // phase
      seeds[i * 4 + 1] = 0.55 + Math.random() * 0.75;           // orbit radius factor
      seeds[i * 4 + 2] = Math.random();                          // height seed
      seeds[i * 4 + 3] = 0.4 + Math.random() * 1.3;             // speed
    }
    geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = count;

    const mat = this.#additive({
      depthTest: true,
      uniforms: this.#uniforms({
        uRadius: { value: radius },
        uHeight: { value: height },
        uSize: { value: radius * 0.05 },
      }),
      vertexShader: /* glsl */ `
        ${NOISE}
        uniform float uTime; uniform float uRadius; uniform float uHeight; uniform float uSize;
        uniform float uFront; uniform float uBurst; uniform float uProgress;
        attribute vec4 aSeed;
        varying vec2 vUv; varying float vLife; varying float vHot;
        void main() {
          vUv = uv;
          float spd = aSeed.w * (0.5 + uFront * 1.4 + uBurst * 4.0);
          float a = aSeed.x + uTime * spd * 0.9;
          // Embers climb, loop back to the base, and ride outside the cage.
          float climb = fract(aSeed.z + uTime * 0.16 * spd);
          float h = climb * uHeight;
          // Only embers below the front are awake.
          float awake = step(climb, uFront + 0.06);
          float r = uRadius * aSeed.y * (1.08 + 0.12 * sin(a * 1.7));
          r *= 1.0 - uBurst * 0.35;                 // contract on completion
          vec3 pos = vec3(cos(a) * r, h, sin(a) * r);

          // Billboard the quad, stretched along travel to fake a comet tail.
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float stretch = 1.0 + spd * 2.2 + uBurst * 3.0;
          vec2 q = (uv - 0.5) * uSize;
          vec3 world = pos + right * q.x * stretch + up * q.y;

          vLife = awake * (0.35 + 0.65 * sin(climb * 3.14159));
          vHot = smoothstep(0.7, 1.0, fract(a * 0.5)) + uBurst;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform vec3 uCore; uniform float uIntensity; uniform float uBurst;
        uniform float uFade;
        varying vec2 vUv; varying float vLife; varying float vHot;
        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          // Head-heavy falloff: bright dot with a tail trailing in x.
          float d = length(vec2(p.x * 0.55, p.y));
          float head = pow(max(0.0, 1.0 - d), 3.0);
          float tail = pow(max(0.0, 1.0 - abs(p.y)), 4.0) * pow(max(0.0, 1.0 - abs(p.x)), 1.2) * 0.5;
          float e = (head + tail) * vLife * uIntensity * (1.0 + uBurst * 0.7);
          if (e < 0.003) discard;
          vec3 col = mix(uColor, uCore, min(1.0, head * 0.8 + vHot * 0.4));
          // Embers and dust are the two layers that do not pull in the shared
          // FRONT chunk, so they have to honour the dissolve by hand. Missed
          // once already: they stayed at full brightness through a fade that
          // every other layer respected, and the frame that hid the group had
          // to swallow the whole difference at once.
          e *= 1.0 - uFade;
          gl_FragColor = vec4(col * e, e);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    this.#register(mesh, mat, "embers");
  }

  /** Twinkling dust suspended around the spell. */
  #buildDust(radius: number, height: number): void {
    const count = this.options.dustCount;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = radius * (0.6 + Math.random() * 1.5);
      pos[i * 3 + 0] = Math.cos(a) * r;
      pos[i * 3 + 1] = (Math.random() * 1.35 - 0.1) * height;
      pos[i * 3 + 2] = Math.sin(a) * r;
      seed[i] = Math.random() * 6.28;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    const mat = this.#additive({
      uniforms: this.#uniforms({ uSize: { value: radius * 8 } }),
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uSize; uniform float uFront; uniform float uBurst;
        attribute float aSeed;
        varying float vTwinkle;
        void main() {
          vec3 p = position;
          p.y += sin(uTime * 0.5 + aSeed) * 0.02;
          vTwinkle = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * 2.0 + aSeed * 3.0), 3.0);
          vTwinkle *= 0.25 + uFront * 0.9 + uBurst * 1.5;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = uSize * (1.0 + uBurst) / max(0.001, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform vec3 uCore; uniform float uIntensity; uniform float uFade;
        varying float vTwinkle;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float e = pow(max(0.0, 1.0 - d), 2.5) * vTwinkle * uIntensity * (1.0 - uFade);
          if (e < 0.004) discard;
          gl_FragColor = vec4(mix(uColor, uCore, 0.4) * e, e);
        }
      `,
    });
    this.#register(new THREE.Points(geo, mat), mat, "dust");
  }

  /** The turbulent plume that climbs the inside of the cage.
   *
   * This is the effect's soul: without it the cage is furniture. One
   * Y-billboarded quad with domain-warped fbm -- noise is sampled, then used
   * to displace its own lookup, which is what turns smooth blobs into the
   * curling filaments smoke actually makes. Cheap for how much it buys.
   */
  #buildSmoke(radius: number, height: number): void {
    const geo = new THREE.PlaneGeometry(radius * 2.2, height * 1.22);
    geo.translate(0, height * 0.5, 0);
    const mat = this.#additive({
      uniforms: this.#uniforms({ uHeight: { value: height } }),
      vertexShader: BILLBOARD_Y_VS,
      fragmentShader: /* glsl */ `
        ${NOISE}
        ${FRONT}
        uniform float uTime; uniform vec3 uColor; uniform vec3 uColor2; uniform vec3 uCore;
        uniform float uIntensity; uniform float uNoiseScale; uniform float uNoiseSpeed;
        varying vec2 vUv;
        void main() {
          float x = (vUv.x - 0.5) * 2.0;
          float h = vUv.y;
          float t = uTime * uNoiseSpeed;

          // Shearing x by height turns a straight column into a helix once it
          // billboards, which is how the reference plume reads.
          float swirl = sin(h * 4.1 - t * 1.15) * 0.30 + sin(h * 2.3 - t * 0.62) * 0.16;
          float px = x - swirl * (0.28 + h * 0.55);

          // Domain warp: sample the noise, then offset its own lookup by it.
          vec3 q = vec3(px * 2.3 * uNoiseScale, h * 2.4 - t * 1.05, t * 0.28);
          float w = fbm(q);
          // Two warps, not one: the first bends the column into curls, the
          // second frays those curls into separate filaments. A single octave
          // of warp gives a flame; this gives smoke.
          float n = fbm(q * 2.1 + vec3(w * 1.3, w * 0.8, 0.0));
          n += 0.42 * fbm(q * 5.5 + vec3(n * 1.6, 0.0, w));

          // A column that widens as it rises.
          float width = 0.17 + h * 0.42;
          float column = exp(-(px * px) / (width * width));

          // Thresholding the noise gives filaments instead of fog.
          float wisp = smoothstep(0.10, 0.46, n + 0.18 - h * 0.08);
          float rise = smoothstep(0.02, 0.16, h) * (1.0 - smoothstep(0.78, 1.0, h));

          // The plume only fills up to the front, so it grows with the load.
          float gate = 1.0 - smoothstep(uFront - 0.04, uFront + 0.20, h);

          float e = wisp * column * rise * gate * uIntensity * (1.15 + uBurst * 0.7);
          if (e < 0.003) discard;
          // Deep blue in the thick of it, cyan at the thin edges: one flat
          // tint is what makes procedural smoke look like a decal.
          vec3 col = mix(uColor2, uColor, clamp(wisp * 0.5 + 0.42, 0.0, 1.0));
          gl_FragColor = emit(mix(col, uCore, uBurst * 0.6), e, 0.62);
        }
      `,
    });
    this.#register(new THREE.Mesh(geo, mat), mat, "smoke");
  }
}

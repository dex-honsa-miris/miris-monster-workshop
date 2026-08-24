// Shared GLSL: value noise + fbm + helpers, injected into every spell shader.
// Deliberately cheap (value noise, not simplex) because it runs on full-screen
// sized transparent layers where fill rate matters more than noise fidelity.
export const NOISE = /* glsl */ `
  vec3 hash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
             dot(p, vec3(269.5, 183.3, 246.1)),
             dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453123);
  }

  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    float n000 = dot(hash3(i + vec3(0.0, 0.0, 0.0)) - 0.5, vec3(1.0));
    float n100 = dot(hash3(i + vec3(1.0, 0.0, 0.0)) - 0.5, vec3(1.0));
    float n010 = dot(hash3(i + vec3(0.0, 1.0, 0.0)) - 0.5, vec3(1.0));
    float n110 = dot(hash3(i + vec3(1.0, 1.0, 0.0)) - 0.5, vec3(1.0));
    float n001 = dot(hash3(i + vec3(0.0, 0.0, 1.0)) - 0.5, vec3(1.0));
    float n101 = dot(hash3(i + vec3(1.0, 0.0, 1.0)) - 0.5, vec3(1.0));
    float n011 = dot(hash3(i + vec3(0.0, 1.0, 1.0)) - 0.5, vec3(1.0));
    float n111 = dot(hash3(i + vec3(1.0, 1.0, 1.0)) - 0.5, vec3(1.0));
    return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
               mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
  }

  float fbm(vec3 p) {
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 4; i++) {
      s += a * vnoise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return s;
  }

  // pow() with a negative base is undefined in GLSL and returns NaN on most
  // drivers. Bases here are things like 1.0 - dot(n, v), which interpolation
  // and rounding push a hair past 1.0 -- and a single NaN pixel poisons the
  // bloom mipmap chain, blanking the entire frame. Every exponent in this
  // effect goes through here.
  float spow(float base, float e) { return pow(max(base, 0.0), e); }

  // Soft band around a value: 1 at centre, 0 beyond width.
  float band(float x, float centre, float width) {
    return 1.0 - smoothstep(0.0, width, abs(x - centre));
  }
`;

/** The activation front: shared by every layer so the whole effect fills as
 * one body of energy rather than each piece animating on its own clock. */
export const FRONT = /* glsl */ `
  uniform float uProgress;   // 0..1 loading progress
  uniform float uFront;      // eased fill height in 0..1 (leads uProgress slightly)
  uniform float uBurst;      // 0..1 completion flash envelope
  uniform float uFade;       // 0..1 dissipation, applied to every layer's output

  // Every layer emits through here, so the completion dissolve is one
  // multiply in one place rather than eight chances to forget it.
  vec4 emit(vec3 col, float e, float alpha) {
    float f = 1.0 - uFade;
    return vec4(col * e * f, e * alpha * f);
  }

  // How lit a point at normalised height h is: fully below the front, a hot
  // line at the front itself, dim above.
  float activation(float h, out float edge) {
    edge = band(h, uFront, 0.055);
    float below = 1.0 - smoothstep(uFront - 0.02, uFront + 0.04, h);
    // The 0.11 floor keeps unlit structure faintly visible instead of absent.
    // That distinction carries the whole progress read: you see the entire
    // cage from the start and watch energy climb it, rather than watching
    // pieces pop into existence.
    return clamp(0.15 + below * 0.86 + edge * 0.62, 0.0, 3.0);
  }
`;

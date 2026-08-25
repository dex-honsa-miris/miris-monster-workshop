// Taubin smoothing for generated GLBs, in place.
//
// Meshy reconstructs on a voxel grid, and above ~30k polygons its remesher
// reproduces the grid's stair-steps instead of the creature's skin: verified
// by rendering a generation untextured, where the whole surface shows
// axis-aligned lattice blocks. No workflow setting removes them (ultra mode
// included), but they are pure high-frequency noise, which is exactly what
// Laplacian smoothing kills. Taubin's lambda/mu alternation does it without
// the shrinkage plain Laplacian causes, and the creature's real forms (neck
// folds, muscle shapes) are far lower frequency, so they survive. Measured on
// a 158k-triangle hydra: 12 iterations erase the lattice completely while
// wrinkles and spikes keep their shape.
//
// Positions and normals are overwritten byte for byte, so the GLB needs no
// re-serialization and every other byte (textures, UVs, JSON) is untouched.

interface GltfAccessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  sparse?: unknown;
}
interface GltfDoc {
  accessors?: GltfAccessor[];
  bufferViews?: Array<{ byteOffset?: number; byteLength: number; byteStride?: number }>;
  meshes?: Array<{ primitives: Array<{ attributes: Record<string, number>; indices?: number; mode?: number }> }>;
}

export const SMOOTH_ITERATIONS = 12;
const LAMBDA = 0.5;
const MU = -0.53;

/**
 * Smooths every indexed triangle primitive in the GLB. Returns the SAME
 * buffer, modified in place. Anything unexpected (sparse or strided
 * accessors, missing attributes, malformed container) makes it return the
 * buffer untouched: a blocky monster beats a broken one.
 */
export function smoothGlb(input: ArrayBuffer, iterations = SMOOTH_ITERATIONS): ArrayBuffer {
  try {
    smoothInPlace(input, iterations);
  } catch (e) {
    console.warn("[workshop] mesh smoothing skipped:", e);
  }
  return input;
}

function smoothInPlace(input: ArrayBuffer, iterations: number): void {
  const buf = new DataView(input);
  if (buf.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB");
  const jsonLen = buf.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(input, 20, jsonLen))) as GltfDoc;
  const binStart = 20 + jsonLen + 8;

  const viewOffset = (a: GltfAccessor): number => {
    const bv = gltf.bufferViews![a.bufferView]!;
    if (bv.byteStride !== undefined && bv.byteStride !== 12) throw new Error("strided attribute");
    return binStart + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  };

  for (const mesh of gltf.meshes ?? []) {
    for (const prim of mesh.primitives) {
      if ((prim.mode ?? 4) !== 4 || prim.indices === undefined) continue;
      const pa = gltf.accessors![prim.attributes.POSITION!];
      const na = prim.attributes.NORMAL !== undefined ? gltf.accessors![prim.attributes.NORMAL] : undefined;
      const ia = gltf.accessors![prim.indices];
      if (!pa || !ia || pa.sparse || ia.sparse || (na && na.sparse)) continue;

      const n = pa.count;
      const pos = new Float32Array(input, viewOffset(pa), n * 3);
      const idx =
        ia.componentType === 5125
          ? new Uint32Array(input, viewOffset(ia), ia.count)
          : new Uint16Array(input, viewOffset(ia), ia.count);

      // Weld by position so UV-seam clones move together and seams stay
      // closed; smoothing per-clone would tear the mesh open along charts.
      const weld = new Map<string, number>();
      const group = new Int32Array(n);
      const members: number[][] = [];
      for (let v = 0; v < n; v++) {
        const k = `${Math.round(pos[v * 3]! * 1e5)},${Math.round(pos[v * 3 + 1]! * 1e5)},${Math.round(pos[v * 3 + 2]! * 1e5)}`;
        let g = weld.get(k);
        if (g === undefined) {
          g = members.length;
          weld.set(k, g);
          members.push([]);
        }
        group[v] = g;
        members[g]!.push(v);
      }
      const G = members.length;
      const nbr: Array<Set<number>> = Array.from({ length: G }, () => new Set());
      for (let t = 0; t < idx.length; t += 3) {
        const a = group[idx[t]!]!, b = group[idx[t + 1]!]!, c = group[idx[t + 2]!]!;
        nbr[a]!.add(b); nbr[a]!.add(c);
        nbr[b]!.add(a); nbr[b]!.add(c);
        nbr[c]!.add(a); nbr[c]!.add(b);
      }

      const cur = new Float64Array(G * 3);
      for (let g = 0; g < G; g++) {
        const v = members[g]![0]!;
        cur[g * 3] = pos[v * 3]!;
        cur[g * 3 + 1] = pos[v * 3 + 1]!;
        cur[g * 3 + 2] = pos[v * 3 + 2]!;
      }
      const next = new Float64Array(G * 3);
      const pass = (f: number): void => {
        for (let g = 0; g < G; g++) {
          let sx = 0, sy = 0, sz = 0, k = 0;
          for (const m of nbr[g]!) {
            sx += cur[m * 3]!; sy += cur[m * 3 + 1]!; sz += cur[m * 3 + 2]!;
            k++;
          }
          if (k === 0) {
            next[g * 3] = cur[g * 3]!; next[g * 3 + 1] = cur[g * 3 + 1]!; next[g * 3 + 2] = cur[g * 3 + 2]!;
            continue;
          }
          next[g * 3] = cur[g * 3]! + f * (sx / k - cur[g * 3]!);
          next[g * 3 + 1] = cur[g * 3 + 1]! + f * (sy / k - cur[g * 3 + 1]!);
          next[g * 3 + 2] = cur[g * 3 + 2]! + f * (sz / k - cur[g * 3 + 2]!);
        }
        cur.set(next);
      };
      for (let i = 0; i < iterations; i++) {
        pass(LAMBDA);
        pass(MU);
      }

      for (let g = 0; g < G; g++) {
        for (const v of members[g]!) {
          pos[v * 3] = cur[g * 3]!;
          pos[v * 3 + 1] = cur[g * 3 + 1]!;
          pos[v * 3 + 2] = cur[g * 3 + 2]!;
        }
      }

      // Normals describe the old, stepped surface: recompute from the new
      // one, area-weighted across the welded groups so shading is smooth
      // over UV seams too.
      if (na) {
        const nrm = new Float32Array(input, viewOffset(na), n * 3);
        const gn = new Float64Array(G * 3);
        for (let t = 0; t < idx.length; t += 3) {
          const a = idx[t]! * 3, b = idx[t + 1]! * 3, c = idx[t + 2]! * 3;
          const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
          const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          for (const vi of [idx[t]!, idx[t + 1]!, idx[t + 2]!]) {
            const g = group[vi]!;
            gn[g * 3] = gn[g * 3]! + nx; gn[g * 3 + 1] = gn[g * 3 + 1]! + ny; gn[g * 3 + 2] = gn[g * 3 + 2]! + nz;
          }
        }
        for (let v = 0; v < n; v++) {
          const g = group[v]!;
          const l = Math.hypot(gn[g * 3]!, gn[g * 3 + 1]!, gn[g * 3 + 2]!) || 1;
          nrm[v * 3] = gn[g * 3]! / l;
          nrm[v * 3 + 1] = gn[g * 3 + 1]! / l;
          nrm[v * 3 + 2] = gn[g * 3 + 2]! / l;
        }
      }
    }
  }
}

/** How rough the exported creature is, everywhere. The art bible demands
 * "strictly matte, like unvarnished painted resin"; this is that surface. */
const MATTE_ROUGHNESS = 0.9;

/**
 * Make the GLB matte for EVERY viewer, not just ours.
 *
 * Meshy omits metallicFactor/roughnessFactor, so spec-compliant viewers
 * default both to 1.0 and read the metallic-roughness texture instead --
 * which ships at roughness ~0.48, half gloss. Our renderer tames that at
 * load, but the file goes places we do not render: the Miris portal, the
 * published viewer, anyone's glTF tool. Factors can only multiply the
 * texture downward, so matte means dropping the texture reference and
 * stating the factors outright. The JSON chunk changes length, so unlike
 * smoothing this rebuilds the container (BIN chunk byte-identical).
 */
export function matteGlb(input: ArrayBuffer): ArrayBuffer {
  try {
    const dv = new DataView(input);
    if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB");
    const jsonLen = dv.getUint32(12, true);
    const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(input, 20, jsonLen))) as {
      materials?: Array<{ pbrMetallicRoughness?: Record<string, unknown> }>;
    };
    if (!gltf.materials?.length) return input;
    for (const m of gltf.materials) {
      const pbr = (m.pbrMetallicRoughness ??= {});
      pbr.metallicFactor = 0;
      pbr.roughnessFactor = MATTE_ROUGHNESS;
      // The texture stays in the file (removing bytes would mean re-indexing
      // every bufferView); unreferenced, no loader samples it.
      delete pbr.metallicRoughnessTexture;
    }

    const jsonText = JSON.stringify(gltf);
    const jsonRaw = new TextEncoder().encode(jsonText);
    const jsonPadded = new Uint8Array(Math.ceil(jsonRaw.length / 4) * 4).fill(0x20);
    jsonPadded.set(jsonRaw);

    const binHeaderAt = 20 + jsonLen;
    const binChunk = new Uint8Array(input, binHeaderAt, input.byteLength - binHeaderAt);

    const out = new ArrayBuffer(20 + jsonPadded.length + binChunk.length);
    const odv = new DataView(out);
    const ou8 = new Uint8Array(out);
    odv.setUint32(0, 0x46546c67, true);
    odv.setUint32(4, 2, true);
    odv.setUint32(8, out.byteLength, true);
    odv.setUint32(12, jsonPadded.length, true);
    odv.setUint32(16, 0x4e4f534a, true);
    ou8.set(jsonPadded, 20);
    ou8.set(binChunk, 20 + jsonPadded.length);
    return out;
  } catch (e) {
    console.warn("[workshop] matte pass skipped:", e);
    return input;
  }
}

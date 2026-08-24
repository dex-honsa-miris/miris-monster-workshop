// Click-to-annotate capture. The director used to own this; now it is a plain
// function over the renderer R3F hands us, so it works the same on either
// architecture: render a closeup framed on the clicked point plus a full-body
// context shot, both as data URIs for the vision call.
import * as THREE from "three";

let target: THREE.WebGLRenderTarget | null = null;

function renderToDataUrl(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): string {
  target ??= new THREE.WebGLRenderTarget(512, 512);
  const prev = gl.getRenderTarget();
  gl.setRenderTarget(target);
  gl.render(scene, camera);
  const pixels = new Uint8Array(target.width * target.height * 4);
  gl.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels);
  gl.setRenderTarget(prev);

  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(target.width, target.height);
  for (let y = 0; y < target.height; y++) {
    const src = (target.height - 1 - y) * target.width * 4; // GL reads bottom-up
    img.data.set(pixels.subarray(src, src + target.width * 4), y * target.width * 4);
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.82);
}

export function captureProbe(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  viewCamera: THREE.Camera,
  monster: THREE.Object3D,
  point: THREE.Vector3,
  hide: THREE.Object3D[],
): { closeup: string; context: string } | null {
  const wasVisible = hide.map((o) => o.visible);
  hide.forEach((o) => { o.visible = false; });
  try {
    const box = new THREE.Box3().setFromObject(monster);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(0.001, box.getSize(new THREE.Vector3()).length() / 2);
    const cam = new THREE.PerspectiveCamera(32, 1, 0.01, 40);

    const outward = point.clone().sub(center).normalize();
    if (!Number.isFinite(outward.x) || outward.lengthSq() < 1e-6) outward.set(0, 0, 1);
    cam.position.copy(point).addScaledVector(outward, radius * 0.85);
    cam.lookAt(point);
    cam.updateProjectionMatrix();
    const closeup = renderToDataUrl(gl, scene, cam);

    const dir = viewCamera.position.clone().sub(center).normalize();
    cam.position.copy(center).addScaledVector(dir, radius * 3.4);
    cam.lookAt(center);
    cam.updateProjectionMatrix();
    const context = renderToDataUrl(gl, scene, cam);
    return { closeup, context };
  } catch (e) {
    console.warn("[workshop] probe capture failed:", e);
    return null;
  } finally {
    hide.forEach((o, i) => { o.visible = wasVisible[i] ?? true; });
  }
}

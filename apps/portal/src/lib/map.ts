// Live map: Rust+ map image as a textured plane, team + event markers as instanced dots.
// WebGPU renderer (falls back to WebGL2 automatically inside three's WebGPURenderer).
import { Schema } from "effect";
import * as THREE from "three/webgpu";

export const Snapshot = Schema.Struct({
  mapSize: Schema.Number,
  team: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      x: Schema.Number,
      y: Schema.Number,
      online: Schema.Boolean,
      alive: Schema.Boolean,
    }),
  ),
  markers: Schema.Array(Schema.Struct({ kind: Schema.String, x: Schema.Number, y: Schema.Number })),
});

export const decodeSnapshot = Schema.decodeUnknownSync(Schema.fromJsonString(Snapshot));

export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}

const MARKER_COLORS = new Map([
  ["cargoShip", 0x60a5fa],
  ["patrolHelicopter", 0xf87171],
  ["chinook", 0xfbbf24],
  ["crate", 0xa3e635],
  ["vendingMachine", 0x94a3b8],
  ["explosion", 0xfb923c],
]);

/**
 * The Rust+ map image includes an ocean margin around the playable square; world coordinates
 * (0..mapSize, origin bottom-left) map into the inner square.
 */
export const toPlane = (x: number, y: number, mapSize: number, margin: number, imagePx: number) => {
  const inner = imagePx - 2 * margin;
  const u = (margin + (x / mapSize) * inner) / imagePx;
  const v = (margin + (y / mapSize) * inner) / imagePx;

  return { px: u - 0.5, py: v - 0.5 };
};

/** WebGPU first; some GPUs/drivers expose WebGPU but fail to init, so fall back to WebGL2. */
const makeRenderer = async (canvas: HTMLCanvasElement) => {
  const gpu = new THREE.WebGPURenderer({ canvas, antialias: true });

  try {
    await gpu.init();

    return gpu;
  } catch {
    gpu.dispose();

    const gl = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: true });

    await gl.init();

    return gl;
  }
};

export const mount = async (canvas: HTMLCanvasElement, imageUrl: string, margin: number) => {
  const renderer = await makeRenderer(canvas);

  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);

  camera.position.z = 2;

  const texture = await new THREE.TextureLoader().loadAsync(imageUrl);

  texture.colorSpace = THREE.SRGBColorSpace;

  const imagePx = texture.image.width;

  scene.add(
    new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: texture })),
  );

  const dot = new THREE.CircleGeometry(0.006, 20);
  const team = new THREE.InstancedMesh(dot, new THREE.MeshBasicMaterial(), 64);
  const events = new THREE.InstancedMesh(dot, new THREE.MeshBasicMaterial(), 64);

  // Allocate per-instance colors before first render so the material compiles with them.
  for (const mesh of [team, events])
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(64 * 3), 3);

  team.position.z = 0.02;
  events.position.z = 0.01;
  scene.add(team, events);

  const m = new THREE.Matrix4();
  const c = new THREE.Color();

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;

    renderer.setSize(w, h, false);
    camera.left = -0.5 * (w / h);
    camera.right = 0.5 * (w / h);
    camera.updateProjectionMatrix();
  };

  const observer = new ResizeObserver(resize);

  observer.observe(canvas);
  resize();

  const update = (s: Snapshot) => {
    s.team.forEach((p, i) => {
      const { px, py } = toPlane(p.x, p.y, s.mapSize, margin, imagePx);

      team.setMatrixAt(i, m.makeTranslation(px, py, 0));
      team.setColorAt(i, c.set(!p.online ? 0x6b7280 : p.alive ? 0x34d399 : 0xef4444));
    });
    team.count = s.team.length;

    s.markers.forEach((k, i) => {
      const { px, py } = toPlane(k.x, k.y, s.mapSize, margin, imagePx);

      events.setMatrixAt(i, m.makeTranslation(px, py, 0).scale(new THREE.Vector3(1.6, 1.6, 1)));
      events.setColorAt(i, c.set(MARKER_COLORS.get(k.kind) ?? 0xffffff));
    });
    events.count = s.markers.length;

    for (const mesh of [team, events]) {
      mesh.instanceMatrix.needsUpdate = true;

      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  };

  renderer.setAnimationLoop(() => renderer.render(scene, camera));

  return {
    update,
    destroy: () => {
      observer.disconnect();
      renderer.setAnimationLoop(null);
      renderer.dispose();
    },
  };
};

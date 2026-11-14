import * as THREE from "three";

/**
 * Inventory items as small 3D models, built from basic shapes in code.
 * Nothing is downloaded: there are no model files to host or license.
 */

export type ItemKind = "key" | "card" | "battery" | "torch" | "note" | "gear" | "magnet" | "lens" | "fuse" | "tool" | "gem";

const MATCHERS: [ItemKind, RegExp][] = [
  ["card", /card|badge|pass|💳|🪪/i],
  ["key", /key|🗝|🔑/i],
  ["battery", /batter|cell|power|🔋/i],
  ["torch", /torch|flashlight|lamp|light|🔦|💡/i],
  ["note", /note|paper|letter|page|map|photo|ticket|📜|📄|📝|🗺|✉/i],
  ["gear", /gear|cog|dial|wheel|knob|valve|⚙/i],
  ["magnet", /magnet|🧲/i],
  ["lens", /lens|glass|magnif|loupe|🔍|🔎/i],
  ["fuse", /fuse|plug|wire|cable|chip|🔌/i],
  ["tool", /crowbar|screwdriver|hammer|wrench|lever|tool|pliers|🔨|🔧|🪛|🛠/i],
];

/** Chooses a model from what the item is called and its emoji. Anything unrecognised becomes a glowing gem. */
export function itemKind(name: string, icon: string): ItemKind {
  const text = `${name} ${icon}`;
  return MATCHERS.find(([, pattern]) => pattern.test(text))?.[0] ?? "gem";
}

const metal = (color: number, roughness = 0.35) => new THREE.MeshStandardMaterial({ color, metalness: 0.9, roughness });
const matte = (color: number) => new THREE.MeshStandardMaterial({ color, metalness: 0.05, roughness: 0.75 });
const glass = () => new THREE.MeshStandardMaterial({ color: 0xcfe8ff, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.35 });

function part(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  return mesh;
}

/** A model about two units across, centred on the origin. */
export function buildItem(kind: ItemKind): THREE.Group {
  const g = new THREE.Group();
  const gold = metal(0xd9a441);
  const steel = metal(0xb8bcc4);
  const dark = matte(0x26262b);

  if (kind === "key") {
    g.add(part(new THREE.TorusGeometry(0.34, 0.09, 16, 40), gold, -0.62));
    const shaft = part(new THREE.CylinderGeometry(0.07, 0.07, 1.25, 20), gold, 0.33);
    shaft.rotation.z = Math.PI / 2;
    g.add(shaft, part(new THREE.BoxGeometry(0.12, 0.3, 0.07), gold, 0.62, -0.18), part(new THREE.BoxGeometry(0.12, 0.2, 0.07), gold, 0.86, -0.14));
  } else if (kind === "card") {
    g.add(part(new THREE.BoxGeometry(1.7, 1.05, 0.04), matte(0xf2f0ea)));
    g.add(part(new THREE.BoxGeometry(1.7, 0.2, 0.045), dark, 0, 0.28));
    g.add(part(new THREE.BoxGeometry(0.3, 0.24, 0.05), gold, -0.5, -0.12));
    g.add(part(new THREE.BoxGeometry(0.7, 0.05, 0.045), matte(0x9a968c), 0.3, -0.1), part(new THREE.BoxGeometry(0.5, 0.05, 0.045), matte(0x9a968c), 0.2, -0.26));
  } else if (kind === "battery") {
    g.add(part(new THREE.CylinderGeometry(0.36, 0.36, 1.3, 32), matte(0x2f9e5b)));
    g.add(part(new THREE.CylinderGeometry(0.365, 0.365, 0.3, 32), gold, 0, 0.5));
    g.add(part(new THREE.CylinderGeometry(0.13, 0.13, 0.14, 20), steel, 0, 0.72));
    g.add(part(new THREE.CylinderGeometry(0.37, 0.37, 0.05, 32), steel, 0, -0.66));
  } else if (kind === "torch") {
    g.add(part(new THREE.CylinderGeometry(0.2, 0.2, 1.2, 24), dark, 0, -0.3));
    g.add(part(new THREE.CylinderGeometry(0.42, 0.22, 0.45, 24), steel, 0, 0.5));
    g.add(part(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 24), new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffd76a, emissiveIntensity: 1.6 }), 0, 0.74));
    g.add(part(new THREE.BoxGeometry(0.1, 0.22, 0.06), matte(0xc0392b), 0, -0.1, 0.2));
    g.rotation.z = -0.5;
  } else if (kind === "note") {
    g.add(part(new THREE.BoxGeometry(1.25, 1.6, 0.02), matte(0xe9dfc4)));
    for (let i = 0; i < 6; i++) g.add(part(new THREE.BoxGeometry(i === 5 ? 0.5 : 0.95, 0.045, 0.025), matte(0x4a4336), i === 5 ? -0.22 : 0, 0.55 - i * 0.2));
    g.rotation.z = 0.08;
  } else if (kind === "gear") {
    const bronze = metal(0xa9743a, 0.45);
    const body = part(new THREE.CylinderGeometry(0.62, 0.62, 0.2, 40), bronze);
    body.rotation.x = Math.PI / 2;
    g.add(body);
    for (let i = 0; i < 12; i++) {
      const tooth = part(new THREE.BoxGeometry(0.2, 0.26, 0.2), bronze);
      const a = (i / 12) * Math.PI * 2;
      tooth.position.set(Math.cos(a) * 0.7, Math.sin(a) * 0.7, 0);
      tooth.rotation.z = a + Math.PI / 2;
      g.add(tooth);
    }
    const hub = part(new THREE.CylinderGeometry(0.2, 0.2, 0.24, 24), dark);
    hub.rotation.x = Math.PI / 2;
    g.add(hub);
  } else if (kind === "magnet") {
    g.add(part(new THREE.TorusGeometry(0.5, 0.17, 16, 40, Math.PI), matte(0xc0392b), 0, 0.1));
    g.add(part(new THREE.BoxGeometry(0.34, 0.5, 0.34), matte(0xc0392b), -0.5, -0.15), part(new THREE.BoxGeometry(0.34, 0.5, 0.34), matte(0xc0392b), 0.5, -0.15));
    g.add(part(new THREE.BoxGeometry(0.35, 0.22, 0.35), steel, -0.5, -0.5), part(new THREE.BoxGeometry(0.35, 0.22, 0.35), steel, 0.5, -0.5));
  } else if (kind === "lens") {
    g.add(part(new THREE.TorusGeometry(0.5, 0.07, 16, 48), gold, 0, 0.3));
    const pane = part(new THREE.CylinderGeometry(0.47, 0.47, 0.04, 40), glass(), 0, 0.3);
    pane.rotation.x = Math.PI / 2;
    g.add(pane, part(new THREE.CylinderGeometry(0.075, 0.09, 0.8, 16), dark, 0, -0.6));
  } else if (kind === "fuse") {
    const tube = part(new THREE.CylinderGeometry(0.22, 0.22, 1.0, 24), glass());
    tube.rotation.z = Math.PI / 2;
    const wire = part(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 8), gold);
    wire.rotation.z = Math.PI / 2;
    g.add(tube, wire);
    for (const x of [-0.6, 0.6]) {
      const cap = part(new THREE.CylinderGeometry(0.24, 0.24, 0.26, 24), steel, x);
      cap.rotation.z = Math.PI / 2;
      g.add(cap);
    }
  } else if (kind === "tool") {
    // A crowbar: a long bar with a hooked claw at one end and a flat tip at the other.
    const bar = part(new THREE.CylinderGeometry(0.075, 0.075, 1.7, 16), steel);
    bar.rotation.z = Math.PI / 2;
    const hook = part(new THREE.TorusGeometry(0.22, 0.075, 12, 24, Math.PI * 0.9), steel, 0.85, 0.22);
    hook.rotation.z = -Math.PI / 2;
    const tip = part(new THREE.BoxGeometry(0.3, 0.05, 0.2), steel, -0.95, -0.03);
    tip.rotation.z = 0.25;
    g.add(bar, hook, tip, part(new THREE.CylinderGeometry(0.095, 0.095, 0.5, 16), matte(0xc0392b)));
    g.children[3].rotation.z = Math.PI / 2;
    g.rotation.z = 0.35;
  } else {
    g.add(part(new THREE.OctahedronGeometry(0.7, 0), new THREE.MeshStandardMaterial({ color: 0xfcd34d, emissive: 0xb7791f, emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.15, flatShading: true })));
  }
  return g;
}

/** Draws one slowly turning item into `host`. Returns a function that stops and cleans up. */
export function showItem(host: HTMLElement, kind: ItemKind): () => void {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const size = () => renderer.setSize(host.clientWidth, host.clientHeight, false);
  const canvas = renderer.domElement;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  host.appendChild(canvas);
  size();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, host.clientWidth / Math.max(1, host.clientHeight), 0.1, 50);
  camera.position.set(0, 0.25, 5.2);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x1c1917, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(2.5, 3, 4);
  const rim = new THREE.DirectionalLight(0xfcd34d, 2.2);
  rim.position.set(-3, 1.5, -3);
  scene.add(key, rim);

  const item = buildItem(kind);
  scene.add(item);
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const start = performance.now();
  renderer.setAnimationLoop((now) => {
    const t = (now - start) / 1000;
    if (!still) {
      item.rotation.y = t * 1.1;
      item.position.y = Math.sin(t * 1.6) * 0.06;
      // It arrives small and settles at full size.
      item.scale.setScalar(Math.min(1, 0.2 + t * 2.2));
    } else item.rotation.y = 0.5;
    renderer.render(scene, camera);
  });

  return () => {
    renderer.setAnimationLoop(null);
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    renderer.dispose();
    canvas.remove();
  };
}

import * as THREE from "three";
import { SparkRenderer, SplatEdit, SplatEditRgbaBlendMode, SplatEditSdf, SplatEditSdfType, SplatMesh } from "@sparkjsdev/spark";
import { CAPTURE_ASPECT, CAPTURE_VFOV, clampToBounds, wallYaw, type Bounds, type Frame, type Vec3 } from "./geometry";
import type { WallId } from "../game/schema";

/**
 * A 3D scan on screen, with first-person controls. Browser only.
 *
 * Two ways to move:
 * - "fly": free movement in every direction, for the creator to find the middle of the room.
 * - "walk": eye height is fixed and the player stays inside the room, like a first-person game.
 */

export type Device = "digits" | "colors" | "letters" | "directions";
export type Anchor = {
  id: string;
  label: string;
  pos: Vec3;
  /** A lock sits here: it is shown as a small device fixed to the object. */
  device?: Device;
  /** The lock has been opened. */
  done?: boolean;
};
export type SplatSource = { url: string; format: "spz" | "ply" } | { bytes: ArrayBuffer; format: "spz" | "ply" };

type Options = {
  mode: "fly" | "walk";
  onProgress?: (fraction: number) => void;
  /** The anchor the player is close to and looking at, or null. */
  onFocus?: (id: string | null) => void;
  /** The player pressed the interact key, or clicked, while an anchor was in focus. */
  onInteract?: (id: string) => void;
  onLockChange?: (locked: boolean) => void;
};

const WALK_SPEED = 1.7;
const REACH = 1.9;
/** How far off the centre of the view an anchor may be and still count as looked at. */
const FOCUS_ANGLE = (24 * Math.PI) / 180;

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  private scene = new THREE.Scene();
  private mesh: SplatMesh | null = null;
  private markers = new THREE.Group();
  /** Lock devices: real 3D objects added to the scanned room. */
  private props = new THREE.Group();
  private anchors: Anchor[] = [];
  private focused: string | null = null;
  private showAll = false;
  private yaw = 0;
  private pitch = 0;
  private keys = new Set<string>();
  private frame: Frame | null = null;
  private bounds: Bounds | null = null;
  /** Set while capturing or while a dialog is open: input is ignored. */
  paused = false;
  private disposed = false;
  private clock = new THREE.Clock();
  private resize: ResizeObserver;
  /** Movement from the on-screen stick, each axis -1..1. */
  private stick = { x: 0, y: 0 };
  private touches = new Map<number, { kind: "move" | "look"; x: number; y: number; sx: number; sy: number }>();
  private drag: { x: number; y: number; moved: number } | null = null;
  private bob = 0;
  /** Dark room: everything outside the torch beam is dimmed. */
  private torch: { edit: SplatEdit; beam: SplatEditSdf } | null = null;

  constructor(
    private host: HTMLElement,
    private options: Options,
  ) {
    // Splats gain nothing from multisampling, and it costs a lot on phones.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.matchMedia("(pointer: coarse)").matches ? 1 : 1.5));
    this.renderer.setClearColor(0x0c0a09);
    const canvas = this.renderer.domElement;
    // Taken out of the flow, so the canvas's own pixel size can never stretch the page around it.
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.touchAction = "none";
    canvas.tabIndex = 0;
    host.appendChild(canvas);

    this.scene.add(new SparkRenderer({ renderer: this.renderer }));
    this.scene.add(this.markers);
    this.scene.add(this.props);
    // Only the added devices are lit by these; the scan carries its own baked lighting.
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x292524, 1.4));
    const lamp = new THREE.DirectionalLight(0xffffff, 1.6);
    lamp.position.set(1, 3, 2);
    this.scene.add(lamp);
    this.camera.rotation.order = "YXZ";

    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(host);
    this.fit();

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("mousemove", this.onLockedMove);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);

    this.renderer.setAnimationLoop(() => this.tick());
  }

  /** Loads the scan. Rejects if the file cannot be read. */
  async load(source: SplatSource, flip: boolean): Promise<void> {
    const common = {
      fileName: `scan.${source.format}`,
      onProgress: (e: ProgressEvent) => e.lengthComputable && this.options.onProgress?.(e.loaded / e.total),
    };
    const mesh = new SplatMesh("url" in source ? { url: source.url, ...common } : { fileBytes: source.bytes, ...common });
    await mesh.initialized;
    if (this.disposed) return mesh.dispose();
    this.mesh = mesh;
    this.setFlip(flip);
    this.scene.add(mesh);
  }

  /** Turns the scan over, for files whose "up" points down. */
  setFlip(flip: boolean) {
    this.mesh?.quaternion.set(flip ? 1 : 0, 0, 0, flip ? 0 : 1);
    this.mesh?.updateMatrixWorld(true);
  }

  /** World-space centre of every splat that is solid enough to matter: x, y, z per splat. */
  centers(): Float32Array {
    const mesh = this.mesh;
    if (!mesh) return new Float32Array();
    mesh.updateMatrixWorld(true);
    const out: number[] = [];
    const p = new THREE.Vector3();
    mesh.forEachSplat((_i, center, _s, _q, opacity) => {
      if (opacity < 0.35) return;
      p.copy(center).applyMatrix4(mesh.matrixWorld);
      out.push(p.x, p.y, p.z);
    });
    return new Float32Array(out);
  }

  /** Puts the camera somewhere sensible before the creator takes over: the middle of the scan. */
  frameScan(centers: Float32Array) {
    if (centers.length === 0) return;
    const axis = (o: number) => {
      const values: number[] = [];
      const step = Math.max(1, Math.floor(centers.length / 3 / 50_000)) * 3;
      for (let i = o; i < centers.length; i += step) values.push(centers[i]);
      values.sort((a, b) => a - b);
      return { lo: values[Math.floor(values.length * 0.05)], mid: values[Math.floor(values.length / 2)], hi: values[Math.floor(values.length * 0.95)] };
    };
    const x = axis(0);
    const y = axis(1);
    const z = axis(2);
    // About eye height above the lowest solid part of the scan, but never above its middle.
    this.camera.position.set(x.mid, Math.min(y.lo + 1.5, (y.lo + y.hi) / 2), z.mid);
    this.yaw = 0;
    this.pitch = 0;
  }

  pose(): Frame {
    const p = this.camera.position;
    return { origin: [p.x, p.y, p.z], yaw: this.yaw };
  }

  /** Walk mode: where the player starts, and where they may go. */
  enter(frame: Frame, bounds: Bounds) {
    this.frame = frame;
    this.bounds = bounds;
    this.camera.position.set(...frame.origin);
    this.yaw = frame.yaw;
    this.pitch = 0;
  }

  setAnchors(anchors: Anchor[]) {
    this.anchors = anchors;
    this.markers.clear();
    const texture = glowTexture();
    for (const a of anchors) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: texture, color: 0xfcd34d, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      sprite.position.set(...a.pos);
      sprite.renderOrder = 10;
      sprite.userData.id = a.id;
      this.markers.add(sprite);
    }

    for (const old of [...this.props.children]) {
      old.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      this.props.remove(old);
    }
    const centre = new THREE.Vector3(...(this.frame?.origin ?? [0, 0, 0]));
    for (const a of anchors) {
      if (!a.device) continue;
      const device = buildDevice(a.device, Boolean(a.done));
      const at = new THREE.Vector3(...a.pos);
      // Faces the middle of the room, and stands a little proud of the surface it is on.
      const out = centre.clone().sub(at).setY(0).normalize();
      // The measured surface is only approximate, so the device floats clear of it instead of sinking in.
      device.position.copy(at).addScaledVector(out, 0.12);
      device.scale.setScalar(1.5);
      device.lookAt(centre.x, at.y, centre.z);
      this.props.add(device);
    }
  }

  /**
   * Turns the lights out and gives the player a torch: the scan is dimmed everywhere
   * except inside a cone that follows where they look.
   */
  setTorch(on: boolean) {
    if (!on) {
      if (this.torch) this.scene.remove(this.torch.edit);
      this.torch = null;
      return;
    }
    if (this.torch) return;
    const beam = new SplatEditSdf({ type: SplatEditSdfType.INFINITE_CONE, radius: 0.6, color: new THREE.Color(0.1, 0.1, 0.14), opacity: 1 });
    // Inverted: the edit applies outside the cone. A soft edge gives the beam a falloff.
    const edit = new SplatEdit({ rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY, invert: true, softEdge: 0.45 });
    edit.add(beam);
    this.scene.add(edit);
    this.torch = { edit, beam };
  }

  setShowAll(show: boolean) {
    this.showAll = show;
  }

  /** Renders the view of one wall from the room centre and returns it as a JPEG. */
  async capture(frame: Frame, wall: WallId, width = 1280): Promise<Blob> {
    const height = Math.round(width / CAPTURE_ASPECT);
    const saved = { pos: this.camera.position.clone(), yaw: this.yaw, pitch: this.pitch, fov: this.camera.fov, markers: this.markers.visible };
    this.paused = true;
    this.markers.visible = false;
    this.props.visible = false;
    this.camera.position.set(...frame.origin);
    this.yaw = wallYaw(frame, wall);
    this.pitch = 0;
    this.camera.fov = CAPTURE_VFOV;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = CAPTURE_ASPECT;
    this.camera.updateProjectionMatrix();
    // Splats are sorted for the new view off the main thread; give that a moment to land.
    await new Promise((r) => setTimeout(r, 700));
    this.applyPose();
    this.renderer.render(this.scene, this.camera);
    const blob = await new Promise<Blob | null>((resolve) => this.renderer.domElement.toBlob(resolve, "image/jpeg", 0.85));
    this.camera.position.copy(saved.pos);
    this.yaw = saved.yaw;
    this.pitch = saved.pitch;
    this.camera.fov = saved.fov;
    this.markers.visible = saved.markers;
    this.props.visible = true;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.fit();
    this.paused = false;
    if (!blob) throw new Error("The view could not be captured.");
    return blob;
  }

  /** Called by the on-screen interact button. */
  interact() {
    if (this.focused && !this.paused) this.options.onInteract?.(this.focused);
  }

  releasePointer() {
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    this.keys.clear();
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resize.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointercancel", this.onPointerUp);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    document.removeEventListener("mousemove", this.onLockedMove);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.releasePointer();
    this.mesh?.dispose();
    this.renderer.dispose();
    canvas.remove();
  }

  private fit() {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private applyPose() {
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  private tick() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (!this.paused) this.move(dt);
    this.applyPose();
    this.updateFocus();
    if (this.torch) {
      // The cone starts a little behind the eye, so things right in front are lit too.
      const back = new THREE.Vector3();
      this.camera.getWorldDirection(back).multiplyScalar(-0.35);
      this.torch.beam.position.copy(this.camera.position).add(back);
      this.torch.beam.quaternion.copy(this.camera.quaternion);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private move(dt: number) {
    const k = this.keys;
    let side = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0) + this.stick.x;
    let ahead = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0) - this.stick.y;
    const length = Math.hypot(side, ahead);
    if (length > 1) {
      side /= length;
      ahead /= length;
    }
    const speed = WALK_SPEED * (k.has("shift") ? 1.9 : 1) * dt;
    const p = this.camera.position;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    p.x += (side * cos - ahead * sin) * speed;
    p.z += (-side * sin - ahead * cos) * speed;

    if (this.options.mode === "fly") {
      p.y += ((k.has(" ") || k.has("e") ? 1 : 0) - (k.has("c") || k.has("q") ? 1 : 0)) * speed;
      return;
    }
    if (this.frame && this.bounds) {
      const [x, y, z] = clampToBounds(this.frame, this.bounds, [p.x, p.y, p.z]);
      // A small rise and fall while walking, so movement reads as steps.
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.bob = length > 0.1 && !still ? this.bob + dt * 9 : 0;
      p.set(x, y + Math.sin(this.bob) * 0.018, z);
    }
  }

  private updateFocus() {
    const view = new THREE.Vector3();
    this.camera.getWorldDirection(view);
    const to = new THREE.Vector3();
    let best: string | null = null;
    let bestAngle = FOCUS_ANGLE;
    for (const sprite of this.markers.children as THREE.Sprite[]) {
      to.copy(sprite.position).sub(this.camera.position);
      const distance = to.length();
      const angle = to.angleTo(view);
      const reachable = distance < REACH;
      if (reachable && angle < bestAngle) {
        bestAngle = angle;
        best = sprite.userData.id as string;
      }
      // Markers fade in as the player gets close; "show objects" reveals all of them.
      const near = THREE.MathUtils.clamp(1 - (distance - REACH) / 2.5, 0, 1);
      sprite.material.opacity = this.showAll ? 0.9 : near * 0.75;
      sprite.scale.setScalar(0.22);
    }
    for (const sprite of this.markers.children as THREE.Sprite[]) {
      if (sprite.userData.id === best) {
        sprite.material.opacity = 1;
        sprite.scale.setScalar(0.34 + Math.sin(performance.now() / 180) * 0.03);
      }
    }
    // Devices are drawn over the scan, so far ones are hidden: otherwise they would show through walls.
    for (const device of this.props.children) device.visible = device.position.distanceTo(this.camera.position) < 4.5;
    if (best !== this.focused) {
      this.focused = best;
      this.options.onFocus?.(best);
    }
  }

  private look(dx: number, dy: number, sensitivity: number) {
    this.yaw -= dx * sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * sensitivity, -1.3, 1.3);
  }

  private onPointerDown = (e: PointerEvent) => {
    if (this.paused) return;
    const canvas = this.renderer.domElement;
    canvas.focus();
    if (e.pointerType === "touch") {
      const rect = canvas.getBoundingClientRect();
      const kind = e.clientX - rect.left < rect.width * 0.4 ? "move" : "look";
      this.touches.set(e.pointerId, { kind, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (document.pointerLockElement === canvas) return this.interact();
    this.drag = { x: e.clientX, y: e.clientY, moved: 0 };
    canvas.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.paused) return;
    const touch = this.touches.get(e.pointerId);
    if (touch) {
      if (touch.kind === "look") this.look(e.clientX - touch.x, e.clientY - touch.y, 0.005);
      else {
        this.stick.x = THREE.MathUtils.clamp((e.clientX - touch.sx) / 50, -1, 1);
        this.stick.y = THREE.MathUtils.clamp((e.clientY - touch.sy) / 50, -1, 1);
      }
      touch.x = e.clientX;
      touch.y = e.clientY;
      return;
    }
    if (!this.drag) return;
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    this.drag.moved += Math.abs(dx) + Math.abs(dy);
    // Dragging pulls the scene with the pointer, the way a map does.
    this.look(-dx, -dy, 0.004);
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
  };

  private onPointerUp = (e: PointerEvent) => {
    const touch = this.touches.get(e.pointerId);
    if (touch) {
      const tapped = Math.hypot(e.clientX - touch.sx, e.clientY - touch.sy) < 8;
      if (touch.kind === "move") this.stick = { x: 0, y: 0 };
      this.touches.delete(e.pointerId);
      if (tapped) this.interact();
      return;
    }
    if (!this.drag) return;
    const clicked = this.drag.moved < 5;
    this.drag = null;
    if (!clicked || this.paused) return;
    // A plain click acts on what is in focus; otherwise, in walk mode, it grabs the mouse for looking around.
    if (this.focused) this.interact();
    else if (this.options.mode === "walk") this.renderer.domElement.requestPointerLock?.();
  };

  private onLockedMove = (e: MouseEvent) => {
    if (this.paused || document.pointerLockElement !== this.renderer.domElement) return;
    this.look(e.movementX, e.movementY, 0.0022);
  };

  private onLockChange = () => {
    this.options.onLockChange?.(document.pointerLockElement === this.renderer.domElement);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.paused || e.target instanceof HTMLInputElement) return;
    const key = e.key.toLowerCase();
    if (this.options.mode === "walk" && (key === "e" || key === "enter") && !e.repeat) return this.interact();
    this.keys.add(key);
    if (key === " " || key.startsWith("arrow")) e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  private onBlur = () => this.keys.clear();
}

/** A small lock device, about 20 cm wide, with its face on +z. What is on the face depends on the kind of lock. */
function buildDevice(kind: Device, done: boolean): THREE.Group {
  const g = new THREE.Group();
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    // Drawn after the scan and on top of it, in the order the parts are added: body first, face last.
    // The scan's surface is only roughly known, so depth-testing against it would bury the device.
    material.depthTest = false;
    material.transparent = true;
    mesh.renderOrder = 6 + g.children.length * 0.01;
    g.add(mesh);
    return mesh;
  };
  const shell = new THREE.MeshStandardMaterial({ color: 0x1f1f23, metalness: 0.7, roughness: 0.4 });
  const glow = (color: number, strength = 1.4) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: strength, roughness: 0.4 });
  const key = new THREE.MeshStandardMaterial({ color: 0x57534e, metalness: 0.3, roughness: 0.6 });

  add(new THREE.BoxGeometry(0.2, 0.27, 0.045), shell, 0, 0, 0);
  // Status light and screen: amber while locked, green once opened.
  add(new THREE.BoxGeometry(0.16, 0.05, 0.01), glow(done ? 0x34d399 : 0xfbbf24, done ? 1.8 : 1.1), 0, 0.09, 0.025);

  if (kind === "digits") {
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) add(new THREE.BoxGeometry(0.038, 0.038, 0.012), key, (col - 1) * 0.052, 0.025 - row * 0.052, 0.027);
    }
  } else if (kind === "colors") {
    [0xdc4444, 0xe6c532, 0x3b7de0].forEach((color, i) => {
      const dial = add(new THREE.CylinderGeometry(0.026, 0.026, 0.014, 24), glow(color, 0.5), (i - 1) * 0.058, -0.03, 0.028);
      dial.rotation.x = Math.PI / 2;
    });
  } else if (kind === "letters") {
    for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.028, 0.045, 0.012), glow(0xe7e5e4, 0.35), (i - 2) * 0.034, -0.03, 0.027);
  } else {
    const ring = add(new THREE.TorusGeometry(0.06, 0.008, 12, 40), key, 0, -0.035, 0.028);
    ring.rotation.set(0, 0, 0);
    for (let i = 0; i < 4; i++) {
      const arrow = add(new THREE.ConeGeometry(0.014, 0.034, 12), glow(i === 0 ? 0xf87171 : 0xe7e5e4, 0.5), Math.sin((i * Math.PI) / 2) * 0.038, -0.035 + Math.cos((i * Math.PI) / 2) * 0.038, 0.03);
      arrow.rotation.z = -(i * Math.PI) / 2;
    }
  }
  return g;
}

/** A soft round glow, drawn once and shared by every marker. */
function glowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.18, "rgba(255,255,255,0.9)");
  gradient.addColorStop(0.3, "rgba(255,255,255,0.25)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

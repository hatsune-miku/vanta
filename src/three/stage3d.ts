import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { VIEW_H, VIEW_W } from '../config';
import { A, type PoseRef } from '../art/anims';

/**
 * Characters are rigged 3D bodies driven by a ready-made animation library
 * (Quaternius "Universal Animation Library" 1 + 2, CC0), drawn by three.js into an
 * offscreen canvas that Phaser shows as one layer between the backdrop and the effects.
 * World units are the game's pixels; three's y axis is flipped.
 */

export interface SkinDef {
  base: 'F' | 'M';
  height: number;            // standing height in px
  wide?: number;             // extra girth for heavy frames
  main: number; joints: number; glow: number; glowPower: number;
  weapon: 'katana' | 'cleaver' | 'pistol' | 'maul' | 'great';
}

export const SKINS3: Record<string, SkinDef> = {
  vanta: { base: 'F', height: 184, main: 0xe4e9f2, joints: 0x1c2233, glow: 0x2f9bff, glowPower: 0.25, weapon: 'katana' },
  grunt: { base: 'M', height: 194, main: 0x4d566b, joints: 0x14171f, glow: 0xff5030, glowPower: 1.1, weapon: 'cleaver' },
  gunner: { base: 'M', height: 186, main: 0x5d5775, joints: 0x15131f, glow: 0xff7a3d, glowPower: 1.1, weapon: 'pistol' },
  heavy: { base: 'M', height: 252, wide: 1.28, main: 0x3f4b57, joints: 0x10151a, glow: 0xff5030, glowPower: 1.2, weapon: 'maul' },
  titan: { base: 'M', height: 360, wide: 1.36, main: 0x556170, joints: 0x12171c, glow: 0xff6a3d, glowPower: 1.4, weapon: 'maul' },
  warden: { base: 'M', height: 322, wide: 1.12, main: 0x2b2533, joints: 0x0c0a10, glow: 0xff2d2d, glowPower: 1.7, weapon: 'great' },
};

const MODEL_H = 1.72;
const TURN = 1.22; // not a pure profile: a little of the chest stays toward the camera

function buildWeapon(kind: SkinDef['weapon'], ghost: THREE.Material | null) {
  const g = new THREE.Group(), tip = new THREE.Object3D();
  const mat = (color: number, emissive = 0, power = 1) => ghost ?? new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: power, metalness: 0.6, roughness: 0.35 });
  const box = (w: number, h: number, d: number, y: number, m: THREE.Material, x = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, 0); g.add(b); return b; };
  let len = 1;
  if (kind === 'katana') { len = 1.08; box(0.03, 0.2, 0.035, -0.02, mat(0x1c2233)); box(0.09, 0.015, 0.05, 0.085, mat(0xdfe6f2)); box(0.012, 1.0, 0.045, 0.59, ghost ?? new THREE.MeshBasicMaterial({ color: 0xbfe2ff })); }
  else if (kind === 'cleaver') { len = 0.8; box(0.035, 0.2, 0.04, -0.02, mat(0x14171f)); box(0.02, 0.68, 0.13, 0.44, mat(0x4d566b)); box(0.024, 0.68, 0.02, 0.44, ghost ?? new THREE.MeshBasicMaterial({ color: 0xff6a40 }), 0).position.z = 0.07; }
  else if (kind === 'pistol') { len = 0.3; box(0.04, 0.12, 0.05, -0.02, mat(0x15131f)); const b = box(0.045, 0.3, 0.06, 0.12, mat(0x5d5775)); b.rotation.x = 0; box(0.02, 0.05, 0.02, 0.29, ghost ?? new THREE.MeshBasicMaterial({ color: 0xff7a3d })); }
  else if (kind === 'maul') { len = 1.15; box(0.045, 1.2, 0.045, 0.45, mat(0x10151a)); box(0.3, 0.34, 0.26, 1.02, mat(0x3f4b57)); box(0.31, 0.05, 0.27, 1.02, ghost ?? new THREE.MeshBasicMaterial({ color: 0xff5030 })); }
  else { len = 1.5; box(0.04, 0.3, 0.045, -0.03, mat(0x0c0a10)); box(0.2, 0.03, 0.06, 0.13, mat(0x2b2533)); box(0.03, 1.4, 0.15, 0.85, mat(0x2b2533)); box(0.034, 1.4, 0.025, 0.85, ghost ?? new THREE.MeshBasicMaterial({ color: 0xff3030 })).position.z = 0.08; }
  tip.position.y = len; g.add(tip);
  return { g, tip };
}

/** Anything an actor can be drawn with (3D body or the drone sprite). */
export interface Puppet {
  /** world-space offsets from the actor's feet, updated by apply() */
  hand: { x: number; y: number }; neck: { x: number; y: number }; tip: { x: number; y: number };
  x: number; y: number; alpha: number; facing: number;
  squash: number; extraRot: number; heightPx: number; widthPx: number;
  apply(p: PoseRef): void;
  setPos(x: number, y: number, facing: number): void;
  wx(v: number): number; wy(v: number): number;
  setFlash(color: number | null): void; setTintMul(color: number): void;
  setAlpha(a: number): void; setVisible(v: boolean): void;
  ghost(color: number, alpha: number, life: number): void;
  destroy(): void;
}

interface GhostBody { root: THREE.Object3D; bones: THREE.Bone[]; mat: THREE.MeshBasicMaterial; life: number; max: number; a0: number; skin: string }

export class Stage3D {
  static I: Stage3D;
  renderer!: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  cam = new THREE.OrthographicCamera(-VIEW_W / 2, VIEW_W / 2, VIEW_H / 2, -VIEW_H / 2, 1, 4000);
  clips = new Map<string, THREE.AnimationClip>();
  private bases: Record<string, THREE.Object3D> = {};
  canvas!: HTMLCanvasElement;
  private ghosts: GhostBody[] = [];
  private ghostPool: Record<string, GhostBody[]> = {};
  bodies = new Set<Body3D>();

  static async load(): Promise<Stage3D> {
    if (Stage3D.I) return Stage3D.I;
    const s = new Stage3D();
    s.canvas = document.createElement('canvas'); s.canvas.width = VIEW_W; s.canvas.height = VIEW_H;
    s.renderer = new THREE.WebGLRenderer({ canvas: s.canvas, antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
    s.renderer.setPixelRatio(1); s.renderer.setSize(VIEW_W, VIEW_H, false);
    s.renderer.setClearColor(0x000000, 0);
    s.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const loader = new GLTFLoader(), base = import.meta.env.BASE_URL + 'models/';
    const [f, a1, a2] = await Promise.all(['Mannequin_F.glb', 'UAL1_Standard.glb', 'UAL2_Standard.glb'].map((n) => loader.loadAsync(base + n)));
    for (const c of [...a1.animations, ...a2.animations]) s.clips.set(c.name, c);
    // the models are packed down to the clips the table names (tools/pack-models.mjs); catch a stale pack early
    for (const a of Object.values(A)) if (!s.clips.has(a.clip)) console.error(`animation clip missing from models: ${a.clip} (run node tools/pack-models.mjs)`);
    s.bases.F = f.scene; s.bases.M = a1.scene;
    // lighting: cool sky fill, a neutral key from the camera side, blue and pink rims from behind
    s.scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x0b101c, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(300, 500, 900); s.scene.add(key);
    const rimA = new THREE.DirectionalLight(0x2f9bff, 4.5); rimA.position.set(-500, 300, -400); s.scene.add(rimA);
    const rimB = new THREE.DirectionalLight(0xff4fc8, 3.2); rimB.position.set(500, 150, -500); s.scene.add(rimB);
    s.cam.position.z = 2000;
    Stage3D.I = s;
    return s;
  }

  cloneBase(kind: 'F' | 'M') { return cloneSkinned(this.bases[kind]); }

  /** Match Phaser's camera (centre in world px, zoom) and draw. */
  render(cx: number, cy: number, zoom: number) {
    const c = this.cam;
    c.left = -VIEW_W / 2 / zoom; c.right = VIEW_W / 2 / zoom; c.top = VIEW_H / 2 / zoom; c.bottom = -VIEW_H / 2 / zoom;
    c.position.x = cx; c.position.y = -cy; c.updateProjectionMatrix();
    this.renderer.render(this.scene, c);
  }

  /* ----------------------------- afterimages ----------------------------- */

  spawnGhost(src: Body3D, color: number, alpha: number, life: number) {
    let g = this.ghostPool[src.skinKey]?.pop();
    if (!g) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: alpha, blending: THREE.AdditiveBlending, depthWrite: false });
      const root = this.cloneBase(src.skin.base);
      const bones: THREE.Bone[] = [];
      root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); const m = o as THREE.Mesh; if (m.isMesh) { m.material = mat; m.frustumCulled = false; } });
      const hand = root.getObjectByName('hand_r'); if (hand) hand.add(buildWeapon(src.skin.weapon, mat).g);
      g = { root, bones, mat, life: 0, max: life, a0: alpha, skin: src.skinKey };
    }
    for (let i = 0; i < g.bones.length && i < src.bones.length; i++) { const a = src.bones[i], b = g.bones[i]; b.position.copy(a.position); b.quaternion.copy(a.quaternion); b.scale.copy(a.scale); }
    g.root.position.copy(src.root.position); g.root.position.z = -60;
    g.root.rotation.copy(src.root.rotation); g.root.scale.copy(src.root.scale);
    g.mat.color.setHex(color); g.mat.opacity = alpha; g.life = 0; g.max = life; g.a0 = alpha;
    this.scene.add(g.root); this.ghosts.push(g);
  }

  update(dt: number) {
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i]; g.life += dt;
      const t = g.life / g.max;
      if (t >= 1) { this.scene.remove(g.root); (this.ghostPool[g.skin] ??= []).push(g); this.ghosts.splice(i, 1); continue; }
      g.mat.opacity = g.a0 * (1 - t);
    }
  }

  /** Drop everything a finished scene left behind. */
  reset() {
    for (const b of [...this.bodies]) b.destroy();
    for (const g of this.ghosts) this.scene.remove(g.root);
    this.ghosts.length = 0;
  }
}

const tmp = new THREE.Vector3();

export class Body3D implements Puppet {
  root: THREE.Object3D;
  bones: THREE.Bone[] = [];
  skin: SkinDef;
  hand = { x: 0, y: 0 }; neck = { x: 0, y: 0 }; tip = { x: 0, y: 0 };
  x = 0; y = 0; alpha = 1; facing = 1; squash = 0; extraRot = 0; heightPx: number; widthPx: number;
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  /** lit materials (flash / tint act on these) */
  private mats: THREE.MeshStandardMaterial[] = [];
  /** every material of the body and its weapon (fades act on these) */
  private allMats: THREE.Material[] = [];
  private glowMat: THREE.MeshStandardMaterial;
  private handBone: THREE.Object3D; private headBone: THREE.Object3D; private tipObj: THREE.Object3D;
  private S: number;
  private flashOn = false; private tintOn = 0;
  private stage = Stage3D.I;
  private active: string[] = [];

  constructor(public skinKey: string, z = 0) {
    const skin = this.skin = SKINS3[skinKey];
    this.heightPx = skin.height; this.widthPx = skin.height * 0.29 * (skin.wide ?? 1); this.S = skin.height / MODEL_H;
    this.root = this.stage.cloneBase(skin.base);
    const main = new THREE.MeshStandardMaterial({ color: skin.main, metalness: 0.4, roughness: 0.42 });
    const joints = this.glowMat = new THREE.MeshStandardMaterial({ color: skin.joints, metalness: 0.7, roughness: 0.3, emissive: skin.glow, emissiveIntensity: skin.glowPower });
    this.mats = [main, joints];
    this.root.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.push(o as THREE.Bone);
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false;
      const src = Array.isArray(m.material) ? m.material : [m.material];
      const mapped = src.map((mt) => (mt.name === 'M_Joints' ? joints : main));
      m.material = mapped.length === 1 ? mapped[0] : mapped;
    });
    this.handBone = this.root.getObjectByName('hand_r')!; this.headBone = this.root.getObjectByName('Head')!;
    const w = buildWeapon(skin.weapon, null); this.handBone.add(w.g); this.tipObj = w.tip;
    this.allMats = [main, joints];
    w.g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      this.allMats.push(m.material as THREE.Material);
      if ((m.material as THREE.MeshStandardMaterial).isMeshStandardMaterial) this.mats.push(m.material as THREE.MeshStandardMaterial);
    });
    this.mixer = new THREE.AnimationMixer(this.root);
    this.root.position.z = z;
    this.stage.scene.add(this.root); this.stage.bodies.add(this);
    this.applyTransform();
  }

  private action(name: string) {
    let a = this.actions.get(name);
    if (!a) {
      const clip = this.stage.clips.get(name) ?? this.stage.clips.get('Idle_Loop')!;
      a = this.mixer.clipAction(clip); a.setLoop(THREE.LoopRepeat, Infinity); a.clampWhenFinished = true; a.paused = true; a.play();
      a.setEffectiveWeight(0); this.actions.set(name, a);
    }
    return a;
  }

  apply(p: PoseRef) {
    for (const n of this.active) if (n !== p.clip && n !== p.prev) this.action(n).setEffectiveWeight(0);
    const a = this.action(p.clip);
    const d = a.getClip().duration;
    a.time = Math.min(d - 1e-3, Math.max(0, p.time)); a.setEffectiveWeight(p.prev ? p.w : 1);
    this.active = [p.clip];
    if (p.prev && p.prev !== p.clip) {
      const b = this.action(p.prev); b.time = Math.min(b.getClip().duration - 1e-3, Math.max(0, p.prevTime)); b.setEffectiveWeight(1 - p.w); this.active.push(p.prev);
    } else a.setEffectiveWeight(1);
    this.mixer.update(0);
    this.measure();
  }

  private measure() {
    this.root.updateMatrixWorld(true);
    const o = this.root.position;
    this.handBone.getWorldPosition(tmp); this.hand.x = tmp.x - o.x; this.hand.y = -(tmp.y - o.y);
    this.headBone.getWorldPosition(tmp); this.neck.x = tmp.x - o.x; this.neck.y = -(tmp.y - o.y) + this.heightPx * 0.06;
    this.tipObj.getWorldPosition(tmp); this.tip.x = tmp.x - o.x; this.tip.y = -(tmp.y - o.y);
  }

  private applyTransform() {
    const w = this.skin.wide ?? 1, S = this.S;
    this.root.position.x = this.x; this.root.position.y = -this.y;
    this.root.rotation.set(0, this.facing > 0 ? TURN : -TURN, 0);
    this.root.rotateOnWorldAxis(Z, -this.extraRot);
    this.root.scale.set(S * w * (1 - this.squash * 0.6), S * (1 + this.squash), S * w * (1 - this.squash * 0.6));
  }

  setPos(x: number, y: number, facing: number) { this.x = x; this.y = y; this.facing = facing; this.applyTransform(); }
  wx(v: number) { return this.x + v; }
  wy(v: number) { return this.y + v; }

  setFlash(color: number | null) {
    const on = color !== null;
    if (on === this.flashOn && !this.tintOn) return;
    this.flashOn = on; this.tintOn = 0;
    for (const m of this.mats) {
      if (m === this.glowMat) { m.emissive.setHex(on ? 0xffffff : this.skin.glow); m.emissiveIntensity = on ? 2 : this.skin.glowPower; }
      else { m.emissive.setHex(on ? 0xffffff : 0x000000); m.emissiveIntensity = on ? 1.4 : 0; }
    }
  }
  /** A soft self-illumination used for "broken" and "empowered" states. */
  setTintMul(color: number) {
    if (this.tintOn === color) return;
    this.tintOn = color; this.flashOn = false;
    for (const m of this.mats) {
      if (m === this.glowMat) { m.emissive.setHex(this.skin.glow); m.emissiveIntensity = this.skin.glowPower; }
      else { m.emissive.setHex(color); m.emissiveIntensity = 0.1; }
    }
  }
  setAlpha(a: number) {
    if (a === this.alpha) return;
    this.alpha = a; this.root.visible = a > 0.01;
    const tr = a < 0.999;
    for (const m of this.allMats) {
      if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; } // the OPAQUE shader path must be switched off to fade
      m.opacity = a;
    }
  }
  setVisible(v: boolean) { this.root.visible = v && this.alpha > 0.01; }
  ghost(color: number, alpha: number, life: number) { this.stage.spawnGhost(this, color, alpha, life); }
  destroy() {
    this.stage.scene.remove(this.root); this.stage.bodies.delete(this);
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root);
    // geometry is shared with the base model; skeleton textures and materials are ours
    this.root.traverse((o) => { const sk = (o as THREE.SkinnedMesh).skeleton; if (sk) sk.dispose(); });
    for (const m of this.allMats) m.dispose();
  }
}
const Z = new THREE.Vector3(0, 0, 1);

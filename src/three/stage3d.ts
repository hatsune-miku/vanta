import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

import { dressCharacter } from './costume'
import { type RimLight, prepareElle, styleElleMaterial } from './elle'

import { A, type PoseRef } from '../art/anims'
import { VIEW_H, VIEW_W } from '../config'

/**
 * Characters are rigged 3D bodies driven by a ready-made animation library
 * (Quaternius "Universal Animation Library" 1 + 2, CC0), drawn by three.js into an
 * offscreen canvas that Phaser shows as one layer between the backdrop and the effects.
 * World units are the game's pixels; three's y axis is flipped.
 */

export interface SkinDef {
  base: 'Elle' | 'M'
  height: number // standing height in px
  wide?: number // extra girth for heavy frames
  main: number
  joints: number
  glow: number
  glowPower: number
  weapon: 'katana' | 'cleaver' | 'pistol' | 'maul' | 'great'
}

export const SKINS3: Record<string, SkinDef> = {
  vanta: {
    base: 'Elle',
    height: 184 * 1.2,
    main: 0x263b54,
    joints: 0x121c2d,
    glow: 0x2f9bff,
    glowPower: 0.25,
    weapon: 'katana',
  },
  grunt: {
    base: 'M',
    height: 194,
    main: 0x65433e,
    joints: 0x1a202b,
    glow: 0xff5030,
    glowPower: 1.1,
    weapon: 'cleaver',
  },
  gunner: {
    base: 'M',
    height: 186,
    main: 0x514c76,
    joints: 0x181a2b,
    glow: 0xff7a3d,
    glowPower: 1.1,
    weapon: 'pistol',
  },
  heavy: {
    base: 'M',
    height: 252,
    wide: 1.28,
    main: 0x3f4b57,
    joints: 0x10151a,
    glow: 0xff5030,
    glowPower: 1.2,
    weapon: 'maul',
  },
  titan: {
    base: 'M',
    height: 360,
    wide: 1.36,
    main: 0x556170,
    joints: 0x12171c,
    glow: 0xff6a3d,
    glowPower: 1.4,
    weapon: 'maul',
  },
  warden: {
    base: 'M',
    height: 322,
    wide: 1.12,
    main: 0x2b2533,
    joints: 0x0c0a10,
    glow: 0xff2d2d,
    glowPower: 1.7,
    weapon: 'great',
  },
}

const MODEL_H = 1.72
const TURN = 1.22 // not a pure profile: a little of the chest stays toward the camera

function buildWeapon(kind: SkinDef['weapon'], ghost: THREE.Material | null) {
  const g = new THREE.Group(),
    tip = new THREE.Object3D()
  const mat = (color: number, emissive = 0, power = 1) =>
    ghost ??
    new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: power, metalness: 0.6, roughness: 0.35 })
  const box = (w: number, h: number, d: number, y: number, m: THREE.Material, x = 0) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
    b.position.set(x, y, 0)
    g.add(b)
    return b
  }
  let len = 1
  if (kind === 'katana') {
    len = 1.08
    box(0.03, 0.2, 0.035, -0.02, mat(0x1c2233))
    box(0.09, 0.015, 0.05, 0.085, mat(0xdfe6f2))
    box(0.012, 1.0, 0.045, 0.59, ghost ?? new THREE.MeshBasicMaterial({ color: 0xbfe2ff }))
  } else if (kind === 'cleaver') {
    len = 0.8
    box(0.035, 0.2, 0.04, -0.02, mat(0x14171f))
    box(0.02, 0.68, 0.13, 0.44, mat(0x4d566b))
    box(0.024, 0.68, 0.02, 0.44, ghost ?? new THREE.MeshBasicMaterial({ color: 0xff6a40 }), 0).position.z = 0.07
  } else if (kind === 'pistol') {
    len = 0.3
    box(0.04, 0.12, 0.05, -0.02, mat(0x15131f))
    const b = box(0.045, 0.3, 0.06, 0.12, mat(0x5d5775))
    b.rotation.x = 0
    box(0.02, 0.05, 0.02, 0.29, ghost ?? new THREE.MeshBasicMaterial({ color: 0xff7a3d }))
  } else if (kind === 'maul') {
    len = 1.15
    box(0.045, 1.2, 0.045, 0.45, mat(0x10151a))
    box(0.3, 0.34, 0.26, 1.02, mat(0x3f4b57))
    box(0.31, 0.05, 0.27, 1.02, ghost ?? new THREE.MeshBasicMaterial({ color: 0xff5030 }))
  } else {
    len = 1.5
    box(0.04, 0.3, 0.045, -0.03, mat(0x0c0a10))
    box(0.2, 0.03, 0.06, 0.13, mat(0x2b2533))
    box(0.03, 1.4, 0.15, 0.85, mat(0x2b2533))
    box(0.034, 1.4, 0.025, 0.85, ghost ?? new THREE.MeshBasicMaterial({ color: 0xff3030 })).position.z = 0.08
  }
  tip.position.y = len
  g.add(tip)
  return { g, tip }
}

/** Anything an actor can be drawn with (3D body or the drone sprite). */
export interface Puppet {
  /** world-space offsets from the actor's feet, updated by apply() */
  hand: { x: number; y: number }
  neck: { x: number; y: number }
  tip: { x: number; y: number }
  x: number
  y: number
  alpha: number
  facing: number
  squash: number
  extraRot: number
  /** A roll about the middle of the body (extraRot leans it about the feet). */
  spin: number
  /** 0..1: the weapon is lowered onto the floor instead of following the hand below it (kneeling bodies) */
  rest: number
  /** The body is drawn left-right mirrored, so the weapon is in its other hand. */
  mirror: boolean
  /** The weapon is held blade-down from the fist. */
  reverseGrip: boolean
  heightPx: number
  widthPx: number
  apply(p: PoseRef): void
  setPos(x: number, y: number, facing: number): void
  wx(v: number): number
  wy(v: number): number
  setFlash(color: number | null): void
  setTintMul(color: number, power?: number): void
  /** A glow along the silhouette, for bodies that carry their own light (only the hero does). */
  setRim(color: number, power: number): void
  setAlpha(a: number): void
  setVisible(v: boolean): void
  ghost(color: number, alpha: number, life: number): void
  /** Leave an afterimage in a given pose somewhere else; the body itself is re-posed on its next update. */
  ghostAt(pose: PoseRef, x: number, y: number, facing: number, color: number, alpha: number, life: number): void
  destroy(): void
}

interface GhostBody {
  root: THREE.Object3D
  weapon: THREE.Group
  bones: THREE.Bone[]
  mat: THREE.MeshBasicMaterial
  life: number
  max: number
  a0: number
  skin: string
}

function disposeSkeletons(root: THREE.Object3D) {
  const skeletons = new Set<THREE.Skeleton>()
  root.traverse((o) => {
    const skeleton = (o as THREE.SkinnedMesh).skeleton
    if (skeleton) skeletons.add(skeleton)
  })
  for (const skeleton of skeletons) skeleton.dispose()
}

/** Model geometry is shared; only the procedural weapon belongs to this instance. */
function disposeWeapon(weapon: THREE.Group) {
  weapon.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose()
  })
}

export class Stage3D {
  static I: Stage3D
  renderer!: THREE.WebGLRenderer
  scene = new THREE.Scene()
  cam = new THREE.OrthographicCamera(-VIEW_W / 2, VIEW_W / 2, VIEW_H / 2, -VIEW_H / 2, 1, 4000)
  clips = new Map<string, THREE.AnimationClip>()
  private elleClips = new Map<string, THREE.AnimationClip>()
  private bases: Record<string, THREE.Object3D> = {}
  private characters: Record<string, THREE.Object3D> = {}
  canvas!: HTMLCanvasElement
  private ghosts: GhostBody[] = []
  /**
   * The tactical view of the overload charge: the same bodies seen from high above in perspective, standing on
   * a grid of light, each enemy marked by a cross. `k` runs 0 (the ordinary side view) to 1 (fully overhead).
   */
  private top = { k: 0, x: 0, ground: 0, l: 0, r: 0 }
  private overhead = new THREE.PerspectiveCamera(30, VIEW_W / VIEW_H, 10, 60000)
  private grid: THREE.LineSegments | null = null
  private gridSpan = ''
  private crosses: THREE.Group[] = []
  private crossMaterial = new THREE.MeshBasicMaterial({
    color: 0xff5fd0,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  private heroMaterial = new THREE.MeshBasicMaterial({
    color: 0x6fd8ff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  /** The hero's floor light. It falls off with distance, so legs catch more of it than heads. */
  private foot = new THREE.PointLight(0x3d9cff, 0, 640, 1)
  private ghostPool: Record<string, GhostBody[]> = {}
  bodies = new Set<Body3D>()

  static async load(): Promise<Stage3D> {
    if (Stage3D.I) return Stage3D.I
    const s = new Stage3D()
    s.canvas = document.createElement('canvas')
    s.canvas.width = VIEW_W
    s.canvas.height = VIEW_H
    s.renderer = new THREE.WebGLRenderer({
      canvas: s.canvas,
      antialias: true,
      alpha: true,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    })
    s.renderer.setPixelRatio(1)
    s.renderer.setSize(VIEW_W, VIEW_H, false)
    s.renderer.setClearColor(0x000000, 0)
    s.renderer.toneMapping = THREE.ACESFilmicToneMapping
    const loader = new GLTFLoader(),
      base = import.meta.env.BASE_URL + 'models/'
    const [f, a1, a2] = await Promise.all(
      ['Elle_Vanta.glb', 'UAL1_Standard.glb', 'UAL2_Standard.glb'].map((n) => loader.loadAsync(base + n))
    )
    for (const c of [...a1.animations, ...a2.animations]) s.clips.set(c.name, c)
    // the models are packed down to the clips the table names (tools/pack-models.mjs); catch a stale pack early
    for (const a of Object.values(A))
      if (!s.clips.has(a.clip))
        console.error(`animation clip missing from models: ${a.clip} (run node tools/pack-models.mjs)`)
    for (const clip of f.animations) s.elleClips.set(clip.name, clip)
    for (const a of Object.values(A)) {
      if (!s.elleClips.has(a.clip)) throw new Error(`Elle animation missing: ${a.clip} (run pnpm models:pack)`)
    }
    prepareElle(f.scene)
    s.bases.Elle = f.scene
    s.bases.M = a1.scene
    // lighting: cool sky fill, a neutral key from the camera side, blue and pink rims from behind
    s.scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x0b101c, 1.0))
    const key = new THREE.DirectionalLight(0xffffff, 2.0)
    key.position.set(300, 500, 900)
    s.scene.add(key)
    const rimA = new THREE.DirectionalLight(0x2f9bff, 4.5)
    rimA.position.set(-500, 300, -400)
    s.scene.add(rimA)
    const rimB = new THREE.DirectionalLight(0xff4fc8, 3.2)
    rimB.position.set(500, 150, -500)
    s.scene.add(rimB)
    s.scene.add(s.foot)
    s.cam.position.z = 2000
    Stage3D.I = s
    return s
  }

  cloneCharacter(key: string) {
    if (!this.characters[key]) {
      const skin = SKINS3[key]
      const template = cloneSkinned(this.bases[skin.base])
      if (skin.base !== 'Elle') dressCharacter(template, key, skin)
      this.characters[key] = template
    }
    return cloneSkinned(this.characters[key])
  }

  characterClip(key: string, name: string) {
    const clips = SKINS3[key].base === 'Elle' ? this.elleClips : this.clips
    return clips.get(name) ?? clips.get('Idle_Loop')!
  }

  /** Match Phaser's camera (centre in world px, zoom) and draw. */
  render(cx: number, cy: number, zoom: number) {
    const c = this.cam
    c.left = -VIEW_W / 2 / zoom
    c.right = VIEW_W / 2 / zoom
    c.top = VIEW_H / 2 / zoom
    c.bottom = -VIEW_H / 2 / zoom
    c.position.x = cx
    c.position.y = -cy
    c.updateProjectionMatrix()
    const top = this.top
    if (top.k <= 0.001) {
      this.renderer.render(this.scene, c)
      return
    }
    // Swing from a long-lens view that matches the side view up to a wide one looking down on the floor.
    const s = top.k * top.k * (3 - 2 * top.k),
      o = this.overhead,
      rad = Math.PI / 180,
      fov = 6 + (36 - 6) * s,
      level = VIEW_H / 2 / zoom / Math.tan((6 * rad) / 2),
      above = Math.max(1000, (top.r - top.l) / 2 + 200) / (Math.tan((36 * rad) / 2) * (VIEW_W / VIEW_H)),
      distance = level + (above - level) * s,
      pitch = 60 * rad * s,
      tx = cx + (top.x - cx) * s,
      ty = -cy + (-top.ground + 70 + cy) * s
    o.fov = fov
    o.position.set(tx, ty + Math.sin(pitch) * distance, Math.cos(pitch) * distance)
    o.lookAt(tx, ty, 0)
    o.updateProjectionMatrix()
    this.renderer.render(this.scene, o)
  }

  /**
   * Open or close the tactical view. `marks` are the points to cross-mark on the floor (world px); the first
   * one flagged `hero` gets a ring instead.
   */
  setTop(k: number, x: number, ground: number, l: number, r: number, marks: { x: number; hero?: boolean }[]) {
    const top = this.top
    top.k = k
    top.x = x
    top.ground = ground
    top.l = l
    top.r = r
    const on = k > 0.001,
      span = `${l}:${r}:${ground}`
    if (on && this.gridSpan !== span) {
      // a floor of light under the fight: lines every 100 px, the fighting line itself brighter
      this.gridSpan = span
      if (this.grid) {
        this.scene.remove(this.grid)
        this.grid.geometry.dispose()
      }
      const points: number[] = [],
        colors: number[] = [],
        x0 = Math.floor((l - 300) / 100) * 100,
        x1 = Math.ceil((r + 300) / 100) * 100,
        z0 = -900,
        z1 = 700,
        line = (ax: number, az: number, bx: number, bz: number, bright: number) => {
          points.push(ax, -ground, az, bx, -ground, bz)
          for (let i = 0; i < 2; i++) colors.push(0.18 * bright, 0.42 * bright, 1 * bright)
        }
      for (let gx = x0; gx <= x1; gx += 100) line(gx, z0, gx, z1, gx % 500 === 0 ? 0.55 : 0.28)
      for (let gz = z0; gz <= z1; gz += 100) line(x0, gz, x1, gz, gz === 0 ? 1.3 : 0.28)
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      this.grid = new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      )
      this.grid.frustumCulled = false
      this.scene.add(this.grid)
    }
    if (this.grid) {
      this.grid.visible = on
      ;(this.grid.material as THREE.LineBasicMaterial).opacity = k
    }
    this.crossMaterial.opacity = this.heroMaterial.opacity = k
    for (let i = 0; i < Math.max(marks.length, this.crosses.length); i++) {
      const mark = on ? marks[i] : undefined
      let cross = this.crosses[i]
      if (!mark) {
        if (cross) cross.visible = false
        continue
      }
      if (!cross) {
        cross = new THREE.Group()
        const bar = (w: number, h: number, d: number, y = 0) => {
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.crossMaterial)
          mesh.position.y = y
          mesh.frustumCulled = false
          cross.add(mesh)
        }
        // two bars lying crossed on the floor, and a thin beam standing on their centre
        bar(340, 5, 9)
        bar(9, 5, 340)
        bar(5, 300, 5, 150)
        this.crosses[i] = cross
        this.scene.add(cross)
      }
      cross.visible = true
      cross.position.set(mark.x, -ground + 3, 0)
      for (const mesh of cross.children)
        (mesh as THREE.Mesh).material = mark.hero ? this.heroMaterial : this.crossMaterial
      // the hero's mark is a tight diamond rather than a wide cross
      cross.rotation.y = mark.hero ? Math.PI / 4 : 0
      cross.scale.setScalar(mark.hero ? 0.45 : 1)
    }
  }

  /** Place the hero's floor light at a point on the ground (world px); it lights every nearby body from below. */
  setFootLight(x: number, y: number, strength: number, color: number) {
    // slightly above the floor and toward the camera, so surfaces facing the viewer catch it
    this.foot.position.set(x, -y + 12, 170)
    this.foot.color.setHex(color)
    // intensity is quoted at the light's own distance from the feet
    this.foot.intensity = strength * 170
  }

  /* ----------------------------- afterimages ----------------------------- */

  spawnGhost(src: Body3D, color: number, alpha: number, life: number) {
    let g = this.ghostPool[src.skinKey]?.pop()
    if (!g) {
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: alpha,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      const root = this.cloneCharacter(src.skinKey)
      const bones: THREE.Bone[] = []
      root.traverse((o) => {
        if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone)
        const m = o as THREE.Mesh
        if (m.isMesh) {
          m.material = mat
          m.frustumCulled = false
        }
      })
      const weapon = buildWeapon(src.skin.weapon, mat).g
      root.getObjectByName('hand_r')!.add(weapon)
      g = { root, weapon, bones, mat, life: 0, max: life, a0: alpha, skin: src.skinKey }
    }
    for (let i = 0; i < g.bones.length && i < src.bones.length; i++) {
      const a = src.bones[i],
        b = g.bones[i]
      b.position.copy(a.position)
      b.quaternion.copy(a.quaternion)
      b.scale.copy(a.scale)
    }
    g.root.position.copy(src.root.position)
    g.root.position.z = -60
    g.root.rotation.copy(src.root.rotation)
    g.root.scale.copy(src.root.scale)
    g.mat.color.setHex(color)
    g.mat.opacity = alpha
    g.life = 0
    g.max = life
    g.a0 = alpha
    this.scene.add(g.root)
    this.ghosts.push(g)
  }

  update(dt: number) {
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i]
      g.life += dt
      const t = g.life / g.max
      if (t >= 1) {
        this.scene.remove(g.root)
        ;(this.ghostPool[g.skin] ??= []).push(g)
        this.ghosts.splice(i, 1)
        continue
      }
      g.mat.opacity = g.a0 * (1 - t)
    }
  }

  /** Drop everything a finished scene left behind. */
  reset() {
    this.setTop(0, 0, 0, 0, 0, [])
    for (const b of [...this.bodies]) b.destroy()
    for (const g of [...this.ghosts, ...Object.values(this.ghostPool).flat()]) {
      this.scene.remove(g.root)
      disposeSkeletons(g.root)
      disposeWeapon(g.weapon)
      g.mat.dispose()
    }
    this.ghosts.length = 0
    this.ghostPool = {}
  }
}

const tmp = new THREE.Vector3(),
  tmpB = new THREE.Vector3(),
  tmpC = new THREE.Vector3(),
  swing = new THREE.Quaternion(),
  frame = new THREE.Quaternion(),
  frameInverse = new THREE.Quaternion()

export class Body3D implements Puppet {
  root: THREE.Object3D
  bones: THREE.Bone[] = []
  skin: SkinDef
  hand = { x: 0, y: 0 }
  neck = { x: 0, y: 0 }
  tip = { x: 0, y: 0 }
  x = 0
  y = 0
  alpha = 1
  facing = 1
  squash = 0
  extraRot = 0
  spin = 0
  rest = 0
  mirror = false
  reverseGrip = false
  heightPx: number
  widthPx: number
  private mixer: THREE.AnimationMixer
  private actions = new Map<string, THREE.AnimationAction>()
  /** lit materials (flash / tint act on these) */
  private mats: THREE.MeshStandardMaterial[] = []
  /** every material of the body and its weapon (fades act on these) */
  private allMats: THREE.Material[] = []
  private emissions = new Map<THREE.MeshStandardMaterial, { color: THREE.Color; power: number }>()
  private handBone: THREE.Object3D
  private headBone: THREE.Object3D
  private tipObj: THREE.Object3D
  private weapon: THREE.Group
  private S: number
  private flashOn = false
  private tintOn = 0
  private tintPower = 0
  private rim: RimLight | null = null
  private stage = Stage3D.I
  private active: string[] = []

  constructor(
    public skinKey: string,
    z = 0
  ) {
    const skin = (this.skin = SKINS3[skinKey])
    this.heightPx = skin.height
    this.widthPx = skin.height * 0.29 * (skin.wide ?? 1)
    this.S = skin.height / MODEL_H
    this.root = this.stage.cloneCharacter(skinKey)
    if (skin.base === 'Elle') this.rim = { color: { value: new THREE.Color(0x5fb0ff) }, power: { value: 0 } }
    const instances = new Map<THREE.Material, THREE.Material>()
    this.root.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.push(o as THREE.Bone)
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.frustumCulled = false
      const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      const mapped = source.map((material) => {
        if (!instances.has(material)) {
          const instance = material.clone()
          styleElleMaterial(instance, this.rim)
          instances.set(material, instance)
        }
        return instances.get(material)!
      })
      mesh.material = mapped.length === 1 ? mapped[0] : mapped
    })
    this.handBone = this.root.getObjectByName('hand_r')!
    this.headBone = this.root.getObjectByName('Head')!
    const w = buildWeapon(skin.weapon, null)
    this.weapon = w.g
    this.handBone.add(w.g)
    this.tipObj = w.tip
    const materials = new Set(instances.values())
    w.g.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) materials.add(mesh.material as THREE.Material)
    })
    this.allMats = [...materials]
    this.mats = this.allMats.filter(
      (m): m is THREE.MeshStandardMaterial => (m as THREE.MeshStandardMaterial).isMeshStandardMaterial
    )
    for (const material of this.mats) {
      this.emissions.set(material, { color: material.emissive.clone(), power: material.emissiveIntensity })
    }
    this.mixer = new THREE.AnimationMixer(this.root)
    this.root.position.z = z
    this.stage.scene.add(this.root)
    this.stage.bodies.add(this)
    this.applyTransform()
  }

  private action(name: string) {
    let a = this.actions.get(name)
    if (!a) {
      const clip = this.stage.characterClip(this.skinKey, name)
      a = this.mixer.clipAction(clip)
      a.setLoop(THREE.LoopRepeat, Infinity)
      a.clampWhenFinished = true
      a.paused = true
      a.play()
      a.setEffectiveWeight(0)
      this.actions.set(name, a)
    }
    return a
  }

  apply(p: PoseRef) {
    for (const n of this.active) if (n !== p.clip && n !== p.prev) this.action(n).setEffectiveWeight(0)
    const a = this.action(p.clip)
    const d = a.getClip().duration
    a.time = Math.min(d - 1e-3, Math.max(0, p.time))
    a.setEffectiveWeight(p.prev ? p.w : 1)
    this.active = [p.clip]
    if (p.prev && p.prev !== p.clip) {
      const b = this.action(p.prev)
      b.time = Math.min(b.getClip().duration - 1e-3, Math.max(0, p.prevTime))
      b.setEffectiveWeight(1 - p.w)
      this.active.push(p.prev)
    } else a.setEffectiveWeight(1)
    this.mixer.update(0)
    this.restWeapon()
    this.measure()
  }

  /**
   * A kneeling pose points the weapon hand at the ground, which would push a long weapon through the floor.
   * Swing it up in its own vertical plane until the head lies on the floor, as if the body were leaning on it.
   */
  private restWeapon() {
    const weapon = this.weapon
    if (this.reverseGrip) weapon.quaternion.copy(REVERSE_GRIP)
    else weapon.quaternion.identity()
    if (this.rest <= 0) return
    this.root.updateMatrixWorld(true)
    this.handBone.getWorldQuaternion(frame)
    frameInverse.copy(frame).invert()
    const hand = this.handBone.getWorldPosition(tmp),
      // keep the head on the floor, not half inside it
      floor = this.root.position.y + this.heightPx * 0.05
    // The body is scaled unevenly, so one swing lands close; a second and third settle it.
    for (let pass = 0; pass < 3; pass++) {
      const shaft = this.tipObj.getWorldPosition(tmpB).sub(hand),
        length = shaft.length(),
        drop = Math.max(-length * 0.98, floor - hand.y),
        error = hand.y + shaft.y - floor
      if (drop >= 0 || (pass === 0 && error >= 0)) break
      if (Math.abs(error) < 1) break
      const flat = Math.hypot(shaft.x, shaft.z) || 1e-6,
        reach = Math.sqrt(length * length - drop * drop)
      tmpC.set((shaft.x / flat) * reach, drop, (shaft.z / flat) * reach).normalize()
      // express the world-space swing in the hand's frame, where the weapon lives
      swing.setFromUnitVectors(shaft.normalize(), tmpC).premultiply(frameInverse).multiply(frame)
      weapon.quaternion.premultiply(swing)
      weapon.updateMatrixWorld(true)
    }
    if (this.rest < 1) {
      swing.copy(weapon.quaternion)
      weapon.quaternion.identity().slerp(swing, this.rest)
      weapon.updateMatrixWorld(true)
    }
  }

  private measure() {
    this.root.updateMatrixWorld(true)
    const o = this.root.position
    this.handBone.getWorldPosition(tmp)
    this.hand.x = tmp.x - o.x
    this.hand.y = -(tmp.y - o.y)
    this.headBone.getWorldPosition(tmp)
    this.neck.x = tmp.x - o.x
    this.neck.y = -(tmp.y - o.y) + this.heightPx * 0.06
    this.tipObj.getWorldPosition(tmp)
    this.tip.x = tmp.x - o.x
    this.tip.y = -(tmp.y - o.y)
  }

  private applyTransform() {
    const w = this.skin.wide ?? 1,
      S = this.S
    // A lean turns the body about its feet. A spin must turn it about its middle, so the feet are moved to
    // keep that point where the lean alone would have put it.
    const turn = this.extraRot + this.spin,
      mid = this.heightPx * 0.5
    this.root.position.x = this.x + mid * (Math.sin(this.extraRot) - Math.sin(turn))
    this.root.position.y = -this.y + mid * (Math.cos(this.extraRot) - Math.cos(turn))
    this.root.rotation.set(0, this.facing > 0 ? TURN : -TURN, 0)
    this.root.rotateOnWorldAxis(Z, -turn)
    this.root.scale.set(
      S * w * (1 - this.squash * 0.6) * (this.mirror ? -1 : 1),
      S * (1 + this.squash),
      S * w * (1 - this.squash * 0.6)
    )
  }

  setPos(x: number, y: number, facing: number) {
    this.x = x
    this.y = y
    this.facing = facing
    this.applyTransform()
    this.measure()
  }
  wx(v: number) {
    return this.x + v
  }
  wy(v: number) {
    return this.y + v
  }

  setFlash(color: number | null) {
    const on = color !== null
    if (on === this.flashOn && !this.tintOn) return
    this.flashOn = on
    this.tintOn = 0
    for (const m of this.mats) {
      const base = this.emissions.get(m)!
      m.emissive.copy(on ? FLASH_COLOR : base.color)
      m.emissiveIntensity = on ? 1.4 : base.power
    }
  }
  /** Self-illumination of the unlit surfaces, used for "dying" and "empowered" states. */
  setTintMul(color: number, power = 0.1) {
    if (this.tintOn === color && this.tintPower === power) return
    this.tintOn = color
    this.tintPower = power
    this.flashOn = false
    for (const m of this.mats) {
      const base = this.emissions.get(m)!
      if (base.color.getHex() !== 0) {
        m.emissive.copy(base.color)
        m.emissiveIntensity = base.power
      } else {
        m.emissive.setHex(color)
        m.emissiveIntensity = power
      }
    }
  }
  setRim(color: number, power: number) {
    if (!this.rim) return
    this.rim.color.value.setHex(color)
    this.rim.power.value = power
  }
  setAlpha(a: number) {
    if (a === this.alpha) return
    this.alpha = a
    this.root.visible = a > 0.01
    const tr = a < 0.999
    for (const m of this.allMats) {
      if (m.transparent !== tr) {
        m.transparent = tr
        m.needsUpdate = true
      } // the OPAQUE shader path must be switched off to fade
      m.opacity = a
    }
  }
  setVisible(v: boolean) {
    this.root.visible = v && this.alpha > 0.01
  }
  ghost(color: number, alpha: number, life: number) {
    this.stage.spawnGhost(this, color, alpha, life)
  }
  ghostAt(pose: PoseRef, x: number, y: number, facing: number, color: number, alpha: number, life: number) {
    const mirror = this.mirror,
      grip = this.reverseGrip
    this.mirror = this.reverseGrip = false
    this.setPos(x, y, facing)
    this.apply(pose)
    this.stage.spawnGhost(this, color, alpha, life)
    this.mirror = mirror
    this.reverseGrip = grip
  }
  destroy() {
    this.stage.scene.remove(this.root)
    this.stage.bodies.delete(this)
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.root)
    // geometry is shared with the base model; skeleton textures and materials are ours
    disposeSkeletons(this.root)
    disposeWeapon(this.weapon)
    for (const m of this.allMats) m.dispose()
  }
}
const Z = new THREE.Vector3(0, 0, 1)
const REVERSE_GRIP = new THREE.Quaternion().setFromAxisAngle(Z, Math.PI)
const FLASH_COLOR = new THREE.Color(0xffffff)

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export interface CostumePalette {
  main: number
  joints: number
  glow: number
  glowPower: number
}

type Point = [number, number, number]

/** Dress the bind pose once. Clothing shares the animation skeleton and cached geometry. */
export function dressCharacter(root: THREE.Object3D, kind: string, palette: CostumePalette) {
  const hero = kind === 'vanta'
  const heavy = kind === 'heavy' || kind === 'titan'
  const boss = kind === 'warden'
  const gunner = kind === 'gunner'
  const materials = {
    suit: new THREE.MeshStandardMaterial({ color: palette.joints, roughness: 0.88, metalness: 0.08 }),
    armor: new THREE.MeshStandardMaterial({ color: palette.main, roughness: 0.48, metalness: 0.55 }),
    trim: new THREE.MeshStandardMaterial({
      color: hero ? 0xc8d2dc : heavy ? 0xbba16b : 0x939eac,
      roughness: 0.45,
      metalness: 0.7,
    }),
    dark: new THREE.MeshStandardMaterial({ color: 0x101923, roughness: 0.36, metalness: 0.6 }),
    light: new THREE.MeshStandardMaterial({
      color: palette.glow,
      emissive: palette.glow,
      emissiveIntensity: hero ? 1.5 : 1.1,
      roughness: 0.28,
      metalness: 0.35,
    }),
    hair: new THREE.MeshStandardMaterial({
      color: hero ? 0xc5cfdb : palette.main,
      roughness: 0.8,
      metalness: 0.1,
      flatShading: true,
    }),
  }
  for (const [name, material] of Object.entries(materials)) material.name = `${kind}:${name}`
  let source: THREE.SkinnedMesh | undefined
  root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    source ??= mesh
    const material = mesh.material as THREE.MeshStandardMaterial
    if (material.name === 'M_Joints') {
      mesh.material = materials.suit
      return
    }
    // The supplied mannequin has one surface for its whole body. Colour the
    // undersuit, gloves, boots and exposed face in bind space, before skinning.
    const geometry = mesh.geometry.clone()
    const position = geometry.getAttribute('position')
    const colors = new Float32Array(position.count * 3)
    const color = new THREE.Color()
    for (let i = 0; i < position.count; i++) {
      const x = Math.abs(position.getX(i)),
        y = position.getY(i)
      let hex = palette.joints
      if (y > 1.54 && x < 0.15) hex = hero ? 0xc39a87 : palette.main
      else if (y < 0.27 || x > (hero ? 0.6 : 0.7)) hex = 0x172333
      else if (y > 1.2 && x < 0.19) hex = palette.main
      color.setHex(hex).toArray(colors, i * 3)
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    mesh.geometry = geometry
    mesh.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.75,
      metalness: 0.15,
    })
  })
  if (!source) throw new Error(`Missing character skeleton: ${kind}`)
  const skeleton = source.skeleton
  const pieces = new Map<THREE.Material, THREE.BufferGeometry[]>()

  function add(
    bone: string,
    geometry: THREE.BufferGeometry,
    at: Point,
    size: Point,
    material: THREE.Material,
    rotation: Point = [0, 0, 0]
  ) {
    const joint = skeleton.bones.findIndex((b) => b.name === bone)
    if (joint < 0) throw new Error(`Missing costume attachment: ${bone}`)
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...at),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(...size)
    )
    geometry.applyMatrix4(matrix)
    const count = geometry.getAttribute('position').count
    const indices = new Uint16Array(count * 4),
      weights = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      indices[i * 4] = joint
      weights[i * 4] = 1
    }
    geometry.setAttribute('skinIndex', new THREE.BufferAttribute(indices, 4))
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4))
    // Rounded boxes are non-indexed; normalise all pieces before merging.
    const flat = geometry.index ? geometry.toNonIndexed() : geometry
    if (flat !== geometry) geometry.dispose()
    const group = pieces.get(material) ?? []
    group.push(flat)
    pieces.set(material, group)
  }
  function box(bone: string, at: Point, size: Point, material: THREE.Material, rotation: Point = [0, 0, 0]) {
    add(bone, new RoundedBoxGeometry(1, 1, 1, 1, 0.12), at, size, material, rotation)
  }
  function oval(bone: string, at: Point, size: Point, material: THREE.Material, start = 0, length = Math.PI) {
    add(bone, new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, start, length), at, size, material)
  }
  function band(bone: string, at: Point, size: Point, material: THREE.Material, rotation: Point = [0, 0, 0]) {
    add(bone, new THREE.CylinderGeometry(0.86, 1, 1, 8), at, size, material, rotation)
  }

  const { suit, armor, trim, dark, light, hair } = materials
  // Cropped jacket / chest cuirass, collar, belt and an inset power cell.
  band('spine_03', [0, 1.32, -0.015], [hero ? 0.185 : 0.235, 0.28, hero ? 0.13 : 0.17], armor)
  band('neck_01', [0, 1.5, -0.012], [hero ? 0.083 : 0.11, 0.065, 0.08], dark)
  box('spine_03', [0, 1.365, hero ? 0.12 : 0.16], [0.043, 0.17, 0.025], dark)
  box('spine_03', [0, 1.39, hero ? 0.14 : 0.18], [0.018, 0.084, 0.018], light)
  box('spine_03', [0, 1.34, -0.155], [0.12, 0.2, 0.07], dark)
  box('spine_03', [0, 1.36, -0.195], [0.025, 0.11, 0.02], light)
  band('pelvis', [0, 1.005, -0.012], [0.16, 0.066, 0.12], dark)
  box('pelvis', [0, 1.01, 0.114], [0.066, 0.045, 0.026], trim)
  box('pelvis', [0, 1.01, 0.132], [0.025, 0.017, 0.01], light)

  for (const side of [-1, 1]) {
    const suffix = side > 0 ? 'l' : 'r'
    const shoulderX = hero ? 0.195 : 0.25
    const forearmX = hero ? 0.52 : 0.6
    const shoulderSize: Point = heavy ? [0.17, 0.14, 0.19] : boss ? [0.16, 0.09, 0.16] : [0.095, 0.085, 0.12]
    oval(`upperarm_${suffix}`, [side * shoulderX, 1.445, -0.06], shoulderSize, hero && side > 0 ? trim : armor)
    box(`upperarm_${suffix}`, [side * shoulderX, 1.485, 0.035], [heavy ? 0.2 : 0.09, 0.025, 0.025], light)
    band(`lowerarm_${suffix}`, [side * forearmX, 1.441, -0.066], [0.064, hero ? 0.16 : 0.18, 0.07], armor, [
      0,
      0,
      Math.PI / 2,
    ])
    box(`lowerarm_${suffix}`, [side * forearmX, 1.49, -0.04], [0.1, 0.018, 0.04], trim)
    box(`lowerarm_${suffix}`, [side * (forearmX + 0.025), 1.495, 0.004], [0.05, 0.015, 0.017], light)
    box(`thigh_${suffix}`, [side * 0.15, 0.84, 0.012], [0.085, 0.17, 0.14], side > 0 ? dark : armor, [
      0,
      0,
      -side * 0.07,
    ])
    box(`calf_${suffix}`, [side * 0.089, 0.52, 0.066], [0.11, 0.11, 0.075], trim)
    box(`calf_${suffix}`, [side * 0.089, 0.335, 0.025], [0.105, 0.25, 0.12], armor)
    box(`calf_${suffix}`, [side * 0.089, 0.39, 0.088], [0.024, 0.13, 0.015], light)
    box(`foot_${suffix}`, [side * 0.089, 0.065, 0.06], [0.13, 0.1, 0.25], dark)
    box(`foot_${suffix}`, [side * 0.089, 0.025, 0.068], [0.14, 0.035, 0.27], trim)
    if (hero) {
      // Two ivory lapels and a split, short jacket hem retain the narrow silhouette.
      box('spine_03', [side * 0.078, 1.375, 0.108], [0.1, 0.15, 0.055], trim, [0, side * -0.18, side * 0.12])
      box('pelvis', [side * 0.14, 0.96, -0.035], [0.075, 0.24, 0.18], armor, [0, 0, side * 0.12])
    } else if (heavy) {
      for (const y of [1.39, 1.34])
        box('spine_03', [side * 0.135, y, 0.15], [0.09, 0.02, 0.035], trim, [0, side * 0.3, -side * 0.3])
    }
  }

  if (hero) {
    // Silver bob, swept fringe, visible jaw and a wraparound optical visor.
    oval('Head', [0, 1.708, -0.005], [0.128, 0.13, 0.126], hair, 0, Math.PI * 0.56)
    for (const side of [-1, 1]) {
      box('Head', [side * 0.105, 1.65, -0.035], [0.055, 0.19, 0.13], hair, [0.15, 0, side * -0.12])
      box('Head', [side * 0.108, 1.7, 0.035], [0.025, 0.045, 0.14], dark)
    }
    box('Head', [0, 1.704, 0.115], [0.2, 0.045, 0.045], dark)
    box('Head', [0.02, 1.707, 0.141], [0.15, 0.014, 0.015], light)
    box('Head', [-0.037, 1.755, 0.1], [0.15, 0.065, 0.06], hair, [0.1, 0, -0.3])
    box('Head', [0.061, 1.74, 0.1], [0.065, 0.1, 0.055], hair, [0.05, 0, 0.3])
    box('Head', [0, 1.626, 0.1], [0.135, 0.055, 0.055], suit)
  } else {
    oval('Head', [0, 1.697, 0], [heavy ? 0.15 : 0.135, 0.15, 0.135], armor)
    box('Head', [0, 1.7, 0.119], [0.23, 0.065, 0.055], dark)
    box('Head', [0, 1.706, 0.15], [boss ? 0.035 : 0.18, boss ? 0.095 : 0.018, 0.025], light)
    box('Head', [0, 1.62, 0.115], [0.12, 0.08, 0.065], dark)
    for (const x of [-0.035, 0, 0.035]) box('Head', [x, 1.62, 0.15], [0.012, 0.042, 0.018], trim)
    if (gunner) {
      oval('Head', [0.09, 1.72, 0.14], [0.05, 0.05, 0.035], dark)
      oval('Head', [0.09, 1.72, 0.17], [0.03, 0.03, 0.018], light)
      box('Head', [-0.13, 1.83, -0.04], [0.018, 0.22, 0.018], dark, [0, 0, -0.14])
      box('spine_03', [0.13, 1.32, 0.16], [0.065, 0.18, 0.06], trim)
    }
    if (boss) {
      for (const side of [-1, 1]) {
        box('Head', [side * 0.105, 1.855, -0.018], [0.05, 0.22, 0.075], armor, [0.12, 0, -side * 0.25])
        box(`upperarm_${side > 0 ? 'l' : 'r'}`, [side * 0.29, 1.51, -0.06], [0.24, 0.065, 0.25], trim, [
          0,
          0,
          side * 0.35,
        ])
      }
    }
    if (heavy) {
      box('spine_03', [0, 1.34, -0.21], [0.28, 0.28, 0.12], armor)
      for (const x of [-0.08, 0.08]) box('spine_03', [x, 1.38, -0.28], [0.04, 0.15, 0.02], light)
    }
  }

  // One skinned wardrobe, grouped by material, keeps draw calls independent of
  // the number of individual plates. Ghosts use this exact same silhouette.
  const groups: THREE.BufferGeometry[] = [],
    wardrobeMaterials: THREE.Material[] = []
  for (const [material, geometries] of pieces) {
    groups.push(mergeGeometries(geometries)!)
    wardrobeMaterials.push(material)
    for (const geometry of geometries) geometry.dispose()
  }
  const wardrobe = new THREE.SkinnedMesh(mergeGeometries(groups, true)!, wardrobeMaterials)
  for (const geometry of groups) geometry.dispose()
  wardrobe.name = 'Costume'
  wardrobe.bind(skeleton, source.bindMatrix)
  wardrobe.frustumCulled = false
  root.add(wardrobe)
}

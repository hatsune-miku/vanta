import * as THREE from 'three'

const X = new THREE.Vector3(1, 0, 0)
const Y = new THREE.Vector3(0, 1, 0)
const Z = new THREE.Vector3(0, 0, 1)
const IDENTITY = new THREE.Quaternion()

/** Author the heroine's silhouette after retargeting and before baking. All
 * edits are model-space, so facing changes and blended clips stay consistent. */
export function createHeroStylist(scene) {
  const bones = new Map()
  scene.traverse((bone) => bones.set(bone.name, bone))
  const world = new THREE.Quaternion(),
    parent = new THREE.Quaternion()
  const turn = new THREE.Quaternion(),
    direction = new THREE.Vector3(),
    wanted = new THREE.Vector3()

  function setWorld(bone, rotation) {
    bone.parent.getWorldQuaternion(parent).invert()
    bone.quaternion.copy(parent.multiply(rotation)).normalize()
    bone.updateMatrixWorld(true)
  }

  function rotate(name, axis, angle) {
    const bone = bones.get(name)
    bone.getWorldQuaternion(world)
    turn.setFromAxisAngle(axis, angle)
    setWorld(bone, world.premultiply(turn))
  }

  function aim(name, x, y, z, weight = 1) {
    const bone = bones.get(name)
    bone.getWorldQuaternion(world)
    direction.copy(Y).applyQuaternion(world)
    wanted.set(x, y, z).normalize()
    turn.setFromUnitVectors(direction, wanted)
    turn.slerp(IDENTITY, 1 - weight)
    setWorld(bone, world.premultiply(turn))
  }

  function pulse(time, center, width) {
    return Math.exp(-Math.pow((time - center) / width, 2))
  }

  return function styleHero(name, time, duration) {
    const breathe = Math.sin((time / duration) * Math.PI * 2)
    if (name === 'Spell_Simple_Enter' || name === 'Spell_Simple_Shoot') {
      // The free hand plants and opens the charge; keep the sword lowered.
      const reach = name === 'Spell_Simple_Shoot' ? Math.min(1, time / 0.3) : Math.min(1, time / 0.6) * 0.45
      rotate('spine_03', Y, -0.12)
      aim('upperarm_r', -0.12, -0.94, -0.22)
      aim('lowerarm_r', -0.08, -0.95, 0.1)
      aim('hand_r', 0, -0.62, -0.78)
      aim('upperarm_l', 0.35, -0.5 + reach * 0.6, 0.7)
      aim('lowerarm_l', -0.1, 0.65 - reach * 0.6, 0.8)
      aim('hand_l', 0, 0.15, 1)
      if (name === 'Spell_Simple_Shoot') {
        const grip = Math.min(1, Math.max(0, (time - 0.2) / 0.3))
        for (const finger of ['index', 'middle', 'ring', 'pinky']) {
          rotate(`${finger}_01_l`, X, grip * 0.7)
          rotate(`${finger}_02_l`, X, grip * 1.05)
          rotate(`${finger}_03_l`, X, grip * 0.75)
        }
      }
      return
    }
    if (name === 'Sword_Idle' || name === 'Sword_Regular_A_Rec') {
      // Narrow, upright contrapposto. The free hand rests at the hip while the
      // sword hangs behind the body instead of the default two-arm wide guard.
      rotate('spine_01', Z, 0.055)
      rotate('spine_03', Y, -0.2)
      rotate('Head', Y, 0.15)
      aim('upperarm_r', -0.12, -0.94, -0.22)
      aim('lowerarm_r', -0.08, -0.95, 0.1)
      aim('hand_r', 0, -0.62, -0.78)
      aim('upperarm_l', 0.55, -0.83, -0.02)
      aim('lowerarm_l', -0.78, -0.16, 0.42)
      aim('hand_l', 0.05, -0.8, 0.5)
      rotate('spine_02', X, breathe * 0.012)
      return
    }
    if (name === 'Sprint_Loop') {
      // Preserve the planted footwork, lean from the waist and trail the blade.
      rotate('spine_01', X, 0.2)
      rotate('spine_02', X, 0.1)
      rotate('Head', X, -0.22)
      aim('upperarm_r', -0.15, -0.8, -0.55)
      aim('lowerarm_r', -0.1, -0.5, -0.85)
      aim('hand_r', 0, 0.15, -1)
      aim('upperarm_l', 0.28, -0.8, -0.45)
      aim('lowerarm_l', 0.1, -0.5, -0.85)
      aim('hand_l', 0, -0.3, -1)
      return
    }
    if (name === 'NinjaJump_Idle_Loop') {
      rotate('spine_02', X, 0.08)
      aim('upperarm_r', -0.18, -0.25, -0.9, 0.75)
      aim('lowerarm_r', -0.18, 0.5, -0.7, 0.75)
      aim('hand_r', -0.1, 0.65, -0.75, 0.75)
      aim('upperarm_l', 0.8, 0.1, 0.25, 0.65)
      return
    }

    const peaks = {
      Sword_Regular_A: [[0.23, 0.16, 1]],
      Sword_Regular_B: [[0.25, 0.18, -1]],
      Sword_Regular_C: [[0.63, 0.32, 1]],
      Sword_Dash: [[0.32, 0.3, 1]],
      Sword_Attack: [
        [0.28, 0.16, -1],
        [0.85, 0.25, 1],
      ],
      Sword_Heavy_Combo: [
        [0.38, 0.22, 1],
        [1.15, 0.24, -1],
        [1.8, 0.25, 1],
        [2.55, 0.28, -1],
      ],
    }[name]
    if (!peaks) return
    let power = 0,
      twist = 0
    for (const [center, width, sign] of peaks) {
      const beat = pulse(time, center, width)
      power = Math.max(power, beat)
      twist += sign * beat
    }
    // Bigger shoulder/hip separation and a trailing open hand sell the arcs.
    // The original sword arm and contact times remain the basis of each cut.
    rotate('spine_01', X, power * (name === 'Sword_Dash' ? 0.24 : 0.1))
    rotate('spine_03', Y, twist * 0.28)
    rotate('Head', Y, -twist * 0.18)
    aim('upperarm_l', 0.6, -0.4, -0.7, power * 0.7)
    aim('lowerarm_l', 0.45, -0.3, -0.84, power * 0.65)
  }
}

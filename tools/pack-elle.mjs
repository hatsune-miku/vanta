// Prepare the attributed Elle model and bake Quaternius actions onto its VRoid rig.
// No Blender installation or runtime retargeting is needed.
import assert from 'node:assert/strict'
import { copyFileSync, statSync } from 'node:fs'
import sharp from 'sharp'
import * as THREE from 'three'

import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, resample, textureCompress } from '@gltf-transform/functions'

import { createHeroStylist } from './hero-motion.mjs'

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const target = await io.read('assets-src/models/Elle.glb')
const library = await io.read('public/models/UAL1_Standard.glb')
const extra = await io.read('public/models/UAL2_Standard.glb')
const root = target.getRoot()
const mapping = {
  J_Bip_C_Hips: 'pelvis',
  J_Bip_C_Spine: 'spine_01',
  J_Bip_C_Chest: 'spine_02',
  J_Bip_C_UpperChest: 'spine_03',
  J_Bip_C_Neck: 'neck_01',
  J_Bip_C_Head: 'Head',
}
for (const [side, suffix] of [
  ['L', 'l'],
  ['R', 'r'],
]) {
  for (const [name, bone] of Object.entries({
    Shoulder: 'clavicle',
    UpperArm: 'upperarm',
    LowerArm: 'lowerarm',
    Hand: 'hand',
    UpperLeg: 'thigh',
    LowerLeg: 'calf',
    Foot: 'foot',
    ToeBase: 'ball',
  }))
    mapping[`J_Bip_${side}_${name}`] = `${bone}_${suffix}`
  for (const [finger, name] of [
    ['Index', 'index'],
    ['Middle', 'middle'],
    ['Ring', 'ring'],
    ['Little', 'pinky'],
    ['Thumb', 'thumb'],
  ]) {
    for (let i = 1; i <= 3; i++) mapping[`J_Bip_${side}_${finger}${i}`] = `${name}_0${i}_${suffix}`
  }
}
const mappedNodes = new Set()
for (const node of root.listNodes()) {
  const name = mapping[node.getName().replace(/_0\d+$/, '')]
  if (name) {
    node.setName(name)
    mappedNodes.add(node)
  }
}
assert.equal(mappedNodes.size, Object.keys(mapping).length, 'every humanoid bone must be mapped')

function makeRig(document) {
  const root = document.getRoot(),
    objects = new Map()
  for (const node of root.listNodes()) {
    const object = new THREE.Object3D()
    object.name = node.getName()
    object.position.fromArray(node.getTranslation())
    object.quaternion.fromArray(node.getRotation())
    object.scale.fromArray(node.getScale())
    objects.set(node, object)
  }
  for (const node of root.listNodes())
    for (const child of node.listChildren()) objects.get(node).add(objects.get(child))
  const scene = new THREE.Group()
  for (const node of root.listScenes()[0].listChildren()) scene.add(objects.get(node))
  scene.updateMatrixWorld(true)
  return { scene, objects }
}

// Measure the actual skinned bind pose. Exported vertex coordinates are in cm,
// while the armature has nested FBX conversion transforms and an off-centre origin.
const before = makeRig(target)
const bounds = new THREE.Box3(),
  point = new THREE.Vector3(),
  weighted = new THREE.Vector3()
for (const node of root.listNodes()) {
  const skin = node.getSkin()
  if (!skin) continue
  const inverses = skin.getInverseBindMatrices(),
    elements = []
  const matrices = skin.listJoints().map((joint, i) =>
    before.objects
      .get(joint)
      .matrixWorld.clone()
      .multiply(new THREE.Matrix4().fromArray(inverses.getElement(i, elements)))
  )
  for (const primitive of node.getMesh().listPrimitives()) {
    const positions = primitive.getAttribute('POSITION'),
      indices = primitive.getAttribute('JOINTS_0'),
      weights = primitive.getAttribute('WEIGHTS_0')
    const p = [],
      j = [],
      w = []
    for (let i = 0; i < positions.getCount(); i++) {
      positions.getElement(i, p)
      indices.getElement(i, j)
      weights.getElement(i, w)
      weighted.set(0, 0, 0)
      for (let k = 0; k < 4; k++)
        if (w[k]) weighted.addScaledVector(point.fromArray(p).applyMatrix4(matrices[j[k]]), w[k])
      bounds.expandByPoint(weighted)
    }
  }
}
const modelScale = 1.72 / bounds.getSize(new THREE.Vector3()).y
const hipsNode = root.listNodes().find((n) => n.getName() === 'pelvis')
const origin = root
  .listNodes()
  .find((n) => n.getName() === 'Root_04')
  .getWorldTranslation()
const scene = root.listScenes()[0]
const normalizer = target
  .createNode('ElleOrigin')
  .setScale([modelScale, modelScale, modelScale])
  .setTranslation([-origin[0] * modelScale, -bounds.min.y * modelScale, -origin[2] * modelScale])
for (const node of scene.listChildren()) normalizer.addChild(node)
scene.addChild(normalizer)
console.log('normalised bind pose:', bounds.min.toArray(), bounds.max.toArray(), 'scale', modelScale.toFixed(4))

// Keep weighted joints and animated humanoid joints. Unweighted FBX end bones do
// not need matrix palette entries, but their ancestors remain in the hierarchy.
for (const skin of root.listSkins()) {
  const joints = skin.listJoints(),
    used = new Set()
  for (const [i, joint] of joints.entries()) if (mappedNodes.has(joint)) used.add(i)
  const attributes = new Map()
  for (const node of root.listNodes())
    if (node.getSkin() === skin) {
      for (const primitive of node.getMesh().listPrimitives()) {
        const indices = primitive.getAttribute('JOINTS_0'),
          weights = primitive.getAttribute('WEIGHTS_0')
        attributes.set(indices, weights)
        for (let i = 0; i < indices.getCount(); i++) {
          const j = indices.getElement(i, []),
            w = weights.getElement(i, [])
          for (let k = 0; k < 4; k++) if (w[k] > 0) used.add(j[k])
        }
      }
    }
  const keep = [...used].sort((a, b) => a - b),
    remap = new Map(keep.map((old, i) => [old, i]))
  for (const [indices, weights] of attributes) {
    const j = [],
      w = []
    for (let i = 0; i < indices.getCount(); i++) {
      indices.getElement(i, j)
      weights.getElement(i, w)
      for (let k = 0; k < 4; k++) j[k] = w[k] > 0 ? remap.get(j[k]) : 0
      indices.setElement(i, j)
    }
  }
  const original = skin.getInverseBindMatrices(),
    matrices = []
  for (const i of keep) matrices.push(...original.getElement(i, []))
  skin.setInverseBindMatrices(
    target.createAccessor().setType('MAT4').setArray(new Float32Array(matrices)).setBuffer(original.getBuffer())
  )
  for (const joint of joints) skin.removeJoint(joint)
  for (const i of keep) skin.addJoint(joints[i])
  console.log(`skeleton palette: ${joints.length} -> ${keep.length} joints`)
}

const source = makeRig(library),
  destination = makeRig(target)
const styleHero = createHeroStylist(destination.scene)
const sourceByName = new Map([...source.objects.values()].map((o) => [o.name, o]))
const records = []
// Traverse parent-first, so each local rotation can be recovered from its parent's current world rotation.
destination.scene.traverse((bone) => {
  const node = [...mappedNodes].find((n) => n.getName() === bone.name)
  if (!node) return
  const from = sourceByName.get(bone.name)
  assert.ok(from, `animation source bone ${bone.name}`)
  const offset = from
    .getWorldQuaternion(new THREE.Quaternion())
    .invert()
    .multiply(bone.getWorldQuaternion(new THREE.Quaternion()))
  records.push({ node, bone, from, offset })
})
const sourceHip = sourceByName.get('pelvis'),
  targetHip = destination.objects.get(hipsNode)
const sourceRestHip = sourceHip.getWorldPosition(new THREE.Vector3())
const targetRestHip = targetHip.getWorldPosition(new THREE.Vector3())
const hipScale = targetRestHip.y / sourceRestHip.y
const buffer = root.listBuffers()[0]
const desiredRotation = new THREE.Quaternion(),
  parentRotation = new THREE.Quaternion(),
  desiredPosition = new THREE.Vector3()

function makeClip(animation) {
  const tracks = []
  for (const channel of animation.listChannels()) {
    const sampler = channel.getSampler(),
      path = channel.getTargetPath()
    assert.equal(sampler.getInterpolation(), 'LINEAR', 'this baker expects the linear packed library')
    const Track = path === 'rotation' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack
    tracks.push(
      new Track(
        `${channel.getTargetNode().getName()}.${path === 'rotation' ? 'quaternion' : path === 'translation' ? 'position' : path}`,
        sampler.getInput().getArray(),
        sampler.getOutput().getArray()
      )
    )
  }
  return new THREE.AnimationClip(animation.getName(), -1, tracks)
}

const animations = [...library.getRoot().listAnimations(), ...extra.getRoot().listAnimations()]
const relaxedIdle = makeClip(animations.find((animation) => animation.getName() === 'Idle_Loop'))
for (const animation of animations) {
  const clip = makeClip(animation),
    mixer = new THREE.AnimationMixer(source.scene)
  const sampled = ['Sword_Idle', 'Sword_Regular_A_Rec'].includes(clip.name) ? relaxedIdle : clip
  const action = mixer.clipAction(sampled)
  action.setLoop(THREE.LoopOnce, 1)
  action.clampWhenFinished = true
  action.play()
  const count = Math.ceil(clip.duration * 60) + 1
  const times = new Float32Array(count),
    positions = new Float32Array(count * 3)
  const rotations = records.map(() => new Float32Array(count * 4))
  for (let i = 0; i < count; i++) {
    const time = (clip.duration * i) / (count - 1)
    times[i] = time
    mixer.setTime(Math.min((time / clip.duration) * sampled.duration, sampled.duration - 1e-6))
    source.scene.updateMatrixWorld(true)
    for (const { bone, from, offset } of records) {
      from.getWorldQuaternion(desiredRotation).multiply(offset)
      bone.parent.getWorldQuaternion(parentRotation).invert()
      bone.quaternion.copy(parentRotation.multiply(desiredRotation)).normalize()
      if (bone === targetHip) {
        from.getWorldPosition(desiredPosition).sub(sourceRestHip).multiplyScalar(hipScale).add(targetRestHip)
        bone.position.copy(bone.parent.worldToLocal(desiredPosition))
      }
      bone.updateMatrixWorld(true)
    }
    styleHero(clip.name, time, clip.duration)
    targetHip.position.toArray(positions, i * 3)
    for (const [j, { bone }] of records.entries()) bone.quaternion.toArray(rotations[j], i * 4)
  }
  const baked = target.createAnimation(clip.name)
  const input = target.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer)
  for (const [i, record] of records.entries()) {
    const output = target.createAccessor().setType('VEC4').setArray(rotations[i]).setBuffer(buffer)
    const sampler = target.createAnimationSampler().setInput(input).setOutput(output)
    baked
      .addSampler(sampler)
      .addChannel(
        target.createAnimationChannel().setTargetNode(record.node).setTargetPath('rotation').setSampler(sampler)
      )
  }
  const output = target.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer)
  const sampler = target.createAnimationSampler().setInput(input).setOutput(output)
  baked
    .addSampler(sampler)
    .addChannel(
      target.createAnimationChannel().setTargetNode(hipsNode).setTargetPath('translation').setSampler(sampler)
    )
  mixer.stopAllAction()
  mixer.uncacheRoot(source.scene)
}
await target.transform(
  resample(),
  prune(),
  dedup(),
  textureCompress({ encoder: sharp, resize: [1024, 1024], targetFormat: 'webp', quality: 88 }),
  dedup()
)
await io.write('public/models/Elle_Vanta.glb', target)
copyFileSync('assets-src/models/LICENSE-Elle-CC-BY.txt', 'public/models/LICENSE-Elle-CC-BY.txt')
console.log(
  `Elle: ${(statSync('public/models/Elle_Vanta.glb').size / 1048576).toFixed(2)} MB, ${root.listAnimations().length} baked clips`
)

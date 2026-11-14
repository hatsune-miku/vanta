// Render the production costumes and skeletons, including both facing directions.
import * as THREE from 'three'

import { Body3D, SKINS3, Stage3D } from '../../src/three/stage3d'

const W = 320,
  H = 400
const stage = await Stage3D.load()
stage.renderer.setSize(W, H, false)
const canvas = document.getElementById('sheet') as HTMLCanvasElement
const sheet = canvas.getContext('2d')!
const samples = [
  ...Object.keys(SKINS3).map((skin) => ({
    skin,
    clip: skin === 'gunner' ? 'Pistol_Idle_Loop' : 'Sword_Idle',
    t: 0.25,
    facing: 1,
    portrait: true,
  })),
  ...[
    ['Sword_Regular_A', 0.3],
    ['Sword_Regular_B', 0.5],
    ['Sprint_Loop', 0.25],
    ['Sword_Dash', 0.6],
    ['Sword_Heavy_Combo', 0.4],
    ['NinjaJump_Idle_Loop', 0.3],
    ['Spell_Simple_Enter', 0.45],
    ['Spell_Simple_Shoot', 0.4],
  ].flatMap(([clip, t]) =>
    [1, -1].map((facing) => ({ skin: 'vanta', clip: String(clip), t: Number(t), facing, portrait: false }))
  ),
]
canvas.width = W * 6
canvas.height = Math.ceil(samples.length / 6) * H
const missing: string[] = []
for (const [i, sample] of samples.entries()) {
  const x = (i % 6) * W,
    y = Math.floor(i / 6) * H
  sheet.fillStyle = i % 2 ? '#111c2a' : '#0d1724'
  sheet.fillRect(x, y, W, H)
  const body = new Body3D(sample.skin)
  body.setPos(0, 0, sample.facing)
  if (sample.portrait) body.root.rotation.y = 0.45
  const clip = stage.characterClip(sample.skin, sample.clip)
  if (!clip) missing.push(sample.clip)
  body.apply({ clip: sample.clip, time: sample.t * (clip?.duration ?? 1), prev: null, prevTime: 0, w: 1 })
  body.root.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(body.root, true)
  const center = bounds.getCenter(new THREE.Vector3()),
    size = bounds.getSize(new THREE.Vector3())
  const halfH = Math.max(size.y / 2 + 25, ((size.x / 2 + 20) * H) / W)
  const cam = stage.cam
  cam.left = (-halfH * W) / H
  cam.right = (halfH * W) / H
  cam.top = halfH
  cam.bottom = -halfH
  cam.position.set(center.x, center.y, 2000)
  cam.updateProjectionMatrix()
  cam.updateMatrixWorld()
  stage.renderer.render(stage.scene, cam)
  sheet.drawImage(stage.canvas, x, y)
  sheet.fillStyle = '#bdd1e8'
  sheet.font = 'bold 16px sans-serif'
  sheet.fillText(
    sample.portrait ? sample.skin.toUpperCase() : `${sample.clip} / ${sample.facing > 0 ? 'R' : 'L'}`,
    x + 16,
    y + 26
  )
  body.destroy()
}
;(window as any).__done = { missing, clips: [...stage.clips.keys()] }

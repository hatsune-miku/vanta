import assert from 'node:assert/strict'

// Exercise real models, bone attachments, projectiles and GPU resource ownership.
export default async (g) => {
  const results = await g.eval(async () => {
    const { Body3D, SKINS3, Stage3D } = await import('/src/three/stage3d.ts')
    const { A, timeAt } = await import('/src/art/anims.ts')
    const { Gunner } = await import('/src/game/enemies.ts')
    const battle = window.__vanta.scene
    const stage = Stage3D.I
    const results = []

    function check(name, ok, detail) {
      results.push({ name, ok, detail })
    }

    const body = new Body3D('vanta')
    body.setPos(800, 900, 1)
    body.apply({ clip: A.l3.clip, time: timeAt(A.l3, 8), prev: null, prevTime: 0, w: 1 })
    body.squash = 0.1
    body.extraRot = 0.12
    body.setPos(1100, 760, -1)
    const hand = body.root.getObjectByName('hand_r').getWorldPosition(body.root.position.clone())
    const handError = Math.hypot(body.wx(body.hand.x) - hand.x, body.wy(body.hand.y) + hand.y)
    check('attachments follow facing, scale and rotation immediately', handError < 0.001, handError)
    body.destroy()

    for (const skin of Object.keys(SKINS3)) {
      const actor = new Body3D(skin)
      const twin = new Body3D(skin)
      actor.setPos(960, 850, -1)
      actor.apply({ clip: A.l3.clip, time: timeAt(A.l3, 8), prev: null, prevTime: 0, w: 1 })
      const surfaceName = skin === 'vanta' ? 'CharacterSurface' : 'Costume'
      const costume = actor.root.getObjectByName(surfaceName)
      check(
        `${skin} has animated clothing`,
        costume?.isSkinnedMesh && costume.skeleton.bones.includes(actor.root.getObjectByName('Head'))
      )
      actor.setAlpha(0.35)
      const twinMaterials = twin.root.getObjectByName(surfaceName).material
      check(
        `${skin} fades independently`,
        twinMaterials.every((m) => m.opacity === 1)
      )
      const emissions = costume.material.map((m) => [m.emissive.getHex(), m.emissiveIntensity])
      actor.setFlash(0xffffff)
      actor.setTintMul(0xffaa33)
      actor.setFlash(null)
      check(
        `${skin} restores its own lights after damage`,
        costume.material.every(
          (m, i) => m.emissive.getHex() === emissions[i][0] && m.emissiveIntensity === emissions[i][1]
        )
      )
      actor.ghost(0x2f9bff, 0.5, 0.3)
      const ghost = stage.ghosts.at(-1).root.getObjectByName(surfaceName)
      check(`${skin} ghosts keep clothing`, ghost?.geometry === costume.geometry)
      actor.root.updateMatrixWorld(true)
      stage.ghosts.at(-1).root.updateMatrixWorld(true)
      let ghostError = 0
      for (let i = 0; i < costume.geometry.attributes.position.count; i += 200) {
        const p = costume.getVertexPosition(i, actor.root.position.clone()).applyMatrix4(costume.matrixWorld)
        const q = ghost.getVertexPosition(i, actor.root.position.clone()).applyMatrix4(ghost.matrixWorld)
        // Ghosts are moved backwards only in Z; their on-screen pose must match.
        ghostError = Math.max(ghostError, Math.hypot(p.x - q.x, p.y - q.y))
      }
      check(`${skin} ghosts preserve the animated pose`, ghostError < 0.001, ghostError)
      actor.destroy()
      twin.destroy()
    }

    const hero = new Body3D('vanta')
    const surface = hero.root.getObjectByName('CharacterSurface')
    hero.setPos(0, 0, 1)
    check('Elle retains textured skin, clothing and hair', surface.material.filter((m) => m.map).length >= 15)
    check('Elle uses a compact bone palette', surface.skeleton.bones.length <= 80, surface.skeleton.bones.length)
    check(
      'silver hair styling survives per-character material cloning',
      surface.material
        .filter((m) => m.userData.elleTone === 'silver')
        .every((m) => m.customProgramCacheKey().includes('elle-silver'))
    )
    let allClips = true,
      maxSpan = 0,
      idleFloor = Infinity
    for (const name of new Set(Object.values(A).map((a) => a.clip))) {
      const clip = stage.characterClip('vanta', name)
      const source = stage.clips.get(name)
      allClips &&= clip.name === name && Math.abs(clip.duration - source.duration) < 0.002
      for (const ratio of [0, 0.25, 0.5, 0.75, 0.99]) {
        hero.apply({ clip: name, time: clip.duration * ratio, prev: null, prevTime: 0, w: 1 })
        const low = [Infinity, Infinity, Infinity],
          high = [-Infinity, -Infinity, -Infinity]
        for (let i = 0; i < surface.geometry.attributes.position.count; i += 40) {
          const p = surface.getVertexPosition(i, hero.root.position.clone()).applyMatrix4(surface.matrixWorld).toArray()
          for (let axis = 0; axis < 3; axis++) {
            low[axis] = Math.min(low[axis], p[axis])
            high[axis] = Math.max(high[axis], p[axis])
          }
        }
        maxSpan = Math.max(maxSpan, ...high.map((v, i) => v - low[i]))
        if (name === A.idle.clip && ratio === 0) idleFloor = low[1]
      }
    }
    check('all Elle actions retain the combat timing', allClips)
    check('all retargeted actions keep finite, bounded geometry', Number.isFinite(maxSpan) && maxSpan < 500, maxSpan)
    check('Elle idle feet meet the ground', Math.abs(idleFloor) < 12, idleFloor)
    for (const facing of [1, -1]) {
      hero.setPos(0, 0, facing)
      hero.apply({ clip: A.run.clip, time: 0.2, prev: null, prevTime: 0, w: 1 })
      check(
        `running sword trails behind when facing ${facing}`,
        (hero.tip.x - hero.hand.x) * facing < -60,
        hero.tip.x - hero.hand.x
      )
    }
    hero.destroy()

    const gunner = new Gunner(battle, 1200)
    gunner.facing = 1
    gunner.rig.setPos(1200, gunner.y, 1)
    gunner.state = 'fire'
    gunner.st = 0
    gunner.an.play(A.aim, 0, true)
    gunner.rig.apply(gunner.an.update(0))
    const expectedMuzzleX = 1700 + gunner.rig.tip.x
    gunner.x = gunner.px = 1700
    const before = battle.projs.length
    gunner.update()
    const shot = battle.projs[before]
    const muzzleError = shot ? Math.abs(shot.x - expectedMuzzleX) : Infinity
    check('shots use the current logic position without a render', muzzleError < 0.001, muzzleError)
    for (const p of battle.projs.splice(before)) p.im.destroy()
    gunner.destroy()

    window.__vanta.tap('pause')
    const frame = battle.frame
    window.__vanta.step(60)
    check('manual stepping respects pause', battle.paused && battle.frame === frame, battle.frame - frame)
    window.__vanta.tap('pause')
    check('manual stepping resumes', !battle.paused && battle.frame > frame, battle.frame - frame)

    // Force allocation by drawing, then reset as a scene restart would. Shared model
    // geometry stays cached; per-body weapons and ghost skeletons must be released.
    stage.reset()
    stage.render(960, 540, 1)
    const counts = []
    for (let i = 0; i < 4; i++) {
      for (const skin of ['heavy', 'vanta']) {
        const actor = new Body3D(skin)
        actor.setPos(960, 900, 1)
        actor.apply({ clip: A.idle.clip, time: 0, prev: null, prevTime: 0, w: 1 })
        actor.ghost(0x2f9bff, 0.5, 0.3)
      }
      stage.render(960, 540, 1)
      // Alternate between an active ghost and one already returned to its pool.
      if (i % 2) stage.update(1)
      stage.reset()
      stage.render(960, 540, 1)
      counts.push({ ...stage.renderer.info.memory })
    }
    check(
      'restarts keep GPU allocations bounded',
      counts.every((c) => c.geometries === counts[0].geometries && c.textures === counts[0].textures),
      counts
    )
    battle.scene.restart()
    return results
  })
  for (const result of results) console.log(JSON.stringify(result))
  assert.ok(
    results.every((r) => r.ok),
    '3D integration regression; see results above'
  )
}

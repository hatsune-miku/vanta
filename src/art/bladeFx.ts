import * as Phaser from 'phaser'

import { tex } from './textures'

/** Stable, aperiodic variation keeps the stroke rough without flickering between frames. */
function bladeNoise(x: number, seed: number) {
  function hash(n: number) {
    const v = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453
    return v - Math.floor(v)
  }
  const i = Math.floor(x),
    f = x - i,
    k = f * f * (3 - 2 * f)
  return hash(i) * (1 - k) + hash(i + 1) * k
}

/** An uneven cutting edge, torn inner wake and broken filaments share one translucent stroke. */
function bladeTexture(scene: Phaser.Scene, key: string, sweep: number, thickness: number) {
  const size = 512,
    radius = 234,
    body = document.createElement('canvas'),
    spine = document.createElement('canvas'),
    hot = document.createElement('canvas')
  body.width = spine.width = hot.width = size
  body.height = spine.height = hot.height = size
  const bg = body.getContext('2d')!,
    sg = spine.getContext('2d')!,
    hg = hot.getContext('2d')!,
    bodyPixels = bg.createImageData(size, size),
    spinePixels = sg.createImageData(size, size),
    hotPixels = hg.createImageData(size, size)
  function feather(x: number) {
    const t = Math.max(0, Math.min(1, x))
    return t * t * (3 - 2 * t)
  }
  const profile = Array.from({ length: 1025 }, (_, i) => {
    const t = i / 1024,
      seed = sweep * 7 + thickness * 31,
      bend = bladeNoise(t * 4.3, seed),
      edge = bladeNoise(t * 21, seed + 8),
      wake = bladeNoise(t * 13, seed + 17),
      grain = bladeNoise(t * 63, seed + 29)
    return {
      // Broad asymmetry breaks the compass arc; finer erosion gives the edge its torn silhouette.
      outer: radius - 38 + 37 * Math.sin(t * Math.PI * 0.88) + (bend - 0.5) * 38 + (edge - 0.5) * 25,
      width: radius * thickness * Math.pow(Math.sin(Math.PI * t), 0.8) * (0.4 + 0.6 * t) * (0.32 + wake * 1.25),
      ends: feather(t / 0.07) * feather((1 - t) / 0.055),
      edge,
      wake,
      grain,
    }
  })
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - size / 2,
        dy = y + 0.5 - size / 2,
        t = Math.atan2(dy, dx) / sweep + 0.5
      if (t <= 0 || t >= 1) continue
      const p = profile[Math.round(t * 1024)],
        u = (p.outer - Math.hypot(dx, dy)) / p.width
      if (u <= 0 || u >= 1) continue
      const edge = feather(u / 0.045) * feather((1 - u) / (0.14 + p.wake * 0.25)),
        // Uneven diagonal rifts break the polished crescent into a fast, torn stroke.
        tearLine = t * 27 + u * 1.6 + p.wake * 0.8,
        tear = Math.pow(Math.max(0, Math.sin(tearLine * Math.PI)), 18),
        cutT = t - u * 0.045,
        rift = Math.max(
          Math.exp(-Math.pow((cutT - 0.17) / 0.012, 2)),
          Math.exp(-Math.pow((cutT - 0.39) / 0.008, 2)),
          Math.exp(-Math.pow((cutT - 0.76) / 0.015, 2))
        ),
        erosion = (1 - tear * feather((u - 0.12) / 0.5) * (0.45 + p.grain * 0.5)) * (1 - rift * 0.98),
        breakUp = 0.48 + 0.52 * feather((p.grain - 0.13) / 0.5),
        ridge = Math.exp(-Math.pow((u - 0.28) / 0.3, 2)),
        striation = 0.83 + 0.11 * Math.sin(t * 105 + u * 19) + 0.06 * Math.sin(t * 39 - u * 34),
        luminance = Math.round((0.23 + ridge * 0.77) * striation * 255),
        alpha = p.ends * edge * (0.3 + 0.6 * ridge) * erosion,
        edgeAt = 0.16 + p.edge * 0.11,
        highlight = Math.exp(-Math.pow((u - edgeAt) / (0.024 + p.wake * 0.024), 2)),
        filament = Math.exp(-Math.pow((u - 0.53 - p.wake * 0.16) / 0.02, 2)) * 0.2,
        i = (y * size + x) * 4
      bodyPixels.data[i] = bodyPixels.data[i + 1] = bodyPixels.data[i + 2] = luminance
      bodyPixels.data[i + 3] = Math.round(alpha * 255)
      spinePixels.data[i] = spinePixels.data[i + 1] = spinePixels.data[i + 2] = 255
      spinePixels.data[i + 3] = Math.round(p.ends * (highlight * breakUp * 0.85 + filament) * erosion * 255)
      hotPixels.data[i] = hotPixels.data[i + 1] = hotPixels.data[i + 2] = 255
      hotPixels.data[i + 3] = Math.round(
        p.ends * edge * Math.exp(-Math.pow((u - edgeAt) / (0.06 + p.wake * 0.055), 2)) * breakUp * erosion * 255
      )
    }
  }
  bg.putImageData(bodyPixels, 0, 0)
  sg.putImageData(spinePixels, 0, 0)
  hg.putImageData(hotPixels, 0, 0)
  tex(scene, key, size, size, 256, 256, (g) => g.drawImage(body, -256, -256), 1)
  tex(scene, `${key}_core`, size, size, 256, 256, (g) => g.drawImage(spine, -256, -256), 1)
  tex(scene, `${key}_hot`, size, size, 256, 256, (g) => g.drawImage(hot, -256, -256), 1)
  tex(
    scene,
    `${key}_hot_glow`,
    640,
    640,
    320,
    320,
    (g) => {
      g.filter = 'blur(16px)'
      g.globalCompositeOperation = 'lighter'
      for (let i = 0; i < 4; i++) g.drawImage(hot, -256, -256)
    },
    1
  )
  tex(
    scene,
    `${key}_glow`,
    size,
    size,
    256,
    256,
    (g) => {
      g.filter = 'blur(10px)'
      g.drawImage(body, -256, -256)
    },
    1
  )
}

export function buildBladeFx(scene: Phaser.Scene) {
  for (const [key, sweep, thickness] of [
    ['slash', Math.PI * 0.95, 0.34],
    ['slash_wide', Math.PI * 1.5, 0.4],
    ['slash_thin', Math.PI * 0.8, 0.19],
    ['slash_flat', Math.PI * 1.6, 0.17],
  ] as const) {
    bladeTexture(scene, `blade_${key}`, sweep, thickness)
  }

  tex(
    scene,
    'dash_trail',
    512,
    128,
    256,
    64,
    (g) => {
      const across = g.createLinearGradient(0, -64, 0, 64)
      across.addColorStop(0, 'rgba(255,255,255,0)')
      across.addColorStop(0.3, 'rgba(255,255,255,0.12)')
      across.addColorStop(0.5, 'rgba(255,255,255,0.95)')
      across.addColorStop(0.7, 'rgba(255,255,255,0.12)')
      across.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = across
      g.fillRect(-256, -64, 512, 128)
      g.globalCompositeOperation = 'destination-in'
      const along = g.createLinearGradient(-256, 0, 256, 0)
      along.addColorStop(0, 'rgba(255,255,255,0)')
      along.addColorStop(0.08, 'rgba(255,255,255,0.4)')
      along.addColorStop(0.7, 'rgba(255,255,255,1)')
      along.addColorStop(1, 'rgba(255,255,255,0.65)')
      g.fillStyle = along
      g.fillRect(-256, -64, 512, 128)
    },
    1
  )

  // The projectile's pivot sits in the blade itself. It never rotates around a distant arc centre.
  tex(
    scene,
    'surge_blade',
    192,
    1024,
    96,
    512,
    (g) => {
      g.beginPath()
      g.moveTo(0, -502)
      g.bezierCurveTo(27, -370, 23, -260, 36, -150)
      g.lineTo(26, -128)
      g.bezierCurveTo(38, 60, 23, 310, 0, 502)
      g.bezierCurveTo(-13, 345, -37, 160, -26, -12)
      g.lineTo(-37, -65)
      g.bezierCurveTo(-22, -250, -17, -390, 0, -502)
      g.closePath()
      const gradient = g.createLinearGradient(-42, 0, 42, 0)
      gradient.addColorStop(0, '#ff70dc')
      gradient.addColorStop(0.24, '#429fff')
      gradient.addColorStop(0.42, '#d5fbff')
      gradient.addColorStop(0.64, '#ffffff')
      gradient.addColorStop(1, '#50dfff')
      g.fillStyle = gradient
      g.shadowColor = '#5addff'
      g.shadowBlur = 24
      g.fill()
      g.shadowBlur = 0
      g.fill()
      g.beginPath()
      g.moveTo(0, -490)
      g.quadraticCurveTo(15, -40, 0, 490)
      g.quadraticCurveTo(-11, 80, 0, -490)
      g.fillStyle = '#ffffff'
      g.fill()
    },
    1
  )
}

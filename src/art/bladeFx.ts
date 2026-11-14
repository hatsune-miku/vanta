import * as Phaser from 'phaser'

import { tex } from './textures'

/** A clean crescent: translucent volume that thickens toward the leading tip, under one continuous bright edge. */
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
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - size / 2,
        dy = y + 0.5 - size / 2,
        t = Math.atan2(dy, dx) / sweep + 0.5
      if (t <= 0 || t >= 1) continue
      // The outer edge is a true arc. The body is thin at the tail, widest near the leading tip, and closes at both ends.
      const width = radius * thickness * 0.95 * Math.pow(Math.sin(Math.PI * t), 0.8) * (0.4 + 0.6 * t),
        u = (radius - Math.hypot(dx, dy)) / width
      if (u <= 0 || u >= 1) continue
      const ends = feather(t / 0.07) * feather((1 - t) / 0.055),
        edge = feather(u / 0.045) * feather((1 - u) / 0.26),
        ridge = Math.exp(-Math.pow((u - 0.28) / 0.3, 2)),
        i = (y * size + x) * 4
      bodyPixels.data[i] = bodyPixels.data[i + 1] = bodyPixels.data[i + 2] = Math.round((0.23 + ridge * 0.77) * 255)
      bodyPixels.data[i + 3] = Math.round(ends * edge * (0.3 + 0.6 * ridge) * 255)
      spinePixels.data[i] = spinePixels.data[i + 1] = spinePixels.data[i + 2] = 255
      spinePixels.data[i + 3] = Math.round(ends * Math.exp(-Math.pow((u - 0.2) / 0.036, 2)) * 0.85 * 255)
      hotPixels.data[i] = hotPixels.data[i + 1] = hotPixels.data[i + 2] = 255
      hotPixels.data[i + 3] = Math.round(ends * edge * Math.exp(-Math.pow((u - 0.2) / 0.09, 2)) * 255)
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

import * as Phaser from 'phaser'

import { ORIGIN, tex } from './textures'

/**
 * One ray of the execution bloom: pinched at the core, widest a quarter of the way out, then a long taper
 * to a point. It is drawn white, so a wider tinted copy under a narrow white one reads as an overexposed
 * blade of light with a coloured fringe.
 */
function petalTexture(scene: Phaser.Scene, key: string) {
  if (scene.textures.exists(key)) return
  const w = 512,
    h = 96,
    canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d', { willReadFrequently: true })!,
    pixels = g.createImageData(w, h)
  // peak of t^0.42 * (1 - t)^1.25, so the widest point fills the texture height
  const norm = 0.39
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = (x + 0.5) / w,
        half = ((h / 2 - 2) * Math.pow(t, 0.42) * Math.pow(1 - t, 1.25)) / norm,
        v = Math.abs(y + 0.5 - h / 2) / half
      if (!(v < 1)) continue
      // a flat bright blade with a short soft edge, so neighbouring rays stay separate instead of fogging together
      const edge = Math.min(1, (1 - v) / 0.5),
        cross = edge * edge * (3 - 2 * edge),
        // overexposed for most of its length, easing off only toward the point
        along = Math.min(1, t / 0.05) * (1 - 0.4 * t * t),
        i = (y * w + x) * 4
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255
      pixels.data[i + 3] = Math.round(cross * along * 255)
    }
  }
  g.putImageData(pixels, 0, 0)
  scene.textures.addCanvas(key, canvas)
  ORIGIN[key] = [0, 0.5]
}

interface VerdictShape {
  /** where the edge sits at the ends of the blade, and how much lower it hangs in the middle (texture heights) */
  rim: number
  bow: number
  /** thickness of the white edge at the ends, and how much it gains toward the middle */
  core: number
  swell: number
  /** the light standing above the edge: its strength, and how slowly it thins with height (lower = taller) */
  curtain: number
  reach: number
}

/**
 * The overload charge's blades: an edge as wide as the screen, bowed downward, with light standing above it.
 * Pink throughout, with only a few thin blue strands. Painted in colour, not tinted at runtime.
 */
function verdictTexture(scene: Phaser.Scene, key: string, shape: VerdictShape) {
  if (scene.textures.exists(key)) return
  const w = 512,
    h = 512,
    canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d', { willReadFrequently: true })!,
    pixels = g.createImageData(w, h)
  for (let x = 0; x < w; x++) {
    const u = (x + 0.5) / w,
      side = 2 * u - 1,
      belly = 1 - side * side,
      // the edge hangs lowest in the middle
      edge = shape.rim + shape.bow * belly,
      ends = Math.min(1, (1 - Math.abs(side)) / 0.1),
      thick = shape.core + shape.swell * belly,
      // light and dark strands that run the height of the curtain
      strand = 0.55 + 0.25 * Math.sin(u * 61) + 0.2 * Math.sin(u * 173 + 1.3),
      blue = Math.sin(u * 47 + 0.6) > 0.94
    for (let y = 0; y < h; y++) {
      const v = (y + 0.5) / h,
        above = edge - v
      let alpha: number, white: number
      // The blade's body is pink; only a thin line along the very edge burns white.
      if (above < 0) {
        // a short glow under the edge
        alpha = Math.exp(-Math.pow(above / (thick * 1.5), 2)) * 0.9
        white = Math.exp(-Math.pow(above / (thick * 0.5), 2))
      } else {
        const core = Math.exp(-Math.pow(above / thick, 2)),
          halo = Math.exp(-Math.pow(above / (thick * 4), 2)) * 0.5,
          curtain = Math.pow(Math.max(0, 1 - above / edge), shape.reach) * shape.curtain * strand
        alpha = Math.max(core, halo, curtain)
        white = Math.exp(-Math.pow(above / (thick * 0.4), 2))
      }
      alpha *= ends
      const i = (y * w + x) * 4
      pixels.data[i] = Math.round(blue ? 110 + 145 * white : 255)
      pixels.data[i + 1] = Math.round((blue ? 170 : 96) + (255 - (blue ? 170 : 96)) * white)
      pixels.data[i + 2] = Math.round((blue ? 255 : 214) + (255 - (blue ? 255 : 214)) * white)
      pixels.data[i + 3] = Math.round(alpha * (blue ? 0.8 : 1) * 255)
    }
  }
  g.putImageData(pixels, 0, 0)
  scene.textures.addCanvas(key, canvas)
}

/**
 * The fourth heavy stage seen as what it is: a wheel of blade light. Many arcs at different radii, each brightest
 * at its leading end and trailing away behind it, inside one hard bright rim. White, to be tinted and spun.
 */
function wheelTexture(scene: Phaser.Scene, key: string) {
  if (scene.textures.exists(key)) return
  const size = 512,
    c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.translate(size / 2, size / 2)
  g.lineCap = 'round'
  // a deterministic scatter, so the wheel is the same wheel every time
  let seed = 7
  const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  /** An arc that fades along its length, drawn as short pieces of falling brightness. */
  const streak = (radius: number, from: number, sweep: number, width: number, alpha: number) => {
    const pieces = 14
    for (let i = 0; i < pieces; i++) {
      const k = i / pieces
      g.strokeStyle = `rgba(255,255,255,${(alpha * Math.pow(1 - k, 1.6)).toFixed(3)})`
      g.lineWidth = width * (1 - 0.6 * k)
      g.beginPath()
      g.arc(0, 0, radius, from - sweep * k, from - sweep * (k + 1 / pieces) - 0.01, true)
      g.stroke()
    }
  }
  // the fine grain of the spin
  for (let i = 0; i < 70; i++)
    streak(70 + next() * 165, next() * Math.PI * 2, 0.5 + next() * 1.6, 1 + next() * 2.5, 0.1 + next() * 0.28)
  // the blade edges themselves: a few broad, hot arcs near the rim
  for (let i = 0; i < 5; i++) {
    const from = (i / 5) * Math.PI * 2 + next() * 0.5
    streak(206 + next() * 22, from, 1.5 + next() * 0.7, 13, 0.95)
    streak(150 + next() * 40, from + 0.7, 1.1, 7, 0.6)
  }
  g.strokeStyle = 'rgba(255,255,255,0.55)'
  g.lineWidth = 3
  g.beginPath()
  g.arc(0, 0, 240, 0, Math.PI * 2)
  g.stroke()
  const hub = g.createRadialGradient(0, 0, 0, 0, 0, 130)
  hub.addColorStop(0, 'rgba(255,255,255,0.75)')
  hub.addColorStop(0.5, 'rgba(255,255,255,0.22)')
  hub.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = hub
  g.beginPath()
  g.arc(0, 0, 130, 0, Math.PI * 2)
  g.fill()
  scene.textures.addCanvas(key, c)
}

/** Textures used only by the dying state, the execution bloom and the overload charge. */
export function buildExecFx(scene: Phaser.Scene) {
  petalTexture(scene, 'petal')
  wheelTexture(scene, 'gear_wheel')
  // the blade that bites: a deep arc, thick in the belly, with only a short veil above it
  verdictTexture(scene, 'verdict', { rim: 0.3, bow: 0.62, core: 0.026, swell: 0.05, curtain: 0.3, reach: 2.4 })
  // its herald: a thin, nearly level edge under a very tall standing path of light
  verdictTexture(scene, 'verdict_herald', {
    rim: 0.9,
    bow: 0.04,
    core: 0.0016,
    swell: 0.0006,
    curtain: 0.5,
    reach: 0.55,
  })
  // a short electrical discharge: a jagged main path with one side branch
  tex(scene, 'arc', 128, 56, 64, 28, (g) => {
    const main = [-56, 5, -41, -9, -27, 6, -13, -12, 2, 3, 14, -7, 28, 9, 42, -4, 56, 2],
      branch = [-13, -12, -4, -22, 9, -17, 17, -24]
    function path(points: number[]) {
      g.beginPath()
      g.moveTo(points[0], points[1])
      for (let i = 2; i < points.length; i += 2) g.lineTo(points[i], points[i + 1])
    }
    g.lineJoin = 'miter'
    g.lineCap = 'butt'
    g.save()
    g.shadowColor = '#ffffff'
    g.shadowBlur = 7
    g.strokeStyle = 'rgba(255,255,255,0.7)'
    g.lineWidth = 2
    path(main)
    g.stroke()
    g.lineWidth = 1.2
    path(branch)
    g.stroke()
    g.restore()
    g.strokeStyle = '#ffffff'
    g.lineWidth = 1.1
    path(main)
    g.stroke()
  })
}

import * as Phaser from 'phaser'

import { tex } from './textures'

import { CAM_REST_Y, DEPTH, GROUND_Y, VIEW_H, VIEW_W } from '../config'
import { rng } from '../core/util'

const TILE = 2048

/** Draw something twice so it wraps cleanly across the tile seam. */
function wrap(x: number, w: number, fn: (x: number) => void) {
  fn(x)
  if (x + w > TILE) fn(x - TILE)
  if (x < 0) fn(x + TILE)
}

/** the dark the photographed layers fade into (tools/pack-backdrop.mjs bakes the same colour into them) */
const VOID = 0x05080e
/** height of the near layer's texture: tall enough that its columns run out of sight when the view climbs */
const NEAR_H = 1400
/** where the near layer's columns stand in a tile: [x, width, mirrored] */
const COLUMNS: [number, number, boolean][] = [
  [230, 168, false],
  [1290, 200, true],
]

/** the sets of backdrop layers: one per stage */
export type BackdropSet = 'plant' | 'yard'
/** the colour stage 2's sky fades into overhead */
const VOID_YARD = 0x0b0716

/** The photographed layers, graded by tools/pack-backdrop.mjs. Queue them from a scene's preload. */
export function loadStage(scene: Phaser.Scene) {
  scene.load.image('bd_far', 'backdrop/far.jpg')
  scene.load.image('bd_mid', 'backdrop/mid.webp')
  scene.load.image('bd_column', 'backdrop/column.jpg')
  scene.load.image('bd_floor', 'backdrop/floor.jpg')
  scene.load.image('bd_far_yard', 'backdrop/yard/far.jpg')
  scene.load.image('bd_mid_yard', 'backdrop/yard/mid.webp')
  scene.load.image('bd_floor_yard', 'backdrop/yard/floor.jpg')
}

/** Stage 2's own layers: the yard's fence, lamp posts, mast and containers as dusk silhouettes, and their lights. */
function buildYard(scene: Phaser.Scene) {
  const H = 1100,
    DARK = '#07050c',
    // lamp posts: [x, height]; the mast; the containers: [x, width, height]
    posts: [number, number][] = [
      [340, 560],
      [1380, 610],
    ],
    mast = 930,
    boxes: [number, number, number][] = [
      [560, 330, 150],
      [1640, 300, 140],
      [1700, 250, 130],
    ]
  tex(
    scene,
    'bd_near_yard',
    TILE,
    H,
    0,
    0,
    (g) => {
      const r = rng(31)
      g.fillStyle = DARK
      g.strokeStyle = DARK
      // containers, the second stacked on the third, their ribs catching the last of the light
      boxes.forEach(([x, w, h], i) => {
        const y = H - h - (i === 2 ? 140 : 0)
        wrap(x, w, (xx) => {
          g.fillStyle = DARK
          g.fillRect(xx, y, w, h)
          g.fillStyle = 'rgba(255,150,90,0.07)'
          for (let k = 8; k < w - 6; k += 13) g.fillRect(xx + k, y + 6, 2, h - 12)
          g.fillStyle = 'rgba(255,170,110,0.3)'
          g.fillRect(xx, y, w, 2)
        })
      })
      // the mast: a lattice tower with a dish hanging off it by one bracket
      wrap(mast - 60, 120, (shift) => {
        const xx = shift + 60
        g.strokeStyle = DARK
        g.lineWidth = 7
        g.beginPath()
        g.moveTo(xx - 46, H)
        g.lineTo(xx - 8, 120)
        g.moveTo(xx + 46, H)
        g.lineTo(xx + 8, 120)
        g.stroke()
        g.lineWidth = 3
        for (let y = 160; y < H; y += 74) {
          const w0 = 8 + ((y - 120) / (H - 120)) * 38,
            w1 = 8 + ((y + 74 - 120) / (H - 120)) * 38
          g.beginPath()
          g.moveTo(xx - w0, y)
          g.lineTo(xx + w1, y + 74)
          g.moveTo(xx + w0, y)
          g.lineTo(xx - w1, y + 74)
          g.moveTo(xx - w0, y)
          g.lineTo(xx + w0, y)
          g.stroke()
        }
        g.fillStyle = DARK
        g.save()
        g.translate(xx + 30, 330)
        g.rotate(0.5)
        g.beginPath()
        g.ellipse(0, 0, 46, 16, 0, 0, Math.PI * 2)
        g.fill()
        g.restore()
      })
      // lamp posts, each with an arm; one has lost its head
      posts.forEach(([x, h], i) =>
        wrap(x - 90, 180, (shift) => {
          const xx = shift + 90,
            dir = i ? -1 : 1
          g.fillStyle = DARK
          g.fillRect(xx - 6, H - h, 12, h)
          g.fillRect(xx - 16, H - 26, 32, 26)
          g.save()
          g.translate(xx, H - h)
          g.rotate(-0.12 * dir)
          g.fillRect(dir > 0 ? 0 : -84, -5, 84, 9)
          g.fillRect(dir > 0 ? 66 : -90, -3, 24, 15)
          g.restore()
        })
      )
      // chain-link fence along the whole yard, torn open in places, with barbed wire sagging along its top
      const top = H - 250
      g.strokeStyle = 'rgba(7,5,12,0.9)'
      g.lineWidth = 1.5
      for (let x = -260; x < TILE + 20; x += 20) {
        const torn = Math.floor((x + 260) / 320) % 4 === 2
        if (torn && r() < 0.8) continue
        g.beginPath()
        g.moveTo(x, top)
        g.lineTo(x + 250, H)
        g.moveTo(x + 250, top)
        g.lineTo(x, H)
        g.stroke()
      }
      g.fillStyle = DARK
      for (let x = 0; x < TILE; x += 256) {
        g.save()
        g.translate(x, H)
        g.rotate((r() - 0.5) * 0.08)
        g.fillRect(-5, -268, 10, 268)
        g.restore()
      }
      g.strokeStyle = DARK
      g.lineWidth = 2.5
      for (let x = 0; x < TILE; x += 256) {
        g.beginPath()
        g.moveTo(x, top - 14)
        g.quadraticCurveTo(x + 128, top + 6 + r() * 16, x + 256, top - 14)
        g.stroke()
      }
      g.fillRect(0, top - 2, TILE, 4)
    },
    1
  )
  tex(
    scene,
    'bd_lights_yard',
    TILE,
    H,
    0,
    0,
    (g) => {
      // sodium lamps: a hot head, a cone of orange haze under it, a pool on the ground
      posts.forEach(([x, h], i) => {
        if (i === 1) return // the one that has lost its head
        wrap(x - 320, 640, (shift) => {
          const hx = shift + 320 + 80,
            hy = H - h + 4
          const cone = g.createLinearGradient(0, hy, 0, H)
          cone.addColorStop(0, 'rgba(255,170,80,0.34)')
          cone.addColorStop(1, 'rgba(255,170,80,0.03)')
          g.fillStyle = cone
          g.beginPath()
          g.moveTo(hx - 12, hy)
          g.lineTo(hx + 12, hy)
          g.lineTo(hx + 250, H)
          g.lineTo(hx - 250, H)
          g.closePath()
          g.fill()
          const head = g.createRadialGradient(hx, hy, 2, hx, hy, 90)
          head.addColorStop(0, 'rgba(255,225,170,1)')
          head.addColorStop(0.2, 'rgba(255,170,80,0.6)')
          head.addColorStop(1, 'rgba(255,150,60,0)')
          g.fillStyle = head
          g.fillRect(hx - 90, hy - 90, 180, 180)
        })
      })
      // the mast's beacons, and the yard's one working sign: a manifest nobody will read again
      wrap(mast - 40, 80, (shift) => {
        for (const y of [128, 520]) {
          const b = g.createRadialGradient(shift + 40, y, 1, shift + 40, y, 34)
          b.addColorStop(0, 'rgba(255,90,90,1)')
          b.addColorStop(1, 'rgba(255,40,60,0)')
          g.fillStyle = b
          g.fillRect(shift + 6, y - 34, 68, 68)
        }
      })
      wrap(600, 250, (xx) => {
        g.save()
        g.translate(xx, H - 150 - 190)
        g.shadowColor = '#35d8ff'
        g.shadowBlur = 16
        g.strokeStyle = 'rgba(150,235,255,0.9)'
        g.lineWidth = 3
        g.strokeRect(0, 0, 250, 150)
        g.fillStyle = 'rgba(80,200,255,0.12)'
        g.fillRect(0, 0, 250, 150)
        g.fillStyle = 'rgba(170,240,255,0.95)'
        g.fillRect(16, 18, 90, 26)
        for (let k = 0; k < 5; k++) g.fillRect(16, 62 + k * 16, 70 + ((k * 53) % 140), 6)
        g.restore()
      })
    },
    1
  )
  // the day's heat still standing over the ground
  tex(
    scene,
    'fog_yard',
    64,
    420,
    0,
    0,
    (g) => {
      const gr = g.createLinearGradient(0, 0, 0, 420)
      gr.addColorStop(0, 'rgba(255,130,70,0)')
      gr.addColorStop(0.62, 'rgba(255,130,70,0.26)')
      gr.addColorStop(0.78, 'rgba(255,120,90,0.16)')
      gr.addColorStop(1, 'rgba(255,120,90,0)')
      g.fillStyle = gr
      g.fillRect(0, 0, 64, 420)
    },
    1
  )
}

export function buildStage(scene: Phaser.Scene) {
  buildYard(scene)
  // ---- near layer: the hall's own riveted columns, with dead cables hanging out of the dark above them
  const column = scene.textures.get('bd_column').getSourceImage() as HTMLImageElement
  tex(
    scene,
    'bd_near',
    TILE,
    NEAR_H,
    0,
    0,
    (g) => {
      const r = rng(11)
      for (const [x, w, flip] of COLUMNS)
        wrap(x, w, (xx) => {
          g.save()
          g.translate(xx + (flip ? w : 0), 0)
          g.scale(flip ? -1 : 1, 1)
          g.drawImage(column, 0, 0, w, NEAR_H)
          g.restore()
          // turned away from what little light there is: both edges fall off into shadow
          const shade = g.createLinearGradient(xx, 0, xx + w, 0)
          shade.addColorStop(0, 'rgba(1,3,7,0.6)')
          shade.addColorStop(0.3, 'rgba(1,3,7,0)')
          shade.addColorStop(0.72, 'rgba(1,3,7,0.1)')
          shade.addColorStop(1, 'rgba(1,3,7,0.7)')
          g.fillStyle = shade
          g.fillRect(xx, 0, w, NEAR_H)
          // a base plate bolted to the deck
          g.fillStyle = '#04070c'
          g.fillRect(xx - 16, NEAR_H - 34, w + 32, 34)
          g.fillStyle = 'rgba(150,200,235,0.16)'
          g.fillRect(xx - 16, NEAR_H - 34, w + 32, 2)
        })
      // cables: most sag from one anchor to the next, a few have come away and hang with a frayed end
      g.lineCap = 'round'
      for (let i = 0; i < 11; i++) {
        const x0 = r() * TILE,
          span = 260 + r() * 520,
          y0 = 40 + r() * 220,
          sag = 120 + r() * 420,
          loose = r() < 0.35
        wrap(x0, span, (xx) => {
          g.strokeStyle = '#03060a'
          g.lineWidth = 3 + r() * 4
          g.beginPath()
          g.moveTo(xx, y0)
          if (loose) g.quadraticCurveTo(xx + 30, y0 + sag * 0.6, xx + 18 + r() * 40, y0 + sag + 260)
          else g.quadraticCurveTo(xx + span / 2, y0 + sag, xx + span, y0 + 30 + r() * 80)
          g.stroke()
        })
      }
      // a length of collapsed catwalk still slung between two of the columns
      wrap(640, 470, (xx) => {
        g.save()
        g.translate(xx, 372)
        g.rotate(0.07)
        g.fillStyle = '#04070c'
        g.fillRect(0, 0, 470, 16)
        g.fillRect(0, -70, 470, 6)
        for (let k = 0; k <= 470; k += 47) g.fillRect(k, -70, 5, 74)
        g.strokeStyle = '#04070c'
        g.lineWidth = 3
        for (let k = 0; k < 470; k += 94) {
          g.beginPath()
          g.moveTo(k, 0)
          g.lineTo(k + 47, -66)
          g.lineTo(k + 94, 0)
          g.stroke()
        }
        g.fillStyle = 'rgba(150,200,235,0.14)'
        g.fillRect(0, -70, 470, 1.5)
        g.restore()
      })
      // the tops of everything are lost in the dark of the roof
      g.globalCompositeOperation = 'destination-out'
      const top = g.createLinearGradient(0, 0, 0, NEAR_H * 0.22)
      top.addColorStop(0, 'rgba(0,0,0,1)')
      top.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = top
      g.fillRect(0, 0, TILE, NEAR_H * 0.22)
      g.globalCompositeOperation = 'source-over'
    },
    1
  )

  // ---- what still has power, drawn to be added over the near layer: strips of cold light down the columns
  //      (dead in places), status lamps, and one hazard panel still projecting
  tex(
    scene,
    'bd_lights',
    TILE,
    NEAR_H,
    0,
    0,
    (g) => {
      const r = rng(23)
      for (const [x, w, flip] of COLUMNS)
        wrap(x, w, (xx) => {
          const edge = flip ? xx + w * 0.16 : xx + w * 0.84
          g.save()
          g.shadowColor = '#35c8ff'
          g.shadowBlur = 18
          g.fillStyle = 'rgba(170,238,255,0.95)'
          for (let y = 430; y < NEAR_H - 70;) {
            const len = 40 + r() * 190
            if (r() < 0.72) g.fillRect(edge - 2, y, 4, Math.min(len, NEAR_H - 70 - y))
            y += len + 14 + r() * 60
          }
          g.restore()
          // a lamp at head height: most are amber, one is on its last legs in red
          const lamp = r() < 0.34 ? '#ff3b52' : '#ffb347'
          g.save()
          g.shadowColor = lamp
          g.shadowBlur = 26
          g.fillStyle = lamp
          g.beginPath()
          g.arc(xx + w * (flip ? 0.7 : 0.3), NEAR_H - 520 - r() * 120, 6, 0, Math.PI * 2)
          g.fill()
          g.restore()
          // the light the strip throws on the deck at its foot
          const pool = g.createRadialGradient(edge, NEAR_H - 20, 4, edge, NEAR_H - 20, 190)
          pool.addColorStop(0, 'rgba(70,190,255,0.3)')
          pool.addColorStop(1, 'rgba(70,190,255,0)')
          g.fillStyle = pool
          g.fillRect(edge - 190, NEAR_H - 210, 380, 210)
        })
      // the hazard panel: a frame, its warning chevrons and a few lines of text that can no longer be read
      wrap(1560, 250, (xx) => {
        g.save()
        g.translate(xx, 760)
        g.shadowColor = '#ff4fc0'
        g.shadowBlur = 16
        g.strokeStyle = 'rgba(255,150,225,0.9)'
        g.lineWidth = 3
        g.strokeRect(0, 0, 250, 150)
        g.fillStyle = 'rgba(255,110,205,0.14)'
        g.fillRect(0, 0, 250, 150)
        g.fillStyle = 'rgba(255,170,230,0.95)'
        for (let k = 0; k < 4; k++) {
          g.beginPath()
          g.moveTo(18 + k * 30, 22)
          g.lineTo(36 + k * 30, 22)
          g.lineTo(24 + k * 30, 52)
          g.lineTo(6 + k * 30, 52)
          g.closePath()
          g.fill()
        }
        for (let k = 0; k < 4; k++) g.fillRect(16, 74 + k * 17, 60 + r() * 150, 6)
        g.restore()
      })
    },
    1
  )

  // ---- moonlight through the plant's windows, hanging in the dust
  tex(
    scene,
    'bd_shafts',
    TILE,
    1100,
    0,
    0,
    (g) => {
      g.filter = 'blur(14px)'
      for (const [x, w, a] of [
        [120, 300, 0.34],
        [760, 190, 0.22],
        [1180, 360, 0.3],
        [1720, 150, 0.18],
      ])
        wrap(x - 260, w + 520, (shift) => {
          const xx = shift + 260,
            beam = g.createLinearGradient(0, 0, 0, 1100)
          beam.addColorStop(0, 'rgba(150,205,255,0)')
          beam.addColorStop(0.25, `rgba(150,205,255,${a})`)
          beam.addColorStop(0.9, `rgba(150,205,255,${a * 0.55})`)
          beam.addColorStop(1, 'rgba(150,205,255,0)')
          g.fillStyle = beam
          g.beginPath()
          g.moveTo(xx, 0)
          g.lineTo(xx + w, 0)
          g.lineTo(xx + w + 260, 1100)
          g.lineTo(xx + 190, 1100)
          g.closePath()
          g.fill()
        })
      g.filter = 'none'
    },
    1
  )

  // ---- floating platform (stretchable middle is baked per width in makePlatform)
  // ---- energy gate
  tex(
    scene,
    'gate',
    96,
    512,
    48,
    0,
    (g) => {
      const gr = g.createLinearGradient(-48, 0, 48, 0)
      gr.addColorStop(0, 'rgba(255,61,110,0)')
      gr.addColorStop(0.5, 'rgba(255,61,110,0.55)')
      gr.addColorStop(1, 'rgba(255,61,110,0)')
      g.fillStyle = gr
      g.fillRect(-48, 0, 96, 512)
      g.strokeStyle = 'rgba(255,190,205,0.85)'
      g.lineWidth = 1.5
      for (let y = -16; y < 540; y += 32)
        for (let c = -1; c <= 1; c++) {
          const cx = c * 28 + (Math.round(y / 32) & 1 ? 14 : 0),
            cy = y
          g.beginPath()
          for (let k = 0; k < 6; k++) {
            const a = (Math.PI / 3) * k + Math.PI / 6
            const px = cx + Math.cos(a) * 15,
              py = cy + Math.sin(a) * 15
            k ? g.lineTo(px, py) : g.moveTo(px, py)
          }
          g.closePath()
          g.stroke()
        }
      g.globalCompositeOperation = 'destination-in'
      const m = g.createLinearGradient(-48, 0, 48, 0)
      m.addColorStop(0, 'rgba(0,0,0,0)')
      m.addColorStop(0.5, 'rgba(0,0,0,1)')
      m.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = m
      g.fillRect(-48, 0, 96, 512)
      g.globalCompositeOperation = 'source-over'
      g.save()
      g.shadowColor = '#ff2a10'
      g.shadowBlur = 14
      g.fillStyle = '#ffd0da'
      g.fillRect(-1.5, 0, 3, 512)
      g.restore()
    },
    1
  )

  // ---- foreground silhouettes
  tex(
    scene,
    'fg_pillar',
    260,
    1080,
    130,
    0,
    (g) => {
      g.save()
      g.filter = 'blur(5px)'
      g.fillStyle = '#02050a'
      g.fillRect(-30, 0, 60, 1080)
      g.fillRect(-70, 0, 140, 50)
      g.fillRect(-52, 1010, 104, 70)
      g.strokeStyle = '#02050a'
      g.lineWidth = 9
      g.beginPath()
      g.moveTo(-90, 20)
      g.quadraticCurveTo(-120, 500, -60, 1010)
      g.stroke()
      g.restore()
      g.save()
      g.filter = 'blur(2px)'
      g.fillStyle = 'rgba(120,220,240,0.25)'
      g.fillRect(27, 60, 2.5, 940)
      g.restore()
    },
    1
  )

  tex(
    scene,
    'fog',
    64,
    420,
    0,
    0,
    (g) => {
      const gr = g.createLinearGradient(0, 0, 0, 420)
      gr.addColorStop(0, 'rgba(110,200,205,0)')
      gr.addColorStop(0.62, 'rgba(110,200,205,0.34)')
      gr.addColorStop(0.75, 'rgba(110,200,205,0.2)')
      gr.addColorStop(1, 'rgba(110,200,205,0)')
      g.fillStyle = gr
      g.fillRect(0, 0, 64, 420)
    },
    1
  )
}

export function makePlatform(scene: Phaser.Scene, w: number): string {
  const key = `plat_${w}`
  tex(scene, key, w + 40, 90, 20, 20, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 30)
    gr.addColorStop(0, '#34506a')
    gr.addColorStop(0.2, '#1b2d40')
    gr.addColorStop(1, '#0a121c')
    g.beginPath()
    g.moveTo(0, 0)
    g.lineTo(w, 0)
    g.lineTo(w - 14, 24)
    g.lineTo(w * 0.62, 24)
    g.lineTo(w * 0.58, 34)
    g.lineTo(w * 0.42, 34)
    g.lineTo(w * 0.38, 24)
    g.lineTo(14, 24)
    g.closePath()
    g.fillStyle = gr
    g.fill()
    g.strokeStyle = '#04080d'
    g.lineWidth = 1.5
    g.stroke()
    g.save()
    g.shadowColor = '#40e0ff'
    g.shadowBlur = 10
    g.fillStyle = 'rgba(170,240,255,0.95)'
    g.fillRect(0, 0, w, 2)
    g.restore()
    g.save()
    g.shadowColor = '#ffb040'
    g.shadowBlur = 14
    g.fillStyle = 'rgba(255,205,130,0.95)'
    g.fillRect(w * 0.44, 33, w * 0.12, 3)
    g.restore()
    const cone = g.createLinearGradient(0, 36, 0, 70)
    cone.addColorStop(0, 'rgba(255,200,120,0.3)')
    cone.addColorStop(1, 'rgba(255,200,120,0)')
    g.fillStyle = cone
    g.beginPath()
    g.moveTo(w * 0.44, 36)
    g.lineTo(w * 0.56, 36)
    g.lineTo(w * 0.62, 70)
    g.lineTo(w * 0.38, 70)
    g.closePath()
    g.fill()
    for (let x = 30; x < w - 30; x += 46) {
      g.fillStyle = 'rgba(4,8,13,0.8)'
      g.fillRect(x, 8, 22, 3)
    }
  })
  return key
}

/**
 * The backdrop: a derelict power plant at night, photographed. All layers are camera-fixed tile sprites scrolled by
 * hand. From the back: the dark itself, the turbine hall in haze, the plant floor, moonlight in the dust, floor
 * fog, the hall's columns with their cables and what still has power, and the checker-plate deck.
 */
export class Backdrop {
  private layers: { ts: Phaser.GameObjects.TileSprite; f: number; y: number; s: number }[] = []
  private filler!: Phaser.GameObjects.Rectangle
  private lights!: Phaser.GameObjects.TileSprite
  private motes: { im: Phaser.GameObjects.Image; x: number; y: number; z: number; ph: number }[] = []
  dim: Phaser.GameObjects.Rectangle

  constructor(scene: Phaser.Scene, worldW: number, set: BackdropSet = 'plant') {
    const M = 500 // overscan so cinematic zoom/rotation never shows an edge
    const W = VIEW_W + M * 2
    scene.add
      .rectangle(VIEW_W / 2, VIEW_H / 2, W, VIEW_H + M * 2, set === 'yard' ? VOID_YARD : VOID)
      .setScrollFactor(0)
      .setDepth(DEPTH.sky)
    /** A layer whose bottom edge rests `bottom` down the world when the camera is at rest, drawn at `scale`. */
    const add = (key: string, bottom: number, scale: number, f: number, depth: number) => {
      const h = scene.textures.getFrame(key).height * scale
      const ts = scene.add
        .tileSprite(-M, bottom - h, W, h, key)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(depth)
        .setTileScale(scale, scale)
      this.layers.push({ ts, f, y: bottom - h, s: scale })
      return ts
    }
    if (set === 'yard') {
      // the outer yard at dusk: a burning sky, the sheds against it, then the fence line with its lamps
      add('bd_far_yard', GROUND_Y + 70, 1.9, 0.05, DEPTH.far)
      add('bd_mid_yard', GROUND_Y + 34, 1.55, 0.2, DEPTH.mid)
      add('fog_yard', GROUND_Y + 70, 1, 0.3, DEPTH.mid + 2).setBlendMode(Phaser.BlendModes.ADD)
      add('bd_near_yard', GROUND_Y + 8, 1, 0.5, DEPTH.near)
      this.lights = add('bd_lights_yard', GROUND_Y + 8, 1, 0.5, DEPTH.near + 0.5).setBlendMode(Phaser.BlendModes.ADD)
      add('bd_floor_yard', GROUND_Y + 220, 1, 1, DEPTH.floor)
    } else {
      add('bd_far', GROUND_Y + 80, 1.7, 0.07, DEPTH.far)
      add('bd_mid', GROUND_Y + 40, 1.36, 0.24, DEPTH.mid)
      add('bd_shafts', GROUND_Y + 30, 1, 0.3, DEPTH.mid + 1)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(0.85)
      add('fog', GROUND_Y + 90, 1, 0.3, DEPTH.mid + 2).setBlendMode(Phaser.BlendModes.ADD)
      add('bd_near', GROUND_Y + 8, 1, 0.5, DEPTH.near)
      this.lights = add('bd_lights', GROUND_Y + 8, 1, 0.5, DEPTH.near + 0.5).setBlendMode(Phaser.BlendModes.ADD)
      add('bd_floor', GROUND_Y + 220, 1, 1, DEPTH.floor)
    }
    this.filler = scene.add
      .rectangle(VIEW_W / 2, GROUND_Y + 220 + 300, W, 600, 0x02040a)
      .setScrollFactor(0)
      .setDepth(DEPTH.floor)
    for (let x = 900; x < worldW; x += 1750)
      scene.add
        .image(x, -260, 'fg_pillar')
        .setOrigin(0.5, 0)
        .setScale(1, 1.3)
        .setScrollFactor(1.4, 1)
        .setDepth(DEPTH.fore)
        .setAlpha(0.92)
    const r = rng(5)
    for (let i = 0; i < 46; i++) {
      const z = 0.4 + r() * 1.1
      // dust in the moonlight, and now and then an ember from something still burning out
      const im = scene.add
        .image(0, 0, 'glow')
        .setScrollFactor(0)
        .setDepth(z > 1 ? DEPTH.fore - 1 : DEPTH.near + 1)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(0.04 + z * 0.06)
        .setAlpha(0.12 + r() * 0.26)
        .setTint(r() < 0.14 ? 0xffb070 : 0xbfd8ee)
      this.motes.push({ im, x: r() * 2400, y: r() * VIEW_H, z, ph: r() * 7 })
    }
    // cinematic dimmer: sits between the backdrop and the actors
    this.dim = scene.add
      .rectangle(VIEW_W / 2, VIEW_H / 2, W, VIEW_H + M * 2, 0x02030a)
      .setScrollFactor(0)
      .setDepth(DEPTH.props + 5)
      .setAlpha(0)
  }

  update(cam: Phaser.Cameras.Scene2D.Camera, time: number) {
    // vertical parallax is measured from the camera's resting height so layers meet the floor when at rest
    const rest = CAM_REST_Y - VIEW_H / 2,
      dy = cam.scrollY - rest
    // a tile sprite scrolls in texture pixels, so a scaled layer's scroll is divided by its scale
    // Sideways each layer drifts at its own rate. Up and down they all move with the deck, so nothing lifts off it
    // when the view climbs; only the far hall, whose foot is hidden behind the plant floor, hangs back a little.
    for (const l of this.layers) {
      l.ts.tilePositionX = (cam.scrollX * l.f - 500 * (1 - l.f)) / l.s
      l.ts.y = l.y - rest - dy * (l.f < 0.1 ? 0.8 : 1)
    }
    this.filler.y = GROUND_Y + 520 - cam.scrollY
    // failing power: the lights breathe unevenly, and every few seconds they drop out for an instant
    const dip = Math.sin(time * 0.9) * Math.sin(time * 2.3 + 1.7) > 0.86 ? (Math.sin(time * 61) > 0 ? 0.35 : 0.8) : 1
    this.lights.setAlpha((0.82 + 0.1 * Math.sin(time * 3.1) + 0.06 * Math.sin(time * 12.7)) * dip)
    for (const m of this.motes) {
      const x = ((((m.x - cam.scrollX * m.z * 0.6 + time * 12 * m.z) % 2400) + 2400) % 2400) - 240
      m.im.setPosition(x, m.y + Math.sin(time * 0.6 + m.ph) * 26 - ((time * 9 * m.z) % VIEW_H) * 0)
    }
  }
}

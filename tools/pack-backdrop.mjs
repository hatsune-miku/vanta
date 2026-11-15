// Grade the photographic sources in assets-src/backdrop/ into the game's backdrop layers in public/backdrop/.
//
//   node tools/pack-backdrop.mjs [sourceDir] [outDir]
//
// The sources are daylight panoramas of a derelict power plant (see assets-src/backdrop/SOURCES.json). A band around
// the horizon of each wraps seamlessly, so it can scroll for ever as a parallax layer. Here they are turned into
// night: dimmed, cooled, the far one softened as if seen through dust, their tops lost in the dark of the roof.
import { mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..'),
  src = process.argv[2] ?? join(root, 'assets-src/backdrop'),
  out = process.argv[3] ?? join(root, 'public/backdrop'),
  open = (name) => sharp(join(src, name), { limitInputPixels: false })
mkdirSync(out, { recursive: true })

/** the dark the layers fade into: the colour the scene is cleared to behind them */
export const VOID = '#05080e'
const W = 4096

/** A vertical gradient as an overlay: `stops` are [offset 0..1, colour, opacity]. */
function gradient(width, height, stops) {
  const marks = stops
    .map(([at, color, opacity]) => `<stop offset="${at}" stop-color="${color}" stop-opacity="${opacity}"/>`)
    .join('')
  return Buffer.from(
    `<svg width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">${marks}</linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/></svg>`
  )
}
/** Night grade: less colour, less light, and what is left pushed toward blue without becoming one flat tint. */
const night = (image, light, colour) =>
  image
    .modulate({ saturation: colour, brightness: light })
    .recomb([
      [0.74, 0.05, 0.03],
      [0.05, 0.88, 0.07],
      [0.08, 0.16, 1.1],
    ])
    .linear(1.22, -26)

async function size(image) {
  const { width, height } = await image.metadata()
  return { width, height }
}
async function report(name) {
  const file = join(out, name),
    { width, height } = await size(sharp(file))
  console.log(`${name.padEnd(12)} ${width} x ${height}  ${(statSync(file).size / 1024).toFixed(0)} KB`)
}

// ---- far: the turbine hall, deep in haze. Opaque; its top is baked into the dark.
{
  const band = night(open('plant_far.jpg').resize({ width: W }), 0.4, 0.38).blur(2.6),
    buffer = await band.toBuffer(),
    { width, height } = await size(sharp(buffer))
  await sharp(buffer)
    .composite([
      {
        input: gradient(width, height, [
          [0, VOID, 1],
          [0.2, VOID, 0.75],
          [0.5, VOID, 0],
          [1, '#0d2a40', 0.35],
        ]),
      },
    ])
    .jpeg({ quality: 84, mozjpeg: true })
    .toFile(join(out, 'far.jpg'))
  await report('far.jpg')
}

// ---- mid: the plant floor the fight happens in front of. Its top thins out so the far hall shows above it.
{
  const band = night(open('plant_mid.jpg').resize({ width: W }), 0.74, 0.6),
    buffer = await band.toBuffer(),
    { width, height } = await size(sharp(buffer)),
    mask = await sharp(
      gradient(width, height, [
        [0, '#000', 1],
        [0.06, '#000', 1],
        [0.3, '#fff', 1],
        [1, '#fff', 1],
      ])
    )
      .greyscale()
      .raw()
      .toBuffer()
  // floor haze first, then the mask as the alpha channel
  const hazed = await sharp(buffer)
    .composite([
      {
        input: gradient(width, height, [
          [0.55, '#0d2a40', 0],
          [1, '#0d2a40', 0.3],
        ]),
      },
    ])
    .removeAlpha()
    .png()
    .toBuffer()
  await sharp(hazed)
    .joinChannel(mask, { raw: { width, height, channels: 1 } })
    .webp({ quality: 84, alphaQuality: 80 })
    .toFile(join(out, 'mid.webp'))
  await report('mid.webp')
}

// ---- column: one riveted, flaking steel column from the same hall, stood in the near layer.
{
  await night(open('column.jpg'), 0.6, 0.55)
    .resize({ height: 1400 })
    .jpeg({ quality: 86, mozjpeg: true })
    .toFile(join(out, 'column.jpg'))
  await report('column.jpg')
}

// ---- floor: worn checker plate, foreshortened, falling off into the dark toward the camera.
{
  const tile = 1024,
    height = 220,
    plate = await night(open('floor.jpg').resize({ width: tile, height: tile }), 1.05, 0.5)
      .resize({ width: tile, height, fit: 'fill' })
      .toBuffer()
  await sharp(plate)
    .composite([
      {
        input: gradient(tile, height, [
          [0, '#bfe2ff', 0.34],
          [0.03, '#4f86b0', 0.14],
          [0.35, VOID, 0.1],
          [1, VOID, 0.9],
        ]),
      },
    ])
    .jpeg({ quality: 86, mozjpeg: true })
    .toFile(join(out, 'floor.jpg'))
  await report('floor.jpg')
}

// =====================================================================================================
// Stage 2: the outer yard at dusk. A burning sky far off, and against it the yard's sheds and trees as
// near-black shapes, cut out of their own daylight sky.
// =====================================================================================================
const yardSrc = join(src, 'yard'),
  yardOut = join(out, 'yard'),
  VOID_YARD = '#0b0716'
mkdirSync(yardOut, { recursive: true })
const reportYard = async (name) => {
  const file = join(yardOut, name),
    { width, height } = await size(sharp(file))
  console.log(`yard/${name.padEnd(10)} ${width} x ${height}  ${(statSync(file).size / 1024).toFixed(0)} KB`)
}

// ---- sky: the sunset pushed toward ember and violet, its top lost in the coming night
{
  const buffer = await sharp(join(yardSrc, 'sky.jpg'), { limitInputPixels: false })
      .resize({ width: W })
      .modulate({ saturation: 1.2, brightness: 0.5 })
      .recomb([
        [1.08, 0.04, 0.0],
        [0.02, 0.84, 0.04],
        [0.05, 0.1, 0.98],
      ])
      .linear(1.25, -24)
      .toBuffer(),
    { width, height } = await size(sharp(buffer))
  await sharp(buffer)
    .composite([
      {
        input: gradient(width, height, [
          [0, VOID_YARD, 1],
          [0.3, VOID_YARD, 0.6],
          [0.62, '#5a2a6a', 0.12],
          [0.86, '#ff6a2a', 0.2],
          [1, '#ffa24a', 0.42],
        ]),
      },
    ])
    .jpeg({ quality: 86, mozjpeg: true })
    .toFile(join(yardOut, 'far.jpg'))
  await reportYard('far.jpg')
}

// ---- skyline: everything that is not sky, darkened to a silhouette that keeps a little of its own form
{
  const { data, info } = await sharp(join(yardSrc, 'skyline.jpg'), { limitInputPixels: false })
      .resize({ width: W })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    { width, height } = info,
    rgb = Buffer.alloc(width * height * 3),
    alpha = Buffer.alloc(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x,
        r = data[i * 3],
        g = data[i * 3 + 1],
        b = data[i * 3 + 2],
        lum = 0.299 * r + 0.587 * g + 0.114 * b,
        // blue sky, or cloud: bright and no warmer than neutral, above where the buildings stand
        sky = (b - r > 10 && lum > 110) || (lum > 170 && b >= r - 6 && y < height * 0.66)
      alpha[i] = sky ? 0 : 255
      const k = 0.1 + 0.12 * (lum / 255)
      rgb[i * 3] = Math.min(255, r * k * 1.2 + 12)
      rgb[i * 3 + 1] = Math.min(255, g * k * 0.82 + 6)
      rgb[i * 3 + 2] = Math.min(255, b * k * 1.05 + 16)
    }
  const soft = await sharp(alpha, { raw: { width, height, channels: 1 } })
    .blur(1.2)
    .toColourspace('b-w')
    .raw()
    .toBuffer()
  await sharp(rgb, { raw: { width, height, channels: 3 } })
    .joinChannel(soft, { raw: { width, height, channels: 1 } })
    .webp({ quality: 86, alphaQuality: 90 })
    .toFile(join(yardOut, 'mid.webp'))
  await reportYard('mid.webp')
}

// ---- floor: worn concrete, lit low from the horizon
{
  const tile = 1024,
    height = 220,
    slab = await sharp(join(yardSrc, 'floor.jpg'))
      .resize({ width: tile, height: tile })
      .modulate({ saturation: 0.5, brightness: 0.5 })
      .recomb([
        [1.1, 0.04, 0.02],
        [0.02, 0.84, 0.04],
        [0.08, 0.08, 0.98],
      ])
      .resize({ width: tile, height, fit: 'fill' })
      .toBuffer()
  await sharp(slab)
    .composite([
      {
        input: gradient(tile, height, [
          [0, '#ffb070', 0.3],
          [0.04, '#a8552c', 0.12],
          [0.35, VOID_YARD, 0.2],
          [1, VOID_YARD, 0.92],
        ]),
      },
    ])
    .jpeg({ quality: 86, mozjpeg: true })
    .toFile(join(yardOut, 'floor.jpg'))
  await reportYard('floor.jpg')
}

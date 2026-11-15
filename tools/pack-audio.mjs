// Trim, level and transcode the sounds listed in assets-src/audio/SOURCES.json into public/audio/.
//
//   node tools/pack-audio.mjs            (ffmpeg on PATH)
//   FFMPEG=/path/to/ffmpeg node tools/pack-audio.mjs
//
// Effects become short mono mp3 files at a set peak level, so their balance is decided here and in the mix table of
// src/audio/sfx.ts rather than by whatever level each pack happened to be mastered at.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..'),
  src = join(root, 'assets-src/audio'),
  out = join(root, 'public/audio'),
  ffmpeg = process.env.FFMPEG || 'ffmpeg',
  sources = JSON.parse(readFileSync(join(src, 'SOURCES.json'), 'utf8')),
  quiet = ['-hide_banner', '-loglevel', 'error', '-y'],
  RATE = 44100

if (spawnSync(ffmpeg, ['-version']).status !== 0) {
  console.error(`ffmpeg was not found (${ffmpeg}). Install it, or point FFMPEG at a binary.`)
  process.exit(1)
}

rmSync(join(out, 'sfx'), { recursive: true, force: true })
mkdirSync(join(out, 'sfx'), { recursive: true })

let total = 0
for (const [name, effect] of Object.entries(sources.effects)) {
  const file = join(src, effect.local),
    // the whole effect as mono samples: where it becomes audible, how loud it gets, how long it runs
    decoded = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(RATE), 'pipe:1'], {
      maxBuffer: 1 << 26,
    })
  if (decoded.status !== 0 || !decoded.stdout.length) throw new Error(`cannot read ${effect.local}`)
  const pcm = new Float32Array(decoded.stdout.buffer, decoded.stdout.byteOffset, decoded.stdout.length >> 2)
  let loudest = 0
  for (const sample of pcm) loudest = Math.max(loudest, Math.abs(sample))
  let first = 0
  while (first < pcm.length && Math.abs(pcm[first]) < loudest * 0.01) first++
  // dead air before the sound would make it land after the frame it belongs to
  const start = Math.max(0, first / RATE - 0.002),
    keep = Math.min(pcm.length / RATE - start, effect.longest),
    fade = Math.min(0.06, keep / 2),
    target = join(out, 'sfx', `${name}.mp3`)
  execFileSync(ffmpeg, [
    ...quiet,
    '-ss',
    start.toFixed(4),
    '-i',
    file,
    '-t',
    keep.toFixed(4),
    '-ac',
    '1',
    '-ar',
    String(RATE),
    '-af',
    `volume=${(effect.peak - 20 * Math.log10(loudest)).toFixed(1)}dB,afade=t=out:st=${(keep - fade).toFixed(3)}:d=${fade.toFixed(3)}`,
    '-b:a',
    '96k',
    target,
  ])
  total += statSync(target).size
  console.log(
    `${name.padEnd(11)} ${keep.toFixed(2)}s  cut ${(start * 1000).toFixed(0).padStart(3)}ms  ${statSync(target).size} bytes  <- ${effect.pack}/${effect.original}`
  )
}

for (const piece of sources.music) {
  const target = join(out, `${piece.name}.mp3`)
  execFileSync(ffmpeg, [
    ...quiet,
    '-i',
    join(src, piece.local),
    '-ac',
    '2',
    '-ar',
    '44100',
    '-af',
    `volume=${piece.gain}dB`,
    '-b:a',
    piece.bitrate ?? '112k',
    target,
  ])
  total += statSync(target).size
  console.log(`${piece.name.padEnd(11)} ${statSync(target).size} bytes  <- ${piece.title}`)
}
console.log(`total ${(total / 1e6).toFixed(2)} MB`)

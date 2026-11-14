export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const approach = (v: number, target: number, d: number) =>
  v < target ? Math.min(v + d, target) : Math.max(v - d, target)
export const smooth = (t: number) => t * t * (3 - 2 * t)
/** Exponential approach that behaves the same at any frame rate: `rate` is per second. */
export const damp = (v: number, target: number, rate: number, dt: number) =>
  target + (v - target) * Math.exp(-rate * dt)

/** Deterministic RNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Gameplay RNG, shared and reseedable so test runs are reproducible. */
let gr = rng(1337)
export const rand = () => gr()
export const randRange = (a: number, b: number) => a + (b - a) * gr()
export const reseed = (s: number) => {
  gr = rng(s)
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}
export const overlap = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/** Continuous segment / rectangle overlap, including contact with its boundary. */
export function segmentBox(x0: number, y0: number, x1: number, y1: number, box: Box) {
  let enter = 0,
    leave = 1
  for (const [from, delta, low, high] of [
    [x0, x1 - x0, box.x, box.x + box.w],
    [y0, y1 - y0, box.y, box.y + box.h],
  ]) {
    if (Math.abs(delta) < 1e-8) {
      if (from < low || from > high) return false
      continue
    }
    const a = (low - from) / delta,
      b = (high - from) / delta
    enter = Math.max(enter, Math.min(a, b))
    leave = Math.min(leave, Math.max(a, b))
    if (enter > leave) return false
  }
  return true
}

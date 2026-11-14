import type { FxPeak } from './fx'

/** Cinematic slow motion starts only once the authored impact envelope has reached its visual peak. */
export class ImpactSlowdown {
  at = -1
  readonly duration = 6
  private peak: FxPeak | null = null

  arm(peak: FxPeak) {
    this.peak = peak
    this.at = -1
  }

  rateAt(time: number) {
    if (this.at < 0 && this.peak?.reached) this.at = time
    return this.at >= 0 && time < this.at + this.duration ? 0.16 : 1
  }
}

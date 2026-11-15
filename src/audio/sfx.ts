import { TEST_MODE } from '../config'

interface Voice {
  /** level in the mix; the files themselves are levelled by tools/pack-audio.mjs */
  gain: number
  /** random pitch spread, as a fraction of the playback rate, so repeats do not sound stamped */
  spread?: number
  /** shortest time between two of the same sound, in seconds */
  gap?: number
}

/**
 * Every moment the game marks for a sound. The code calls play() at all of them, but only the cues given a voice
 * in MIX are heard; the rest are places where a sound belongs once one worth having has been chosen.
 */
const CUES = [
  'ui',
  'swing',
  'swingHeavy',
  'hit',
  'hitHeavy',
  'clang',
  'dash',
  'jump',
  'land',
  'slam',
  'warn',
  'shoot',
  'overload',
  'exStart',
  'exGlint',
  'exCut',
  'exBoom',
  'die',
  'break',
  'clear',
  'gate',
  'perfect',
  'hurt',
] as const
export type SfxName = (typeof CUES)[number]

/** The cues that have a sound: public/audio/sfx/<name>.mp3. At present only an area being cleared. */
const MIX: Partial<Record<SfxName, Voice>> = {
  clear: { gain: 0.6 },
}
export const SFX_NAMES = Object.keys(MIX) as SfxName[]

const BASE = import.meta.env.BASE_URL + 'audio/',
  MUTED = 'vanta.muted',
  MASTER = 0.9,
  MUSIC = 0.4,
  /** the music's low-pass cutoff when open, and at full muffle */
  TONE_OPEN = 20000,
  TONE_SHUT = 700,
  /** a sound asked for while it is still decoding is played if it becomes ready within this long */
  LATE = 0.3

interface Sound {
  buffer: AudioBuffer
  /** seconds of encoder padding before the first audible sample, skipped so hits land on their frame */
  lead: number
}

function leadOf(buffer: AudioBuffer) {
  const data = buffer.getChannelData(0),
    limit = Math.min(data.length, Math.floor(buffer.sampleRate * 0.15))
  let i = 0
  while (i < limit && Math.abs(data[i]) < 0.004) i++
  return i >= limit ? 0 : Math.max(0, i / buffer.sampleRate - 0.002)
}

/**
 * Effects and music.
 *
 * Browsers only let a page make sound after the visitor has pressed something, so nothing is opened until then:
 * the files are fetched up front, decoded on the first key or pointer press, and effects asked for before that are
 * simply not heard. Effects are short buffers played through Web Audio; the music is streamed by an audio element
 * (decoding three and a half minutes into memory would cost about 70 MB) and runs through a low-pass filter so
 * the scene can muffle it while paused or while time is slowed.
 *
 * Scripted test runs make no sound and open nothing.
 */
export class Sfx {
  muted = false
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private effects: GainNode | null = null
  private musicGain: GainNode | null = null
  private tone: BiquadFilterNode | null = null
  private track: HTMLAudioElement | null = null
  private raw = new Map<SfxName, Promise<ArrayBuffer | null>>()
  private decoding = new Map<SfxName, Promise<Sound | null>>()
  private sounds = new Map<SfxName, Sound>()
  private last = new Map<SfxName, number>()
  private wantMusic = false
  /** hidden by a host that embeds the game (KOOK), which the document itself does not know about */
  private hostAway = false
  private musicName = 'bgm1'
  private muffled = 0
  private parked = 0
  /** what the music was last set to, so repeated calls do not keep rescheduling it */
  private musicState = ''
  private openedAt = 0
  private resuming = false

  constructor(private live = !TEST_MODE) {
    if (!live) return
    try {
      this.muted = localStorage.getItem(MUTED) === '1'
    } catch {
      // storage may be unavailable; the setting just does not persist
    }
    for (const name of SFX_NAMES)
      this.raw.set(
        name,
        fetch(`${BASE}sfx/${name}.mp3`)
          .then((response) => (response.ok ? response.arrayBuffer() : null))
          .catch(() => null)
      )
    // Some browsers only honour a resume made inside the gesture's own handler.
    const wake = () => this.unlock()
    for (const type of ['keydown', 'pointerdown', 'touchend']) window.addEventListener(type, wake, { passive: true })
    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyM' && !event.repeat) this.setMuted(!this.muted)
    })
    document.addEventListener('visibilitychange', () => this.syncMusic())
  }

  /** How many effects are decoded and ready. */
  get ready() {
    return this.sounds.size
  }
  /** 'none' before the first press, then the audio context's own state. */
  get state() {
    return this.ctx ? this.ctx.state : 'none'
  }
  /** The music element has data and is running (a refused or failed play() does not count). */
  get musicPlaying() {
    const track = this.track
    return !!track && !track.paused && !track.error && track.readyState > 2
  }
  /** Seconds into the piece. */
  get musicTime() {
    return this.track?.currentTime ?? 0
  }
  /** Resolves when every effect has been decoded (or has failed to). Only meaningful after unlock(). */
  whenReady() {
    return Promise.all(this.decoding.values()).then(() => this.sounds.size)
  }

  /** Call from anything the visitor pressed. Cheap to repeat. */
  unlock() {
    if (!this.live) return
    if (!this.ctx) this.open()
    else this.resume()
    this.syncMusic()
  }

  /**
   * Ask a suspended context to run. A browser that has seen no key or pointer press yet (a gamepad alone does
   * not count) leaves the request pending, so only one is ever outstanding however often this is called.
   */
  private resume() {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'suspended' || this.resuming || this.away) return
    this.resuming = true
    void ctx
      .resume()
      .catch(() => {})
      .finally(() => (this.resuming = false))
  }

  private open() {
    const Context: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Context) {
      this.live = false
      return
    }
    this.openedAt = performance.now()
    const ctx = (this.ctx = new Context()),
      // a limiter on the way out: a dozen hits in one frame must not clip
      limiter = ctx.createDynamicsCompressor(),
      master = (this.master = ctx.createGain()),
      effects = (this.effects = ctx.createGain()),
      musicGain = (this.musicGain = ctx.createGain()),
      tone = (this.tone = ctx.createBiquadFilter())
    limiter.threshold.value = -4
    limiter.knee.value = 4
    limiter.ratio.value = 14
    limiter.attack.value = 0.003
    limiter.release.value = 0.16
    master.gain.value = this.muted ? 0 : MASTER
    musicGain.gain.value = 0
    tone.type = 'lowpass'
    tone.frequency.value = TONE_OPEN
    tone.Q.value = 0.5
    effects.connect(master)
    tone.connect(musicGain).connect(master)
    master.connect(limiter).connect(ctx.destination)
    this.resume()
    for (const [name, raw] of this.raw)
      this.decoding.set(
        name,
        raw
          .then((bytes) => (bytes ? ctx.decodeAudioData(bytes) : null))
          .then((buffer) => {
            if (!buffer) return null
            const sound = { buffer, lead: leadOf(buffer) }
            this.sounds.set(name, sound)
            return sound
          })
          .catch(() => null)
      )
    this.raw.clear()
  }

  play(name: SfxName) {
    const ctx = this.ctx,
      voice = MIX[name]
    if (!voice || !ctx || this.muted) return
    if (ctx.state !== 'running') {
      // A context needs a moment to start after the first press, and that press's own sound should be heard.
      // Past that, a context that is not running (no press yet, or a hidden tab) must not pile sounds up.
      if (performance.now() - this.openedAt < 500) window.setTimeout(() => this.play(name), 50)
      return
    }
    const now = ctx.currentTime
    if (now - (this.last.get(name) ?? -1) < (voice.gap ?? 0.04)) return
    this.last.set(name, now)
    const sound = this.sounds.get(name)
    if (sound) this.fire(sound, voice)
    else
      void this.decoding.get(name)?.then((late) => {
        if (late && ctx.currentTime - now < LATE && !this.muted) this.fire(late, voice)
      })
  }

  private fire(sound: Sound, voice: Voice) {
    const ctx = this.ctx,
      out = this.effects
    if (!ctx || !out) return
    const source = ctx.createBufferSource(),
      gain = ctx.createGain()
    source.buffer = sound.buffer
    source.playbackRate.value = 1 + (Math.random() * 2 - 1) * (voice.spread ?? 0)
    gain.gain.value = voice.gain
    source.connect(gain).connect(out)
    source.onended = () => gain.disconnect()
    source.start(0, sound.lead)
  }

  /** Out of sight: the tab is in the background, or the embedding host has hidden the game. */
  private get away() {
    return document.hidden || this.hostAway
  }
  /** The embedding host hid the game (true) or showed it again (false). */
  setAway(hidden: boolean) {
    this.hostAway = hidden
    this.syncMusic()
  }
  /** Play a stage's music (public/audio/<name>.mp3). Asking for the one already playing changes nothing. */
  startMusic(name = 'bgm1') {
    if (name !== this.musicName) {
      this.musicName = name
      // a different piece: the element is pointed at it and starts from the top
      if (this.track) {
        this.track.pause()
        this.track.src = `${BASE}${name}.mp3`
        this.musicState = ''
      }
    }
    this.wantMusic = true
    this.syncMusic()
  }
  /** Fades the music out; the next startMusic() begins it again from the top. */
  stopMusic() {
    this.wantMusic = false
    this.syncMusic()
  }

  /**
   * How far the music is pushed into the background, 0 to 1: its highs are rolled off and it drops a little.
   * The scene calls this every frame with what is on screen (paused, time slowed, a cinematic).
   */
  muffle(amount: number) {
    if (Math.abs(amount - this.muffled) < 0.01) return
    this.muffled = amount
    this.syncMusic()
  }

  setMuted(muted: boolean) {
    this.muted = muted
    try {
      localStorage.setItem(MUTED, muted ? '1' : '0')
    } catch {
      // not persisted
    }
    const ctx = this.ctx
    if (ctx && this.master) {
      this.master.gain.cancelScheduledValues(ctx.currentTime)
      this.master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.03)
    }
  }

  /** Bring the music element and its filter in line with what is wanted right now. */
  private syncMusic() {
    const ctx = this.ctx,
      gain = this.musicGain,
      tone = this.tone
    if (!ctx || !gain || !tone) return
    if (this.wantMusic && !this.track) {
      const track = (this.track = new Audio(`${BASE}${this.musicName}.mp3`))
      track.loop = true
      track.preload = 'auto'
      ctx.createMediaElementSource(track).connect(tone)
    }
    const track = this.track
    if (!track) return
    const playing = this.wantMusic && !this.away
    // a play() refused for want of a press is asked again on the next one
    if (playing && track.paused) void track.play().catch(() => {})
    const state = `${this.wantMusic} ${this.away} ${this.muffled}`
    if (state === this.musicState) return
    this.musicState = state
    const now = ctx.currentTime,
      k = this.muffled
    gain.gain.cancelScheduledValues(now)
    gain.gain.setTargetAtTime(this.wantMusic ? MUSIC * (1 - 0.4 * k) : 0, now, this.wantMusic ? 0.35 : 0.3)
    tone.frequency.cancelScheduledValues(now)
    tone.frequency.setTargetAtTime(TONE_OPEN * Math.pow(TONE_SHUT / TONE_OPEN, k), now, 0.1)
    window.clearTimeout(this.parked)
    if (playing) return
    if (this.away) track.pause()
    else
      // faded out: rewind, so the next run starts the piece from its opening
      this.parked = window.setTimeout(() => {
        if (this.wantMusic) return
        track.pause()
        track.currentTime = 0
      }, 1500)
  }
}

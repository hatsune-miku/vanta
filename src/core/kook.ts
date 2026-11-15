import type { KookCapability, KookClient } from '@kookapp/kook-minigame-sdk'

import { TEST_MODE } from '../config'

/**
 * - `standalone`  opened directly in a browser: the SDK is not even downloaded
 * - `connecting`  inside a frame, waiting for KOOK to answer
 * - `ready`       KOOK answered: this is a KOOK mini-game session
 * - `unavailable` inside a frame that is not KOOK, or the connection ended: the game simply plays on its own
 * - `closed`      KOOK has closed this session
 */
export type KookState = 'standalone' | 'connecting' | 'ready' | 'unavailable' | 'closed'

/**
 * VANTA as a KOOK mini-game.
 *
 * It is a static, single-player game and asks KOOK for nothing: `session.get()` is never called, so no
 * authorisation is ever requested and no OAuth scope is needed; it reads no user data and sends no invitations.
 * What it does do, when it finds itself embedded in KOOK:
 *
 *   - connects (`ready()`) as soon as the page starts, alongside its own loading
 *   - reports the load result once the title screen can be played, or that loading failed
 *   - pauses when the host hides it and stops when the host closes it
 *   - offers the host's fullscreen, exit and external-link handling where the host has them
 *   - destroys the client when the page goes away
 *
 * None of this is required to play. Opened on its own, or framed by something that is not KOOK, the game runs
 * exactly as it does anywhere else.
 */
class Kook {
  state: KookState = 'standalone'
  /** why KOOK is not available, as the SDK's fixed error code (for the record, not for the player) */
  reason = ''
  /** the host hid the game (true) or showed it again (false) */
  onVisibility: ((hidden: boolean) => void) | null = null
  /** the host closed the session */
  onClosed: (() => void) | null = null
  /** Asked from inside a real key or pointer event: return true to go fullscreen right there, in the handler. */
  wantsFullscreen: ((event: KeyboardEvent) => boolean) | null = null
  private client: KookClient | null = null
  private usable: boolean | null = null
  private reported = false
  private epoch = -1
  private lastGesture = -1e9

  /** Call once, as the page starts. */
  start() {
    // Only a framed page can be inside KOOK. Scripted runs and directly opened pages stop here.
    if (TEST_MODE || window.parent === window) return
    this.state = 'connecting'
    import('@kookapp/kook-minigame-sdk')
      .then(({ createKookClient }) => {
        const client = (this.client = createKookClient())
        window.addEventListener('pagehide', () => client.destroy(), { once: true })
        client.onConnectionChanged((connection) => {
          if (connection.state === 'connected') {
            // a recovered connection has a new epoch: read the host's state again, once
            if (this.epoch >= 0 && connection.epoch !== this.epoch) void client.ready().catch(() => {})
            this.epoch = connection.epoch
          } else if (connection.state === 'disconnected' && this.state === 'ready') {
            // the binding is gone; nothing in the game depends on it, so play goes on
            this.state = 'unavailable'
            this.reason = connection.reason ?? 'CHANNEL_CLOSED'
          }
        })
        return client.ready().then(() => {
          this.state = 'ready'
          this.flush()
          if (!client.hasCapability('lifecycle.onStateChanged')) return
          return client.lifecycle
            .onStateChanged((snapshot) => {
              if (snapshot.status === 'closed') {
                this.state = 'closed'
                this.onClosed?.()
              } else this.onVisibility?.(snapshot.visibility === 'hidden')
            })
            .then(() => undefined)
        })
      })
      .catch((error: unknown) => {
        // Framed by something that is not KOOK (UNSUPPORTED_ENVIRONMENT, BOOTSTRAP_TIMEOUT …): not an error for
        // the player. The game is already running; it just is not a KOOK session.
        if (this.state !== 'closed') this.state = 'unavailable'
        this.reason = (error as { code?: string })?.code ?? 'UNKNOWN'
      })
  }

  /** The title screen is up and can be played (true), or the game could not load (false). */
  loadResult(usable: boolean) {
    if (this.usable === null) this.usable = usable
    this.flush()
  }
  /** One result per load attempt, sent once KOOK is ready to hear it. */
  private flush() {
    const client = this.client
    if (!client || this.state !== 'ready' || this.usable === null || this.reported) return
    this.reported = true
    if (!client.hasCapability('lifecycle.reportLoadResult')) return
    void client.lifecycle
      .reportLoadResult(this.usable ? { status: 'loaded' } : { status: 'failed', reasonCode: 'game_resource_failed' })
      .catch(() => {})
  }

  /** The host offers this optional ability in the current session. */
  can(name: KookCapability) {
    return this.state === 'ready' && !!this.client?.hasCapability(name)
  }
  /** Inside a frame at all (KOOK or not): the browser's own fullscreen and new tabs may not be allowed there. */
  get framed() {
    return this.state !== 'standalone'
  }

  /** Whether a fullscreen entry should be offered: the host's when in KOOK, the browser's when on its own. */
  get fullscreenOffered() {
    return this.framed ? this.can('ui.requestFullscreen') : !TEST_MODE && !!document.fullscreenEnabled
  }
  /**
   * Go fullscreen: in KOOK the host does it, on its own the page toggles it. Browsers and the host only honour
   * this inside a user's own key or click, so the keyboard path calls it from the key event itself (`fromEvent`);
   * the same confirm seen a frame later by the game loop is then ignored.
   */
  fullscreen(fromEvent = true) {
    const now = performance.now()
    if (fromEvent) this.lastGesture = now
    else if (now - this.lastGesture < 500) return
    if (this.can('ui.requestFullscreen')) void this.client!.ui.requestFullscreen().catch(() => {})
    else if (!this.framed) {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
      else void document.documentElement.requestFullscreen().catch(() => {})
    }
  }

  /** Leave the game through KOOK. Resolves false when the host could not confirm it (the player may try again). */
  leave() {
    if (!this.can('lifecycle.leave')) return Promise.resolve(false)
    return this.client!.lifecycle.leave().then(
      () => true,
      () => false
    )
  }

  /** Open a page outside the game: through KOOK's own link prompt when embedded there, a new tab otherwise. */
  openLink(url: string) {
    if (this.can('ui.openExternalLink')) void this.client!.ui.openExternalLink({ url }).catch(() => {})
    else window.open(url, '_blank', 'noopener,noreferrer')
  }
}

export const kook = new Kook()

// Fullscreen has to be asked for inside the user's own key event, not a frame later from the game loop.
if (!TEST_MODE)
  window.addEventListener('keydown', (event) => {
    if (!event.repeat && kook.wantsFullscreen?.(event)) kook.fullscreen()
  })

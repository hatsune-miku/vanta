import type {
  KookAutoLaunchOptions,
  KookCapability,
  KookClient,
  SessionCodeResult,
} from '@kookapp/kook-minigame-sdk'

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
 * Where the player's KOOK authorisation stands:
 * - `none`       not asked (or not a KOOK session)
 * - `asking`     `session.get()` is waiting for the player's answer
 * - `authorized` the player agreed
 * - `cancelled`  the player declined: an ordinary outcome, the game plays on all the same
 * - `failed`     the host could not complete the request
 * - `revoked`    the player took the authorisation back
 */
export type KookAuth = 'none' | 'asking' | 'authorized' | 'cancelled' | 'failed' | 'revoked'

/** The one OAuth scope asked for: KOOK's basic sign-in, which is also what `session.get()` asks for by default. */
export const KOOK_SCOPES: readonly string[] = ['get_user_info']

/** A fresh 128-bit transaction id for one authorisation request: 32 hex characters. */
function transaction() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * VANTA as a KOOK mini-game.
 *
 * It is a static, single-player game. It signs in the way KOOK mini-games do — `session.get()` with the
 * `get_user_info` scope, by itself, once KOOK has answered and the game is loaded — and that is all it asks for:
 * it sends no invitations and queries no friends, members or participants. What it does, when it finds itself
 * embedded in KOOK (the same order as KOOK's own sample game):
 *
 *   - connects (`ready()`) as soon as the page starts, alongside its own loading
 *   - reports the load result once the title screen can be played, or that loading failed
 *   - then asks for the player's authorisation, over the title screen; a request the host did not take is made
 *     once more from the press that leaves the title screen, and the terminal keeps a row to ask again
 *   - pauses when the host hides it and stops when the host closes it
 *   - offers the host's fullscreen, exit and external-link handling where the host has them
 *   - destroys the client when the page goes away
 *
 * None of this is required to play. Opened on its own, or framed by something that is not KOOK, the game runs
 * exactly as it does anywhere else.
 */
/** fetches the SDK: the real one is a separate file downloaded on demand; a stand-in can be given instead */
type SdkLoader = () => Promise<{ createKookClient: (options?: KookAutoLaunchOptions) => KookClient }>

/**
 * KOOK hosts to trust besides the SDK's own default (`https://www.kookapp.cn`): exact HTTPS origins, comma
 * separated, fixed when the game is built (`VITE_KOOK_HOST_ORIGINS`). Needed only to run inside one of KOOK's
 * test environments; a host that is not trusted is never answered, so the session would stay `unavailable`.
 */
const HOST_ORIGINS = String(import.meta.env.VITE_KOOK_HOST_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
/** every host this build answers to: the SDK keeps its default beside the ones added here */
const TRUSTED = ['https://www.kookapp.cn', ...HOST_ORIGINS]

export class Kook {
  state: KookState = 'standalone'
  /** why KOOK is not available, as the SDK's fixed error code (for the record, not for the player) */
  reason = ''
  /** the host hid the game (true) or showed it again (false) */
  onVisibility: ((hidden: boolean) => void) | null = null
  /** the host closed the session */
  onClosed: (() => void) | null = null
  /** Asked from inside a real key or pointer event: return true to go fullscreen right there, in the handler. */
  wantsFullscreen: ((event: KeyboardEvent) => boolean) | null = null
  /** The same, for asking KOOK for the player's authorisation again. */
  wantsSignIn: ((event: KeyboardEvent) => boolean) | null = null
  private client: KookClient | null = null
  private usable: boolean | null = null
  /** the host has the load result (or has no use for one); a request for it is in flight; attempts so far */
  private reported = false
  private reporting = false
  private attempts = 0
  /** how long to wait before sending a load result again after the host did not take it */
  retryMs = 1500
  private epoch = -1
  /** a recovered connection is being read again: connection events seen meanwhile do not start another read */
  private recovering = false
  private lastGesture = -1e9
  private lastSignIn = -1e9
  auth: KookAuth = 'none'
  /** why the last authorisation request did not go through, as the SDK's error code (shown in the terminal) */
  authReason = ''
  /** `session.get()` has returned the player's agreement during this launch: it is not asked for twice */
  private obtained = false
  /** the game has asked by itself once; any further request is the player's own doing */
  private greeted = false
  /** the request in flight, if any, and the handshake it may have to wait for */
  private asking: Promise<KookAuth> | null = null
  private linked: Promise<void> = Promise.resolve()

  /**
   * Call once, as the page starts. `load` fetches the SDK (it is a separate file, downloaded only here) and
   * `always` skips the check for a frame: both exist so the sequence can be exercised without a KOOK host.
   */
  start(load: SdkLoader = () => import('@kookapp/kook-minigame-sdk'), always = false) {
    // Only a framed page can be inside KOOK. Scripted runs and directly opened pages stop here.
    if (!always && (TEST_MODE || window.parent === window)) return
    this.state = 'connecting'
    this.note(`connecting (framed by ${this.host || 'an unknown page'}; trusted hosts: ${TRUSTED.join(', ')})`)
    this.linked = load()
      .then(({ createKookClient }) => {
        const client = (this.client = createKookClient(
          HOST_ORIGINS.length ? { allowedHostOrigins: HOST_ORIGINS } : undefined
        ))
        window.addEventListener('pagehide', () => client.destroy(), { once: true })
        client.onConnectionChanged((connection) => {
          if (connection.state === 'connected') {
            // A recovered connection (a new epoch, or connected again after a drop): read the host's state again,
            // once, and tell it again that the game is loaded. The SDK does not replay that for us, and the host
            // merges a repeated result. A new authorisation is not asked for by itself.
            const recovered = this.epoch >= 0 && (connection.epoch !== this.epoch || this.state === 'unavailable')
            this.epoch = connection.epoch
            if (recovered && !this.recovering) {
              this.recovering = true
              void client
                .ready()
                .then(() => {
                  if (this.state === 'closed') return
                  this.state = 'ready'
                  this.reason = ''
                  this.reported = false
                  this.attempts = 0
                  this.note('reconnected')
                  this.flush()
                })
                .catch(() => {})
                .finally(() => {
                  this.recovering = false
                })
            }
          } else if (connection.state === 'disconnected' && this.state === 'ready') {
            // the binding is gone; nothing in the game depends on it, so play goes on
            this.state = 'unavailable'
            this.reason = connection.reason ?? 'CHANNEL_CLOSED'
            this.note(`disconnected (${this.reason})`)
          }
        })
        return client.ready().then(() => {
          this.state = 'ready'
          this.note('ready')
          this.listen(client)
          // the load result, if the title is already up, and after it the sign-in
          this.flush()
        })
      })
      .catch((error: unknown) => {
        // Framed by something that is not KOOK (UNSUPPORTED_ENVIRONMENT, BOOTSTRAP_TIMEOUT …): not an error for
        // the player. The game is already running; it just is not a KOOK session.
        if (this.state !== 'closed') this.state = 'unavailable'
        this.reason = (error as { code?: string })?.code ?? 'UNKNOWN'
        this.note(
          `not connected (${this.reason})` +
            (this.hostTrusted
              ? ''
              : `: ${this.host} is not a KOOK host this build trusts — add it to VITE_KOOK_HOST_ORIGINS and rebuild`)
        )
      })
  }
  /**
   * The page this one is framed by, as the browser reports it. Only for saying what went wrong: which hosts are
   * answered is fixed when the game is built, never read from here.
   */
  get host() {
    try {
      const above = location.ancestorOrigins
      if (above?.length) return above[0]
      return document.referrer ? new URL(document.referrer).origin : ''
    } catch {
      return ''
    }
  }
  /** That page is one of the KOOK hosts this build answers to (or cannot be told). */
  get hostTrusted() {
    const host = this.host
    return !host || TRUSTED.includes(host)
  }
  /**
   * Follow the host's authorisation and lifecycle events. Neither subscription is needed to play or to sign in, so
   * a host that refuses one leaves the session exactly as it is.
   */
  private listen(client: KookClient) {
    if (client.hasCapability('auth.onStateChanged'))
      void client.auth
        .onStateChanged((snapshot) => {
          if (snapshot.status === 'revoked') this.auth = 'revoked'
          else if (this.auth === 'asking' || this.auth === 'revoked') return
          // a consent given earlier still stands (or no longer does): the host's word on it
          else if (snapshot.status === 'authorized') this.auth = 'authorized'
          else if (this.auth === 'authorized') {
            this.auth = 'none'
            this.obtained = false
          }
        })
        .catch(() => {})
    if (client.hasCapability('lifecycle.onStateChanged'))
      void client.lifecycle
        .onStateChanged((snapshot) => {
          if (snapshot.status === 'closed') {
            this.state = 'closed'
            this.onClosed?.()
          } else this.onVisibility?.(snapshot.visibility === 'hidden')
        })
        .catch(() => {})
  }
  /** One line for the browser console on what the KOOK session is doing. Never the authorisation code. */
  private note(text: string) {
    if (!TEST_MODE) console.info(`[VANTA] KOOK: ${text}`)
  }

  /** The title screen is up and can be played (true), or the game could not load (false). */
  loadResult(usable: boolean) {
    if (this.usable === null) this.usable = usable
    this.flush()
  }
  /**
   * Report the load result, as the SDK asks of every game: once `ready()` has succeeded and the game can be
   * played (or has failed to load), and before the host's 60-second wait runs out. One result per load: the
   * first one given stands. The SDK never replays this write, so a report the host did not take is sent again.
   */
  private flush() {
    const client = this.client
    if (!client || this.state !== 'ready' || this.usable === null || this.reported || this.reporting) return
    if (!client.hasCapability('lifecycle.reportLoadResult')) {
      // an older host that does not take load results
      this.reported = true
      this.greet()
      return
    }
    this.reporting = true
    const attempt = ++this.attempts
    client.lifecycle
      .reportLoadResult(this.usable ? { status: 'loaded' } : { status: 'failed', reasonCode: 'game_resource_failed' })
      .then(
        () => {
          this.reporting = false
          this.reported = true
          this.note(`load result reported (${this.usable ? 'loaded' : 'failed'})`)
          this.greet()
        },
        (error: unknown) => {
          this.reporting = false
          const code = (error as { code?: string })?.code
          // the host already holds a result for this load, or this client is finished: nothing more to send
          if (code === 'STATE_CONFLICT' || code === 'DESTROYED' || attempt >= 4) {
            this.reported = true
            this.note(`load result not taken (${code ?? 'UNKNOWN'})`)
            this.greet()
            return
          }
          window.setTimeout(() => this.flush(), this.retryMs)
        }
      )
  }

  /**
   * The game's own, single request for the player's authorisation: made once KOOK has answered and has been told
   * the game is loaded, so the consent prompt comes up over the title screen — the order KOOK's sample game uses.
   * A game that failed to load does not ask.
   */
  private greet() {
    if (this.greeted || !this.usable) return
    this.greeted = true
    void this.authorize()
  }
  /**
   * Sign in with KOOK: `session.get()` with the `get_user_info` scope. It is asked once by itself (see `greet`);
   * after that, only from the player's own key or click. KOOK shows its consent prompt if the
   * player has not agreed before, and answers straight away if they have. Always resolves, with where the
   * authorisation then stands; declining is an ordinary answer and nothing in the game depends on agreeing.
   * Outside KOOK it does nothing.
   *
   * The call returns a one-time code meant for a game server to exchange for the player's identity. VANTA has no
   * server, so the code is dropped unread: it is never kept, logged or sent anywhere, and the game still knows
   * nothing about who is playing.
   */
  authorize(): Promise<KookAuth> {
    if (this.asking) return this.asking
    // pressed while KOOK is still answering the handshake: ask as soon as that is settled
    const asked = this.state === 'connecting' ? this.linked.then(() => this.request()) : this.request()
    return (this.asking = asked.then((auth) => {
      this.asking = null
      return auth
    }))
  }
  private request(): Promise<KookAuth> {
    const client = this.client
    if (!client || this.state !== 'ready' || this.obtained || this.auth === 'revoked') return Promise.resolve(this.auth)
    // With no server to issue it, the transaction id is made here: random, and used for this one request only.
    const state = transaction(),
      epoch = this.epoch
    let reason = '',
      pending: Promise<SessionCodeResult>
    this.auth = 'asking'
    this.authReason = ''
    // whoever asked, the game's own single request is used up: it never follows a request with another
    this.greeted = true
    this.note('asking for authorisation (get_user_info)')
    try {
      pending = client.session.get({ state, scopes: KOOK_SCOPES })
    } catch (error) {
      pending = Promise.reject(error)
    }
    return pending
      .then(
        (result): KookAuth => {
          // an answer for another request, or for a connection that has since been replaced, is not ours
          if (result.state !== state) reason = 'STATE_MISMATCH'
          else if (this.epoch !== epoch) reason = 'CONNECTION_CHANGED'
          else return result.status === 'authorized' ? 'authorized' : 'cancelled'
          return 'failed'
        },
        (error: unknown): KookAuth => {
          reason = (error as { code?: string })?.code ?? 'UNKNOWN'
          return 'failed'
        }
      )
      .then((auth) => {
        // revoked, or closed, while the prompt was up: that stands, and the late answer is dropped
        if (this.auth === 'asking') {
          this.auth = this.state === 'closed' ? 'none' : auth
          this.authReason = this.auth === 'failed' ? reason : ''
          this.obtained = this.auth === 'authorized'
        }
        this.note(`authorisation ${this.auth}${this.authReason ? ` (${this.authReason})` : ''}`)
        return this.auth
      })
  }
  /** Whether a row to ask for the authorisation (again) belongs in the terminal: in KOOK, while it is not held. */
  get signInOffered() {
    return this.state === 'ready' && this.auth !== 'authorized' && this.auth !== 'revoked'
  }
  /**
   * Ask again, from the terminal. Like fullscreen, the keyboard path calls this inside the key event itself
   * (`fromEvent`), and the same confirm seen a frame later by the game loop is then ignored.
   */
  signIn(fromEvent = true) {
    const now = performance.now()
    if (fromEvent) this.lastSignIn = now
    else if (now - this.lastSignIn < 500) return
    void this.authorize()
  }
  /** Where the KOOK session stands, in one line for the terminal. Empty when the game is not in a frame at all. */
  get statusLine() {
    if (this.state === 'standalone') return ''
    if (this.state === 'connecting') return 'KOOK · 连接中'
    if (this.state === 'closed') return 'KOOK · 已关闭'
    if (this.state === 'unavailable') {
      // The usual cause inside one of KOOK's test environments: its page is not a host this build was told to
      // trust, so the SDK never answered it. Name that page rather than the timeout it ends in.
      const stranger = this.reason === 'BOOTSTRAP_TIMEOUT' && !this.hostTrusted && /^https:\/\//.test(this.host)
      return stranger
        ? `KOOK · 未连接（宿主 ${this.host.slice(8)} 未受信任）`
        : `KOOK · 未连接（${this.reason || 'UNKNOWN'}）`
    }
    const auth: Record<KookAuth, string> = {
      none: '未申请授权',
      asking: '等待授权',
      authorized: '已授权',
      cancelled: '授权已取消',
      failed: `授权失败（${this.authReason || 'UNKNOWN'}）`,
      revoked: '授权已撤销',
    }
    return `KOOK · 已连接 · ${auth[this.auth]}`
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
    if (event.repeat) return
    if (kook.wantsFullscreen?.(event)) kook.fullscreen()
    else if (kook.wantsSignIn?.(event)) kook.signIn()
  })

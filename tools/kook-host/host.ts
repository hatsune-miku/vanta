// A stand-in for the KOOK host page. It speaks the real bridge protocol (KOOK's own published bridge package) to
// the real SDK inside the game, so the handshake, the load report and the sign-in are exercised as they are in
// KOOK. Accounts, codes and answers here are made up; nothing is sent to KOOK.
import { SCOPED_PROTOCOL_VERSION, createScopedChannelServer } from '@kookapp/kook-bridge-channel'

const gameOrigin = (window as unknown as { __GAME_ORIGIN__: string }).__GAME_ORIGIN__
const frame = document.querySelector<HTMLIFrameElement>('#game')!
const bootstrap = { hostOrigin: location.origin, sessionId: crypto.randomUUID(), generation: 1 }
/** every request the game made through the SDK, in order */
const calls: string[] = []
const sessionInputs: Record<string, unknown>[] = []
let bootstrapRequests = 0
let auth = { revision: 1, status: 'unauthorized', scopes: [] as string[] }
const lifecycle = { revision: 1, status: 'active', visibility: 'visible', presentation: 'embedded' }
const authObservers = new Set<(value: unknown) => void>()
/** the consent prompt, while it is up: the test answers it the way a player would */
let answer: ((choice: 'authorized' | 'cancelled') => void) | null = null
const success = (data: unknown) => ({ ok: true, data })

const server = createScopedChannelServer({
  protocolVersion: SCOPED_PROTOCOL_VERSION,
  channelName: 'mini-game-sdk',
  sessionId: bootstrap.sessionId,
  generation: bootstrap.generation,
  transport: 'web',
  peerWindow: frame.contentWindow!,
  expectedOrigin: gameOrigin,
  handshakeTimeoutMs: 5000,
})
const handlers: Record<string, (input: Record<string, unknown>) => unknown> = {
  ready: () =>
    success({
      contractVersion: 1,
      gameCode: 'vanta-fixture',
      instanceId: 'fixture-instance',
      platform: 'web',
      capabilities: [
        'ui.requestFullscreen',
        'ui.openExternalLink',
        'lifecycle.reportLoadResult',
        'lifecycle.leave',
        'auth.onStateChanged',
        'lifecycle.onStateChanged',
      ],
      permissionVersion: 'fixture-v1',
      availableScopes: ['get_user_info'],
      context: { contextType: 'voice_channel', launchSource: 'appLauncher' },
    }),
  'session.get': async (input) => {
    sessionInputs.push(input)
    const choice = await new Promise<'authorized' | 'cancelled'>((resolve) => (answer = resolve))
    answer = null
    if (choice === 'cancelled') return success({ status: 'cancelled', state: input.state })
    auth = { revision: auth.revision + 1, status: 'authorized', scopes: input.scopes as string[] }
    for (const notify of authObservers) notify(success(auth))
    return success({
      status: 'authorized',
      state: input.state,
      code: 'fixture-one-time-code',
      expiresAt: Date.now() + 60000,
      scopes: auth.scopes,
      revision: auth.revision,
    })
  },
  'ui.requestFullscreen': () => success({}),
  'ui.openExternalLink': () => success({}),
  'lifecycle.reportLoadResult': () => success({}),
  'lifecycle.leave': () => success({}),
  'lifecycle.resume': () =>
    success({
      status: 'resumed',
      recovery: { ticket: 'fixture_recovery_ticket_11111111111111111111111111111111', expiresInMs: 60000 },
    }),
}
for (const [method, handler] of Object.entries(handlers))
  server.handle(`miniGame.v1.${method}`, (input) => {
    calls.push(method)
    return handler((input as { params: Record<string, unknown> }).params)
  })
server.handleSubscription('miniGame.v1.auth.stateChanged', (_input, _peer, notify) => {
  authObservers.add(notify)
  notify(success(auth))
  return () => {
    authObservers.delete(notify)
  }
})
server.handleSubscription('miniGame.v1.lifecycle.stateChanged', (_input, _peer, notify) => {
  notify(success(lifecycle))
  return () => {}
})
server.handleSubscription('miniGame.v1.health.probe', (input, _peer, notify) => {
  const probeId = (input as { callId: string }).callId
  notify(
    success({
      probeId,
      stage: 'client',
      recovery: { ticket: 'fixture_recovery_ticket_00000000000000000000000000000000', expiresInMs: 60000 },
    })
  )
  const timer = setTimeout(() => notify(success({ probeId, stage: 'server', reachable: true })), 0)
  return () => clearTimeout(timer)
})

// the launch binding: sent when the game page has loaded, and again whenever the SDK asks for it
function sendBootstrap() {
  frame.contentWindow?.postMessage({ type: 'KOOK_MINI_GAME_BOOTSTRAP', bootstrap }, gameOrigin)
}
frame.addEventListener('load', sendBootstrap)
window.addEventListener('message', (event) => {
  if (
    event.source === frame.contentWindow &&
    event.origin === gameOrigin &&
    event.data?.type === 'KOOK_MINI_GAME_BOOTSTRAP_REQUEST'
  ) {
    bootstrapRequests++
    sendBootstrap()
  }
})
Object.assign(window, {
  sdkFixture: {
    calls,
    sessionInputs,
    bootstrapRequests: () => bootstrapRequests,
    prompting: () => !!answer,
    answer: (choice: 'authorized' | 'cancelled') => answer?.(choice),
  },
})
frame.src = gameOrigin + '/'

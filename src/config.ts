// Global tuning constants. Logic runs at a fixed 60 Hz; all "frames" below are logic frames.
export const VIEW_W = 1920;
export const VIEW_H = 1080;
export const GROUND_Y = 900;
export const STEP = 1 / 60;
export const GRAVITY = 3200;
export const WORLD_W = 12200;
/** gameplay camera zoom; below 1 shows more of the arena */
export const BASE_ZOOM = 0.88;
/** world y the camera centres on while the player is on the floor */
export const CAM_REST_Y = 478;
/** reach of an anchor: two thirds of the screen */
export const ANCHOR_RANGE = 1280;

export const COL = {
  /** the player's light: blue, with pink as its hot / secondary tone */
  main: 0x2f9bff,
  pink: 0xff9be8,
  pinkDeep: 0xff4fc8,
  hostile: 0xff5030,
  hostileHot: 0xffc8b0,
  cyan: 0x6fe9ff,
  white: 0xffffff,
  violet: 0x9a7bff,
};

export const DEPTH = {
  sky: -100, far: -90, mid: -80, near: -70, floor: -50, props: -40,
  backFx: 10, tail: 18, enemy: 20, player: 30, frontFx: 40, fore: 60,
};

const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
export const TEST_MODE = params.has('test');
export const START_ARENA = Number(params.get('arena') ?? 0) || 0;

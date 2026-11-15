import * as Phaser from 'phaser';
import { VIEW_H, VIEW_W } from './config';
import { Boot } from './scenes/Boot';

import { GAME_SCENES } from './scenes/index';
import { kook } from './core/kook';

const scenes: Phaser.Types.Scenes.SceneType[] = [Boot, ...GAME_SCENES];

// Embedded in KOOK this is a mini-game session: start talking to the host while the game loads. Opened on its
// own (or framed by anything else) this does nothing and the game plays as usual.
kook.start();
(window as any).__kook = kook;

const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game',
  width: VIEW_W,
  height: VIEW_H,
  backgroundColor: '#05070c',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true, antialiasGL: true, powerPreference: 'high-performance' },
  input: { gamepad: true },
  audio: { noAudio: true },
  scene: scenes,
});
(window as any).__game = game;

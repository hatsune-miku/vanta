import * as Phaser from 'phaser';
import { VIEW_H, VIEW_W } from './config';
import { Boot } from './scenes/Boot';

import { GAME_SCENES } from './scenes/index';

const scenes: Phaser.Types.Scenes.SceneType[] = [Boot, ...GAME_SCENES];

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

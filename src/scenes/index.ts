import * as Phaser from 'phaser';
import { Title } from './Title';
import { Battle } from './Battle';
import { Hud } from './Hud';

export const GAME_SCENES: Phaser.Types.Scenes.SceneType[] = [Title, Battle, Hud];

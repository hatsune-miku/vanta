import * as Phaser from 'phaser'

import { DEPTH } from '../config'

/** A compact keycap attached to the object that accepts the action. */
export class KeyHint extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, key: string, color: number) {
    super(scene, 0, 0)
    const face = scene.add.graphics()
    face.fillStyle(0x02060d, 0.95).fillRoundedRect(-20, -18, 40, 40, 6)
    face.fillStyle(0x132133, 0.96).fillRoundedRect(-20, -20, 40, 36, 6)
    face.lineStyle(1.5, color, 0.85).strokeRoundedRect(-20, -20, 40, 36, 6)
    face.lineStyle(2, color, 0.4).lineBetween(-13, 20, 13, 20)
    const label = scene.add
      .text(0, -2, key, {
        fontFamily: '"DIN Alternate", "Segoe UI", sans-serif',
        fontSize: '25px',
        fontStyle: 'bold',
        color: '#eaf5ff',
      })
      .setOrigin(0.5)
    this.add([face, label])
    this.setDepth(DEPTH.frontFx + 5).setVisible(false)
    scene.add.existing(this)
  }
}

import * as Phaser from 'phaser'

import { buildBladeFx } from '../art/bladeFx'
import { buildExecFx } from '../art/execFx'
import { buildStage, loadStage } from '../art/stage'
import { buildDrone, buildFx } from '../art/textures'
import { kook } from '../core/kook'
import { Stage3D } from '../three/stage3d'

/** Generates the 2D textures procedurally and loads the 3D bodies + animation library. */
export class Boot extends Phaser.Scene {
  constructor() {
    super('Boot')
  }
  preload() {
    // the photographed backdrop; everything else is drawn or packed into the models
    loadStage(this)
  }
  create() {
    buildDrone(this)
    buildFx(this)
    buildBladeFx(this)
    buildExecFx(this)
    buildStage(this)
    const msg = this.add
      .text(960, 540, 'LOADING', { fontFamily: 'sans-serif', fontSize: '28px', color: '#bfe6ff' })
      .setOrigin(0.5)
      .setLetterSpacing(12)
    // Canvas text is drawn once with whatever face is available then, so the wordmark's must be in before the title.
    const face = document.fonts
      .load('900 64px Orbitron', 'VANTA')
      .catch(() => [])
      .then(() => undefined)
    Promise.all([Stage3D.load(), Promise.race([face, new Promise((done) => setTimeout(done, 4000))])])
      .then(([s]) => {
        // the 3D layer is an ordinary texture as far as Phaser is concerned
        // (a plain Texture: CanvasTexture insists on a 2D context, and this canvas belongs to WebGL)
        if (!this.textures.exists('actors3d'))
          this.textures
            .create('actors3d', s.canvas, s.canvas.width, s.canvas.height)!
            .add('__BASE', 0, 0, 0, s.canvas.width, s.canvas.height)
        msg.destroy()
        this.scene.start('Title')
      })
      .catch((e) => {
        msg.setText('LOAD FAILED')
        // as a KOOK mini-game the host is told too, so it does not wait out its timer
        kook.loadResult(false)
        console.error(e)
      })
  }
}

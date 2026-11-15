import * as Phaser from 'phaser'

import { VIEW_H, VIEW_W } from '../config'

const NODE = 'FilterVantaRadialBlur'

// Every pixel is averaged along a line that leads toward the focus and a little around it, plus a small even
// spread. A pure zoom blur would leave rays that already point at the focus untouched; the swirl and the spread are
// what soften their edges. A per-pixel offset hides the banding of the fixed sample count.
const FRAGMENT = [
  '#pragma phaserTemplate(shaderName)',
  'precision mediump float;',
  'uniform sampler2D uMainSampler;',
  'uniform vec2 uFocus;',
  'uniform float uStrength;',
  'uniform float uAspect;',
  'varying vec2 outTexCoord;',
  'void main ()',
  '{',
  '    vec2 toFocus = uFocus - outTexCoord;',
  '    vec2 swirl = vec2(-toFocus.y / uAspect, toFocus.x * uAspect) * 0.2;',
  '    vec2 path = (toFocus + swirl) * uStrength;',
  '    float spread = uStrength * 0.018;',
  '    float offset = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);',
  '    vec4 sum = vec4(0.0);',
  '    for (int i = 0; i < 24; i++)',
  '    {',
  '        float k = (float(i) + offset) / 24.0;',
  '        float turn = float(i) * 2.39996 + offset * 6.2832;',
  '        vec2 scatter = vec2(cos(turn), sin(turn) * uAspect) * spread * sqrt(k);',
  '        sum += texture2D(uMainSampler, outTexCoord + path * k + scatter);',
  '    }',
  '    gl_FragColor = sum / 24.0;',
  '}',
].join('\n')

class RadialBlur extends Phaser.Filters.Controller {
  x = 0.5
  y = 0.5
  strength = 0
  constructor(camera: Phaser.Cameras.Scene2D.Camera) {
    super(camera, NODE)
  }
}

class RadialBlurNode extends Phaser.Renderer.WebGL.RenderNodes.BaseFilterShader {
  constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) {
    super(NODE, manager, undefined, FRAGMENT)
  }
  setupUniforms(controller: RadialBlur) {
    // filter texture coordinates run bottom-up
    this.programManager.setUniform('uFocus', [controller.x, 1 - controller.y])
    this.programManager.setUniform('uStrength', controller.strength)
    this.programManager.setUniform('uAspect', VIEW_W / VIEW_H)
  }
}

/** Full-screen motion blur around a focus on the world camera; the HUD scene stays sharp. */
export class MotionBlur {
  private filter: RadialBlur

  constructor(scene: Phaser.Scene) {
    const nodes = (scene.renderer as Phaser.Renderer.WebGL.WebGLRenderer).renderNodes
    if (!nodes.hasNode(NODE)) nodes.addNodeConstructor(NODE, RadialBlurNode)
    const camera = scene.cameras.main
    this.filter = new RadialBlur(camera)
    this.filter.setActive(false)
    // screen space, ahead of the ripple and the vignette
    camera.filters.external.add(this.filter, 0)
  }

  get strength() {
    return this.filter.active ? this.filter.strength : 0
  }

  /** strength: the fraction of each pixel's distance to the focus that is smeared; focus in 0..1 screen space. */
  set(strength: number, u = 0.5, v = 0.5) {
    const f = this.filter
    if (strength <= 0.001) {
      if (f.active) f.setActive(false)
      f.strength = 0
      return
    }
    f.x = u
    f.y = v
    f.strength = strength
    if (!f.active) f.setActive(true)
  }
}

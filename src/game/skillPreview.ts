import * as Phaser from 'phaser'

import type { SkillInfo } from './menu'

/** One decoder at a time. Clips are fetched only when selected and released when the terminal closes. */
export class SkillPreview {
  id: string | null = null
  video: Phaser.GameObjects.Video | null = null
  ready = false
  failed = false
  private poster: Phaser.GameObjects.Image
  private loading = new Map<string, HTMLImageElement>()
  private paused = false
  private dead = false
  private visibility = () => this.video?.setPaused(this.paused || document.hidden)

  constructor(private scene: Phaser.Scene) {
    this.poster = scene.add.image(0, 0, '__WHITE').setOrigin(0).setDepth(61).setVisible(false)
    document.addEventListener('visibilitychange', this.visibility)
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy())
  }

  show(skill: SkillInfo, x: number, y: number, width: number, alpha: number, paused: boolean) {
    this.paused = paused
    if (this.id !== skill.id) {
      this.hide()
      this.id = skill.id
      this.failed = this.ready = false
      const video = this.scene.add.video(x, y).setOrigin(0).setDepth(61).setVisible(false)
      this.video = video
      video.on('created', () => {
        this.ready = true
        video.setDisplaySize(width, (width * 9) / 16)
        video.setPaused(this.paused || document.hidden)
      })
      video.on('error', () => {
        this.failed = true
      })
      video.on('unsupported', () => {
        this.failed = true
      })
      video.loadURL(`${import.meta.env.BASE_URL}media/skills/${skill.id}.mp4`, true).play(true)
      this.loadPoster(skill.id)
    }
    const posterKey = `skill-poster-${skill.id}`
    this.poster.setVisible(!this.ready && this.scene.textures.exists(posterKey))
    if (this.poster.visible)
      this.poster
        .setTexture(posterKey)
        .setPosition(x, y)
        .setDisplaySize(width, (width * 9) / 16)
        .setAlpha(alpha)
    this.video!.setPosition(x, y)
      .setDisplaySize(width, (width * 9) / 16)
      .setAlpha(alpha)
      .setVisible(this.ready)
    if (this.ready) this.video!.setPaused(paused || document.hidden)
  }

  private loadPoster(id: string) {
    const key = `skill-poster-${id}`
    if (this.scene.textures.exists(key) || this.loading.has(id)) return
    const image = new Image()
    this.loading.set(id, image)
    image.onload = () => {
      this.loading.delete(id)
      if (!this.dead && !this.scene.textures.exists(key)) this.scene.textures.addImage(key, image)
    }
    image.onerror = () => this.loading.delete(id)
    image.src = `${import.meta.env.BASE_URL}media/skills/${id}.jpg`
  }

  get progress() {
    const media = this.video?.video
    return media && Number.isFinite(media.duration) && media.duration > 0 ? media.currentTime / media.duration : 0
  }

  hide() {
    this.id = null
    this.ready = this.failed = false
    this.poster.setVisible(false)
    if (!this.video) return
    const media = this.video.video,
      texture = this.video.videoTexture?.key
    this.video.destroy()
    // Clearing src and loading an empty resource aborts an in-flight download as well as decoding.
    media?.load()
    if (texture && this.scene.textures.exists(texture)) this.scene.textures.remove(texture)
    this.video = null
  }

  private destroy() {
    this.dead = true
    this.hide()
    for (const image of this.loading.values()) image.onload = image.onerror = null
    this.loading.clear()
    document.removeEventListener('visibilitychange', this.visibility)
  }
}

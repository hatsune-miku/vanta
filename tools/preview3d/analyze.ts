// Offline analysis of the animation library: clip list, swing peaks (right-hand speed), root travel.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const loader = new GLTFLoader();
const [body, a1, a2] = await Promise.all(['Mannequin_F', 'UAL1_Standard', 'UAL2_Standard'].map((n) => loader.loadAsync(`/models/${n}.glb`)));
const clips = [...a1.animations, ...a2.animations];
const model = body.scene; const scene = new THREE.Scene(); scene.add(model);
const mixer = new THREE.AnimationMixer(model);
const hand = model.getObjectByName('hand_r')!, pelvis = model.getObjectByName('pelvis')!, head = model.getObjectByName('Head')!;
const v = new THREE.Vector3(), pv = new THREE.Vector3(), pp = new THREE.Vector3();
const out: any = { clips: {}, rest: {} };
model.updateMatrixWorld(true);
out.rest.head = head.getWorldPosition(new THREE.Vector3()).toArray().map((x) => +x.toFixed(3));
out.rest.pelvis = pelvis.getWorldPosition(new THREE.Vector3()).toArray().map((x) => +x.toFixed(3));
out.rootTracks = [...new Set(clips.flatMap((c) => c.tracks.filter((t) => /^(root|pelvis|Armature)\./.test(t.name)).map((t) => t.name)))];
for (const c of clips) {
  mixer.stopAllAction(); const act = mixer.clipAction(c); act.play();
  const n = Math.max(2, Math.round(c.duration * 60)); const sp: number[] = []; let travel = [0, 0, 0], p0: number[] | null = null, minY = 9, maxY = -9;
  for (let i = 0; i <= n; i++) {
    mixer.setTime(Math.min(c.duration - 1e-4, i / 60)); model.updateMatrixWorld(true);
    pelvis.getWorldPosition(pp); hand.getWorldPosition(v); v.sub(pp);
    if (i) sp.push(v.distanceTo(pv) * 60); pv.copy(v);
    if (!p0) p0 = pp.toArray(); travel = [pp.x - p0[0], pp.y - p0[1], pp.z - p0[2]]; minY = Math.min(minY, pp.y); maxY = Math.max(maxY, pp.y);
  }
  const peaks: [number, number][] = [];
  for (let i = 2; i < sp.length - 2; i++) if (sp[i] > 4.5 && sp[i] >= sp[i - 1] && sp[i] >= sp[i + 1] && sp[i] >= sp[i - 2] && sp[i] >= sp[i + 2]) peaks.push([+(i / 60).toFixed(2), +sp[i].toFixed(1)]);
  const merged = peaks.filter((p, i) => i === 0 || p[0] - peaks[i - 1][0] > 0.12);
  out.clips[c.name] = { d: +c.duration.toFixed(2), travel: travel.map((x) => +x.toFixed(2)), y: [+minY.toFixed(2), +maxY.toFixed(2)], peaks: /Sword|Punch|Melee|Attack|Scratch|Kick|Shield|Spell|Pistol|Rifle|Throw/i.test(c.name) ? merged : undefined };
}
(window as any).__done = out;

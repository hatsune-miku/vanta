// Contact sheet: the CC0 mannequin playing library clips in side view, to judge the look before adopting it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const W = 320, H = 360;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(W, H); renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(-1.25, 1.25, 2.3, -0.5, 0.1, 50);
cam.position.set(0, 0.9, 10); cam.lookAt(0, 0.9, 0);
scene.add(new THREE.HemisphereLight(0x8fb8ff, 0x101624, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(2, 4, 6); scene.add(key);
const rimA = new THREE.DirectionalLight(0x2f9bff, 5); rimA.position.set(-4, 2, -3); scene.add(rimA);
const rimB = new THREE.DirectionalLight(0xff4fc8, 3.5); rimB.position.set(4, 1, -4); scene.add(rimB);

const loader = new GLTFLoader();
const load = (u: string) => loader.loadAsync(u);
const [body, a1, a2] = await Promise.all([load('/models/Mannequin_F.glb'), load('/models/UAL1_Standard.glb'), load('/models/UAL2_Standard.glb')]);
const clips = [...a1.animations, ...a2.animations];
const model = body.scene;
model.rotation.y = Math.PI / 2; // face screen-right
model.traverse((o) => {
  const m = o as THREE.Mesh;
  if (!m.isMesh) return;
  const mats = Array.isArray(m.material) ? m.material : [m.material];
  m.material = mats.map((mt) => new THREE.MeshStandardMaterial(mt.name === 'M_Joints'
    ? { color: 0x1a2030, metalness: 0.7, roughness: 0.35 }
    : { color: 0xdfe6f2, metalness: 0.35, roughness: 0.42 })) as any;
  if (!Array.isArray(m.material) || (m.material as any).length === 1) m.material = (m.material as any)[0];
});
// a simple hard-light blade in the right hand
const hand = model.getObjectByName('hand_r')!;
const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.05, 0.05), new THREE.MeshBasicMaterial({ color: 0x9fd4ff }));
const grip = new THREE.Group(); grip.add(blade); blade.position.y = 0.55; hand.add(grip);
(window as any).__grip = grip;
scene.add(model);
const mixer = new THREE.AnimationMixer(model);

const sheet = (document.getElementById('sheet') as HTMLCanvasElement).getContext('2d')!;
sheet.fillStyle = '#0a1220'; sheet.fillRect(0, 0, 1920, 1080);
const rows: [string, number[]][] = [
  ['Sword_Regular_A', [0.1, 0.3, 0.5, 0.7, 0.9]],
  ['Sword_Regular_B', [0.1, 0.3, 0.5, 0.7, 0.9]],
  ['Sprint_Loop', [0, 0.25, 0.5]], ['Sword_Dash', [0.3, 0.6]],
  ['Sword_Heavy_Combo', [0.1, 0.25, 0.4, 0.6, 0.8]],
];
let col = 0, row = 0;
const missing: string[] = [];
for (const [name, ts] of rows) {
  const clip = clips.find((c) => c.name === name);
  if (!clip) { missing.push(name); continue; }
  mixer.stopAllAction();
  const act = mixer.clipAction(clip); act.play();
  for (const t of ts) {
    mixer.setTime(t * clip.duration);
    // keep the figure centred regardless of root motion
    const p = new THREE.Vector3(); model.getObjectByName('pelvis')!.getWorldPosition(p);
    cam.position.x = p.x; cam.updateMatrixWorld();
    renderer.render(scene, cam);
    sheet.drawImage(renderer.domElement, col * W, row * H);
    sheet.fillStyle = '#9fd4ff'; sheet.font = '16px sans-serif'; sheet.fillText(`${name} @${t}`, col * W + 8, row * H + 20);
    if (++col >= 6) { col = 0; row++; }
  }
}
(window as any).__done = { clips: clips.map((c) => `${c.name}:${c.duration.toFixed(2)}`), missing };

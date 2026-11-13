// Builds public/models/*.glb from the original CC0 downloads in assets-src/models/.
//
// The animation library ships 86 clips (~16 MB); the game uses about two dozen. This keeps only the
// clips named in src/art/anims.ts (the single source of truth), drops the duplicate mesh from the
// second library file, and removes redundant keyframes.
//
// Usage: node tools/pack-models.mjs
import { NodeIO } from '@gltf-transform/core';
import { prune, resample, dedup } from '@gltf-transform/functions';
import { readFileSync, mkdirSync, statSync, copyFileSync } from 'node:fs';

const SRC = 'assets-src/models', OUT = 'public/models';
mkdirSync(OUT, { recursive: true });

// every clip name referenced by the animation table
const table = readFileSync('src/art/anims.ts', 'utf8');
const keep = new Set([...table.matchAll(/\b(?:loop|hold|seg|map)\('([A-Za-z0-9_]+)'/g)].map((m) => m[1]));
keep.add('Idle_Loop'); // fallback clip
console.log(`keeping ${keep.size} clips:`, [...keep].sort().join(' '));

const io = new NodeIO();
const mb = (p) => (statSync(p).size / 1048576).toFixed(2) + ' MB';
const found = new Set();

for (const [file, keepMesh] of [['UAL1_Standard.glb', true], ['UAL2_Standard.glb', false]]) {
  const doc = await io.read(`${SRC}/${file}`);
  const root = doc.getRoot();
  for (const a of root.listAnimations()) {
    if (keep.has(a.getName())) { found.add(a.getName()); continue; }
    // channels and samplers must go explicitly, or their keyframe data stays referenced and survives pruning
    for (const c of a.listChannels()) c.dispose();
    for (const sm of a.listSamplers()) sm.dispose();
    a.dispose();
  }
  // materials are replaced at runtime (only their names are used), so their textures are dead weight
  for (const t of root.listTextures()) t.dispose();
  if (!keepMesh) {
    // the skeleton nodes stay (the clips target them); the skinned mesh is already in the first file
    for (const n of root.listNodes()) { n.setMesh(null); n.setSkin(null); }
    for (const m of root.listMeshes()) m.dispose();
    for (const s of root.listSkins()) s.dispose();
  }
  await doc.transform(resample(), prune({ keepLeaves: true }), dedup());
  await io.write(`${OUT}/${file}`, doc);
  console.log(`${file}: ${mb(`${SRC}/${file}`)} -> ${mb(`${OUT}/${file}`)}  (${root.listAnimations().length} clips)`);
}
copyFileSync(`${SRC}/Mannequin_F.glb`, `${OUT}/Mannequin_F.glb`);
copyFileSync(`${SRC}/LICENSE-Quaternius-CC0.txt`, `${OUT}/LICENSE-Quaternius-CC0.txt`);
console.log(`Mannequin_F.glb: ${mb(`${OUT}/Mannequin_F.glb`)}`);

const missing = [...keep].filter((k) => !found.has(k));
if (missing.length) { console.error('MISSING CLIPS:', missing.join(' ')); process.exit(1); }

import { NodeIO } from '@gltf-transform/core';
import { inspect } from '@gltf-transform/functions';
const io = new NodeIO();
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f); const r = inspect(doc);
  const sum = (a, k) => a.reduce((s, x) => s + (x[k] || 0), 0);
  console.log(f);
  console.log('  textures', r.textures.properties.length, (sum(r.textures.properties, 'size') / 1e6).toFixed(2), 'MB', r.textures.properties.map((t) => `${t.name || t.uri}:${t.resolution}:${(t.size/1e6).toFixed(2)}`).join(' '));
  console.log('  meshes', r.meshes.properties.length, (sum(r.meshes.properties, 'size') / 1e6).toFixed(2), 'MB');
  console.log('  anims', r.animations.properties.length, (sum(r.animations.properties, 'size') / 1e6).toFixed(2), 'MB', r.animations.properties.map((a) => `${a.name}:${a.keyframes}:${(a.size/1e3).toFixed(0)}k`).join(' '));
  const acc = doc.getRoot().listAccessors(); console.log('  accessors', acc.length, 'types', [...new Set(acc.map((a) => a.getComponentType()))].join(','));
}

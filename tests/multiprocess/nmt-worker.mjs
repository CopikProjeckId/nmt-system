/**
 * NMT 스택 전체를 사용하는 멀티 프로세스 워커
 * NeuronStore + ChunkStore + IndexStore 동시 접근 테스트
 *
 * Usage: node nmt-worker.mjs <dataDir> <workerId> <ops>
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const [,, dataDir, workerId, opsStr] = process.argv;
const OPS = parseInt(opsStr ?? '10', 10);

function log(msg) { process.stdout.write(`[nmt-worker-${workerId}] ${msg}\n`); }

try {
  // dynamic import — tsx 없이 순수 ESM 환경
  const { NeuronStore }   = await import(`${resolve(dataDir, '../../dist/src/storage/neuron-store.js')}`).catch(
    () => import('../../dist/src/storage/neuron-store.js')
  );
  const { ChunkStore }    = await import('../../dist/src/storage/chunk-store.js');
  const { HNSWIndex }     = await import('../../dist/src/core/hnsw-index.js');
  const { NeuronGraphManager } = await import('../../dist/src/core/neuron-graph.js');

  const neuronStore = new NeuronStore({ dataDir });
  const chunkStore  = new ChunkStore({ dataDir });
  await neuronStore.init();
  await chunkStore.init();

  const hnswIndex    = new HNSWIndex({ M: 16, efConstruction: 100 });
  const graphManager = new NeuronGraphManager({ neuronStore, hnswIndex });

  const errors = [];
  let created = 0;
  let read    = 0;

  function makeEmbedding(seed) {
    const v = new Float32Array(384);
    let h = (seed * 2654435761) >>> 0;
    for (let i = 0; i < 384; i++) {
      h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
      v[i] = (h % 2000) / 2000 - 0.5;
    }
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm);
    for (let i = 0; i < 384; i++) v[i] /= norm;
    return v;
  }

  for (let i = 0; i < OPS; i++) {
    const seed = parseInt(workerId) * 10000 + i;
    try {
      const neuron = await graphManager.createNeuron({
        embedding:   makeEmbedding(seed),
        chunkHashes: [`chunk-${workerId}-${i}`],
        merkleRoot:  `root-${workerId}-${i}`,
        autoConnect: false,
      });
      created++;

      // 읽기 검증
      const fetched = await neuronStore.getNeuron(neuron.id);
      if (fetched && fetched.id === neuron.id) read++;
      else errors.push(`read mismatch at i=${i}`);

    } catch (e) {
      errors.push(`op[${i}]: ${e.message}`);
    }
  }

  // 전체 목록 읽기
  let listCount = 0;
  try {
    const all = await neuronStore.listNeurons({ limit: 9999 });
    listCount = all.neurons.length;
  } catch (e) {
    errors.push(`list: ${e.message}`);
  }

  await neuronStore.close();
  await chunkStore.close();

  const result = { workerId, created, read, listCount, errors, ops: OPS };
  log(`done — created=${created}/${OPS} read=${read}/${OPS} list=${listCount} errors=${errors.length}`);
  if (errors.length > 0) log(`ERRORS: ${errors.slice(0, 3).join(', ')}`);

  process.send?.(result);
  process.exit(errors.length > 0 ? 1 : 0);

} catch (fatal) {
  log(`FATAL: ${fatal.message}\n${fatal.stack}`);
  process.send?.({ workerId, fatal: fatal.message });
  process.exit(2);
}

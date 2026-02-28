/**
 * ContextBuilder — 세션 시작 시 자동 주입용 컨텍스트 생성
 *
 * Xenova 불필요 — 순수 DB 읽기 + 포맷.
 * NMT_SYSTEM_INSTRUCTIONS에 따라 Claude가 세션 시작 시 nmt_session_start를
 * 호출하면 이 클래스가 포맷된 기억 블록을 반환한다.
 *
 * @module services/context-builder
 */

import type { NeuronNode } from '../types/index.js';
import type { NeuronStore } from '../storage/neuron-store.js';
import type { ChunkStore } from '../storage/chunk-store.js';

const PREVIEW_CHARS = 220;

export interface ContextBuilderOptions {
  neuronStore: NeuronStore;
  chunkStore: ChunkStore;
}

export interface BuiltContext {
  text: string;         // 마크다운 포맷 — Claude에 직접 주입
  neuronCount: number;  // 전체 저장 뉴런 수
  included: number;     // 이번 컨텍스트에 포함된 수
}

export class ContextBuilder {
  private readonly neuronStore: NeuronStore;
  private readonly chunkStore: ChunkStore;

  constructor(opts: ContextBuilderOptions) {
    this.neuronStore = opts.neuronStore;
    this.chunkStore = opts.chunkStore;
  }

  /**
   * 세션 시작 컨텍스트 빌드.
   * 최근 N개 + 다접근 M개를 합쳐 중복 제거 후 포맷.
   */
  async build(opts: { recentN?: number; topN?: number } = {}): Promise<BuiltContext> {
    const recentN = opts.recentN ?? 15;
    const topN    = opts.topN    ?? 5;

    const allIds = await this.neuronStore.getAllNeuronIds();
    const total  = allIds.length;

    if (total === 0) {
      return {
        text: '# NMT Memory\n\nNo memories stored yet.',
        neuronCount: 0,
        included: 0,
      };
    }

    // 전체 로드 (소규모 — 실사용 수천 뉴런 이하)
    const all: NeuronNode[] = [];
    for (const id of allIds) {
      const n = await this.neuronStore.getNeuron(id);
      if (n) all.push(n);
    }

    // 최근 순
    const byRecent = [...all].sort(
      (a, b) => new Date(b.metadata.createdAt).getTime() - new Date(a.metadata.createdAt).getTime()
    );

    // 접근 횟수 순
    const byAccess = [...all].sort((a, b) => b.metadata.accessCount - a.metadata.accessCount);

    // 중복 없이 합치기
    const seen  = new Set<string>();
    const picks: NeuronNode[] = [];

    for (const n of byRecent) {
      if (picks.length >= recentN) break;
      if (!seen.has(n.id)) { seen.add(n.id); picks.push(n); }
    }
    for (const n of byAccess) {
      if (picks.length >= recentN + topN) break;
      if (!seen.has(n.id)) { seen.add(n.id); picks.push(n); }
    }

    // 컨텐츠 미리보기 로드
    const lines: string[] = [];
    lines.push(`# NMT Memory Context`);
    lines.push(`Total stored: **${total}** neurons | Showing: ${picks.length}`);
    lines.push('');

    for (const neuron of picks) {
      const preview = await this.loadPreview(neuron);
      const tags    = neuron.metadata.tags.length > 0
        ? neuron.metadata.tags.map(t => `#${t}`).join(' ')
        : '';
      const date    = neuron.metadata.createdAt.slice(0, 10);

      lines.push(`---`);
      lines.push(`**[${date}]** ${tags}`);
      lines.push(preview);
    }

    lines.push('---');

    return {
      text: lines.join('\n'),
      neuronCount: total,
      included: picks.length,
    };
  }

  private async loadPreview(neuron: NeuronNode): Promise<string> {
    try {
      const chunks = await Promise.all(
        neuron.chunkHashes.slice(0, 2).map(h => this.chunkStore.get(h))
      );
      const combined = chunks
        .filter(Boolean)
        .map(c => c!.data.toString('utf8'))
        .join(' ');
      return combined.length <= PREVIEW_CHARS
        ? combined
        : combined.slice(0, PREVIEW_CHARS) + '…';
    } catch {
      return '(content unavailable)';
    }
  }
}

/**
 * CompactionScheduler — 백그라운드 압축 스케줄러
 *
 * 두 가지 압축을 관리한다:
 *   1. HNSW soft-delete 물리 제거 (tombstone → 실제 삭제)
 *   2. LevelDB compactRange (삭제된 키의 SST 파일 재병합)
 *
 * 트리거 조건 (둘 중 하나):
 *   - HNSW tombstone 수 > tombstoneThreshold
 *   - 마지막 실행 후 intervalMs 경과
 *
 * @module utils/compaction-scheduler
 */

import { coreLogger } from './logger.js';
import type { HNSWIndex } from '../core/hnsw-index.js';

export interface CompactableStore {
  compact(): Promise<void>;
}

export interface CompactionSchedulerOptions {
  hnswIndex: HNSWIndex;
  /** HNSW tombstone 수가 이 값을 넘으면 즉시 compact 실행 (기본: 50) */
  tombstoneThreshold?: number;
  /** 강제 실행 주기 ms (기본: 5분) */
  intervalMs?: number;
  /** LevelDB stores (optional) */
  stores?: CompactableStore[];
}

export interface CompactionResult {
  hnswRemoved: number;
  durationMs: number;
  triggeredBy: 'threshold' | 'interval';
}

export class CompactionScheduler {
  private readonly index: HNSWIndex;
  private readonly stores: CompactableStore[];
  private readonly tombstoneThreshold: number;
  private readonly intervalMs: number;

  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastRunAt = 0;
  private totalCompactions = 0;
  private totalRemoved = 0;

  constructor(opts: CompactionSchedulerOptions) {
    this.index  = opts.hnswIndex;
    this.stores = opts.stores ?? [];
    this.tombstoneThreshold = opts.tombstoneThreshold ?? 50;
    this.intervalMs         = opts.intervalMs ?? 5 * 60 * 1000; // 5 min
  }

  /**
   * 스케줄러 시작 — interval 체크 + 삽입/삭제 후 즉시 체크를 위한
   * `maybeCompact()` 공개 메서드 조합으로 사용.
   */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.compact('interval'), this.intervalMs);
    // NodeJS 프로세스 종료를 막지 않도록 unref
    if (this.timer.unref) this.timer.unref();
    coreLogger.info('[CompactionScheduler] started', {
      tombstoneThreshold: this.tombstoneThreshold,
      intervalMs: this.intervalMs,
    });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * HNSW 삭제 후 즉시 호출 — tombstone이 임계치 초과 시 compact 실행.
   * fire-and-forget 방식이므로 await 불필요.
   */
  maybeCompact(): void {
    if (this.index.tombstoneCount >= this.tombstoneThreshold) {
      void this.compact('threshold');
    }
  }

  /**
   * 강제 compact 실행 (외부 호출용).
   */
  async forceCompact(): Promise<CompactionResult> {
    return this.compact('threshold');
  }

  private async compact(triggeredBy: 'threshold' | 'interval'): Promise<CompactionResult> {
    if (this.running) {
      return { hnswRemoved: 0, durationMs: 0, triggeredBy };
    }

    this.running = true;
    const t0 = Date.now();

    try {
      // 1. HNSW 물리 제거
      const { removed } = this.index.compact();

      // 2. LevelDB compactRange (삭제 키 SST 재병합)
      for (const store of this.stores) {
        try {
          await store.compact();
        } catch (err: any) {
          coreLogger.warn('[CompactionScheduler] store compact failed', { err: err.message });
        }
      }

      const durationMs = Date.now() - t0;
      this.lastRunAt = Date.now();
      this.totalCompactions++;
      this.totalRemoved += removed;

      if (removed > 0 || triggeredBy === 'threshold') {
        coreLogger.info('[CompactionScheduler] compact done', {
          triggeredBy,
          hnswRemoved: removed,
          durationMs,
          tombstoneCountAfter: this.index.tombstoneCount,
        });
      }

      return { hnswRemoved: removed, durationMs, triggeredBy };
    } finally {
      this.running = false;
    }
  }

  getStats() {
    return {
      running: this.running,
      pendingTombstones: this.index.tombstoneCount,
      totalCompactions: this.totalCompactions,
      totalHnswRemoved: this.totalRemoved,
      lastRunAt: this.lastRunAt ? new Date(this.lastRunAt).toISOString() : null,
    };
  }
}

/**
 * SerialTaskQueue — LevelDB single-writer protection
 *
 * Guarantees that tasks sharing a write path (e.g. synapse read-modify-write)
 * run one at a time. Excess tasks are dropped with a warning when the queue
 * exceeds maxPending.
 *
 * @module utils/serial-queue
 */

import type { Logger } from './logger.js';

type Task = () => Promise<void>;

interface QueueEntry {
  task: Task;
  label: string;
  reject: (e: unknown) => void;
}

export class SerialTaskQueue {
  private queue: QueueEntry[] = [];
  private running = false;
  private _dropped = 0;

  /**
   * Enqueue a fire-and-forget task.
   * Errors are logged via `logger.warn`; the caller never receives them.
   * Tasks are dropped (with a warning) when the queue exceeds maxPending.
   */
  enqueueFireAndLog(
    task: Task,
    logger: Logger,
    label: string,
    maxPending = 100
  ): void {
    if (this.queue.length >= maxPending) {
      logger.warn(`[SerialQueue] dropped: ${label} (queue=${this.queue.length})`);
      this._dropped++;
      return;
    }

    this.queue.push({
      task,
      label,
      reject: (err) =>
        logger.warn(`[SerialQueue] ${label} failed`, { err: String(err) }),
    });

    if (!this.running) {
      void this.drain();
    }
  }

  private async drain(): Promise<void> {
    this.running = true;
    while (this.queue.length > 0) {
      const entry = this.queue.shift()!;
      try {
        await entry.task();
      } catch (e) {
        entry.reject(e);
      }
    }
    this.running = false;
  }

  /**
   * 현재 실행 중인 작업이 끝날 때까지 대기.
   * CLI shutdown 전에 호출해 "DB 이미 닫힘" 에러를 방지한다.
   */
  async flush(): Promise<void> {
    // 큐가 비어있고 실행 중도 아니면 즉시 반환
    if (!this.running && this.queue.length === 0) return;
    // 10ms 폴링 — drain이 설정한 this.running 플래그를 기다림
    await new Promise<void>((resolve) => {
      const check = () => {
        if (!this.running && this.queue.length === 0) resolve();
        else setTimeout(check, 10);
      };
      check();
    });
  }

  /** Number of tasks waiting in the queue */
  get pendingCount(): number {
    return this.queue.length;
  }

  /** Total tasks dropped due to queue overflow */
  get droppedCount(): number {
    return this._dropped;
  }
}

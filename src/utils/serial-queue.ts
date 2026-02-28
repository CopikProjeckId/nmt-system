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

  /** Number of tasks waiting in the queue */
  get pendingCount(): number {
    return this.queue.length;
  }

  /** Total tasks dropped due to queue overflow */
  get droppedCount(): number {
    return this._dropped;
  }
}

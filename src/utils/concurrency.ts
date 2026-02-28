/**
 * Concurrency utilities — chunk-based parallel execution
 *
 * @module utils/concurrency
 */

/**
 * Run `fn` over `items` concurrently, processing `concurrency` items at a time.
 * Results are returned in the same order as the input items.
 *
 * @param items       Input array
 * @param concurrency Maximum concurrent calls per chunk
 * @param fn          Async function to apply to each item
 */
export async function parallelChunk<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);

  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const partial = await Promise.all(chunk.map(fn));
    for (let j = 0; j < partial.length; j++) {
      results[i + j] = partial[j];
    }
  }

  return results;
}

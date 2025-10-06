/**
 * Concurrency control utilities
 */

/**
 * Execute promises with concurrency limit
 * @param tasks Array of promise-returning functions
 * @param limit Maximum concurrent executions
 * @returns Results array (same order as input)
 */
export async function pLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<Array<T | Error>> {
  const results: Array<T | Error> = [];
  const executing: Promise<void>[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const index = i;

    const promise = (async () => {
      try {
        results[index] = await task();
      } catch (error) {
        results[index] = error instanceof Error ? error : new Error(String(error));
      }
    })();

    results[index] = promise as any; // Temporary placeholder
    executing.push(promise);

    if (executing.length >= limit) {
      await Promise.race(executing);
      // Remove completed promises
      const completed = executing.filter((p) => {
        const settled = Promise.race([p, Promise.resolve('done')]);
        return settled === 'done';
      });
      completed.forEach((p) => {
        const idx = executing.indexOf(p);
        if (idx !== -1) executing.splice(idx, 1);
      });
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * Simpler implementation using semaphore pattern
 */
export class Semaphore {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(private limit: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next();
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

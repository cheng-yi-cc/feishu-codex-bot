type TaskFactory<T> = () => Promise<T>;

export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  public enqueue<T>(taskFactory: TaskFactory<T>): Promise<T> {
    this.pending += 1;
    const run = async (): Promise<T> => {
      try {
        return await taskFactory();
      } finally {
        this.pending -= 1;
      }
    };

    const taskPromise = this.tail.then(run, run);
    this.tail = taskPromise.then(
      () => undefined,
      () => undefined,
    );

    return taskPromise;
  }

  public getPendingCount(): number {
    return this.pending;
  }
}

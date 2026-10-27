/** Undo and redo over whole states. A run of changes with the same `merge` key, such as one slider drag or one
 *  handle drag, becomes a single step. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private mergeKey: string | null = null;

  constructor(private current: T) {}

  get state(): T {
    return this.current;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  push(next: T, merge?: string): void {
    if (!(merge && merge === this.mergeKey)) this.past.push(this.current);
    if (this.past.length > 200) this.past.shift();
    this.current = next;
    this.future = [];
    this.mergeKey = merge ?? null;
  }

  /** Ends a run of merged changes, so the next change is a step of its own even with the same key. */
  seal(): void {
    this.mergeKey = null;
  }

  undo(): T {
    if (!this.past.length) return this.current;
    this.future.push(this.current);
    this.current = this.past.pop()!;
    this.mergeKey = null;
    return this.current;
  }

  redo(): T {
    if (!this.future.length) return this.current;
    this.past.push(this.current);
    this.current = this.future.pop()!;
    this.mergeKey = null;
    return this.current;
  }

  reset(state: T): void {
    this.past = [];
    this.future = [];
    this.current = state;
    this.mergeKey = null;
  }
}

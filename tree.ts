/* Tasks and the tree they make. A task's place in the tree is its `parent` and its order among its siblings, which is
   its order in the array. Every edit here hands back the array in tree order, each task right after the one above it,
   so the order stays easy to reason about. Free of the DOM, so it can be tested on its own. */

/** Days are day numbers (see dates.ts). A task runs from `start` up to, not including, `end`: a one-day task has
 *  end = start + 1, and a milestone has end = start. */
export interface Task {
  id: string;
  name: string;
  start: number;
  end: number;
  /** From 0 to 1. */
  progress: number;
  /** The summary task this one sits under. */
  parent?: string;
  milestone?: boolean;
}

export interface Row {
  task: Task;
  depth: number;
  /** A summary task: it has tasks under it, and its dates are theirs. */
  summary: boolean;
  collapsed: boolean;
}

/** Each task's children in order, with the top-level tasks under "". A parent that is missing counts as none. */
export function childrenOf(tasks: readonly Task[]): Map<string, Task[]> {
  const ids = new Set(tasks.map((task) => task.id));
  const children = new Map<string, Task[]>();
  for (const task of tasks) {
    const parent = task.parent && ids.has(task.parent) ? task.parent : "";
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(task);
  }
  return children;
}

/** The tasks in tree order. A task that would be its own ancestor is moved to the top level. */
export function treeOrder(tasks: readonly Task[]): Task[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const loose = (task: Task) => {
    const seen = new Set<string>();
    for (let id = task.parent; id; id = byId.get(id)?.parent) {
      if (id === task.id || seen.has(id)) return true;
      seen.add(id);
    }
    return false;
  };
  const fixed = tasks.map((task) => (loose(task) ? { ...task, parent: undefined } : task));
  const children = childrenOf(fixed);
  const out: Task[] = [];
  const walk = (parent: string) => {
    for (const task of children.get(parent) ?? []) {
      out.push(task);
      walk(task.id);
    }
  };
  walk("");
  return out;
}

/** The rows to show, top to bottom, with nothing under a collapsed summary. */
export function visibleRows(tasks: readonly Task[], collapsed: ReadonlySet<string>): Row[] {
  const children = childrenOf(tasks);
  const rows: Row[] = [];
  const walk = (parent: string, depth: number) => {
    for (const task of children.get(parent) ?? []) {
      const summary = children.has(task.id);
      const folded = summary && collapsed.has(task.id);
      rows.push({ task, depth, summary, collapsed: folded });
      if (summary && !folded) walk(task.id, depth + 1);
    }
  };
  walk("", 0);
  return rows;
}

/** The ids of every task under `id`, at any depth. */
export function descendants(tasks: readonly Task[], id: string): string[] {
  const children = childrenOf(tasks);
  const out: string[] = [];
  const walk = (parent: string) => {
    for (const child of children.get(parent) ?? []) {
      out.push(child.id);
      walk(child.id);
    }
  };
  walk(id);
  return out;
}

/** The ids above `id`, nearest first. */
export function ancestors(tasks: readonly Task[], id: string): string[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const out: string[] = [];
  for (let parent = byId.get(id)?.parent; parent && byId.has(parent) && !out.includes(parent); parent = byId.get(parent)?.parent) out.push(parent);
  return out;
}

/** The tasks with nothing under them: the ones whose dates are their own. */
export function leaves(tasks: readonly Task[]): Task[] {
  const children = childrenOf(tasks);
  return tasks.filter((task) => !children.has(task.id));
}

function siblingsOf(tasks: readonly Task[], id: string): Task[] {
  const task = tasks.find((item) => item.id === id);
  if (!task) return [];
  const ids = new Set(tasks.map((item) => item.id));
  const parent = task.parent && ids.has(task.parent) ? task.parent : "";
  return childrenOf(tasks).get(parent) ?? [];
}

/** Moves a task under the sibling above it, as that sibling's last child. A milestone is a moment, so nothing goes
 *  under one. */
export function indent(tasks: readonly Task[], id: string): Task[] {
  const siblings = siblingsOf(tasks, id);
  const index = siblings.findIndex((task) => task.id === id);
  if (index < 1 || siblings[index - 1].milestone) return treeOrder(tasks);
  const parent = siblings[index - 1].id;
  return treeOrder(tasks.map((task) => (task.id === id ? { ...task, parent } : task)));
}

/** Moves a task out of its summary, to sit right after it. */
export function outdent(tasks: readonly Task[], id: string): Task[] {
  const ordered = treeOrder(tasks);
  const task = ordered.find((item) => item.id === id);
  const parent = task?.parent ? ordered.find((item) => item.id === task.parent) : undefined;
  if (!task || !parent) return ordered;
  const subtree = new Set([id, ...descendants(ordered, id)]);
  const moved = ordered.filter((item) => subtree.has(item.id)).map((item) => (item.id === id ? { ...item, parent: parent.parent } : item));
  const rest = ordered.filter((item) => !subtree.has(item.id));
  const parentBlock = new Set([parent.id, ...descendants(rest, parent.id)]);
  const after = rest.findLastIndex((item) => parentBlock.has(item.id));
  return treeOrder([...rest.slice(0, after + 1), ...moved, ...rest.slice(after + 1)]);
}

/** Swaps a task, with everything under it, with the sibling above (-1) or below (1). */
export function moveAmongSiblings(tasks: readonly Task[], id: string, direction: -1 | 1): Task[] {
  const ordered = treeOrder(tasks);
  const siblings = siblingsOf(ordered, id);
  const index = siblings.findIndex((task) => task.id === id);
  const other = siblings[index + direction];
  if (index < 0 || !other) return ordered;
  const [first, second] = direction < 0 ? [other.id, id] : [id, other.id];
  const block = (key: string) => new Set([key, ...descendants(ordered, key)]);
  const firstBlock = block(first);
  const secondBlock = block(second);
  const start = ordered.findIndex((task) => firstBlock.has(task.id));
  const end = ordered.findLastIndex((task) => secondBlock.has(task.id));
  const swapped = [...ordered.slice(start, end + 1).filter((task) => secondBlock.has(task.id)), ...ordered.slice(start, end + 1).filter((task) => firstBlock.has(task.id))];
  return [...ordered.slice(0, start), ...swapped, ...ordered.slice(end + 1)];
}

/** Puts `task` right after `after` and everything under it, as its sibling; at the end with no `after`. */
export function insertAfter(tasks: readonly Task[], task: Task, after?: string): Task[] {
  const ordered = treeOrder(tasks);
  const anchor = after ? ordered.find((item) => item.id === after) : undefined;
  if (!anchor) return treeOrder([...ordered, task]);
  const block = new Set([anchor.id, ...descendants(ordered, anchor.id)]);
  const index = ordered.findLastIndex((item) => block.has(item.id));
  return treeOrder([...ordered.slice(0, index + 1), { ...task, parent: anchor.parent }, ...ordered.slice(index + 1)]);
}

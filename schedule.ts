/* Scheduling: the links between tasks, and keeping them true. A link may start or end on a summary task, which stands
   for every task under it, so all of the work here is done on leaves, the tasks whose dates are their own.
   Free of the DOM, so it can be tested on its own. */

import { ancestors, childrenOf, descendants, leaves, type Task } from "./tree.js";

/** Finish to start: `to` may not start until `lag` days after `from` ends. */
export interface Link {
  id: string;
  from: string;
  to: string;
  lag: number;
}

export interface Span {
  start: number;
  end: number;
  progress: number;
}

/** Each summary task's span: from its earliest start to its latest end, with progress weighted by length. */
export function summarize(tasks: readonly Task[]): Map<string, Span> {
  const children = childrenOf(tasks);
  const spans = new Map<string, Span>();
  const visit = (task: Task): Span & { weight: number } => {
    const kids = children.get(task.id);
    if (!kids) return { start: task.start, end: task.end, progress: task.progress, weight: Math.max(1, task.end - task.start) };
    const parts = kids.map(visit);
    const weight = parts.reduce((sum, part) => sum + part.weight, 0);
    const span = {
      start: Math.min(...parts.map((part) => part.start)),
      end: Math.max(...parts.map((part) => part.end)),
      progress: parts.reduce((sum, part) => sum + part.progress * part.weight, 0) / weight,
    };
    spans.set(task.id, span);
    return { ...span, weight };
  };
  for (const task of children.get("") ?? []) visit(task);
  return spans;
}

/** The links between leaves that `links` amount to: a link to or from a summary task becomes one to or from each task
 *  under it. */
export function expandLinks(tasks: readonly Task[], links: readonly Link[]): Link[] {
  const children = childrenOf(tasks);
  const ids = new Set(tasks.map((task) => task.id));
  const leafIds = (id: string) => (children.has(id) ? descendants(tasks, id).filter((child) => !children.has(child)) : [id]);
  const out: Link[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    if (!ids.has(link.from) || !ids.has(link.to)) continue;
    for (const from of leafIds(link.from)) {
      for (const to of leafIds(link.to)) {
        const key = `${from}>${to}`;
        if (from === to || seen.has(key)) continue;
        seen.add(key);
        out.push({ id: link.id, from, to, lag: link.lag });
      }
    }
  }
  return out;
}

function successors(links: readonly Link[]): Map<string, Link[]> {
  const next = new Map<string, Link[]>();
  for (const link of links) next.set(link.from, [...(next.get(link.from) ?? []), link]);
  return next;
}

function reaches(links: readonly Link[], from: string, to: string): boolean {
  const next = successors(links);
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const link of next.get(id) ?? []) stack.push(link.to);
  }
  return false;
}

/** Why a link from `from` to `to` cannot be made, or null if it can: the same task, one inside the other, a link that
 *  is already there, or one that would close a loop. */
export function linkProblem(tasks: readonly Task[], links: readonly Link[], from: string, to: string): "same" | "nested" | "exists" | "loop" | null {
  if (from === to) return "same";
  if (ancestors(tasks, from).includes(to) || ancestors(tasks, to).includes(from)) return "nested";
  if (links.some((link) => link.from === from && link.to === to)) return "exists";
  const existing = expandLinks(tasks, links);
  // A loop needs a way back: some task the new link leads to already leading to one it comes from.
  for (const link of expandLinks(tasks, [{ id: "", from, to, lag: 0 }])) if (reaches(existing, link.to, link.from)) return "loop";
  return null;
}

/** The earliest a leaf may start, given the tasks before it. */
export function earliestStart(tasks: readonly Task[], links: readonly Link[], id: string): number {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  let earliest = -Infinity;
  for (const link of expandLinks(tasks, links)) if (link.to === id) earliest = Math.max(earliest, byId.get(link.from)!.end + link.lag);
  return earliest;
}

/**
 * Pushes tasks later wherever a link says they start too early, carrying their length with them, and on down the
 * chain. Tasks are only ever moved later: a task that starts after its predecessors allow keeps its date. Links that
 * form a loop are left unenforced rather than pushed forever.
 */
export function propagate(tasks: readonly Task[], links: readonly Link[]): Task[] {
  const byId = new Map(tasks.map((task) => [task.id, { ...task }]));
  const valid = expandLinks(tasks, links);
  const incoming = new Map<string, Link[]>();
  const indegree = new Map(leaves(tasks).map((task) => [task.id, 0]));
  for (const link of valid) {
    incoming.set(link.to, [...(incoming.get(link.to) ?? []), link]);
    indegree.set(link.to, (indegree.get(link.to) ?? 0) + 1);
  }
  const outgoing = successors(valid);
  // Kahn's order: each task once all of its predecessors have settled. Tasks in a loop never reach zero and stay put.
  const queue = [...indegree].filter(([, count]) => count === 0).map(([id]) => id);
  while (queue.length) {
    const task = byId.get(queue.shift()!)!;
    const earliest = Math.max(-Infinity, ...(incoming.get(task.id) ?? []).map((link) => byId.get(link.from)!.end + link.lag));
    if (earliest > task.start) {
      task.end = earliest + (task.end - task.start);
      task.start = earliest;
    }
    for (const link of outgoing.get(task.id) ?? []) {
      indegree.set(link.to, indegree.get(link.to)! - 1);
      if (indegree.get(link.to) === 0) queue.push(link.to);
    }
  }
  return tasks.map((task) => byId.get(task.id)!);
}

/**
 * The critical tasks: those with no slack, where any slip moves the end of the whole plan. Worked back from the plan's
 * last day, a task's latest finish is the earliest its successors allow, and a task is critical when that is its end.
 */
export function criticalTasks(tasks: readonly Task[], links: readonly Link[]): Set<string> {
  const work = leaves(tasks);
  if (!work.length) return new Set();
  const finish = Math.max(...work.map((task) => task.end));
  const byId = new Map(work.map((task) => [task.id, task]));
  const outgoing = successors(expandLinks(tasks, links));
  const latest = new Map<string, number>();
  const visiting = new Set<string>();
  const lateFinish = (id: string): number => {
    if (latest.has(id)) return latest.get(id)!;
    if (visiting.has(id)) return finish;
    visiting.add(id);
    let value = finish;
    for (const link of outgoing.get(id) ?? []) {
      const next = byId.get(link.to)!;
      // The successor's latest start, less the wait the link asks for.
      value = Math.min(value, lateFinish(next.id) - (next.end - next.start) - link.lag);
    }
    visiting.delete(id);
    latest.set(id, value);
    return value;
  };
  return new Set(work.filter((task) => lateFinish(task.id) <= task.end).map((task) => task.id));
}

/** A task moved by `days`; with `edge`, only that end of it, never shorter than a day. Milestones only move. */
export function shift(task: Task, days: number, edge?: "start" | "end"): Task {
  if (task.milestone || !edge) return { ...task, start: task.start + days, end: task.end + days };
  if (edge === "start") return { ...task, start: Math.min(task.start + days, task.end - 1) };
  return { ...task, end: Math.max(task.end + days, task.start + 1) };
}

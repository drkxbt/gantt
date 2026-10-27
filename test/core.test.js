import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonths, dayFormat, isoWeek, startOfMonth, startOfWeek, toDay, toISO, weekday } from "../dist/dates.js";
import { criticalTasks, earliestStart, expandLinks, linkProblem, propagate, shift, summarize } from "../dist/schedule.js";
import { ancestors, descendants, indent, insertAfter, moveAmongSiblings, outdent, treeOrder, visibleRows } from "../dist/tree.js";
import { History } from "../dist/history.js";

const day = (iso) => toDay(iso);
const task = (id, start, days, extra = {}) => ({ id, name: id, start: day(start), end: day(start) + days, progress: 0, ...extra });
const link = (from, to, lag = 0) => ({ id: `${from}>${to}`, from, to, lag });
const ids = (tasks) => tasks.map((item) => item.id);
const byId = (tasks) => Object.fromEntries(tasks.map((item) => [item.id, item]));

test("days are calendar dates with no time zone", () => {
  assert.equal(toISO(day("2026-11-03")), "2026-11-03");
  assert.equal(day("2026-11-04") - day("2026-11-03"), 1);
  // Across the end of daylight saving in Europe and the US.
  assert.equal(day("2026-11-02") - day("2026-10-25"), 8);
  assert.equal(toDay(new Date(2026, 10, 3, 23, 30)), day("2026-11-03"));
  assert.equal(toDay(20000.7), 20000);
  assert.throws(() => toDay("3 Nov"));
});

test("weekdays, weeks and months", () => {
  assert.equal(weekday(day("2026-10-27")), 1, "a Tuesday");
  assert.equal(weekday(day("2026-11-01")), 6, "a Sunday");
  assert.equal(toISO(startOfWeek(day("2026-11-01"))), "2026-10-26");
  assert.equal(toISO(startOfMonth(day("2026-11-18"))), "2026-11-01");
  assert.equal(toISO(addMonths(day("2026-11-18"), 2)), "2027-01-01");
  assert.equal(isoWeek(day("2026-01-01")), 1);
  assert.equal(isoWeek(day("2027-01-01")), 53, "1 January 2027 is in the last week of 2026");
  assert.equal(isoWeek(day("2026-10-27")), 44);
  assert.equal(dayFormat("en-US", { month: "short", day: "numeric" })(day("2026-11-03")), "Nov 3");
});

test("tree order and rows, with groups folded", () => {
  const tasks = [task("b1", "2026-11-03", 2, { parent: "b" }), task("a", "2026-11-02", 1), task("b", "2026-11-02", 1), task("b2", "2026-11-05", 1, { parent: "b" })];
  assert.deepEqual(ids(treeOrder(tasks)), ["a", "b", "b1", "b2"]);
  assert.deepEqual(visibleRows(tasks, new Set()).map((row) => [row.task.id, row.depth, row.summary]), [["a", 0, false], ["b", 0, true], ["b1", 1, false], ["b2", 1, false]]);
  assert.deepEqual(ids(visibleRows(tasks, new Set(["b"])).map((row) => row.task)), ["a", "b"]);
  assert.deepEqual(descendants(tasks, "b"), ["b1", "b2"]);
  assert.deepEqual(ancestors(tasks, "b1"), ["b"]);
});

test("a task that is its own ancestor is moved to the top", () => {
  const tasks = [task("a", "2026-11-02", 1, { parent: "b" }), task("b", "2026-11-02", 1, { parent: "a" })];
  const ordered = treeOrder(tasks);
  assert.equal(ordered.length, 2);
  assert.ok(ordered.some((item) => !item.parent));
});

test("indent, outdent, reorder and insert keep the tree in order", () => {
  const tasks = [task("a", "2026-11-02", 1), task("b", "2026-11-02", 1), task("c", "2026-11-02", 1, { parent: "b" }), task("d", "2026-11-02", 1)];
  assert.equal(byId(indent(tasks, "b")).b.parent, "a");
  assert.deepEqual(indent(tasks, "a").map((item) => item.parent), tasks.map((item) => item.parent), "nothing above the first task");
  const out = outdent(tasks, "c");
  assert.equal(byId(out).c.parent, undefined);
  assert.deepEqual(ids(out), ["a", "b", "c", "d"]);
  assert.deepEqual(ids(moveAmongSiblings(tasks, "b", -1)), ["b", "c", "a", "d"], "a group moves with its tasks");
  assert.deepEqual(ids(moveAmongSiblings(tasks, "b", 1)), ["a", "d", "b", "c"]);
  assert.deepEqual(ids(moveAmongSiblings(tasks, "a", -1)), ["a", "b", "c", "d"]);
  assert.deepEqual(ids(insertAfter(tasks, task("e", "2026-11-02", 1), "b")), ["a", "b", "c", "e", "d"], "after the group, not inside it");
  assert.equal(byId(insertAfter(tasks, task("f", "2026-11-02", 1), "c")).f.parent, "b");
  assert.equal(byId(indent([task("m", "2026-11-02", 0, { milestone: true }), task("x", "2026-11-02", 1)], "x")).x.parent, undefined, "nothing goes under a milestone");
});

test("a summary spans its tasks, with progress weighted by length", () => {
  const tasks = [task("g", "2026-11-01", 1), task("x", "2026-11-02", 2, { parent: "g", progress: 1 }), task("y", "2026-11-06", 6, { parent: "g" })];
  const span = summarize(tasks).get("g");
  assert.equal(toISO(span.start), "2026-11-02");
  assert.equal(toISO(span.end), "2026-11-12");
  assert.equal(span.progress, 2 / 8);
  assert.equal(summarize(tasks).has("x"), false);
});

test("links push later tasks along the chain, and never pull them back", () => {
  const tasks = [task("a", "2026-11-02", 3), task("b", "2026-11-03", 2), task("c", "2026-11-20", 1)];
  const links = [link("a", "b"), link("b", "c", 2)];
  const pushed = byId(propagate(tasks, links));
  assert.equal(toISO(pushed.b.start), "2026-11-05", "b waits for a");
  assert.equal(pushed.b.end - pushed.b.start, 2, "and keeps its length");
  assert.equal(toISO(pushed.c.start), "2026-11-20", "c already starts late enough");
  const later = byId(propagate([{ ...tasks[0], start: day("2026-11-16"), end: day("2026-11-19") }, tasks[1], tasks[2]], links));
  assert.equal(toISO(later.b.start), "2026-11-19");
  assert.equal(toISO(later.c.start), "2026-11-23", "two days' lag after b ends");
  assert.equal(earliestStart(tasks, links, "b"), day("2026-11-05"));
  assert.equal(earliestStart(tasks, links, "a"), -Infinity);
});

test("a loop is left alone rather than pushed forever", () => {
  const tasks = [task("a", "2026-11-02", 1), task("b", "2026-11-02", 1)];
  const result = propagate(tasks, [link("a", "b"), link("b", "a")]);
  assert.deepEqual(result.map((item) => item.start), tasks.map((item) => item.start));
});

test("a link to or from a summary stands for each task in it", () => {
  const tasks = [task("g", "2026-11-02", 1), task("x", "2026-11-02", 2, { parent: "g" }), task("y", "2026-11-02", 4, { parent: "g" }), task("z", "2026-11-02", 1)];
  assert.deepEqual(expandLinks(tasks, [link("g", "z")]).map((item) => `${item.from}>${item.to}`), ["x>z", "y>z"]);
  assert.equal(toISO(byId(propagate(tasks, [link("g", "z")])).z.start), "2026-11-06", "after the longest task in the group");
  const before = byId(propagate(tasks, [link("z", "g")]));
  assert.equal(toISO(before.x.start), "2026-11-03");
  assert.equal(toISO(before.y.start), "2026-11-03");
});

test("links that can't be made say why", () => {
  const tasks = [task("a", "2026-11-02", 1), task("b", "2026-11-02", 1), task("c", "2026-11-02", 1), task("g", "2026-11-02", 1), task("g1", "2026-11-02", 1, { parent: "g" })];
  const links = [link("a", "b"), link("b", "c")];
  assert.equal(linkProblem(tasks, links, "a", "a"), "same");
  assert.equal(linkProblem(tasks, links, "a", "b"), "exists");
  assert.equal(linkProblem(tasks, links, "c", "a"), "loop");
  assert.equal(linkProblem(tasks, links, "g", "g1"), "nested");
  assert.equal(linkProblem(tasks, [link("g1", "a")], "a", "g"), "loop", "through a task inside the group");
  assert.equal(linkProblem(tasks, links, "a", "c"), null);
});

test("the critical path is the chain with no slack", () => {
  // a (3d) leads to b (2d) and to c (1d); b leads to d. c has three days to spare.
  const tasks = [task("a", "2026-11-02", 3), task("b", "2026-11-05", 2), task("c", "2026-11-05", 1), task("d", "2026-11-07", 2), task("e", "2026-11-02", 1)];
  const links = [link("a", "b"), link("a", "c"), link("b", "d")];
  assert.deepEqual([...criticalTasks(tasks, links)].sort(), ["a", "b", "d"]);
  assert.deepEqual([...criticalTasks(tasks, [...links, link("c", "d", 1)])].sort(), ["a", "b", "c", "d"], "lag eats c's slack");
  assert.deepEqual([...criticalTasks([task("g", "2026-11-02", 1), task("g1", "2026-11-02", 2, { parent: "g" })], [])], ["g1"], "only tasks with their own dates");
});

test("shifting and stretching", () => {
  const base = task("a", "2026-11-02", 3);
  assert.equal(toISO(shift(base, 2).start), "2026-11-04");
  assert.equal(shift(base, 2).end - shift(base, 2).start, 3);
  assert.equal(shift(base, 1, "end").end, base.end + 1);
  assert.equal(shift(base, -9, "end").end, base.start + 1, "never shorter than a day");
  assert.equal(shift(base, 5, "start").start, base.end - 1);
  const milestone = task("m", "2026-11-02", 0, { milestone: true });
  assert.equal(shift(milestone, 1, "end").end - shift(milestone, 1, "end").start, 0, "milestones only move");
});

test("undo and redo, with merged steps", () => {
  const history = new History(0);
  history.push(1);
  history.push(2, "drag");
  history.push(3, "drag");
  assert.equal(history.undo(), 1);
  assert.equal(history.redo(), 3);
  history.seal();
  history.push(4, "drag");
  assert.equal(history.undo(), 3);
});

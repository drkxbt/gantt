import { addMonths, dayFormat, startOfMonth, startOfWeek, startOfYear, toDay, toISO, type DateInput } from "./dates.js";
import { History } from "./history.js";
import { criticalTasks, earliestStart, linkProblem, propagate, shift, summarize, type Link, type Span } from "./schedule.js";
import { childrenOf, descendants, indent, insertAfter, moveAmongSiblings, outdent, treeOrder, visibleRows, type Row, type Task } from "./tree.js";

export interface TaskInput {
  id: string;
  name: string;
  /** An ISO date ("2026-11-03"), a Date or a day number. */
  start: DateInput;
  /** Calendar days, weekends included. 0 makes a milestone. A summary task's dates are its tasks', so its own are
   *  ignored. */
  days?: number;
  /** From 0 to 1. */
  progress?: number;
  parent?: string;
  milestone?: boolean;
}

export interface LinkInput {
  id?: string;
  from: string;
  to: string;
  /** Days to wait after `from` ends before `to` may start. */
  lag?: number;
}

export interface PlanInput {
  tasks: TaskInput[];
  links?: LinkInput[];
}

export interface PlanTask {
  id: string;
  name: string;
  start: string;
  days: number;
  progress: number;
  parent?: string;
  milestone?: boolean;
}

export interface Plan {
  tasks: PlanTask[];
  links: Link[];
}

type LinkProblem = NonNullable<ReturnType<typeof linkProblem>>;

export interface Labels {
  plan: string;
  tools: string;
  task: string;
  start: string;
  days: string;
  details: string;
  list: string;
  addTask: string;
  addMilestone: string;
  indent: string;
  outdent: string;
  remove: string;
  undo: string;
  redo: string;
  critical: string;
  zoomOut: string;
  zoomIn: string;
  today: string;
  newTask: string;
  newMilestone: string;
  empty: string;
  duration: (days: number) => string;
  describe: (task: { progress: number; after: string[]; milestone: boolean; critical: boolean }) => string;
  moved: (name: string, dates: string, pushed: number) => string;
  progressed: (name: string, percent: number) => string;
  linked: (from: string, to: string, pushed: number) => string;
  unlinked: (from: string, to: string) => string;
  refused: (problem: LinkProblem) => string;
  removed: (name: string) => string;
}

export interface GanttOptions extends PlanInput {
  /** Pixels per day; the nearest of the zoom levels is used. */
  zoom?: number;
  /** Highlight the tasks that set the plan's end date. */
  critical?: boolean;
  /** The day the today line marks. */
  today?: DateInput;
  /** Look, but don't change anything. */
  readOnly?: boolean;
  /** For dates. Defaults to the page's `lang`. */
  locale?: string;
  labels?: Partial<Labels>;
  onChange?: (plan: Plan) => void;
}

export interface Gantt {
  readonly element: HTMLElement;
  readonly plan: Plan;
  /** Pixels per day. */
  readonly zoom: number;
  setPlan(plan: PlanInput): void;
  select(id: string | null): void;
  scrollToTask(id: string): void;
  scrollToDay(day: DateInput): void;
  setZoom(pixelsPerDay: number): void;
  zoomIn(): void;
  zoomOut(): void;
  setCritical(on: boolean): void;
  undo(): void;
  redo(): void;
  destroy(): void;
}

interface State {
  tasks: Task[];
  links: Link[];
}

type Field = "name" | "start" | "days";
type DragKind = "move" | "start" | "end" | "progress" | "link-start" | "link-end";

interface Drag {
  kind: DragKind;
  id: string;
  pointerId: number;
  /** Where the pointer went down, in days from the start of the timeline, with the fraction. */
  originDay: number;
  down: { x: number; y: number };
  last: { x: number; y: number };
  base: State;
  moved: boolean;
  target: string | null;
  problem: LinkProblem | null;
}

interface RowNode {
  row: HTMLElement;
  name: HTMLElement;
  /** The text of each editable cell, hidden while an input takes its place. */
  text: Record<Field, HTMLElement>;
  details: HTMLElement;
}

interface BarNode {
  bar: HTMLElement;
  fill: HTMLElement;
  knob: HTMLElement | null;
  label: HTMLElement;
}

const listFormat = new Intl.ListFormat("en", { type: "conjunction" });
const tasksAfter = (count: number) => (count === 1 ? " One task after it moved too." : count ? ` ${count} tasks after it moved too.` : "");

const DEFAULT_LABELS: Labels = {
  plan: "Plan",
  tools: "Plan tools",
  task: "Task",
  start: "Start",
  days: "Days",
  details: "Details",
  list: "Show the task list",
  addTask: "Add a task",
  addMilestone: "Add a milestone",
  indent: "Move into the task above",
  outdent: "Move out of its group",
  remove: "Delete the selected task or link",
  undo: "Undo",
  redo: "Redo",
  critical: "Show the critical path",
  zoomOut: "Zoom out",
  zoomIn: "Zoom in",
  today: "Go to today",
  newTask: "New task",
  newMilestone: "New milestone",
  empty: "No tasks yet.",
  duration: (days) => `${days}d`,
  describe: ({ progress, after, milestone, critical }) =>
    [milestone ? "Milestone" : `${Math.round(progress * 100)}% done`, after.length ? `after ${listFormat.format(after)}` : "", critical ? "on the critical path" : ""]
      .filter(Boolean)
      .join(", "),
  moved: (name, dates, pushed) => `${name}: ${dates}.${tasksAfter(pushed)}`,
  progressed: (name, percent) => `${name} is ${percent}% done.`,
  linked: (from, to, pushed) => `${to} now waits for ${from}.${tasksAfter(pushed)}`,
  unlinked: (from, to) => `${to} no longer waits for ${from}.`,
  refused: (problem) =>
    ({
      same: "A task can't wait for itself.",
      nested: "A group and a task inside it can't wait for each other.",
      exists: "Those two are already linked.",
      loop: "That link would go round in a loop.",
    })[problem],
  removed: (name) => `Deleted ${name}.`,
};

const ICONS: Record<string, string> = {
  list: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M9.5 5v14"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  milestone: '<path d="M12 4.5 19.5 12 12 19.5 4.5 12Z"/>',
  indent: '<path d="M11 6h9M11 12h9M11 18h9M4 9l3 3-3 3"/>',
  outdent: '<path d="M11 6h9M11 12h9M11 18h9M7 9l-3 3 3 3"/>',
  remove: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  undo: '<path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  critical: '<path d="M3.5 17.5h4l3-11h3l3 11h4"/><circle class="fill" cx="12" cy="6.5" r="2"/>',
  zoomOut: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5M8 10.5h5"/>',
  zoomIn: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5M10.5 8v5M8 10.5h5"/>',
  today: '<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/><circle class="fill" cx="12" cy="14.8" r="1.7"/>',
  caret: '<path d="m10 7 5 5-5 5"/>',
};

/** Pixels per day at each zoom level, closest first. */
const ZOOMS = [64, 40, 26, 16, 10, 6, 3];
/** The height of the column headings and the timeline's two tiers of dates. */
const HEAD = 56;
/** How far past its ends a bar still counts as hit, for dropping a link on it. */
const LINK_SLOP = 24;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const nearestZoom = (width: number) => ZOOMS.reduce((best, value, index) => (Math.abs(value - width) < Math.abs(ZOOMS[best] - width) ? index : best), 0);

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function svgElement<K extends keyof SVGElementTagNameMap>(tag: K, className = ""): SVGElementTagNameMap[K] {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (className) node.setAttribute("class", className);
  return node;
}

function icon(markup: string): SVGSVGElement {
  const svg = svgElement("svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = markup;
  return svg;
}

/** A button with an icon only; its name is for screen readers and the tooltip. */
function iconButton(label: string, markup: string): HTMLButtonElement {
  const button = element("button", "gt-btn");
  button.type = "button";
  button.tabIndex = -1;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.append(icon(markup));
  return button;
}

/** A path through `points` with its corners rounded off. */
function rounded(points: Array<[number, number]>, radius = 4): string {
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1];
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    const r = Math.min(radius, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
    d += `L${x - Math.sign(x - px) * r} ${y - Math.sign(y - py) * r}Q${x} ${y} ${x + Math.sign(nx - x) * r} ${y + Math.sign(ny - y) * r}`;
  }
  const [lx, ly] = points[points.length - 1];
  return `${d}L${lx} ${ly}`;
}

/** The way a link runs from the end of one bar to the start of another. When the second starts too soon after the
 *  first for a straight elbow, the line doubles back along the gap between the rows. */
function route(x1: number, y1: number, x2: number, y2: number, rowHeight: number): string {
  const gap = 10;
  if (x2 - x1 >= gap * 2) return rounded([[x1, y1], [x1 + gap, y1], [x1 + gap, y2], [x2, y2]]);
  const between = y2 > y1 ? y2 - rowHeight / 2 : y2 + rowHeight / 2;
  return rounded([[x1, y1], [x1 + gap, y1], [x1 + gap, between], [x2 - gap, between], [x2 - gap, y2], [x2, y2]]);
}

function fromInput(plan: PlanInput): State {
  const tasks = plan.tasks.map((input): Task => {
    const start = toDay(input.start);
    const milestone = Boolean(input.milestone) || input.days === 0;
    const days = milestone ? 0 : Math.max(1, Math.round(input.days ?? 1));
    return {
      id: String(input.id),
      name: String(input.name),
      start,
      end: start + days,
      progress: clamp(input.progress ?? 0, 0, 1),
      ...(input.parent ? { parent: String(input.parent) } : {}),
      ...(milestone ? { milestone: true } : {}),
    };
  });
  const links = (plan.links ?? []).map((link, index) => ({ id: String(link.id ?? `link-${index + 1}`), from: String(link.from), to: String(link.to), lag: Math.round(link.lag ?? 0) }));
  return { tasks, links };
}

/** Puts a state right: tasks in tree order, links kept, and each summary task holding its tasks' dates, so a summary
 *  that loses its last task keeps where it was. */
function normalize(state: State): State {
  const ids = new Set(state.tasks.map((task) => task.id));
  const links = state.links.filter((link) => ids.has(link.from) && ids.has(link.to));
  const tasks = propagate(treeOrder(state.tasks), links);
  const spans = summarize(tasks);
  return {
    tasks: tasks.map((task) => {
      const span = spans.get(task.id);
      return span ? { ...task, start: span.start, end: span.end, progress: span.progress } : task;
    }),
    links,
  };
}

function toPublic(state: State): Plan {
  return {
    tasks: state.tasks.map((task) => ({
      id: task.id,
      name: task.name,
      start: toISO(task.start),
      days: task.end - task.start,
      progress: Math.round(task.progress * 1000) / 1000,
      ...(task.parent ? { parent: task.parent } : {}),
      ...(task.milestone ? { milestone: true } : {}),
    })),
    links: state.links.map((link) => ({ ...link })),
  };
}

function uniqueId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let n = used.size + 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

function sameDates(a: State, b: State): boolean {
  return a.tasks.length === b.tasks.length && a.tasks.every((task, index) => {
    const other = b.tasks[index];
    return task.id === other.id && task.start === other.start && task.end === other.end && task.progress === other.progress;
  });
}

/** The leaves whose dates differ between two states, leaving out `except`. */
function pushedCount(before: State, after: State, except: Set<string>): number {
  const was = new Map(before.tasks.map((task) => [task.id, task]));
  const children = childrenOf(after.tasks);
  return after.tasks.filter((task) => !except.has(task.id) && !children.has(task.id) && was.get(task.id)?.start !== task.start).length;
}

export function gantt(container: HTMLElement, options: GanttOptions): Gantt {
  const labels: Labels = { ...DEFAULT_LABELS, ...options.labels };
  const locale = options.locale ?? (document.documentElement.lang || undefined);
  const readOnly = options.readOnly ?? false;
  const short = dayFormat(locale, { month: "short", day: "numeric" });
  const today = toDay(options.today ?? new Date());
  const history = new History<State>(normalize(fromInput(options)));

  let preview: State | null = null;
  const collapsed = new Set<string>();
  let selected: string | null = null;
  let selectedLink: string | null = null;
  let zoom = nearestZoom(options.zoom ?? 26);
  let critical = options.critical ?? false;
  let listShown = true;
  let rowHeight = 40;
  let listWidth = 320;
  let range = { start: 0, end: 0 };
  let editing: { id: string; field: Field; input: HTMLInputElement; text: HTMLElement } | null = null;
  let drag: Drag | null = null;
  let lastPointer = "mouse";

  let rows: Row[] = [];
  let rowIndex = new Map<string, number>();
  let byId = new Map<string, Task>();
  let spans = new Map<string, Span>();
  let summaries = new Set<string>();
  let criticalSet = new Set<string>();
  let before = new Map<string, string[]>();
  const rowNodes = new Map<string, RowNode>();
  const barNodes = new Map<string, BarNode>();
  let scaleKey = "";
  /** Scroll owed after the timeline grew at its start, paid once the wider canvas is laid out. */
  let owedScroll = 0;

  const shown = () => preview ?? history.state;
  const dayWidth = () => ZOOMS[zoom];
  const listPx = () => (listShown ? listWidth : 0);
  const spanOf = (task: Task): Span => spans.get(task.id) ?? task;
  const kindOf = (task: Task) => (summaries.has(task.id) ? "summary" : task.milestone ? "milestone" : "task");
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const datesOf = (task: Task) => {
    const span = spanOf(task);
    return span.end > span.start ? `${short(span.start)} to ${short(span.end - 1)}` : short(span.start);
  };

  // The frame: tools on top, then one scroller for the list and the timeline, so they scroll together.
  const root = element("div", "gt");
  const tools = element("div", "gt-tools");
  tools.setAttribute("role", "toolbar");
  tools.setAttribute("aria-label", labels.tools);
  const buttons = {
    list: iconButton(labels.list, ICONS.list),
    add: iconButton(labels.addTask, ICONS.add),
    milestone: iconButton(labels.addMilestone, ICONS.milestone),
    indent: iconButton(labels.indent, ICONS.indent),
    outdent: iconButton(labels.outdent, ICONS.outdent),
    remove: iconButton(labels.remove, ICONS.remove),
    undo: iconButton(labels.undo, ICONS.undo),
    redo: iconButton(labels.redo, ICONS.redo),
    critical: iconButton(labels.critical, ICONS.critical),
    zoomOut: iconButton(labels.zoomOut, ICONS.zoomOut),
    zoomIn: iconButton(labels.zoomIn, ICONS.zoomIn),
    today: iconButton(labels.today, ICONS.today),
  };
  buttons.list.setAttribute("aria-pressed", "true");
  buttons.critical.setAttribute("aria-pressed", String(critical));
  buttons.critical.classList.add("gt-btn-critical");
  const separator = () => {
    const line = element("span", "gt-sep");
    line.setAttribute("aria-hidden", "true");
    return line;
  };
  const edits = readOnly ? [] : [separator(), buttons.add, buttons.milestone, buttons.indent, buttons.outdent, buttons.remove, separator(), buttons.undo, buttons.redo];
  tools.append(buttons.list, ...edits, element("span", "gt-grow"), buttons.critical, separator(), buttons.zoomOut, buttons.zoomIn, buttons.today);

  const scroller = element("div", "gt-scroll");
  const canvas = element("div", "gt-canvas");
  const list = element("div", "gt-list");
  list.setAttribute("role", "treegrid");
  list.setAttribute("aria-label", labels.plan);
  list.setAttribute("aria-colcount", "4");
  if (readOnly) list.setAttribute("aria-readonly", "true");
  const head = element("div", "gt-list-head");
  head.setAttribute("role", "row");
  head.setAttribute("aria-rowindex", "1");
  for (const [field, text] of [["name", labels.task], ["start", labels.start], ["days", labels.days], ["sr", labels.details]]) {
    const cell = element("div", `gt-cell gt-${field}`);
    cell.setAttribute("role", "columnheader");
    cell.textContent = text;
    head.append(cell);
  }
  const body = element("div", "gt-list-body");
  body.setAttribute("role", "rowgroup");
  const empty = element("p", "gt-empty");
  empty.textContent = labels.empty;
  list.append(head, body, empty);

  const timeline = element("div", "gt-timeline");
  const scale = element("div", "gt-scale");
  scale.setAttribute("aria-hidden", "true");
  const tierTop = element("div", "gt-tier");
  const tierBottom = element("div", "gt-tier");
  const nowMark = element("span", "gt-now");
  scale.append(tierTop, tierBottom, nowMark);
  // The list holds everything a screen reader needs; the chart draws the same plan for the eye and the pointer.
  const chart = element("div", "gt-chart");
  chart.setAttribute("aria-hidden", "true");
  const band = element("div", "gt-band");
  const todayLine = element("div", "gt-today");
  const svg = svgElement("svg", "gt-links");
  const linkLayer = svgElement("g");
  const draft = svgElement("path", "gt-draft");
  svg.append(linkLayer, draft);
  const barLayer = element("div", "gt-bars");
  const tip = element("div", "gt-tip");
  tip.hidden = true;
  chart.append(band, todayLine, svg, barLayer, tip);
  timeline.append(scale, chart);
  canvas.append(list, timeline);
  scroller.append(canvas);
  const live = element("div", "gt-live");
  live.setAttribute("role", "status");
  root.append(tools, scroller, live);
  container.append(root);

  let announceTimer = 0;
  function announce(message: string) {
    live.textContent = "";
    clearTimeout(announceTimer);
    // Cleared first and set a moment later, so the same message twice in a row is read twice.
    announceTimer = window.setTimeout(() => (live.textContent = message), 40);
  }

  function readMetrics() {
    const style = getComputedStyle(scroller);
    rowHeight = parseFloat(style.getPropertyValue("--gt-row")) || 40;
    listWidth = parseFloat(style.getPropertyValue("--gt-list")) || 320;
  }

  function derive() {
    const state = shown();
    byId = new Map(state.tasks.map((task) => [task.id, task]));
    rows = visibleRows(state.tasks, collapsed);
    rowIndex = new Map(rows.map((row, index) => [row.task.id, index]));
    spans = summarize(state.tasks);
    summaries = new Set(spans.keys());
    criticalSet = critical ? criticalTasks(state.tasks, state.links) : new Set();
    before = new Map();
    for (const link of state.links) before.set(link.to, [...(before.get(link.to) ?? []), nameOf(link.from)]);
    growRange(state);
  }

  /** The timeline runs from a fortnight before the first task to five weeks past the last, in whole weeks. It only ever
   *  grows while the plan is open, so dragging a bar past the end never makes the view jump. */
  function growRange(state: State) {
    let low = today;
    let high = today;
    for (const task of state.tasks) {
      low = Math.min(low, task.start);
      high = Math.max(high, task.end);
    }
    const need = { start: startOfWeek(low) - 14, end: startOfWeek(high) + 42 };
    if (!range.end) {
      range = need;
      return;
    }
    if (need.start < range.start) {
      const extra = range.start - need.start;
      range.start = need.start;
      owedScroll += extra * dayWidth();
    }
    range.end = Math.max(range.end, need.end);
  }

  function layout() {
    const width = (range.end - range.start) * dayWidth();
    const height = rows.length * rowHeight;
    root.style.setProperty("--gt-list-now", `${listPx()}px`);
    // The canvas is as wide as both columns, not the view: the list can only stay stuck inside its own parent.
    canvas.style.width = `${listPx() + width}px`;
    canvas.style.gridTemplateColumns = `${listPx()}px ${width}px`;
    body.style.height = `${height}px`;
    chart.style.height = `${height}px`;
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    list.setAttribute("aria-rowcount", String(rows.length + 1));
    empty.hidden = rows.length > 0;

    // Row lines, day or week lines, and weekends, all as backgrounds: no element per day.
    const w = dayWidth();
    const layers = [`linear-gradient(to bottom, transparent ${rowHeight - 1}px, var(--gt-line) 0)`];
    const sizes = [`100% ${rowHeight}px`];
    if (w >= 24) {
      layers.push(`linear-gradient(to right, transparent ${w - 1}px, var(--gt-line-soft) 0)`);
      sizes.push(`${w}px 100%`);
    } else if (w >= 9) {
      layers.push(`linear-gradient(to right, transparent ${7 * w - 1}px, var(--gt-line-soft) 0)`);
      sizes.push(`${7 * w}px 100%`);
    }
    // The timeline starts on a Monday, so Saturday is always five days into each week.
    if (w >= 9) {
      layers.push(`linear-gradient(to right, transparent ${5 * w}px, var(--gt-weekend) 0)`);
      sizes.push(`${7 * w}px 100%`);
    }
    chart.style.backgroundImage = layers.join(", ");
    chart.style.backgroundSize = sizes.join(", ");
    const todayX = `${(today - range.start + 0.5) * w}px`;
    todayLine.style.left = todayX;
    nowMark.style.left = todayX;
    renderScale();
  }

  function renderScale() {
    const w = dayWidth();
    const key = `${range.start}:${range.end}:${w}`;
    if (key === scaleKey) return;
    scaleKey = key;
    const top: HTMLElement[] = [];
    const bottom: HTMLElement[] = [];
    const unit = (into: HTMLElement[], from: number, to: number, text: string, flag?: string) => {
      const start = Math.max(from, range.start);
      const end = Math.min(to, range.end);
      if (end <= start) return;
      const cell = element("div", "gt-unit");
      cell.style.left = `${(start - range.start) * w}px`;
      cell.style.width = `${(end - start) * w}px`;
      if (flag) cell.dataset[flag] = "";
      // A month cut short at the edge of the timeline, or a week too narrow for its date, goes without a label
      // rather than showing a stray letter or two. Day numbers are sized to fit.
      const fits = (into === bottom && w >= 24) || text.length * 7 + 16 <= (end - start) * w;
      const label = element("span", "gt-unit-label");
      label.textContent = fits ? text : "";
      cell.append(label);
      into.push(cell);
    };
    if (w >= 9) {
      const month = dayFormat(locale, { month: "long", year: "numeric" });
      for (let m = startOfMonth(range.start); m < range.end; m = addMonths(m, 1)) unit(top, m, addMonths(m, 1), month(m));
    } else {
      const year = dayFormat(locale, { year: "numeric" });
      for (let y = startOfYear(range.start); y < range.end; y = addMonths(y, 12)) unit(top, y, addMonths(y, 12), year(y));
    }
    tierBottom.dataset.unit = w >= 24 ? "day" : w >= 9 ? "week" : "month";
    if (w >= 24) {
      const day = dayFormat(locale, w >= 56 ? { weekday: "short", day: "numeric" } : { day: "numeric" });
      for (let d = range.start; d < range.end; d++) unit(bottom, d, d + 1, day(d), d === today ? "today" : (d - range.start) % 7 >= 5 ? "weekend" : undefined);
    } else if (w >= 9) {
      const week = dayFormat(locale, 7 * w >= 60 ? { month: "short", day: "numeric" } : { day: "numeric" });
      for (let d = range.start; d < range.end; d += 7) unit(bottom, d, d + 7, week(d));
    } else {
      const month = dayFormat(locale, { month: w * 30 >= 36 ? "short" : "narrow" });
      for (let m = startOfMonth(range.start); m < range.end; m = addMonths(m, 1)) unit(bottom, m, addMonths(m, 1), month(m));
    }
    tierTop.replaceChildren(...top);
    tierBottom.replaceChildren(...bottom);
  }

  /** The row that takes Tab into the list. */
  const focusRow = () => selected ?? rows[0]?.task.id ?? null;

  function createRow(id: string): RowNode {
    const row = element("div", "gt-row");
    row.setAttribute("role", "row");
    row.dataset.id = id;
    const cell = (field: string) => {
      const node = element("div", `gt-cell gt-${field}`);
      node.setAttribute("role", "gridcell");
      return node;
    };
    const name = cell("name");
    const caret = element("span", "gt-caret");
    caret.append(icon(ICONS.caret));
    const text = { name: element("span", "gt-text"), start: element("span", "gt-text"), days: element("span", "gt-text") };
    name.append(caret, text.name);
    const start = cell("start");
    start.append(text.start);
    const days = cell("days");
    days.append(text.days);
    const details = cell("sr");
    row.append(name, start, days, details);
    body.append(row);
    const node = { row, name, text, details };
    rowNodes.set(id, node);
    return node;
  }

  function createBar(id: string): BarNode {
    const bar = element("div", "gt-task");
    bar.dataset.id = id;
    const shape = element("div", "gt-shape");
    const fill = element("div", "gt-fill");
    shape.append(fill);
    const label = element("span", "gt-label");
    let knob: HTMLElement | null = null;
    if (readOnly) bar.append(shape, label);
    else {
      const part = (className: string, name: DragKind) => {
        const node = element("span", className);
        node.dataset.part = name;
        return node;
      };
      knob = part("gt-knob", "progress");
      bar.append(shape, part("gt-grip", "start"), part("gt-grip", "end"), knob, part("gt-dot", "link-start"), part("gt-dot", "link-end"), label);
    }
    barLayer.append(bar);
    const node = { bar, fill, knob, label };
    barNodes.set(id, node);
    return node;
  }

  function updateRow(node: RowNode, row: Row, index: number) {
    const { task } = row;
    const span = spanOf(task);
    const line = node.row;
    line.style.top = `${index * rowHeight}px`;
    line.dataset.kind = kindOf(task);
    line.setAttribute("aria-rowindex", String(index + 2));
    line.setAttribute("aria-level", String(row.depth + 1));
    line.setAttribute("aria-selected", String(task.id === selected));
    if (row.summary) line.setAttribute("aria-expanded", String(!row.collapsed));
    else line.removeAttribute("aria-expanded");
    line.tabIndex = task.id === focusRow() ? 0 : -1;
    node.name.style.paddingLeft = `${6 + row.depth * 18}px`;
    node.text.name.textContent = task.name;
    node.text.start.textContent = short(span.start);
    node.text.days.textContent = labels.duration(span.end - span.start);
    node.details.textContent = labels.describe({ progress: span.progress, after: before.get(task.id) ?? [], milestone: kindOf(task) === "milestone", critical: criticalSet.has(task.id) });
  }

  function updateBar(node: BarNode, row: Row, index: number) {
    const { task } = row;
    const span = spanOf(task);
    const kind = kindOf(task);
    const w = dayWidth();
    const x = (span.start - range.start) * w;
    const { bar } = node;
    bar.dataset.kind = kind;
    bar.style.top = `${index * rowHeight}px`;
    // A milestone is a point in time; its box is just room to grab the diamond.
    bar.style.left = `${kind === "milestone" ? x - 12 : x}px`;
    bar.style.width = `${kind === "milestone" ? 24 : (span.end - span.start) * w}px`;
    node.fill.style.width = `${span.progress * 100}%`;
    if (node.knob) node.knob.style.left = `${span.progress * 100}%`;
    bar.toggleAttribute("data-critical", criticalSet.has(task.id));
    bar.toggleAttribute("data-selected", task.id === selected);
    bar.toggleAttribute("data-active", drag?.id === task.id && drag.moved);
    if (drag?.target === task.id) bar.dataset.target = drag.problem ? "bad" : "good";
    else delete bar.dataset.target;
    bar.toggleAttribute("data-short", (span.end - span.start) * w < 36);
    node.label.textContent = task.name;
  }

  /** Only the rows in view, and a few either side, are in the page. The focused row stays so focus isn't lost. */
  function renderWindow() {
    const first = Math.max(0, Math.floor(scroller.scrollTop / rowHeight) - 6);
    const last = Math.min(rows.length - 1, Math.ceil((scroller.scrollTop + scroller.clientHeight) / rowHeight) + 6);
    const keep = new Set<string>();
    for (let i = first; i <= last; i++) keep.add(rows[i].task.id);
    const focused = focusRow();
    if (focused && rowIndex.has(focused)) keep.add(focused);
    if (editing && rowIndex.has(editing.id)) keep.add(editing.id);
    if (drag && rowIndex.has(drag.id)) keep.add(drag.id);
    for (const [id, node] of rowNodes) {
      if (keep.has(id)) continue;
      node.row.remove();
      rowNodes.delete(id);
    }
    for (const [id, node] of barNodes) {
      if (keep.has(id)) continue;
      node.bar.remove();
      barNodes.delete(id);
    }
    for (const id of keep) {
      const index = rowIndex.get(id)!;
      updateRow(rowNodes.get(id) ?? createRow(id), rows[index], index);
      updateBar(barNodes.get(id) ?? createBar(id), rows[index], index);
    }
  }

  function edgeX(task: Task, side: "start" | "end"): number {
    const span = spanOf(task);
    const x = ((side === "start" ? span.start : span.end) - range.start) * dayWidth();
    return kindOf(task) === "milestone" ? x + (side === "start" ? -8 : 8) : x;
  }

  function renderLinks() {
    const state = shown();
    const groups: SVGGElement[] = [];
    for (const link of state.links) {
      const a = rowIndex.get(link.from);
      const b = rowIndex.get(link.to);
      if (a === undefined || b === undefined) continue;
      const from = byId.get(link.from)!;
      const to = byId.get(link.to)!;
      const x1 = edgeX(from, "end");
      const x2 = edgeX(to, "start");
      const y1 = (a + 0.5) * rowHeight;
      const y2 = (b + 0.5) * rowHeight;
      const d = route(x1, y1, x2 - 2, y2, rowHeight);
      const group = svgElement("g", "gt-link");
      group.dataset.link = link.id;
      if (link.id === selectedLink) group.dataset.selected = "";
      // A link is on the critical path when it is the one holding its task back.
      if (criticalSet.has(from.id) && criticalSet.has(to.id) && spanOf(to).start === spanOf(from).end + link.lag) group.dataset.critical = "";
      const hit = svgElement("path", "gt-link-hit");
      const line = svgElement("path", "gt-link-line");
      const head = svgElement("path", "gt-link-head");
      hit.setAttribute("d", d);
      line.setAttribute("d", d);
      head.setAttribute("d", `M${x2 - 7} ${y2 - 4.5}L${x2} ${y2}L${x2 - 7} ${y2 + 4.5}Z`);
      group.append(hit, line, head);
      groups.push(group);
    }
    linkLayer.replaceChildren(...groups);
    const index = selected ? rowIndex.get(selected) : undefined;
    band.hidden = index === undefined;
    if (index !== undefined) band.style.top = `${index * rowHeight}px`;
  }

  function renderTip() {
    if (!drag?.moved || drag.kind.startsWith("link")) {
      tip.hidden = true;
      return;
    }
    const task = byId.get(drag.id);
    const index = rowIndex.get(drag.id);
    if (!task || index === undefined) return;
    const span = spanOf(task);
    tip.textContent = drag.kind === "progress" ? `${Math.round(span.progress * 100)}%` : kindOf(task) === "milestone" ? short(span.start) : `${short(span.start)} – ${short(span.end - 1)} · ${labels.duration(span.end - span.start)}`;
    tip.hidden = false;
    const x = drag.kind === "end" ? edgeX(task, "end") : drag.kind === "progress" ? edgeX(task, "start") + (span.end - span.start) * dayWidth() * span.progress : edgeX(task, "start");
    tip.style.left = `${Math.max(4, x)}px`;
    tip.style.top = `${index === 0 ? rowHeight + 4 : index * rowHeight - 26}px`;
    tip.dataset.side = drag.kind === "end" ? "end" : "start";
  }

  function renderChrome() {
    const state = history.state;
    const task = selected ? byId.get(selected) : undefined;
    const siblings = task ? childrenOf(state.tasks).get(task.parent ?? "") ?? [] : [];
    const above = siblings[siblings.findIndex((item) => item.id === task?.id) - 1];
    buttons.indent.disabled = !above || Boolean(above.milestone);
    buttons.outdent.disabled = !task?.parent;
    buttons.remove.disabled = !task && !selectedLink;
    buttons.undo.disabled = !history.canUndo;
    buttons.redo.disabled = !history.canRedo;
    buttons.zoomIn.disabled = zoom === 0;
    buttons.zoomOut.disabled = zoom === ZOOMS.length - 1;
    buttons.critical.setAttribute("aria-pressed", String(critical));
    buttons.list.setAttribute("aria-pressed", String(listShown));
    root.toggleAttribute("data-critical", critical);
    root.dataset.list = listShown ? "shown" : "hidden";
    // One stop for Tab in the toolbar; the arrow keys move along it.
    const enabled = [...tools.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const current = enabled.find((button) => button.tabIndex === 0) ?? enabled[0];
    for (const button of tools.querySelectorAll("button")) button.tabIndex = button === current ? 0 : -1;
  }

  function renderNow() {
    cancelAnimationFrame(frame);
    frame = 0;
    derive();
    layout();
    if (owedScroll) {
      scroller.scrollLeft += owedScroll;
      owedScroll = 0;
    }
    renderWindow();
    renderLinks();
    renderTip();
    renderChrome();
  }

  let frame = 0;
  function render() {
    if (!frame) frame = requestAnimationFrame(renderNow);
  }

  function commit(next: State): State {
    const state = normalize(next);
    history.push(state);
    renderNow();
    options.onChange?.(toPublic(state));
    return state;
  }

  function afterHistory() {
    const state = history.state;
    if (selected && !state.tasks.some((task) => task.id === selected)) selected = null;
    if (selectedLink && !state.links.some((link) => link.id === selectedLink)) selectedLink = null;
    renderNow();
    options.onChange?.(toPublic(state));
  }

  function undo() {
    if (!history.canUndo) return;
    history.undo();
    afterHistory();
  }

  function redo() {
    if (!history.canRedo) return;
    history.redo();
    afterHistory();
  }

  function scrollRowIntoView(id: string) {
    const index = rowIndex.get(id);
    if (index === undefined) return;
    const top = index * rowHeight;
    const room = scroller.clientHeight - HEAD;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + rowHeight > scroller.scrollTop + room) scroller.scrollTop = top + rowHeight - room;
  }

  /** Scrolls sideways just enough to show a task's bar, and its label when there's room. */
  function revealBar(id: string) {
    const task = byId.get(id);
    if (!task) return;
    const left = edgeX(task, "start") - 24;
    const right = edgeX(task, "end") + 24;
    const room = scroller.clientWidth - listPx();
    if (left < scroller.scrollLeft) scroller.scrollLeft = left;
    else if (right > scroller.scrollLeft + room) scroller.scrollLeft = Math.min(left, right - room);
  }

  function select(id: string | null, focus = true) {
    selected = id && byId.has(id) ? id : null;
    selectedLink = null;
    if (selected) {
      // A task hidden in a collapsed group comes into view.
      let parent = byId.get(selected)?.parent;
      while (parent) {
        collapsed.delete(parent);
        parent = byId.get(parent)?.parent;
      }
      renderNow();
      scrollRowIntoView(selected);
    }
    renderNow();
    if (focus && selected) rowNodes.get(selected)?.row.focus({ preventScroll: true });
  }

  function toggle(id: string) {
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
    if (selected && collapsed.has(id) && descendants(history.state.tasks, id).includes(selected)) select(id);
    else renderNow();
  }

  function setZoom(index: number, clientX?: number) {
    index = clamp(index, 0, ZOOMS.length - 1);
    if (index === zoom) return;
    // Keep the day under the pointer, or in the middle, where it is.
    const box = scroller.getBoundingClientRect();
    const anchor = clientX === undefined ? listPx() + (scroller.clientWidth - listPx()) / 2 : clientX - box.left;
    const day = range.start + (scroller.scrollLeft + anchor - listPx()) / dayWidth();
    zoom = index;
    renderNow();
    scroller.scrollLeft = (day - range.start) * dayWidth() - anchor + listPx();
    renderWindow();
  }

  function scrollToDay(day: number, smooth = false) {
    const left = (day - range.start + 0.5) * dayWidth() - (scroller.clientWidth - listPx()) / 2;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({ left: Math.max(0, left), behavior: smooth && !reduce ? "smooth" : "auto" });
  }

  function scrollToStart() {
    const starts = history.state.tasks.map((task) => task.start);
    const first = starts.length ? Math.min(...starts) : today;
    scroller.scrollLeft = Math.max(0, (first - range.start - 2) * dayWidth());
    scroller.scrollTop = 0;
  }

  // Editing names, dates and lengths in place.

  function edit(id: string, field: Field) {
    if (readOnly) return;
    const task = byId.get(id);
    if (!task) return;
    if (field !== "name" && kindOf(task) !== "task" && !(field === "start" && kindOf(task) === "milestone")) field = "name";
    finishEdit(true);
    select(id, false);
    const node = rowNodes.get(id);
    if (!node) return;
    const text = node.text[field];
    const input = element("input", "gt-input");
    input.type = field === "name" ? "text" : field === "start" ? "date" : "number";
    input.value = field === "name" ? task.name : field === "start" ? toISO(task.start) : String(task.end - task.start);
    if (field === "days") {
      input.min = "1";
      input.max = "9999";
      input.inputMode = "numeric";
    }
    input.autocomplete = "off";
    input.setAttribute("aria-label", labels[field === "name" ? "task" : field]);
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") finishEdit(true, true);
      else if (event.key === "Escape") finishEdit(false, true);
    });
    input.addEventListener("blur", () => finishEdit(true));
    text.hidden = true;
    text.after(input);
    editing = { id, field, input, text };
    input.focus();
    input.select();
  }

  function finishEdit(save: boolean, refocus = false) {
    if (!editing) return;
    const { id, field, input, text } = editing;
    editing = null;
    input.remove();
    text.hidden = false;
    const state = history.state;
    const task = state.tasks.find((item) => item.id === id);
    if (save && task) {
      let next: Task | null = null;
      if (field === "name" && input.value.trim() && input.value.trim() !== task.name) next = { ...task, name: input.value.trim() };
      if (field === "start" && /^\d{4}-\d{2}-\d{2}$/.test(input.value)) next = shift(task, toDay(input.value) - task.start);
      if (field === "days" && Number(input.value) >= 1) next = { ...task, end: task.start + Math.min(9999, Math.round(Number(input.value))) };
      if (next) {
        const after = commit({ tasks: state.tasks.map((item) => (item.id === id ? next! : item)), links: state.links });
        if (field !== "name") announce(labels.moved(task.name, datesOf(after.tasks.find((item) => item.id === id)!), pushedCount(state, after, new Set([id]))));
      }
    }
    renderNow();
    if (refocus) rowNodes.get(id)?.row.focus({ preventScroll: true });
  }

  // Changes from the toolbar and the keyboard.

  function addTask(milestone: boolean) {
    if (readOnly) return;
    finishEdit(true);
    const state = history.state;
    const anchor = selected ? state.tasks.find((task) => task.id === selected) : undefined;
    const start = anchor ? anchor.start : today;
    const id = uniqueId("task-", state.tasks.map((task) => task.id));
    const task: Task = { id, name: milestone ? labels.newMilestone : labels.newTask, start, end: start + (milestone ? 0 : 3), progress: 0, ...(milestone ? { milestone: true } : {}) };
    commit({ tasks: insertAfter(state.tasks, task, anchor?.id), links: state.links });
    select(id, false);
    revealBar(id);
    edit(id, "name");
  }

  function removeSelected() {
    if (readOnly) return;
    const state = history.state;
    if (selectedLink) {
      const link = state.links.find((item) => item.id === selectedLink);
      selectedLink = null;
      if (!link) return;
      commit({ tasks: state.tasks, links: state.links.filter((item) => item !== link) });
      announce(labels.unlinked(nameOf(link.from), nameOf(link.to)));
      return;
    }
    if (!selected) return;
    const gone = new Set([selected, ...descendants(state.tasks, selected)]);
    const name = nameOf(selected);
    const index = rowIndex.get(selected) ?? 0;
    const next = rows.slice(index + 1).find((row) => !gone.has(row.task.id)) ?? rows.slice(0, index).reverse().find((row) => !gone.has(row.task.id));
    commit({ tasks: state.tasks.filter((task) => !gone.has(task.id)), links: state.links.filter((link) => !gone.has(link.from) && !gone.has(link.to)) });
    select(next?.task.id ?? null);
    announce(labels.removed(name));
  }

  function restructure(change: (tasks: Task[]) => Task[]) {
    if (readOnly || !selected) return;
    const state = history.state;
    const tasks = change(state.tasks);
    if (tasks.every((task, index) => task === state.tasks[index])) return;
    commit({ tasks, links: state.links });
    select(selected);
  }

  /** Moves a task by whole days, or with `edge: "end"` makes it longer or shorter. A summary moves everything in it. */
  function nudge(id: string, days: number, edge?: "end") {
    if (readOnly) return;
    const state = history.state;
    const task = state.tasks.find((item) => item.id === id);
    if (!task || (edge && kindOf(task) !== "task")) return;
    const moving = new Set(summaries.has(id) ? descendants(state.tasks, id) : [id]);
    const after = commit({ tasks: state.tasks.map((item) => (moving.has(item.id) ? shift(item, days, edge) : item)), links: state.links });
    const moved = after.tasks.find((item) => item.id === id)!;
    revealBar(id);
    announce(labels.moved(moved.name, datesOf(moved), pushedCount(state, after, new Set([id, ...moving]))));
  }

  function setCritical(on: boolean) {
    critical = on;
    renderNow();
  }

  // The pointer on the chart: moving, stretching, progress and linking.

  const chartPoint = (clientX: number, clientY: number) => {
    const box = chart.getBoundingClientRect();
    return { x: clientX - box.left, y: clientY - box.top };
  };

  function taskAt(x: number, y: number): string | null {
    const row = rows[Math.floor(y / rowHeight)];
    if (!row) return null;
    return x >= edgeX(row.task, "start") - LINK_SLOP && x <= edgeX(row.task, "end") + LINK_SLOP ? row.task.id : null;
  }

  function applyDrag() {
    if (!drag) return;
    const { x, y } = chartPoint(drag.last.x, drag.last.y);
    const base = drag.base;
    const task = base.tasks.find((item) => item.id === drag!.id);
    if (!task) return;
    if (drag.kind === "link-start" || drag.kind === "link-end") {
      const hit = taskAt(x, y);
      drag.target = hit === drag.id ? null : hit;
      const [from, to] = drag.kind === "link-end" ? [drag.id, drag.target] : [drag.target, drag.id];
      drag.problem = from && to ? linkProblem(base.tasks, base.links, from, to) : null;
      const index = rowIndex.get(drag.id)!;
      const startX = drag.kind === "link-end" ? edgeX(byId.get(drag.id)!, "end") + 16 : edgeX(byId.get(drag.id)!, "start") - 16;
      draft.setAttribute("d", `M${startX} ${(index + 0.5) * rowHeight}L${x} ${y}`);
      draft.dataset.state = !drag.target ? "" : drag.problem ? "bad" : "good";
      renderWindow();
      return;
    }
    const delta = Math.round(range.start + x / dayWidth() - drag.originDay);
    let tasks = base.tasks;
    if (drag.kind === "progress") {
      const progress = clamp(Math.round(((range.start + x / dayWidth() - task.start) / (task.end - task.start)) * 20) / 20, 0, 1);
      tasks = tasks.map((item) => (item.id === task.id ? { ...item, progress } : item));
    } else if (drag.kind === "move") {
      const moving = new Set(summaries.has(task.id) ? descendants(tasks, task.id) : [task.id]);
      tasks = tasks.map((item) => (moving.has(item.id) ? shift(item, delta) : item));
    } else {
      let next = shift(task, delta, drag.kind);
      // Pulling the start earlier stops where the tasks before it end, rather than pushing the whole task later.
      if (drag.kind === "start") next = { ...next, start: Math.max(next.start, earliestStart(tasks, base.links, task.id)) };
      tasks = tasks.map((item) => (item.id === task.id ? next : item));
    }
    preview = normalize({ tasks, links: base.links });
    render();
  }

  let autoFrame = 0;
  /** Scrolls while a drag is held near the edge of the view, so a bar can travel further than the screen is wide. */
  function autoscroll() {
    if (autoFrame || !drag?.moved) return;
    const step = () => {
      autoFrame = 0;
      if (!drag?.moved) return;
      const box = scroller.getBoundingClientRect();
      const { x, y } = drag.last;
      const edge = 40;
      let dx = 0;
      let dy = 0;
      // Faster the deeper into the edge, up to about a day a frame at the default zoom.
      const speed = (depth: number) => Math.min(12, depth / 3);
      if (x > box.right - edge) dx = speed(x - (box.right - edge));
      else if (x < box.left + listPx() + edge) dx = -speed(box.left + listPx() + edge - x);
      if (drag.kind.startsWith("link")) {
        if (y > box.bottom - edge) dy = speed(y - (box.bottom - edge));
        else if (y < box.top + HEAD + edge) dy = -speed(box.top + HEAD + edge - y);
      }
      const left = scroller.scrollLeft;
      const top = scroller.scrollTop;
      scroller.scrollLeft += dx;
      scroller.scrollTop += dy;
      if (scroller.scrollLeft === left && scroller.scrollTop === top) return;
      applyDrag();
      autoFrame = requestAnimationFrame(step);
    };
    autoFrame = requestAnimationFrame(step);
  }

  function endDrag(save: boolean) {
    if (!drag) return;
    const done = drag;
    drag = null;
    cancelAnimationFrame(autoFrame);
    autoFrame = 0;
    delete root.dataset.dragging;
    draft.removeAttribute("d");
    const next = preview;
    preview = null;
    if (!save || !done.moved) {
      renderNow();
      return;
    }
    if (done.kind === "link-start" || done.kind === "link-end") {
      if (done.target && done.problem) announce(labels.refused(done.problem));
      if (!done.target || done.problem) {
        renderNow();
        return;
      }
      const [from, to] = done.kind === "link-end" ? [done.id, done.target] : [done.target, done.id];
      const link: Link = { id: uniqueId("link-", done.base.links.map((item) => item.id)), from, to, lag: 0 };
      const after = commit({ tasks: done.base.tasks, links: [...done.base.links, link] });
      announce(labels.linked(nameOf(from), nameOf(to), pushedCount(done.base, after, new Set())));
      return;
    }
    if (!next || sameDates(next, done.base)) {
      renderNow();
      return;
    }
    const after = commit(next);
    const task = after.tasks.find((item) => item.id === done.id);
    if (!task) return;
    const moving = new Set([done.id, ...(summaries.has(done.id) ? descendants(after.tasks, done.id) : [])]);
    announce(done.kind === "progress" ? labels.progressed(task.name, Math.round(task.progress * 100)) : labels.moved(task.name, datesOf(task), pushedCount(done.base, after, moving)));
  }

  chart.addEventListener("pointerdown", (event) => {
    lastPointer = event.pointerType;
    if (event.button !== 0 || drag) return;
    const target = event.target as Element;
    const linkNode = target.closest<SVGGElement>(".gt-link");
    if (linkNode) {
      event.preventDefault();
      selected = null;
      selectedLink = linkNode.dataset.link ?? null;
      renderNow();
      const id = shown().links.find((link) => link.id === selectedLink)?.to;
      if (id) rowNodes.get(id)?.row.focus({ preventScroll: true });
      return;
    }
    const bar = target.closest<HTMLElement>(".gt-task");
    if (!bar) return;
    const id = bar.dataset.id!;
    if (event.pointerType === "mouse") event.preventDefault();
    select(id);
    if (readOnly) return;
    const kind = ((target.closest<HTMLElement>("[data-part]")?.dataset.part ?? "move") as DragKind);
    const { x } = chartPoint(event.clientX, event.clientY);
    drag = {
      kind,
      id,
      pointerId: event.pointerId,
      originDay: range.start + x / dayWidth(),
      down: { x: event.clientX, y: event.clientY },
      last: { x: event.clientX, y: event.clientY },
      base: history.state,
      moved: false,
      target: null,
      problem: null,
    };
    try {
      chart.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that isn't active, as from a script, can't be captured; the drag still works while it stays on the chart.
    }
  });

  chart.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.last = { x: event.clientX, y: event.clientY };
    if (!drag.moved) {
      const distance = Math.hypot(event.clientX - drag.down.x, event.clientY - drag.down.y);
      if (distance < (event.pointerType === "touch" ? 6 : 3)) return;
      drag.moved = true;
      root.dataset.dragging = drag.kind;
    }
    applyDrag();
    autoscroll();
  });

  chart.addEventListener("pointerup", (event) => {
    if (drag && event.pointerId === drag.pointerId) endDrag(true);
  });
  chart.addEventListener("pointercancel", (event) => {
    if (drag && event.pointerId === drag.pointerId) endDrag(false);
  });

  // A click on empty chart, not a scroll, lets go of the selection.
  let emptyDown: { x: number; y: number } | null = null;
  chart.addEventListener("pointerdown", (event) => {
    emptyDown = (event.target as Element).closest(".gt-task, .gt-link") ? null : { x: event.clientX, y: event.clientY };
  });
  chart.addEventListener("click", (event) => {
    if (!emptyDown || Math.hypot(event.clientX - emptyDown.x, event.clientY - emptyDown.y) > 4) return;
    emptyDown = null;
    selected = null;
    selectedLink = null;
    renderNow();
  });

  chart.addEventListener("dblclick", (event) => {
    const bar = (event.target as Element).closest<HTMLElement>(".gt-task");
    if (bar && !(event.target as Element).closest("[data-part]")) edit(bar.dataset.id!, "name");
  });

  // The list: picking rows, folding groups, and editing cells.

  body.addEventListener("pointerdown", (event) => {
    lastPointer = event.pointerType;
  });

  body.addEventListener("click", (event) => {
    const target = event.target as Element;
    if (target.closest("input")) return;
    const row = target.closest<HTMLElement>(".gt-row");
    if (!row) return;
    const id = row.dataset.id!;
    if (target.closest(".gt-caret")) {
      toggle(id);
      if (selected !== id) select(id);
      return;
    }
    // On a touchscreen, where there's no double click to count on, a tap on a row that is already selected edits it.
    const cell = target.closest<HTMLElement>(".gt-cell");
    if (lastPointer !== "mouse" && selected === id && cell && !readOnly) {
      edit(id, cell.classList.contains("gt-start") ? "start" : cell.classList.contains("gt-days") ? "days" : "name");
      return;
    }
    select(id);
  });

  body.addEventListener("dblclick", (event) => {
    const target = event.target as Element;
    const row = target.closest<HTMLElement>(".gt-row");
    if (!row || target.closest("input, .gt-caret")) return;
    const cell = target.closest<HTMLElement>(".gt-cell");
    edit(row.dataset.id!, cell?.classList.contains("gt-start") ? "start" : cell?.classList.contains("gt-days") ? "days" : "name");
  });

  body.addEventListener("focusin", (event) => {
    const row = (event.target as Element).closest<HTMLElement>(".gt-row");
    if (row && row === event.target && row.dataset.id !== selected) select(row.dataset.id!, false);
  });

  list.addEventListener("keydown", (event) => {
    if ((event.target as Element).closest("input")) return;
    if (event.key === "Escape" && drag) {
      endDrag(false);
      event.preventDefault();
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key;
    const index = selected ? rowIndex.get(selected) ?? -1 : -1;
    const row = rows[index];
    const go = (to: number) => {
      const next = rows[clamp(to, 0, rows.length - 1)];
      if (next) select(next.task.id);
    };
    let handled = true;
    if (mod && !event.altKey && key.toLowerCase() === "z") {
      if (event.shiftKey) redo();
      else undo();
    } else if (mod && key.toLowerCase() === "y") redo();
    else if (mod && (key === "]" || key === "[")) restructure((tasks) => (key === "]" ? indent(tasks, selected!) : outdent(tasks, selected!)));
    else if (event.altKey && row) {
      if (key === "ArrowLeft" || key === "ArrowRight") nudge(row.task.id, key === "ArrowLeft" ? -1 : 1, event.shiftKey ? "end" : undefined);
      else if (key === "ArrowUp" || key === "ArrowDown") restructure((tasks) => moveAmongSiblings(tasks, row.task.id, key === "ArrowUp" ? -1 : 1));
      else handled = false;
    } else if (key === "ArrowDown") go(index + 1);
    else if (key === "ArrowUp") go(index < 0 ? 0 : index - 1);
    else if (key === "Home") go(0);
    else if (key === "End") go(rows.length - 1);
    else if (key === "PageDown" || key === "PageUp") go(index + Math.floor((scroller.clientHeight - HEAD) / rowHeight) * (key === "PageDown" ? 1 : -1));
    else if (key === "ArrowRight" && row?.summary) {
      if (row.collapsed) toggle(row.task.id);
      else go(index + 1);
    } else if (key === "ArrowLeft" && row) {
      if (row.summary && !row.collapsed) toggle(row.task.id);
      else if (row.task.parent) select(row.task.parent);
    } else if ((key === "Enter" || key === "F2") && selected) edit(selected, "name");
    else if (key === "Delete" || key === "Backspace") removeSelected();
    else if (key === "Insert") addTask(false);
    else handled = false;
    if (handled) event.preventDefault();
  });

  // The toolbar.

  buttons.list.addEventListener("click", () => {
    listShown = !listShown;
    renderNow();
  });
  buttons.add.addEventListener("click", () => addTask(false));
  buttons.milestone.addEventListener("click", () => addTask(true));
  buttons.indent.addEventListener("click", () => restructure((tasks) => indent(tasks, selected!)));
  buttons.outdent.addEventListener("click", () => restructure((tasks) => outdent(tasks, selected!)));
  buttons.remove.addEventListener("click", removeSelected);
  buttons.undo.addEventListener("click", undo);
  buttons.redo.addEventListener("click", redo);
  buttons.critical.addEventListener("click", () => setCritical(!critical));
  buttons.zoomOut.addEventListener("click", () => setZoom(zoom + 1));
  buttons.zoomIn.addEventListener("click", () => setZoom(zoom - 1));
  buttons.today.addEventListener("click", () => scrollToDay(today, true));

  tools.addEventListener("keydown", (event) => {
    const enabled = [...tools.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const to = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: enabled.length - 1 }[event.key];
    if (index < 0 || to === undefined) return;
    event.preventDefault();
    enabled[(to + enabled.length) % enabled.length].focus();
  });
  // On a narrow screen the toolbar scrolls; a fade at either end says there is more that way.
  function toolEdges() {
    tools.toggleAttribute("data-more-start", tools.scrollLeft > 1);
    tools.toggleAttribute("data-more-end", tools.scrollWidth - tools.clientWidth - tools.scrollLeft > 1);
  }
  tools.addEventListener("scroll", toolEdges, { passive: true });
  tools.addEventListener("focusin", (event) => {
    for (const button of tools.querySelectorAll("button")) button.tabIndex = button === event.target ? 0 : -1;
  });

  // Ctrl or Cmd with the wheel, and a trackpad pinch, zoom about the pointer.
  let wheel = 0;
  scroller.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      wheel += event.deltaY;
      if (Math.abs(wheel) < 40) return;
      setZoom(zoom + Math.sign(wheel), event.clientX);
      wheel = 0;
    },
    { passive: false },
  );

  let scrollFrame = 0;
  scroller.addEventListener(
    "scroll",
    () => {
      if (!scrollFrame) scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        renderWindow();
      });
    },
    { passive: true },
  );

  // Rows take focus on a click too, so the keys work straight after; their ring only shows once the keyboard is used.
  root.addEventListener("keydown", () => (root.dataset.keys = ""));
  root.addEventListener("pointerdown", () => delete root.dataset.keys);

  const observer = new ResizeObserver(() => {
    readMetrics();
    renderNow();
    toolEdges();
  });
  observer.observe(root);

  readMetrics();
  renderNow();
  scrollToStart();
  renderWindow();

  return {
    element: root,
    get plan() {
      return toPublic(history.state);
    },
    get zoom() {
      return dayWidth();
    },
    setPlan(plan) {
      finishEdit(false);
      endDrag(false);
      history.reset(normalize(fromInput(plan)));
      selected = null;
      selectedLink = null;
      collapsed.clear();
      range = { start: 0, end: 0 };
      renderNow();
      scrollToStart();
      renderWindow();
    },
    select: (id) => select(id),
    scrollToTask(id) {
      select(id, false);
      revealBar(id);
    },
    scrollToDay: (day) => scrollToDay(toDay(day), true),
    setZoom: (pixels) => setZoom(nearestZoom(pixels)),
    zoomIn: () => setZoom(zoom - 1),
    zoomOut: () => setZoom(zoom + 1),
    setCritical,
    undo,
    redo,
    destroy() {
      observer.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(scrollFrame);
      cancelAnimationFrame(autoFrame);
      clearTimeout(announceTimer);
      root.remove();
    },
  };
}

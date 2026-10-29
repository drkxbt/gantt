# gantt

A Gantt chart for the browser, in plain TypeScript with no dependencies. Tasks sit in a tree beside a timeline. Drag a bar to move it, pull an end to make it longer, slide its progress along, or draw a link from one task to another, and every task waiting on it moves later with it. Turn on the critical path to see which tasks decide the end date. Every change can be undone, and the plan comes back as plain data to save.

Try the [Gantt chart demo on drk.vc](https://drk.vc/source/gantt#preview).

![A MacBook and an iPhone running the chart in Safari: on the MacBook, a task is dragged two days later and eight tasks after it follow, another is stretched, a link is drawn that pushes the phone pass along, progress is pulled forward, then the critical path turns red and the view zooms out to weeks; on the iPhone, the task list folds away, a task is moved and another stretched by finger, then the critical path and the wider view](demo/preview.webp)

Charts that do this well, such as Bryntum Gantt and DHTMLX Gantt, are sold per developer. This one is MIT licensed: use it in a product, change it, ship it.

- **Drag everything.** Move a bar, stretch either end, pull the progress handle. A summary task moves with all of its tasks inside. Dates snap to whole days, and a tip shows the new dates while you drag.
- **Links that push.** Drag from the dot at the end of one bar to another to say the second waits for the first. Anything that now starts too early moves later, down the whole chain, and a link that would loop round is refused. Links can wait a few days (`lag`), and a link to or from a summary task stands for every task in it.
- **The critical path.** One button shows the tasks with no slack, the ones that move the end date if they slip, and the links holding them in place.
- **A real tree.** Summary tasks span their tasks and weigh their progress by length. Fold groups, indent and outdent, and move tasks up and down among their siblings. Milestones are diamonds.
- **Edit in place.** Double click a name, a start date or a length to change it; on a touchscreen, tap a selected row.
- **Undo everything.** Every drag, edit and link is one step back.
- **Zoom.** From days to weeks to months, with Ctrl or Cmd and the wheel, a trackpad pinch, or the buttons. Weekends are shaded and today has a line.
- **Large plans.** Only the rows on screen are in the page, and weekends and grid lines are backgrounds rather than an element per day.
- **Touch.** Sideways on a bar drags it and up or down still scrolls, so a phone can scroll a long plan and edit it too. The task list folds away for more timeline.
- **Accessible.** The list is an ARIA tree grid with the dates, progress and links of each task, every change is announced, and the whole plan can be worked from the keyboard.
- **Content Security Policy.** Nothing writes a `style` attribute or a `<style>` tag, so it runs under `style-src 'self'`.

## Install

The package is not on npm. Install it from GitHub, which builds it on the way in:

```bash
npm install github:drkxbt/gantt
```

It installs as `@drkxbt/gantt`. Import it and its stylesheet:

```js
import { gantt } from "@drkxbt/gantt";
import "@drkxbt/gantt/gantt.css";
```

## Usage

```js
const chart = gantt(document.querySelector("#plan"), {
  tasks: [
    { id: "design", name: "Design", start: "2026-11-02", days: 5, progress: 0.4 },
    { id: "build", name: "Build", start: "2026-11-09", days: 10 },
    { id: "launch", name: "Launch", start: "2026-11-23", days: 0 },
  ],
  links: [
    { from: "design", to: "build" },
    { from: "build", to: "launch", lag: 2 },
  ],
  onChange: (plan) => save(plan),
});
```

Give the container a height; the chart fills it. A task with `days: 0` is a milestone, and a task with `parent` sits inside that task, which becomes a summary.

| Option | Default | |
| --- | --- | --- |
| `tasks` | | `{ id, name, start, days, progress, parent, milestone }`. `start` is an ISO date, a `Date` or a day number; `days` counts calendar days, weekends included; `progress` runs from 0 to 1. |
| `links` | `[]` | `{ id, from, to, lag }`: `to` may not start until `lag` days after `from` ends. |
| `zoom` | `26` | Pixels per day. The nearest of the zoom levels, from 64 down to 3, is used. |
| `critical` | `false` | Show the critical path from the start. |
| `today` | today | The day the today line marks. |
| `readOnly` | `false` | Show the plan without letting it change. |
| `locale` | the page's `lang` | For month and day names. |
| `labels` | English | Every button name and announcement, for other languages. |
| `onChange` | | Called with the plan after each change. |

`gantt()` returns `{ element, plan, zoom, setPlan(plan), select(id), scrollToTask(id), scrollToDay(day), setZoom(pixels), zoomIn(), zoomOut(), setCritical(on), undo(), redo(), destroy() }`. `plan` is `{ tasks, links }` in the same shape the options take, with start dates as ISO strings, so it can be saved and handed back to `setPlan` or a new chart.

The scheduling works without a page too: `propagate`, `criticalTasks`, `linkProblem`, `summarize`, `visibleRows` and the tree edits are exported on their own and take plain arrays.

## Keyboard

With a row of the list focused:

| Keys | |
| --- | --- |
| Up, Down, Home, End, Page Up, Page Down | Move between tasks |
| Right, Left | Open or fold a group; Left again goes to the group |
| Enter or F2 | Rename the task |
| Alt with Left or Right | Move the task a day |
| Alt and Shift with Left or Right | Make it a day shorter or longer |
| Alt with Up or Down | Move it among its siblings |
| Ctrl or Cmd with `]` or `[` | Indent or outdent it |
| Insert | Add a task after it |
| Delete or Backspace | Delete it, or the selected link |
| Ctrl or Cmd with Z, with Shift to redo | Undo |
| Escape | Drop a drag that is under way |

The toolbar is one stop for Tab; the arrow keys move along it.

## Theming

```css
.gt {
  --gt-bg: #ffffff;
  --gt-text: #17171a;
  --gt-bar: #e9e7e0;
  --gt-progress: #2ff0b8;
  --gt-summary: #17171a;
  --gt-critical: #ff5a4e;
  --gt-today: #17171a;
  --gt-radius: 10px;
}
.gt-scroll {
  --gt-row: 40px;
  --gt-list: 320px;
}
```

Every colour is a custom property on `.gt`; row height and list width are on `.gt-scroll`. Below 640 pixels wide the chart itself, not the window, switches to taller rows and a list of names only.

## How it works

- **Days are numbers.** A date is the count of days since 1 January 1970, read as a calendar date with no time zone, so a task is two integers and adding a day never trips over a clock change.
- **Pushing.** Links to and from summary tasks are first spread out to the tasks inside them. Tasks are then visited in an order where every task comes after the ones it waits for, and each starts no earlier than its latest predecessor ends plus the lag. Tasks only ever move later; one with room to spare keeps its date. Tasks in a loop never come up in that order, so they stay put instead of being pushed forever, and a new link that would close a loop is refused before it is made.
- **The critical path.** Working back from the plan's last day, each task's latest finish is the earliest any task after it must start, less the lag. A task whose latest finish is its own end has no slack.
- **Dragging.** While a bar is held, the whole plan is worked out again from where it was when the drag began, so pulling a task back undoes the push it made a moment before. Letting go makes it one step in the history.
- **Scrolling.** The list and the timeline are one scroller, the list stuck to the left and the dates to the top, so the two can never drift apart. Rows outside the view are taken out of the page.

## What it doesn't do yet

Days are calendar days: there are no working calendars, holidays or hours. Links are finish to start only, and there are no resources, baselines or exports. Issues and pull requests for any of these are welcome.

## Demo

```bash
npm install
npm run demo
```

Then open http://localhost:4328/demo/. It shows a made-up plan for shipping a small library, with dates set from today's, and the plan as data underneath, changing as you edit it.

## Tests

```bash
npm test
```

Builds the package and tests the dates, the tree and the scheduling: calendar days across a clock change, ISO weeks, tree order with folded groups, indenting and moving tasks, summary spans, pushing along a chain with lag, loops left alone, links to and from groups, refused links, the critical path, stretching, and undo.

## License

[MIT](LICENSE). See [NOTICE](NOTICE) for the fonts in the demo and the names mentioned here.

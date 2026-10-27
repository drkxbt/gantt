import { gantt, toDay, toISO, weekday } from "../dist/index.js";

const tour = new URLSearchParams(location.search).get("tour");
if (tour) document.documentElement.dataset.tour = tour;

/** The sample plan, two weeks under way: it starts on the Monday a fortnight back. */
function samplePlan() {
  const now = toDay(new Date());
  const monday = now - weekday(now) - 14;
  const at = (offset) => toISO(monday + offset);
  return {
    tasks: [
      { id: "plan", name: "Plan", start: at(0) },
      { id: "brief", name: "Write the brief", start: at(0), days: 2, progress: 1, parent: "plan" },
      { id: "api", name: "Sketch the API", start: at(2), days: 3, progress: 1, parent: "plan" },
      { id: "build", name: "Build", start: at(7) },
      { id: "core", name: "Scheduling core", start: at(7), days: 5, progress: 1, parent: "build" },
      { id: "drag", name: "Drag and resize", start: at(14), days: 4, progress: 0.4, parent: "build" },
      { id: "links", name: "Links and arrows", start: at(14), days: 3, progress: 0.6, parent: "build" },
      { id: "keys", name: "Keyboard and screen readers", start: at(21), days: 3, parent: "build" },
      { id: "check", name: "Check", start: at(14) },
      { id: "tests", name: "Tests", start: at(14), days: 4, progress: 0.25, parent: "check" },
      { id: "phone", name: "Phone pass", start: at(18), days: 1, parent: "check" },
      { id: "docs", name: "README and docs", start: at(24), days: 2, parent: "check" },
      { id: "ship", name: "Ship", start: at(21) },
      { id: "record", name: "Record the preview", start: at(21), days: 1, parent: "ship" },
      { id: "release", name: "Release 0.1", start: at(28), days: 0, parent: "ship" },
    ],
    // A lag of two or three days carries work that ends on a Friday over to the Monday.
    links: [
      { from: "brief", to: "api" },
      { from: "api", to: "core", lag: 2 },
      { from: "core", to: "drag", lag: 2 },
      { from: "core", to: "links", lag: 2 },
      { from: "core", to: "tests", lag: 2 },
      { from: "drag", to: "keys", lag: 3 },
      { from: "drag", to: "phone" },
      { from: "links", to: "phone" },
      { from: "keys", to: "docs" },
      { from: "phone", to: "record", lag: 2 },
      { from: "docs", to: "release", lag: 2 },
      { from: "record", to: "release" },
    ],
  };
}

const json = document.querySelector("[data-json]");
const show = (plan) => (json.textContent = JSON.stringify(plan, null, 2));

const chart = gantt(document.querySelector("[data-gantt]"), {
  ...samplePlan(),
  zoom: tour === "phone" ? 16 : 26,
  onChange: show,
});
show(chart.plan);

function startOver() {
  chart.setPlan(samplePlan());
  show(chart.plan);
}
document.querySelector("[data-reset]").addEventListener("click", startOver);

if (tour) import("./tour.js").then(({ run }) => run(tour, chart, startOver));

// A looping tour for recordings, run inside each screen of tour.html: a mouse on the MacBook, a finger on the iPhone.
// Both have the same period, and every loop starts the sample plan over.

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function run(name, chart, reset) {
  const $ = (selector) => document.querySelector(selector);
  const touch = name === "phone";

  // Where the pointer is: a ring the size of a fingertip.
  const finger = document.createElement("div");
  finger.className = "finger";
  document.body.append(finger);
  const show = (x, y, down) => {
    finger.style.translate = `${x - 22}px ${y - 22}px`;
    finger.toggleAttribute("data-on", true);
    finger.toggleAttribute("data-down", down);
  };
  const lift = () => finger.removeAttribute("data-on");

  let captured = null;
  const pointer = (type, x, y) => {
    if (type === "pointerdown") captured = document.elementFromPoint(x, y) ?? document.body;
    const target = captured ?? document.body;
    if (type === "pointerup") captured = null;
    target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, pointerType: touch ? "touch" : "mouse", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true }));
  };
  const ease = (t) => 1 - (1 - t) ** 2;
  const centre = (element) => {
    const box = element.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  };
  async function drag(from, to, ms) {
    show(from.x, from.y, true);
    pointer("pointerdown", from.x, from.y);
    await wait(90);
    const steps = Math.max(4, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const t = ease(i / steps);
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      pointer("pointermove", x, y);
      show(x, y, true);
      await wait(16);
    }
    await wait(120);
    pointer("pointerup", to.x, to.y);
    show(to.x, to.y, false);
    await wait(160);
    lift();
  }
  // A press and release in place: on a bar, it selects the task and shows its handles.
  async function press(point) {
    show(point.x, point.y, true);
    pointer("pointerdown", point.x, point.y);
    await wait(110);
    pointer("pointerup", point.x, point.y);
    show(point.x, point.y, false);
    await wait(140);
    lift();
  }
  async function tap(element) {
    const { x, y } = centre(element);
    show(x, y, true);
    await wait(110);
    show(x, y, false);
    element.click();
    await wait(140);
    lift();
  }
  const bar = (id, part = "") => $(`.gt-task[data-id="${id}"]${part ? ` [data-part="${part}"]` : ""}`);
  const button = (label) => $(`.gt-btn[aria-label="${label}"]`);
  const day = () => chart.zoom;

  // On the phone the toolbar scrolls; a finger swipes it along to reach the tools at its end.
  async function swipeTools(to) {
    const tools = $(".gt-tools");
    const box = tools.getBoundingClientRect();
    const from = tools.scrollLeft;
    const steps = 22;
    for (let i = 0; i <= steps; i++) {
      const t = ease(i / steps);
      tools.scrollLeft = from + (to - from) * t;
      show(box.left + box.width * (0.75 - 0.45 * t), box.top + box.height / 2, true);
      await wait(16);
    }
    lift();
  }

  // A finger pans the chart sideways. A script's touch can't scroll the page itself, so the scroll follows it here.
  async function pan(dx) {
    const scroller = $(".gt-scroll");
    const box = scroller.getBoundingClientRect();
    const from = scroller.scrollLeft;
    const y = box.top + box.height * 0.82;
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const t = ease(i / steps);
      scroller.scrollLeft = from + dx * t;
      show(box.left + box.width * 0.7 - dx * t, y, true);
      await wait(16);
    }
    lift();
  }

  const scripts = {
    // Move the core work two days later and watch everything after it follow; stretch the tests; link the tests to
    // the phone pass, which pushes it along; pull progress; then the critical path, and the whole plan zoomed out.
    async desk(at) {
      await at(500);
      const core = centre(bar("core"));
      await drag(core, { x: core.x + day() * 2, y: core.y }, 560);
      await at(1700);
      await press(centre(bar("tests")));
      await drag(centre(bar("tests", "end")), { x: centre(bar("tests", "end")).x + day() * 2, y: centre(bar("tests", "end")).y }, 420);
      await at(3100);
      const dot = centre(bar("tests", "link-end"));
      const phone = bar("phone").getBoundingClientRect();
      await drag(dot, { x: phone.left + phone.width / 2, y: phone.top + phone.height / 2 }, 620);
      await at(4500);
      await press(centre(bar("drag")));
      const knob = centre(bar("drag", "progress"));
      await drag(knob, { x: knob.x + day() * 1.4, y: knob.y }, 420);
      await at(5800);
      await tap(button("Show the critical path"));
      await at(7200);
      await tap(button("Zoom out"));
      await at(9500);
      await restart();
    },
    // On the phone: the list folds away for more timeline, a bar is moved and stretched by finger, then the critical
    // path and a wider view.
    async phone(at) {
      await at(500);
      await tap(button("Show the task list"));
      await at(1300);
      const core = centre(bar("core"));
      await drag(core, { x: core.x + day() * 2, y: core.y }, 560);
      await at(2400);
      await pan(130);
      await at(3000);
      await press(centre(bar("drag")));
      const end = centre(bar("drag", "end"));
      await drag(end, { x: end.x + day() * 2, y: end.y }, 460);
      await at(4500);
      const tools = $(".gt-tools");
      await swipeTools(tools.scrollWidth - tools.clientWidth);
      await at(5400);
      await tap(button("Show the critical path"));
      await at(6800);
      await tap(button("Zoom out"));
      await at(9500);
      await restart();
    },
  };

  // Back to the sample as it loads: plain colours, the first zoom, the list showing, scrolled to the start.
  async function restart() {
    chart.setCritical(false);
    chart.setZoom(touch ? 16 : 26);
    if (button("Show the task list").getAttribute("aria-pressed") === "false") button("Show the task list").click();
    $(".gt-tools").scrollLeft = 0;
    reset();
  }

  const script = scripts[name];
  if (!script) return;
  const { start, period } = await new Promise((resolve) => {
    const hello = setInterval(() => parent.postMessage({ tourReady: name }, "*"), 300);
    parent.postMessage({ tourReady: name }, "*");
    addEventListener("message", (event) => {
      if (!event.data?.tourStart) return;
      clearInterval(hello);
      resolve({ start: event.data.tourStart, period: event.data.period });
    });
  });
  for (let k = 0; ; k++) {
    const t0 = start + k * period;
    await script((ms) => wait(Math.max(0, t0 + ms - Date.now())));
    await wait(Math.max(0, t0 + period - Date.now()));
  }
}

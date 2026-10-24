/**
 * The script injected into every generated panel before the agent's own document. It is the only code of the app that
 * runs in the sandbox, and it is plain JavaScript in a string: it must not depend on anything of the page.
 *
 * It defines `hai` (scene.get, selection, on, preview, commit), waits for the one MessagePort the page sends after the
 * frame loads, and turns the page's hand presses into the clicks and slider moves a mouse would make. Messages
 * sent before the port arrives are queued, so a panel's script may call `hai` at once.
 */
export const FRAME_RUNTIME = `
(function () {
  "use strict";
  var port = null;
  var queue = [];
  var listeners = { scene: [], selection: [], theme: [], problem: [] };
  var pending = {};
  var counter = 0;
  var selection = [];
  var drag = null;

  function send(message) {
    if (port) port.postMessage(message);
    else queue.push(message);
  }

  function fire(name, value) {
    (listeners[name] || []).slice().forEach(function (callback) {
      try { callback(value); } catch (error) { report(error); }
    });
  }

  function report(error) {
    var text = error && error.message ? error.message : String(error);
    send({ type: "error", message: text.slice(0, 1900) });
  }

  window.addEventListener("error", function (event) { report(event.error || event.message); });
  window.addEventListener("unhandledrejection", function (event) { report(event.reason); });
  window.addEventListener("load", function () { send({ type: "ready" }); });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") send({ type: "key", key: "Escape" });
  });

  // The page sends one port, once, from the window that embeds this frame.
  window.addEventListener("message", function (event) {
    if (port || event.source !== window.parent || !event.data || event.data.hai !== "port" || !event.ports[0]) return;
    port = event.ports[0];
    port.onmessage = function (e) { onHost(e.data); };
    queue.splice(0).forEach(function (message) { port.postMessage(message); });
  });

  function applyTheme(theme) {
    var root = document.documentElement;
    root.setAttribute("data-scheme", theme.scheme);
    root.style.colorScheme = theme.scheme;
    Object.keys(theme.vars).forEach(function (name) { root.style.setProperty(name, theme.vars[name]); });
  }

  function onHost(message) {
    if (!message || typeof message.type !== "string") return;
    switch (message.type) {
      case "reply":
        if (pending[message.requestId]) {
          pending[message.requestId](message.result);
          delete pending[message.requestId];
        }
        break;
      case "scene": fire("scene"); break;
      case "selection": selection = message.ids || []; fire("selection", selection.slice()); break;
      case "theme": applyTheme(message); fire("theme", message.scheme); break;
      case "problem": fire("problem", message.message); break;
      case "press": press(message); break;
    }
  }

  // Hand presses: the page cannot look inside this frame, so it sends the pointer's place in frame coordinates.
  var CONTROL = "button, input, label, a[href], summary, [data-hai-press]";

  function controlAt(x, y) {
    var element = document.elementFromPoint(x, y);
    var control = element && element.closest ? element.closest(CONTROL) : null;
    if (control && control.tagName === "LABEL" && control.control) return control.control;
    return control;
  }

  function setRange(input, x) {
    var rect = input.getBoundingClientRect();
    var min = input.min === "" ? 0 : Number(input.min);
    var max = input.max === "" ? 100 : Number(input.max);
    var step = Number(input.step) > 0 ? Number(input.step) : 1;
    // A native range keeps its thumb inside the track: the value follows the pointer between the thumb's two ends.
    var thumb = 16;
    var t = rect.width > thumb ? Math.min(1, Math.max(0, (x - rect.left - thumb / 2) / (rect.width - thumb))) : 0;
    var value = min + t * (max - min);
    value = Math.round((value - min) / step) * step + min;
    value = Math.min(max, Math.max(min, value));
    var text = String(Number(value.toFixed(6)));
    if (input.value === text) return;
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function press(message) {
    if (message.phase === "down") {
      var control = controlAt(message.x, message.y);
      drag = control ? { control: control } : null;
      if (control && control.type === "range" && !control.disabled) setRange(control, message.x);
      send({ type: "pressed", hit: Boolean(control) && !control.disabled });
    } else if (message.phase === "move") {
      if (drag && drag.control.type === "range") setRange(drag.control, message.x);
    } else if (message.phase === "up" && drag) {
      var held = drag.control;
      drag = null;
      if (held.disabled) return;
      if (held.type === "range") {
        setRange(held, message.x);
        held.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (controlAt(message.x, message.y) === held) {
        if (held.type === "number" || held.type === "text") held.focus();
        else held.click();
      }
    }
  }

  function on(name, callback) {
    if (!listeners[name]) throw new Error("hai.on: unknown event " + name);
    listeners[name].push(callback);
  }

  var hai = {
    scene: {
      get: function (query) {
        return new Promise(function (resolve) {
          var requestId = "r" + ++counter;
          pending[requestId] = resolve;
          send({ type: "get", requestId: requestId, query: query || {} });
        });
      },
    },
    on: on,
    preview: function (ops) { send({ type: "preview", ops: ops }); },
    commit: function () { send({ type: "commit" }); },
  };
  Object.defineProperty(hai, "selection", { get: function () { return selection.slice(); }, enumerable: true });
  Object.defineProperty(window, "hai", { value: Object.freeze(hai), configurable: false });
})();
`;

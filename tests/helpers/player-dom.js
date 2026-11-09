// Deliberately small offline DOM/media adapter for executing the actual emitted scripts.
// It verifies integration and clock/event behavior, not browser layout or audio decoding.
const vm = require('vm');
function loadPlayer(html, search = '?t=0') {
  const nodes = [], media = [], globals = new Map(), documentEvents = new Map();
  class Node {
    constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.style = {}; this.dataset = {}; this.events = new Map(); this.classList = { add() {} }; nodes.push(this); }
    appendChild(n) { this.children.push(n); n.parentElement = this; return n; }
    append() {}
    get lastElementChild() { return this.children.at(-1); }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return this.attributes[k]; }
    removeAttribute(k) { delete this.attributes[k]; }
    get offsetHeight() { return 500; } get scrollHeight() { return 500; }
    get offsetWidth() { return 800; } get scrollWidth() { return 800; }
    get clientWidth() { return 1280; } get clientHeight() { return 720; }
    getBoundingClientRect() { return { left: 400, top: 200, width: 300, height: 350 }; }
    getTotalLength() { return 1000; }
    getPointAtLength(n) { return { x: n, y: n }; }
    insertAdjacentHTML() {}
    addEventListener(event, handler) { if (!this.events.has(event)) this.events.set(event, []); this.events.get(event).push(handler); }
    dispatch(event, value = {}) { for (const fn of this.events.get(event) || []) fn(value); }
  }
  class Audio extends Node {
    constructor() { super('audio'); this.paused = true; this._time = 0; this.seeks = []; this.plays = 0; this.volume = 1; media.push(this); }
    get currentTime() { return this._time; }
    set currentTime(t) { this._time = t; this.seeks.push(t); }
    play() { this.paused = false; this.plays++; return Promise.resolve(); }
    pause() { this.paused = true; }
    load() {}
  }
  const body = new Node('body'), ids = {};
  for (const id of ['wrap', 'stage', 'play', 'scrub', 'clock']) { ids[id] = new Node('div'); body.appendChild(ids[id]); }
  const context = {
    console, URLSearchParams, Uint8Array, atob, location: { search },
    document: { body, documentElement: new Node('html'), getElementById: id => ids[id], createElement: tag => tag === 'audio' ? new Audio() : new Node(tag), createElementNS: (_, tag) => new Node(tag), addEventListener(event, handler) { if (!documentEvents.has(event)) documentEvents.set(event, []); documentEvents.get(event).push(handler); } },
    addEventListener(event, handler) { globals.set(event, handler); },
    setTimeout() {}, requestAnimationFrame(fn) { context.frame = fn; },
  };
  context.window = context;
  vm.createContext(context);
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(script[1], context);
  return { context, nodes, media, ids, key: event => globals.get('keydown')(event), event(name, event) { for (const fn of documentEvents.get(name) || []) fn(event); } };
}
module.exports = { loadPlayer };

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Small DOM fixture for lifecycle and mutation-cost checks; no browser dependencies.
class Element {
	constructor(tag) {
		this.tagName = tag;
		this.children = [];
		this.parentElement = null;
		this.attrs = {};
		this.dataset = {};
		this.style = {};
		this.style.setProperty = (name, value) => { this.style[name] = String(value); };
		this.listeners = new Map();
		this.className = "";
		this._text = "";
		this.scrollTop = 0;
		this.hidden = false;
		this.lookups = 0;
		this.width = 280;
		const classNames = () => new Set(this.className.split(" ").filter(Boolean));
		const commitClasses = (names) => { this.className = [...names].join(" "); };
		this.classList = {
			toggle: (name, on) => { const names = classNames(); if (on) names.add(name); else names.delete(name); commitClasses(names); },
			add: (name) => { const names = classNames(); names.add(name); commitClasses(names); },
			remove: (name) => { const names = classNames(); names.delete(name); commitClasses(names); },
			contains: (name) => classNames().has(name)
		};
	}
	get textContent() { return this._text + this.children.map((x) => x.textContent).join(""); }
	set textContent(value) { this._text = String(value); this.children = []; }
	get isConnected() { return this === document || Boolean(this.parentElement?.isConnected); }
	get clientWidth() { layoutReads++; return this.width; }
	getBoundingClientRect() { layoutReads++; return { left: 150, top: buttonTop, bottom: buttonTop + 28 }; }
	setAttribute(key, value) {
		this.attrs[key] = String(value);
		if (key === "id") this.id = value;
		// Browsers reflect class through className; the fixture has to do it too,
		// or SVG built with setAttribute("class", …) looks unclassed to selectors.
		if (key === "class") this.className = String(value);
	}
	getAttribute(key) { return key in this.attrs ? this.attrs[key] : null; }
	hasAttribute(key) { return key in this.attrs; }
	removeAttribute(key) { delete this.attrs[key]; }
	contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
	append(...nodes) {
		for (const node of nodes) {
			if (node.tagName === "fragment") { this.append(...[...node.children]); continue; }
			node.remove(); node.parentElement = this; this.children.push(node);
		}
	}
	insertBefore(node, next) {
		node.remove();
		node.parentElement = this;
		this.children.splice(this.children.indexOf(next), 0, node);
	}
	remove() {
		if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
		this.parentElement = null;
	}
	replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); this.append(...nodes); }
	addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
	removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
	dispatchEvent(event) { for (const fn of [...(this.listeners.get(event.type) || [])]) fn(event); }
	focus() { document.activeElement = this; }
	querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
	querySelectorAll(selector) {
		this.lookups++;
		const result = [];
		const walk = (node) => { for (const child of node.children) { if (child.matches(selector)) result.push(child); walk(child); } };
		walk(this);
		return result;
	}
	matches(selector) {
		return selector.split(",").some((part) => {
			part = part.trim();
			// "A B" — the descendant form: self must match the last compound, some
			// ancestor the first. Enough for scoped lookups like ".dsb-seg button".
			const space = part.indexOf(" ");
			if (space > 0) {
				const ancestor = part.slice(0, space);
				const rest = part.slice(space + 1).trim();
				return this.matches(rest) && Boolean(this.parentElement && this.parentElement.closest(ancestor));
			}
			if (part.startsWith(".")) return this.className.split(" ").includes(part.slice(1));
			if (part.startsWith("[class*=")) return this.className.toLowerCase().includes(/="([^"]+)"/.exec(part)[1].toLowerCase());
			if (part.startsWith("[data-")) {
				const match = /^\[data-([\w-]+)(?:="([^"]+)")?\]$/.exec(part);
				// A bare [data-x] matches an attribute or a dataset entry, the way a
				// browser does — otherwise setAttribute-only markers look unmatched.
				const key = match ? "data-" + match[1] : "";
				return Boolean(match && (match[2]
					? this.attrs[key] === match[2]
					: this.attrs[key] !== undefined || this.dataset[match[1]] !== undefined));
			}
			if (part.includes("aria-label*=")) {
				const term = /="([^"]+)"/.exec(part)[1];
				return (this.attrs["aria-label"] || "").toLowerCase().includes(term.toLowerCase());
			}
			return this.tagName === part;
		});
	}
	closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
}

const document = new Element("document");
document.head = new Element("head");
document.body = new Element("body");
document.documentElement = new Element("html");
document.append(document.documentElement);
document.documentElement.append(document.head, document.body);
document.createElement = (tag) => new Element(tag);
document.createElementNS = (ns, tag) => Object.assign(new Element(tag), { namespaceURI: ns });
document.createDocumentFragment = () => new Element("fragment");
document.getElementById = (id) => {
	const walk = (el) => el.id === id ? el : el.children.map(walk).find(Boolean);
	return walk(document);
};
let layoutReads = 0;
let buttonTop = 80;
const window = Object.assign(new Element("window"), {
	innerWidth: 1200,
	innerHeight: 800,
	// A light page unless a test sets body[data-ds-dark-theme].
	matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
});
const frames = new Map();
let frameId = 0;
const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((fn) => fn()); };
const mutations = [];
const resizes = [];
class MutationObserver {
	constructor(fn) { this.fn = fn; mutations.push(this); }
	observe(target, config) { this.target = target; this.config = config; }
	disconnect() { this.disconnected = true; }
}
class ResizeObserver {
	constructor(fn) { this.fn = fn; resizes.push(this); }
	observe(target) { this.target = target; this.fn(); }
	disconnect() { this.disconnected = true; }
}
const storage = new Map();
const localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
let effects = [];
let layouts = [];
let refs = [];
let refIndex = 0;
let mounted = false;
let stateWrites = 0;
const React = {
	createElement(type, props, ...children) { return { type, props: { ...props, children: children.length === 1 ? children[0] : children } }; },
	useState() { return [mounted, (value) => { mounted = value; stateWrites++; }]; },
	useRef() { return refs[refIndex++] ||= { current: null }; },
	useEffect(fn) { effects.push(fn); },
	useLayoutEffect(fn) { layouts.push(fn); }
};
let api;
window.__ModuleLoader__ = { load(bundle) { api = bundle.factory(() => React); } };
const sourceText = fs.readFileSync("lib/client.js", "utf8");
const code = sourceText.replace("module.exports = { apply, inject };", "module.exports = { apply, inject, createBellSource, createThemeSource, mountSidebarBell, BellPanel };");
vm.runInNewContext(code, {
	window, document, localStorage, React, MutationObserver, ResizeObserver, console,
	requestAnimationFrame: (fn) => { frames.set(++frameId, fn); return frameId; },
	cancelAnimationFrame: (id) => frames.delete(id), setTimeout, clearTimeout,
	CustomEvent: class { constructor(type) { this.type = type; } }
});

const sidebar = new Element("aside");
document.body.append(sidebar);
function header(title = "工作区") {
	const row = new Element("div");
	const label = new Element("span"); label.textContent = title;
	const searchContainer = new Element("div");
	const search = new Element("button"); search.setAttribute("aria-label", "Search sessions");
	searchContainer.append(search);
	row.append(label, searchContainer, new Element("button"), new Element("button"));
	return row;
}
let row = header(); sidebar.append(row);
const listeners = new Set();
let subscriptions = 0;
let dockState = { items: [
	{ id: "parent", title: "Parent", updatedAt: Date.now() },
	{ id: "child", parentId: "parent", title: "Child", running: true, updatedAt: Date.now() },
	{ id: "unread", title: "Unread", unread: true, updatedAt: Date.now() },
	{ id: "old", title: "Old", unread: true, updatedAt: Date.now() - 4 * 86400000 },
	{ id: "blank", title: "Blank", blank: true, updatedAt: Date.now() }
], current: null };
const dock = { getSnapshot: () => dockState, subscribe(fn) { subscriptions++; listeners.add(fn); return () => listeners.delete(fn); } };
const source = api.createBellSource(dock, {});
assert.equal(subscriptions, 1);
assert.equal(source.getSnapshot().unreadCount, 1);
assert.equal(source.getSnapshot().runningCount, 1);
assert.equal(source.getSnapshot().items.length, 3);
const initial = source.getSnapshot();
listeners.forEach((fn) => fn());
assert.equal(source.getSnapshot(), initial, "unchanged snapshot stays referentially stable");
const anchor = api.mountSidebarBell(source);
flush();
assert.equal(anchor.button.parentElement, row, "button is a direct header child, outside search handlers");
assert.equal(mutations.length, 1);
assert.equal(mutations[0].target, sidebar);
assert.deepEqual({ ...mutations[0].config }, { childList: true, subtree: true });
const lookups = sidebar.lookups;
const reads = layoutReads;
for (let i = 0; i < 500; i++) mutations[0].fn();
assert.equal(frames.size, 0, "attached button makes mutation callbacks O(1)");
assert.equal(sidebar.lookups, lookups);
assert.equal(layoutReads, reads);
row.remove(); row = header("Workspaces"); sidebar.append(row);
for (let i = 0; i < 500; i++) mutations[0].fn();
assert.equal(frames.size, 1, "500 detached-button callbacks coalesce into one frame");
assert.equal(layoutReads, reads);
flush();
assert.equal(sidebar.lookups, lookups + 1);
assert.equal(anchor.button.parentElement, row);
assert.equal(layoutReads, reads, "anchor recovery performs no layout read");

// Theme surface: the panel paints from its own attribute, never from host tokens,
// and the gear row must drive the shared theme source.
const themeCalls = [];
const themeStub = {
	mode: "auto",
	resolved: "light",
	roots: [],
	listeners: new Set(),
	getSnapshot() { return { mode: this.mode, resolved: this.resolved }; },
	subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
	setMode(next) {
		this.mode = next;
		themeCalls.push(next);
		for (const fn of [...this.listeners]) fn(this.getSnapshot());
	},
	apply(el) {
		this.roots.push(el);
		el.setAttribute("data-dsb-theme", this.resolved);
		return () => { this.roots = this.roots.filter((x) => x !== el); };
	}
};
const render = () => { refIndex = 0; effects = []; layouts = []; return api.BellPanel({ source, anchor, theme: themeStub }); };
assert.equal(render(), null, "panel contents absent before first open");
const cleanups = effects.map((fn) => fn()).filter(Boolean);
source.setOpen(true);
assert.equal(stateWrites, 1);
const tree = render();
const root = new Element("div");
root.className = "dsb-panel";
const scroll = new Element("div"); scroll.className = "dsb-scroll";
const settingsEl = new Element("div"); settingsEl.className = "dsb-settings";
const gearEl = new Element("button"); gearEl.setAttribute("data-settings", "1"); gearEl.setAttribute("aria-expanded", "false");
root.append(gearEl, settingsEl, scroll); document.body.append(root); refs[0].current = root;
const disposePanel = layouts[0]();
// Visibility is a class so the open/close transition can play; the node never leaves the document.
assert.match(root.className, /dsb-in/);
assert.equal(root.attrs["aria-hidden"], "false");
assert.equal(root.style["--dsb-origin"], "top left", "entry grows out of the bell on the anchored side");
assert.equal(root.attrs["data-dsb-theme"], "light", "the panel paints from its own theme attribute");
// Gear opens the picker; picking drives the shared source, not local state.
root.dispatchEvent({ type: "click", target: gearEl });
assert.match(settingsEl.className, /dsb-show/);
assert.equal(gearEl.attrs["aria-expanded"], "true");
const segEl = settingsEl.querySelector(".dsb-seg");
// Scoped to the segment's own buttons: the seg carries data-mode itself to move
// the thumb, so an unscoped [data-mode] sweep would paint the track as a pill.
const modeButtons = segEl.querySelectorAll("button");
assert.equal(modeButtons.length, 3, "自动 / 浅色 / 深色");
assert.equal(modeButtons.map((b) => b.textContent).join("|"), "自动|浅色|深色");
assert.equal(modeButtons[0].className, "on", "auto is the default pill");
assert.doesNotMatch(segEl.className, /\bon\b/, "the track never takes the pill class");
assert.equal(segEl.attrs["data-mode"], "auto", "the thumb rides the shared mode");
assert.match(settingsEl.querySelector(".dsb-settings-now").textContent, /浅色/, "the row says what auto resolved to");
root.dispatchEvent({ type: "click", target: modeButtons[2] });
assert.deepEqual(themeCalls, ["dark"], "the picker writes through the theme source");
assert.equal(modeButtons[2].className, "on", "picked mode takes the pill");
assert.equal(segEl.attrs["data-mode"], "dark", "the thumb slides to the picked mode");
assert.equal(modeButtons[0].className, "", "previous pill clears");
// Do-not-disturb switches, one per kind of nudge. They silence the reminder —
// count, badge, dock dot and chime — never the row's own state.
const alertToggles = settingsEl.querySelectorAll("[data-alert]");
assert.equal(alertToggles.length, 2, "任务完成时弹出 / 需要选择时弹出");
assert.deepEqual(alertToggles.map((t) => t.dataset.alert), ["done", "pick"], "switches keep their declared order");
assert.deepEqual(alertToggles.map((t) => t.attrs["aria-label"]), ["任务完成时弹出", "需要选择时弹出"]);
assert.deepEqual(settingsEl.querySelectorAll(".dsb-settings-alert").map((r) => r.querySelector(".dsb-settings-label").textContent),
	["任务完成时弹出", "需要选择时弹出"], "each switch is labelled by its own row");
assert.deepEqual(alertToggles.map((t) => t.attrs.role), ["switch", "switch"]);
assert.deepEqual(alertToggles.map((t) => t.attrs["aria-checked"]), ["true", "true"], "both nudges fire out of the box");
assert.equal(source.getSnapshot().unreadCount, 1);
assert.equal(anchor.button.querySelector(".dsb-badge").textContent, "1", "the bell starts at one");
assert.match(anchor.button.className, /dsb-unread/, "a live count lights the bell");
root.dispatchEvent({ type: "click", target: alertToggles[0] });
assert.equal(alertToggles[0].attrs["aria-checked"], "false", "the switch flips on click");
assert.equal(localStorage.getItem("dsh-session-top-new.alert.done"), "0", "the switch is persisted");
assert.equal(alertToggles[1].attrs["aria-checked"], "true", "only the clicked switch moves");
assert.equal(source.getSnapshot().unreadCount, 0, "muting finished tasks drops the count");
assert.equal(anchor.button.querySelector(".dsb-badge").textContent, "0", "and the badge with it");
assert.doesNotMatch(anchor.button.className, /dsb-unread/, "the dock dot goes dark");
assert.equal(source.getSnapshot().items.find((it) => it.id === "unread").unread, true, "the row keeps its unread flag");
assert.match(scroll.textContent, /Unread/, "the finished row is still listed, just silent");
root.dispatchEvent({ type: "click", target: alertToggles[0] });
assert.equal(alertToggles[0].attrs["aria-checked"], "true", "clicking again restores it");
assert.equal(localStorage.getItem("dsh-session-top-new.alert.done"), "1");
assert.equal(source.getSnapshot().unreadCount, 1, "the count comes back");
assert.match(anchor.button.className, /dsb-unread/);
document.dispatchEvent({ type: "keydown", key: "Escape" });
assert.doesNotMatch(settingsEl.className, /dsb-show/, "first Escape closes the settings row");
assert.match(root.className, /dsb-in/, "and leaves the panel open");
assert.match(scroll.textContent, /运行中 \/ Running.*Parent.*未读 \/ Unread.*Unread/);
assert.doesNotMatch(scroll.textContent, /Child|Old|Blank/);
// Markers mirror the host: running is a ring, unread is the amber dot, and the
// disclosure is the filled triangle — not a home-made dot and a text glyph.
const marks = scroll.querySelectorAll(".dsb-state");
assert.ok(marks.length >= 2, "idle and flagged rows share one state-dot slot");
assert.ok(marks.some((m) => m.dataset.state === "done"), "an unread row is the host's green done dot");
const disclosure = scroll.querySelector("[data-expand]");
assert.ok(disclosure.querySelector(".dsb-arrow"), "the triangle lives inside the expand button");
root.dispatchEvent({ type: "click", target: disclosure });
assert.match(scroll.textContent, /Child/);
// The live session is the nested one, so its ring only appears after expanding.
assert.ok(scroll.querySelector(".dsb-spin"), "a running row draws the rotating ring, not a dot");
assert.equal(scroll.querySelectorAll(".dsb-state").filter((m) => m.dataset.state === "idle").length >= 1, true);
scroll.scrollTop = 77;
source.setOpen(false);
assert.doesNotMatch(root.className, /dsb-in/, "closing only drops the class, leaving the exit transition free to run");
assert.equal(root.attrs["aria-hidden"], "true");
source.setOpen(true);
assert.match(root.className, /dsb-in/);
assert.equal(scroll.scrollTop, 77);
assert.equal(stateWrites, 1, "badge/open changes do not re-render the React panel after first mount");
assert.equal(source.getSnapshot().open, true);
// Opening a row must clear its unread flag even while the host keeps reporting it,
// so the session drops out of Unread into Recent on the very click.
assert.match(scroll.textContent, /未读 \/ Unread[\s\S]*Unread/);
assert.equal(source.getSnapshot().unreadCount, 1);
source.markSeen("unread");
assert.equal(source.getSnapshot().unreadCount, 0, "opening clears the unread count immediately");
assert.equal(source.getSnapshot().items.find((it) => it.id === "unread").unread, false);
assert.doesNotMatch(scroll.textContent, /未读 \/ Unread/, "empty Unread group is skipped");
assert.match(scroll.textContent, /最近 \/ Recent[\s\S]*Unread/, "opened row is regrouped into Recent");
assert.equal(anchor.button.querySelector(".dsb-badge").textContent, "0", "badge drops on the same click");
listeners.forEach((fn) => fn());
assert.equal(source.getSnapshot().items.find((it) => it.id === "unread").unread, false, "host still reporting unread cannot resurrect the row");
document.dispatchEvent({ type: "keydown", key: "Escape" });
assert.doesNotMatch(root.className, /dsb-in/);
assert.equal(document.activeElement, anchor.button);
source.setOpen(true);
document.dispatchEvent({ type: "pointerdown", target: document.body });
assert.doesNotMatch(root.className, /dsb-in/);
buttonTop = 740; source.setOpen(true);
assert.equal(root.style["--dsb-origin"], "bottom left", "flipped panel grows out of its bottom edge");
assert.equal(root.style["--dsb-from"], "6px");
assert.equal(root.style.top, "auto", "panel flips upward near bottom edge");
assert.equal(root.style.bottom, "66px");
sidebar.width = 60; resizes[0].fn();
assert.match(anchor.button.className, /dsb-rail/);
assert.equal(source.getSnapshot().open, false);
sidebar.width = 280; resizes[0].fn();
assert.doesNotMatch(anchor.button.className, /dsb-rail/);
dockState = { ...dockState, items: dockState.items.map((it) => ({ ...it, unread: false })) };
listeners.forEach((fn) => fn());
assert.doesNotMatch(anchor.button.className, /dsb-unread/);
assert.equal(anchor.button.querySelector(".dsb-badge").textContent, "0");
// The other switch governs work waiting on a choice: muting it must leave
// finished tasks alone, and muting that one must leave the choice visible.
dockState = { ...dockState, items: [...dockState.items, { id: "pick", title: "Waiting on you", pending: true, updatedAt: Date.now() }] };
listeners.forEach((fn) => fn());
assert.equal(source.getSnapshot().unreadCount, 1, "a pending session nudges the bell");
assert.equal(anchor.button.querySelector(".dsb-badge").textContent, "1");
root.dispatchEvent({ type: "click", target: alertToggles[1] });
assert.equal(alertToggles[1].attrs["aria-checked"], "false");
assert.equal(localStorage.getItem("dsh-session-top-new.alert.pick"), "0", "the pick switch persists on its own key");
assert.equal(source.getSnapshot().unreadCount, 0, "muting the choice nudge silences it");
assert.equal(source.getSnapshot().items.find((it) => it.id === "pick").pending, true, "the choice itself is still pending");
root.dispatchEvent({ type: "click", target: alertToggles[1] });
assert.equal(source.getSnapshot().unreadCount, 1, "and it comes back");
assert.equal(stateWrites, 1);
localStorage.setItem("dsh-session-top-new.days", "7");
window.dispatchEvent({ type: "dsh-session-top-new:days" });
assert.equal(source.getSnapshot().items.some((it) => it.id === "old"), true, "bell follows dock day setting");
dockState = { items: [], current: null };
listeners.forEach((fn) => fn());
source.setOpen(true);
assert.equal(scroll.textContent, "没有进行中的会话 / No running sessions");
localStorage.removeItem("dsh-session-top-new.days");
anchor.dispose(); disposePanel(); cleanups.forEach((fn) => fn());
assert.equal(listeners.size, 0);
assert.equal(anchor.button.isConnected, false);
assert.equal(document.getElementById("dsh-session-top-new-bell-styles"), undefined);
assert.equal(mutations[0].disconnected, true);
assert.equal(resizes[0].disconnected, true);
assert.equal(frames.size, 0);
for (const target of [window, document, root, scroll]) {
	for (const [name, handlers] of target.listeners) assert.equal(handlers.size, 0, "disposes " + name);
}

row.remove();
const workspaceRoot = new Element("div");
const collapsedHeader = new Element("div"); collapsedHeader.className = "fixture_sectionHeader";
collapsedHeader.append(new Element("button"));
const searchRow = new Element("div");
const railSearch = new Element("button"); railSearch.setAttribute("aria-label", "Search sessions");
searchRow.append(railSearch);
workspaceRoot.append(collapsedHeader, searchRow); sidebar.append(workspaceRoot);
sidebar.width = 60;
const railSource = api.createBellSource(dock, {});
const railAnchor = api.mountSidebarBell(railSource);
flush();
assert.equal(railAnchor.button.isConnected, false, "collapsed startup must not mistake multi-row workspace root for header");
workspaceRoot.replaceChildren(header("Workspace"));
sidebar.width = 280;
mutations[1].fn(); flush(); resizes[1].fn();
assert.equal(railAnchor.button.parentElement, workspaceRoot.children[0], "expansion injects into actual header");
railAnchor.dispose();
workspaceRoot.remove(); sidebar.append(row);

// Exercise the actual plugin registration and late Cordis service startup.
const services = {};
const serviceEvents = new Set();
const registrations = new Map();
const effectDisposers = [];
let listSubscriptions = 0;
let statusSubscriptions = 0;
let listUnsubscribed = 0;
let statusUnsubscribed = 0;
let statusListener;
const list = { ids: ["late"], byId: { late: { displayTitle: "Late service", updatedAt: Date.now() } } };
const ctx = {
	get: (name) => services[name], reflect: { get: (name) => services[name] },
	on(name, fn) { assert.ok(name === "connection/reset" || name === "slots/changed", "only declared client events: " + name); serviceEvents.add(fn); return () => serviceEvents.delete(fn); },
	effect(fn) { const dispose = fn(); if (dispose) effectDisposers.push(dispose); },
	slots: {
		inject(name, fn) { return fn(); },
		register(options, component) { registrations.set(options.id, { options, component }); return () => registrations.delete(options.id); }
	}
};
api.apply(ctx);
assert.equal(registrations.size, 3);
assert.equal(listSubscriptions, 0);
services.sessions = { list: {
	getSnapshot: () => list,
	subscribe() { listSubscriptions++; return () => listUnsubscribed++; }
} };
serviceEvents.forEach((fn) => fn("sessions"));
services.uiSession = { sessionStatus: {
	getSnapshot: () => ({ late: { running: true } }),
	subscribe(fn) { statusListener = fn; statusSubscriptions++; return () => statusUnsubscribed++; }
} };
serviceEvents.forEach((fn) => fn("uiSession"));
serviceEvents.forEach((fn) => fn("sessions"));
assert.equal(listSubscriptions, 1);
assert.equal(statusSubscriptions, 1);
statusListener();
const shared = registrations.get("dsh-session-top-new").options.inject().hooks.dock;
const bell = registrations.get("dsh-session-top-new-bell").options.inject().source;
assert.equal(shared.getSnapshot().items[0].running, true);
assert.equal(bell.getSnapshot().runningCount, 1);
assert.equal(bell.getSnapshot().items[0].title, "Late service");
let opened;
services.uiWorkspace = { openSession(id) { opened = id; } };
bell.openSession("late");
assert.equal(opened, "late", "bell jumps via uiWorkspace.openSession");
effectDisposers.reverse().forEach((fn) => fn());
assert.equal(registrations.size, 0);
assert.equal(serviceEvents.size, 0);
assert.equal(listUnsubscribed, 1);
assert.equal(statusUnsubscribed, 1);
assert.equal(frames.size, 0);
// The shipped sidebar root only carries hashed CSS-module classes (wtg9ga_root)
// and its section header is a plain div, so nothing matches a sidebar-ish
// selector. The bell must still anchor on the 工作区 row via the document scope.
sidebar.remove();
const shipped = new Element("div"); shipped.className = "wtg9ga_root wtg9ga_wide";
document.body.append(shipped);
const shippedHeader = new Element("div"); shippedHeader.className = "wnFoaW_sectionHeader";
const shippedLabel = new Element("span"); shippedLabel.className = "wnFoaW_sectionLabel"; shippedLabel.textContent = "工作区";
const searchSlot = new Element("div"); searchSlot.className = "wnFoaW_searchSlot";
const searchBtn = new Element("button"); searchBtn.setAttribute("aria-label", "搜索会话");
searchSlot.append(searchBtn);
const shippedActions = new Element("div"); shippedActions.className = "wnFoaW_headerActions";
shippedActions.append(new Element("button"), new Element("button"));
shippedHeader.append(shippedLabel, searchSlot, shippedActions);
shipped.append(shippedHeader);
const shippedSource = api.createBellSource(dock, {});
const shippedAnchor = api.mountSidebarBell(shippedSource);
flush();
assert.equal(shippedAnchor.button.parentElement, shippedHeader, "anchors the shipped hashed-class header row");
assert.equal(shippedHeader.children.indexOf(shippedAnchor.button), 1, "sits directly before the search slot");
assert.equal(mutations[mutations.length - 1].target, document.body, "document scope is the observer fallback");
const shippedLookups = document.body.lookups;
for (let i = 0; i < 500; i++) mutations[mutations.length - 1].fn();
assert.equal(document.body.lookups, shippedLookups, "attached button keeps document-scope callbacks O(1)");
shippedHeader.remove();
for (let i = 0; i < 5; i++) { mutations[mutations.length - 1].fn(); flush(); }
assert.equal(shippedAnchor.button.isConnected, false, "a missing row leaves the bell out of the document");
shippedAnchor.dispose();

// Theme source: one resolved value for every surface that registers a root.
const realTheme = api.createThemeSource();
// A registered root must be attached — paint() drops detached elements on purpose.
const fakeRoot = new Element("div");
document.body.append(fakeRoot);
const detachTheme = realTheme.apply(fakeRoot);
assert.equal(realTheme.getSnapshot().mode, "auto");
assert.equal(realTheme.getSnapshot().resolved, "dark", "a light page inverts to a dark panel");
assert.equal(fakeRoot.attrs["data-dsb-theme"], "dark");
// Several observers watch page attributes; the theme one is among them, so fire
// every filtered observer instead of trusting array order.
const attrObservers = mutations.filter((m) => m.config && m.config.attributeFilter);
assert.ok(attrObservers.length > 0, "the theme source observes page attributes");
const pokeTheme = () => { for (const o of attrObservers) o.fn(); };
document.body.setAttribute("data-ds-dark-theme", "");
pokeTheme();
assert.equal(realTheme.getSnapshot().resolved, "light", "a dark page inverts to a light panel");
assert.equal(fakeRoot.attrs["data-dsb-theme"], "light");
realTheme.setMode("dark");
assert.equal(localStorage.getItem("dsh-session-top-new.theme"), "dark", "the choice is persisted");
assert.equal(fakeRoot.attrs["data-dsb-theme"], "dark", "an explicit mode ignores the page");
document.body.removeAttribute("data-ds-dark-theme");
pokeTheme();
assert.equal(fakeRoot.attrs["data-dsb-theme"], "dark");
realTheme.setMode("auto");
assert.equal(fakeRoot.attrs["data-dsb-theme"], "dark");
localStorage.removeItem("dsh-session-top-new.theme");
detachTheme();
realTheme.dispose();

console.log("PASS: shared stable source; 500-mutation fast path and coalescing; no mutation layout; direct header seat; lazy persistent panel; groups and children; Escape/outside; flip; rail; collapsed startup/expand; direct badge updates; day window; empty state; navigation; late services; one subscription per service; complete plugin disposal; inverted auto theme; gear picker; persisted mode");

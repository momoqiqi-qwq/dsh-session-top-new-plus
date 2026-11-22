/**
 * 中文速览 — 铃铛面板的节点断言，自带 DOM 替身，不需要浏览器。
 *   跑：node tests/bell.cjs（零依赖，全绿会打出一串 PASS: ...）。
 *   React 替身只建 { type, props }，不建 DOM：面板根节点、头部按钮这类由 React
 *   生成的元素要在 fixture 里手工搭出来（见 root.append(...) 那段）。
 *   断言锚点一律用 data-* 属性，不要靠 class 名或界面文案。
 */
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
const code = sourceText.replace("module.exports = { apply, inject };", "module.exports = { apply, inject, createBellSource, createThemeSource, mountSidebarBell, BellPanel, countNudges };");
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
	{ id: "unread", title: "Unread", unread: true, jobs: 3, updatedAt: Date.now() },
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
// The real panel puts the header above the list; the fixture only needs the
// mark-all-read control that draw() reaches for by attribute.
const headClear = new Element("button"); headClear.setAttribute("data-clear-unread", "1");
headClear.textContent = "全部已读";
root.append(headClear, gearEl, settingsEl, scroll); document.body.append(root); refs[0].current = root;
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
// Two layout switches sit above them: keep the host sidebar in step, and show or
// hide the floating dock (the bell is the only way back once the dock is gone).
const revealToggle = settingsEl.querySelector("[data-reveal]");
assert.equal(revealToggle.attrs["aria-checked"], "true", "sidebar reveal is on by default");
const dockToggle = settingsEl.querySelector("[data-dock]");
assert.equal(dockToggle.attrs.role, "switch");
assert.equal(dockToggle.attrs["aria-checked"], "true", "the floating dock is on by default");
root.dispatchEvent({ type: "click", target: dockToggle });
assert.equal(dockToggle.attrs["aria-checked"], "false", "the switch flips on click");
assert.equal(localStorage.getItem("dsh-session-top-new.dock"), "0", "hiding the dock is persisted");
root.dispatchEvent({ type: "click", target: dockToggle });
assert.equal(dockToggle.attrs["aria-checked"], "true", "clicking again brings it back");
assert.equal(localStorage.getItem("dsh-session-top-new.dock"), "1");
// Right-click a session: the bookmark path that needs nothing from the transcript
// but the row's id and title, which is why it cannot fail the way the reply
// button could (a message body whose markup we can no longer read).
// Background jobs get their own pill between the title and the clock, so a row
// that is still working reads differently from one that merely finished.
const jobTags = scroll.querySelectorAll(".dsb-job");
assert.equal(jobTags.length, 1, "only the session with live jobs carries a pill");
assert.equal(jobTags[0].textContent, "3", "the pill shows the count");
assert.match(jobTags[0].title, /3 个后台任务在跑/, "and says what it counts");
assert.equal(jobTags[0].parentElement.querySelector(".dsb-time").textContent.length > 0, true, "the pill sits before the clock");
const rowJump = scroll.querySelector("[data-session]");
assert.ok(rowJump, "the list has a row to right-click");
const rowId = rowJump.dataset.session; // the fixture keeps dataset and attrs apart
rowJump.title = "Right-clicked session";
root.dispatchEvent({
	type: "contextmenu",
	target: rowJump,
	clientX: 200,
	clientY: 300,
	preventDefault() { this.defaultPrevented = true; },
	stopPropagation() {}
});
const menuEl = root.querySelector(".dsb-menu");
assert.ok(menuEl, "right-click opens a menu inside the panel");
assert.equal(menuEl.attrs.role, "menu");
const favItem = menuEl.querySelector("[data-fav-toggle]");
assert.equal(favItem.attrs["data-fav-toggle"], rowId, "the item carries the session it acts on");
assert.equal(favItem.textContent, "加入书签", "an unbookmarked session offers to add one");
root.dispatchEvent({ type: "click", target: favItem });
assert.equal(root.querySelector(".dsb-menu"), null, "picking an item closes the menu");
const storedFavs = JSON.parse(localStorage.getItem("dsh-session-top-new.favorites") || "[]");
assert.equal(storedFavs.length, 1, "one bookmark after one click");
assert.equal(storedFavs[0].id, "session:" + rowId, "a session bookmark is keyed by the session");
assert.equal(storedFavs[0].text, "Right-clicked session", "the row title stands in for an unreadable turn");
root.dispatchEvent({
	type: "contextmenu",
	target: rowJump,
	clientX: 200,
	clientY: 300,
	preventDefault() {},
	stopPropagation() {}
});
assert.equal(root.querySelector("[data-fav-toggle]").textContent, "移除书签", "a bookmarked session offers to remove it");
document.dispatchEvent({ type: "keydown", key: "Escape" });
assert.equal(root.querySelector(".dsb-menu"), null, "Escape dismisses the menu");

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
// The counter behind badge, footer and chime: one row nudges at most once, the
// two switches gate their own kind of nudge, and the session you are looking at
// never nudges you about itself.
const nudgeRows = [
	{ id: "a", unread: true },
	{ id: "b", pending: true },
	{ id: "c", unread: true, pending: true },
	{ id: "cur", unread: true, pending: true }
];
assert.equal(api.countNudges(nudgeRows, "cur", { done: true, pick: true }), 3, "both on: only the open session is skipped");
assert.equal(api.countNudges(nudgeRows, "cur", { done: false, pick: true }), 2, "done muted: finished rows go quiet");
assert.equal(api.countNudges(nudgeRows, "cur", { done: true, pick: false }), 2, "pick muted: waiting rows go quiet");
assert.equal(api.countNudges(nudgeRows, "cur", { done: false, pick: false }), 0, "both muted: nothing nudges");
assert.equal(api.countNudges(nudgeRows, "cur", null), 3, "a host without the switches behaves like both on");
assert.equal(api.countNudges(nudgeRows, "a", { done: true, pick: true }), 3, "whichever session is open drops out of the count");
document.dispatchEvent({ type: "keydown", key: "Escape" });
assert.doesNotMatch(settingsEl.className, /dsb-show/, "first Escape closes the settings row");
assert.match(root.className, /dsb-in/, "and leaves the panel open");
// Day buckets instead of state groups: one header per calendar day, newest day
// first, and one line per conversation — a parent owns its subagent rows.
const dayHeads = scroll.querySelectorAll(".dsb-day");
assert.ok(dayHeads.length >= 1, "the list is bucketed by day");
assert.equal(dayHeads[0].textContent, "今天", "today leads the list");
assert.match(scroll.textContent, /Parent/);
assert.match(scroll.textContent, /Unread/);
assert.doesNotMatch(scroll.textContent, /Child|Blank/, "subagent rows and blank sessions stay out");
const rowIds = scroll.querySelectorAll("[data-session]").map((r) => r.dataset.session);
assert.deepEqual(rowIds.slice(0, 2).sort(), ["parent", "unread"], "today holds both live conversations");
assert.equal(rowIds.includes("old"), false, "a session past the day window stays out");
// A session from late yesterday lands in its own bucket, labelled 昨天.
// One second before today is still yesterday, and always inside the rolling
// 24h window — a fixed -1h breaks the day window once the clock passes 23:00.
const yesterdayRow = { id: "yday", title: "Yesterday", updatedAt: new Date().setHours(0, 0, 0, 0) - 1000 };
dockState = { ...dockState, items: dockState.items.concat([yesterdayRow]) };
listeners.forEach((fn) => fn());
assert.deepEqual(scroll.querySelectorAll(".dsb-day").map((h) => h.textContent), ["今天", "昨天"], "yesterday is its own bucket");
dockState = { ...dockState, items: dockState.items.filter((it) => it.id !== "yday") };
listeners.forEach((fn) => fn());
// Markers mirror the host: unread is the green done dot, a quiet row is dim.
const marks = scroll.querySelectorAll(".dsb-state");
assert.ok(marks.length >= 2, "idle and flagged rows share one state-dot slot");
assert.ok(marks.some((m) => m.dataset.state === "done"), "an unread row is the host's green done dot");
assert.ok(marks.filter((m) => m.dataset.state === "idle").length >= 1, "a quiet row keeps the dim dot");
assert.equal(scroll.querySelector("[data-expand]"), null, "the flat list has no disclosure");
assert.equal(scroll.querySelector(".dsb-spin"), null, "no top-level session runs in this fixture");
scroll.scrollTop = 77;
source.setOpen(false);
assert.doesNotMatch(root.className, /dsb-in/, "closing only drops the class, leaving the exit transition free to run");
assert.equal(root.attrs["aria-hidden"], "true");
source.setOpen(true);
assert.match(root.className, /dsb-in/);
assert.equal(scroll.scrollTop, 77);
assert.equal(stateWrites, 1, "badge/open changes do not re-render the React panel after first mount");
assert.equal(source.getSnapshot().open, true);
// Opening a row must clear its unread flag even while the host keeps reporting it:
// the green dot goes out on the very click that opens the conversation.
assert.ok(scroll.querySelector("[data-session]"), "the opened row is still on screen");
assert.equal(source.getSnapshot().unreadCount, 1);
source.markSeen("unread");
assert.equal(source.getSnapshot().unreadCount, 0, "opening clears the unread count immediately");
assert.equal(source.getSnapshot().items.find((it) => it.id === "unread").unread, false);
assert.equal(scroll.querySelectorAll(".dsb-flagged").length, 0, "the opened row drops its flag");
assert.equal(scroll.querySelectorAll("[data-session]").length, 2, "the session itself stays listed");
assert.doesNotMatch(scroll.textContent, /未读 \/ Unread/, "no state groups left to empty");
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
// The picker was folded by the earlier Escape; open it to watch the paint.
root.dispatchEvent({ type: "click", target: gearEl });
assert.match(settingsEl.className, /dsb-show/);
// Switches are shared state: a write from another window has to reach the paint,
// otherwise this panel shows "on" for a nudge that is already muted.
localStorage.setItem("dsh-session-top-new.alert.done", "0");
window.dispatchEvent({ type: "storage" });
assert.equal(alertToggles[0].attrs["aria-checked"], "false", "an outside write repaints the open picker");
assert.equal(source.getSnapshot().unreadCount, 1, "done muted, pick on: the waiting row still nudges");
// A stale attribute cannot turn the first click into a no-op: the click reads the store.
alertToggles[0].setAttribute("aria-checked", "true");
let broadcasts = 0;
const countBroadcast = () => { broadcasts++; };
window.addEventListener("dsh-session-top-new:alerts", countBroadcast);
root.dispatchEvent({ type: "click", target: alertToggles[0] });
assert.equal(localStorage.getItem("dsh-session-top-new.alert.done"), "1", "the click writes the value the store was missing");
assert.equal(alertToggles[0].attrs["aria-checked"], "true");
window.removeEventListener("dsh-session-top-new:alerts", countBroadcast);
// A store that refuses the write must not be papered over with a fake "changed".
const realSetItem = localStorage.setItem;
localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
broadcasts = 0;
window.addEventListener("dsh-session-top-new:alerts", countBroadcast);
root.dispatchEvent({ type: "click", target: alertToggles[0] });
window.removeEventListener("dsh-session-top-new:alerts", countBroadcast);
localStorage.setItem = realSetItem;
assert.equal(broadcasts, 0, "a refused write announces nothing");
assert.equal(source.getAlerts().done, true, "the switch rolls back to what the store still says");
assert.equal(alertToggles[0].attrs["aria-checked"], "true", "and the paint follows the rollback");
assert.equal(localStorage.getItem("dsh-session-top-new.alert.done"), "1");
// The accessor hands out a copy: poking it must not move the source of truth.
const borrowed = source.getAlerts();
borrowed.done = false;
assert.equal(source.getAlerts().done, true, "getAlerts returns a copy");
assert.equal(source.getSnapshot().unreadCount, 1);
localStorage.setItem("dsh-session-top-new.days", "7");
window.dispatchEvent({ type: "dsh-session-top-new:days" });
assert.equal(source.getSnapshot().items.some((it) => it.id === "old"), true, "bell follows dock day setting");
dockState = { items: [], current: null };
listeners.forEach((fn) => fn());
source.setOpen(true);
assert.equal(scroll.textContent, "还没有活动 / No activity yet");
// The session on screen cannot be unread — you are looking at it — and the rest
// must be clearable in one go, or Unread is a group you can never empty.
dockState = { items: [
	{ id: "watched", title: "Watched", unread: true, updatedAt: Date.now() },
	{ id: "other", title: "Other", unread: true, updatedAt: Date.now() }
], current: "watched" };
listeners.forEach((fn) => fn());
let snap = source.getSnapshot();
assert.equal(snap.items.find((it) => it.id === "watched").unread, false, "the session on screen counts as read");
assert.equal(snap.items.find((it) => it.id === "other").unread, true, "the one you are not looking at stays unread");
assert.equal(snap.unreadCount, 1, "only the unseen session nudges");
assert.equal(scroll.querySelectorAll(".dsb-flagged").length, 1, "the unseen row is flagged in place");
const clearBtn = root.querySelector("[data-clear-unread]");
assert.ok(clearBtn, "the header carries a mark-all-read control");
assert.equal(clearBtn.textContent, "全部已读");
assert.notEqual(headClear.hidden, true, "the control is there while something is unread");
root.dispatchEvent({ type: "click", target: clearBtn });
snap = source.getSnapshot();
assert.equal(snap.unreadCount, 0, "one click clears every unread row");
assert.equal(snap.items.every((it) => it.unread === false), true);
assert.equal(scroll.querySelectorAll(".dsb-flagged").length, 0, "the flag leaves with the row state");
assert.equal(anchor.button.querySelector(".dsb-badge").textContent, "0", "the badge empties with it");
assert.equal(headClear.hidden, true, "and the header control leaves with the last unread row");
// Marking read is not marking answered: a row waiting on a choice keeps asking.
dockState = { items: [
	{ id: "finished", title: "Finished", unread: true, updatedAt: Date.now() },
	{ id: "ask", title: "Ask", pending: true, updatedAt: Date.now() }
], current: null };
listeners.forEach((fn) => fn());
assert.equal(source.getSnapshot().unreadCount, 2);
const clearAgain = root.querySelector("[data-clear-unread]");
assert.ok(clearAgain);
root.dispatchEvent({ type: "click", target: clearAgain });
snap = source.getSnapshot();
assert.equal(snap.items.find((it) => it.id === "finished").unread, false, "the finished row goes quiet");
assert.equal(snap.items.find((it) => it.id === "ask").pending, true, "the pending row is untouched");
assert.equal(snap.unreadCount, 1, "a row that still needs an answer keeps nudging");
assert.ok(root.querySelector("[data-clear-unread]"), "and its group header stays");
// The badge wears the colour of the row it is counting, and clicking it clears
// the number: the count is the thing you are looking at, so it is the thing you
// can dismiss without opening two sessions to empty it.
dockState = { items: [
	{ id: "alpha", title: "Alpha", unread: true, updatedAt: Date.now() + 2000 },
	{ id: "beta", title: "Beta", unread: true, updatedAt: Date.now() }
], current: null };
listeners.forEach((fn) => fn());
const badgeEl = anchor.button.querySelector(".dsb-badge");
const striped = scroll.querySelectorAll(".dsb-stripe");
assert.equal(striped.length, 2, "every unread row carries a colour stripe");
assert.equal(striped[0].style["--dsb-accent"], badgeEl.style.background, "the badge borrows the newest row's colour");
assert.notEqual(striped[0].style["--dsb-accent"], striped[1].style["--dsb-accent"], "different sessions get different hues");
assert.match(anchor.button.title, /Alpha/, "the title names the session behind the number");
// The badge is a readout, not a button: clicking the bell opens the panel and
// clearing stays an explicit action in the header.
assert.equal(badgeEl.listeners.get("click"), undefined, "clicking the badge does not clear anything");
// Being read belongs to one version of a session: a run that bumps updatedAt is
// unread again, so clicking through rows cannot silence a conversation for the
// rest of the tab.
assert.equal(source.markAllSeen(), true, "clearing everything records both rows");
listeners.forEach((fn) => fn());
assert.equal(source.getSnapshot().unreadCount, 0);
dockState = { items: [
	{ id: "alpha", title: "Alpha", unread: true, updatedAt: Date.now() + 9000 }
], current: null };
listeners.forEach((fn) => fn());
assert.equal(source.getSnapshot().unreadCount, 1, "a new version of a read session is unread again");
assert.equal(scroll.querySelectorAll(".dsb-stripe").length, 1, "and it gets its stripe back");
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
	getSnapshot: () => ({ late: { running: true, completionUnread: true } }),
	subscribe(fn) { statusListener = fn; statusSubscriptions++; return () => statusUnsubscribed++; }
} };
serviceEvents.forEach((fn) => fn("uiSession"));
serviceEvents.forEach((fn) => fn("sessions"));
assert.equal(listSubscriptions, 1);
assert.equal(statusSubscriptions, 1);
statusListener();
const dockProps = registrations.get("dsh-session-top-new").options.inject();
assert.equal(dockProps.clearUnread, undefined, "the dock badge is not wired to clear the count");
const shared = dockProps.hooks.dock;
const bell = registrations.get("dsh-session-top-new-bell").options.inject().source;
assert.equal(shared.getSnapshot().items[0].running, true);
assert.equal(bell.getSnapshot().runningCount, 1);
assert.equal(bell.getSnapshot().items[0].title, "Late service");
// Background jobs: the client `jobs` service is optional, mounts late, and only
// streams rows for sessions someone watches — the plugin mirrors what it renders.
let jobRows = {};
const jobWatches = new Map();
let jobSubscriptions = 0;
let jobListener = null;
services.jobs = {
	state: {
		getSnapshot: () => ({ rows: jobRows }),
		subscribe(fn) { jobSubscriptions++; jobListener = fn; return () => { jobSubscriptions--; jobListener = null; }; }
	},
	watchRows(id) {
		jobWatches.set(id, (jobWatches.get(id) || 0) + 1);
		return () => jobWatches.set(id, (jobWatches.get(id) || 1) - 1);
	}
};
serviceEvents.forEach((fn) => fn("jobs"));
assert.equal(jobSubscriptions, 1, "the jobs snapshot is subscribed once");
assert.equal(jobWatches.get("late"), 1, "a rendered session opens one job watch");
jobRows = { late: [{ id: "j1", status: "running" }, { id: "j2", status: "stopping" }, { id: "j3", status: "completed" }] };
jobListener();
assert.equal(shared.getSnapshot().items[0].jobs, 2, "running and stopping count, finished jobs do not");
assert.equal(bell.getSnapshot().items[0].jobs, 2, "the bell reads the same number");
jobRows = {};
jobListener();
assert.equal(shared.getSnapshot().items[0].jobs, 0, "clearing every job drops the marker");
// One clear, both surfaces: the bell's header control writes the shared set, and
// the dock snapshot the dock badge counts from follows it.
assert.equal(bell.getSnapshot().unreadCount, 1, "the late session starts unread");
assert.equal(shared.getSnapshot().items[0].unread, true);
bell.markAllSeen();
assert.equal(shared.getSnapshot().items[0].unread, false, "the dock side sees the bell's clear");
assert.equal(bell.getSnapshot().unreadCount, 0, "and the bell counts the same cleared set");
let opened;
let started = 0;
services.uiWorkspace = { openSession(id) { opened = id; }, startSession() { started++; } };
bell.openSession("late");
assert.equal(opened, "late", "bell jumps via uiWorkspace.openSession");
// Ctrl+M: New Session in the default (current, else most recent) workspace.
const ctrlM = { type: "keydown", key: "m", ctrlKey: true };
ctrlM.preventDefault = () => { ctrlM.prevented = true; };
document.dispatchEvent(ctrlM);
assert.equal(started, 1, "Ctrl+M starts a session in the default workspace");
assert.equal(ctrlM.prevented, true, "the shortcut swallows the browser default");
document.dispatchEvent({ type: "keydown", key: "M", ctrlKey: true, shiftKey: true, preventDefault() {} });
assert.equal(started, 1, "Ctrl+Shift+M is not the shortcut");
document.dispatchEvent({ type: "keydown", key: "m" });
assert.equal(started, 1, "a bare m is left to the page");
const composer = new Element("textarea");
const inField = { type: "keydown", key: "m", ctrlKey: true, target: composer };
inField.preventDefault = () => { inField.prevented = true; };
document.dispatchEvent(inField);
assert.equal(started, 1, "a focused composer keeps Ctrl+M");
assert.notEqual(inField.prevented, true, "the composer handles its own key");
effectDisposers.reverse().forEach((fn) => fn());
assert.equal(registrations.size, 0);
assert.equal(serviceEvents.size, 0);
assert.equal(listUnsubscribed, 1);
assert.equal(statusUnsubscribed, 1);
assert.equal(jobSubscriptions, 0, "disposing the plugin unsubscribes from the jobs service");
assert.equal(jobWatches.get("late"), 0, "and releases the per-session job watch");
assert.equal(frames.size, 0);
document.dispatchEvent({ type: "keydown", key: "m", ctrlKey: true, preventDefault() {} });
assert.equal(started, 1, "disposing the plugin unbinds the shortcut");
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

console.log("PASS: shared stable source; 500-mutation fast path and coalescing; no mutation layout; direct header seat; lazy persistent panel; groups and children; Escape/outside; flip; rail; collapsed startup/expand; direct badge updates; day window; empty state; navigation; late services; one subscription per service; complete plugin disposal; Ctrl+M new session; badge colour; unread per version; background job pill; dock badge stays a readout; inverted auto theme; gear picker; persisted mode");

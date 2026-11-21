/**
 * dsh-session-top-new — client bundle.
 *
 * A floating right-side session dock for the DeepSeek Harness Web GUI:
 *   1. Collapses to a round button; expands to show sessions from the last N
 *      days (default: today only, N configurable via a small popover).
 *   2. Live markers: "running" sessions show a pulsing dot; sessions with a
 *      pending interaction (unviewed result) show a badge. Clicking a session
 *      jumps straight to it.
 *   3. Plays a synthesized sound (Web Audio) when a session finishes (running
 *      -> completed / idle transition), with a mute toggle.
 *
 * Architecture (mirrors dsh-chat-pet):
 *   - Mounts into the `shell.overlay` list slot (root scope), so it floats
 *     above the whole app regardless of session/panel.
 *   - Reads the `sessions` client service via ctx.reflect.get("sessions"):
 *       sessions.list           -> observable snapshot store
 *         snapshot.ids          -> ordered session ids
 *         snapshot.byId[id]     -> { id, displayTitle, running, completed,
 *                                    blank, updatedAt, pendingInteraction, ... }
 *         snapshot.current      -> current session id
 *       sessions.open(id)       -> switch/jump to a session
 *   - The source exposes one inject-face Observable, `dock`, and the widget
 *     consumes it through a useSyncExternalStore-style selector hook.
 *
 * Hand-written in the __ModuleLoader__ factory format: the only host-provided
 * require is `react`; everything else is inline.
 */
/**
 * 中文速览 — 这个文件是插件的全部界面逻辑，手写 __ModuleLoader__ bundle，没有构建步骤。
 *   悬浮条和侧栏铃铛共用一份快照：dock 订阅 sessions.list + uiSession.sessionStatus，
 *   抽成一堆标量交给两个界面；铃铛只从快照算分组和计数，自己不再订阅宿主服务。
 *   活动列表按自然日分桶：今天 / 昨天 / 一周内星期名 / 更早 MM-DD（跨年带年份）；
 *   铃铛角标是未读数，超过 99 显示 99+. 点开会话即移出未读，不必等宿主清标记。
 *   改样式注意：面板基态 opacity:0/visibility:hidden，靠 class dsb-in 才显示；
 *   CSS 里少一个空格会静默失效，改完要肉眼看一眼。
 *   文件三千多行，改之前先按小节注释（Dock source / Bell / Styles …）搜位置，别整篇通读。
 *   改完跑 `node --check lib/client.js` 与 `node tests/bell.cjs`。
 */

window.__ModuleLoader__.load({
	id: "dsh-session-top-new",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const React = require("react");

		// ------------------------------------------------------------------
		// Small utils
		// ------------------------------------------------------------------

		const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

		/** Log a diagnostic at most once per message, so a broken path cannot spam. */
		const warned = new Set();
		function warnOnce(message, error) {
			if (warned.has(message)) return;
			warned.add(message);
			try {
				console.warn("[dsh-session-top-new] " + message, error ?? "");
			} catch {}
		}

		// ------------------------------------------------------------------
		// Icons — inline SVG, never emoji
		//
		// Emoji glyphs (🗂 ✕ 🔔 …) depend on a colour-emoji font being present in
		// the Electron font stack; when it is missing the glyph falls back to a
		// blank/odd silhouette (a white blob inside the round button). SVG keeps
		// the shapes exact and lets them inherit `currentColor`.
		// ------------------------------------------------------------------

		const SVG_PROPS = {
			viewBox: "0 0 24 24",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 2,
			strokeLinecap: "round",
			strokeLinejoin: "round",
			"aria-hidden": "true",
			focusable: "false",
			style: { display: "block", flex: "none" }
		};

		/** Wrap icon children in a sized <svg>. */
		function svgIcon(size, children) {
			return React.createElement(
				"svg",
				Object.assign({ width: size, height: size }, SVG_PROPS),
				children
			);
		}

		/** Dock glyph. The list icon and the close icon are the same three
		 *  strokes in two poses: the outer two swing from the rows (y 6/12/18)
		 *  onto the diagonals, the middle one lands on top of the first, so
		 *  three rows read as a two-stroke ✕ and back. One <svg> stays mounted
		 *  and CSS interpolates the strokes, so the button never swaps icons. */
		function iconDock(size, open) {
			const stroke = (key, cls) =>
				React.createElement("line", {
					key,
					className: "dsd-stroke " + cls,
					x1: 3.5,
					y1: 12,
					x2: 20.5,
					y2: 12
				});
			return React.createElement(
				"svg",
				Object.assign(
					{ width: size, height: size, className: "dsd-glyph", "data-open": open ? "true" : "false" },
					SVG_PROPS
				),
				[stroke("g1", "g1"), stroke("g2", "g2"), stroke("g3", "g3")]
			);
		}

		/** Close (X). */
		function iconClose(size) {
			return svgIcon(size, [
				React.createElement("line", { key: "a", x1: 6, y1: 6, x2: 18, y2: 18 }),
				React.createElement("line", { key: "b", x1: 18, y1: 6, x2: 6, y2: 18 })
			]);
		}

		/** Bell, with a slash when muted. */
		function iconBell(size, muted) {
			const parts = [
				React.createElement("path", { key: "b", d: "M6.5 9a5.5 5.5 0 0 1 11 0c0 4.2 1.6 5.6 2.2 6.4H4.3c.6-.8 2.2-2.2 2.2-6.4z" }),
				React.createElement("path", { key: "c", d: "M10 19.2a2.1 2.1 0 0 0 4 0" })
			];
			if (muted) parts.push(React.createElement("line", { key: "m", x1: 4.5, y1: 19.5, x2: 19.5, y2: 4.5 }));
			return svgIcon(size, parts);
		}

		/**
		 * Gear: a real cog silhouette (eight teeth on a ring plus a hub). Radial
		 * ticks alone read as a sun at 15px, which is the wrong affordance.
		 */
		function iconGear(size) {
			const round = (v) => Math.round(v * 100) / 100;
			const teeth = 8, outer = 8.9, inner = 6.7, pitch = (Math.PI * 2) / teeth;
			const half = pitch * 0.30;
			const at = (r, a) => round(12 + Math.cos(a) * r) + " " + round(12 + Math.sin(a) * r);
			let d = "";
			for (let i = 0; i < teeth; i++) {
				const base = i * pitch + pitch / 2;
				const pts = [
					[inner, base - pitch / 2], [inner, base - half * 1.5], [outer, base - half * 0.55],
					[outer, base + half * 0.55], [inner, base + half * 1.5], [inner, base + pitch / 2]
				];
				for (const [r, a] of pts) d += (d ? " L" : "M") + at(r, a);
			}
			return svgIcon(size, [
				React.createElement("path", { key: "cog", d: d + " Z" }),
				React.createElement("circle", { key: "hub", cx: 12, cy: 12, r: 3.15 })
			]);
		}

		/**
		 * Disclosure arrow, the same filled triangle DSH's own tree rows use
		 * (IconTriangleRightFillRegular, 16-unit artboard). Rotation lives in CSS so
		 * opening animates instead of swapping one glyph for another.
		 */
		const TRIANGLE_PATH = "M5.5 4.5C5.5 4.40714 5.52586 4.31612 5.57467 4.23713C5.62349 4.15815 5.69334 4.09431 5.77639 4.05279C5.85945 4.01126 5.95242 3.99368 6.0449 4.00202C6.13738 4.01036 6.22572 4.04429 6.3 4.1L10.967 7.6C11.0291 7.64657 11.0795 7.70697 11.1142 7.77639C11.1489 7.84582 11.167 7.92238 11.167 8C11.167 8.07762 11.1489 8.15418 11.1142 8.22361C11.0795 8.29303 11.0291 8.35343 10.967 8.4L6.3 11.9C6.22572 11.9557 6.13738 11.9896 6.0449 11.998C5.95242 12.0063 5.85945 11.9887 5.77639 11.9472C5.69334 11.9057 5.62349 11.8419 5.57467 11.7629C5.52586 11.6839 5.5 11.5929 5.5 11.5V4.5Z";

		function iconTriangle(size, className, open) {
			return React.createElement(
				"svg",
				{
					width: size,
					height: size,
					viewBox: "0 0 16 16",
					fill: "none",
					className: className ? (className + (open ? " open" : "")) : undefined,
					"aria-hidden": "true"
				},
				React.createElement("path", { d: TRIANGLE_PATH, fill: "currentColor" })
			);
		}

		/**
		 * The host's StateDot: a 10px slot painting one 6px core in the state
		 * colour, and — for a live session — a 14px rotating ring instead of a dot.
		 * `ongoing` is the only state that is not a dot, which is why our old
		 * pulsing green "running" dot never matched the sidebar it sat next to.
		 */
		function stateDot(state) {
			if (state === "ongoing") return spinnerRing();
			return React.createElement("span", { className: "dsd-state", "data-state": state, "aria-hidden": "true" });
		}

		function spinnerRing() {
			return React.createElement(
				"svg",
				{ className: "dsd-spin", width: 14, height: 14, viewBox: "0 0 24 24", "aria-hidden": "true" },
				React.createElement(
					"g",
					{ className: "dsd-spin-motion" },
					React.createElement("circle", { className: "dsd-spin-track", cx: 12, cy: 12, r: 9.5 }),
					React.createElement("circle", { className: "dsd-spin-arc", cx: 12, cy: 12, r: 9.5 })
				)
			);
		}

		/** DOM twins, for the bell's hand-built rows (it renders outside React). */
		function domTriangle(open) {
			const ns = "http://www.w3.org/2000/svg";
			const svg = document.createElementNS(ns, "svg");
			for (const [k, v] of [["width", "14"], ["height", "14"], ["viewBox", "0 0 16 16"], ["fill", "none"]]) {
				svg.setAttribute(k, v);
			}
			svg.setAttribute("class", "dsb-arrow" + (open ? " open" : ""));
			svg.setAttribute("aria-hidden", "true");
			const path = document.createElementNS(ns, "path");
			path.setAttribute("d", TRIANGLE_PATH);
			path.setAttribute("fill", "currentColor");
			svg.append(path);
			return svg;
		}

		function domStateDot(state) {
			if (state !== "ongoing") {
				const dot = document.createElement("span");
				dot.className = "dsb-state";
				dot.dataset.state = state;
				dot.setAttribute("aria-hidden", "true");
				return dot;
			}
			const ns = "http://www.w3.org/2000/svg";
			const svg = document.createElementNS(ns, "svg");
			for (const [k, v] of [["width", "14"], ["height", "14"], ["viewBox", "0 0 24 24"]]) {
				svg.setAttribute(k, v);
			}
			svg.setAttribute("class", "dsb-spin");
			svg.setAttribute("aria-hidden", "true");
			const g = document.createElementNS(ns, "g");
			g.setAttribute("class", "dsb-spin-motion");
			for (const cls of ["dsb-spin-track", "dsb-spin-arc"]) {
				const c = document.createElementNS(ns, "circle");
				c.setAttribute("class", cls);
				c.setAttribute("cx", "12");
				c.setAttribute("cy", "12");
				c.setAttribute("r", "9.5");
				g.append(c);
			}
			svg.append(g);
			return svg;
		}

		/** Row state, in the host's precedence: pending interaction, live work, unseen result, idle. */
		function rowState(row) {
			if (row.pending) return "warning";
			if (row.running) return "ongoing";
			if (row.unread) return "done";
			return "idle";
		}

		/** Bookmark: outlined while unsaved, filled once saved. */
		function iconBookmark(size, filled) {
			return React.createElement(
				"svg",
				Object.assign({ width: size, height: size }, SVG_PROPS, {
					fill: filled ? "currentColor" : "none"
				}),
				React.createElement("path", {
					d: "M6 3h12a1 1 0 0 1 1 1v16.2l-7-3.9-7 3.9V4a1 1 0 0 1 1-1z"
				})
			);
		}

		function dayStart(ts) {
			const d = new Date(ts);
			d.setHours(0, 0, 0, 0);
			return d.getTime();
		}

		/** Relative-ish short time label for a session (HH:mm today, else M/D). */
		function timeLabel(ts) {
			if (!ts) return "";
			const d = new Date(ts);
			const now = new Date();
			const sameDay = dayStart(d.getTime()) === dayStart(now.getTime());
			if (sameDay) {
				const hh = String(d.getHours()).padStart(2, "0");
				const mm = String(d.getMinutes()).padStart(2, "0");
				return hh + ":" + mm;
			}
			return (d.getMonth() + 1) + "/" + d.getDate();
		}

		/** The project folder a session belongs to, when the host exposes it. */
		function folderNameOf(s) {
			const raw = typeof s.cwd === "string" ? s.cwd
				: typeof s.workspacePath === "string" ? s.workspacePath
					: typeof s.folder === "string" ? s.folder
						: (s.workspace && typeof s.workspace.path === "string" ? s.workspace.path : "");
			if (!raw) return "";
			const parts = String(raw).split(/[\\/]+/).filter(Boolean);
			return parts.length ? parts[parts.length - 1] : "";
		}

		const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

		/**
		 * Day bucket for the recent-activity list: today, yesterday, a weekday name
		 * inside the last week, then a plain date. Buckets are what make the list
		 * readable once it stops being grouped by project.
		 */
		function dayLabel(ts) {
			const d = new Date(ts);
			const today = dayStart(Date.now());
			const day = dayStart(d.getTime());
			const diff = Math.round((today - day) / 86400000);
			if (diff === 0) return "今天";
			if (diff === 1) return "昨天";
			if (diff > 1 && diff < 7) return WEEKDAYS[d.getDay()];
			const m = String(d.getMonth() + 1).padStart(2, "0");
			const dd = String(d.getDate()).padStart(2, "0");
			return d.getFullYear() === new Date().getFullYear() ? m + "-" + dd : d.getFullYear() + "-" + m + "-" + dd;
		}

		// ------------------------------------------------------------------
		// Dock source (observable snapshot of sessions.list)
		// ------------------------------------------------------------------

		/**
		 * Read one Session's status row from the `uiSession.sessionStatus` source
		 * (a Map of sessionId -> { running, pendingInteraction, completionUnread }).
		 * Returns null when that service is unavailable (older builds).
		 */
		function statusOf(uiSession, id) {
			if (!uiSession) return null;
			try {
				const snap = uiSession.sessionStatus?.getSnapshot?.();
				if (!snap) return null;
				const row = typeof snap.get === "function" ? snap.get(id) : snap[id];
				return row || null;
			} catch {
				return null;
			}
		}

		function buildSnapshot(sessions, uiSession) {
			if (!sessions) return null;
			let list;
			try {
				list = sessions.list.getSnapshot();
			} catch {
				return null;
			}
			if (!list) return null;
			const ids = Array.isArray(list.ids) ? list.ids : [];
			const byId = list.byId || {};
			// Older builds exposed the selection as `list.current`; the current
			// Session Controller projects it through `byId[id].retainedBy.mainView`.
			let current = typeof list.current === "string" ? list.current : null;
			// Extract only the leaf fields we render (do not copy live objects).
			const items = [];
			for (const id of ids) {
				const s = byId[id];
				if (!s) continue;
				const retained = s.retainedBy || {};
				const isMain = (retained.mainView ?? 0) > 0;
				if (isMain) current = id;
				const st = statusOf(uiSession, id);
				const running = st && st.running !== undefined && st.running !== null
					? Boolean(st.running)
					: Boolean(s.running);
				const pendingRaw = st && st.pendingInteraction !== undefined ? st.pendingInteraction : s.pendingInteraction;
				items.push({
					id: id,
					title: typeof s.displayTitle === "string" ? s.displayTitle : (typeof s.title === "string" ? s.title : id),
					running: running,
					completed: Boolean(s.completed),
					blank: Boolean(s.blank),
					updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : 0,
					pending: pendingRaw !== undefined && pendingRaw !== false && pendingRaw !== null,
					unread: st ? Boolean(st.completionUnread) : false,
					isMain: isMain,
					parentId: typeof s.parentId === "string" ? s.parentId : null,
					isSubagent: s.origin === "subagent" || s.parentId !== undefined,
					folder: folderNameOf(s)
				});
			}
			items.sort((a, b) => b.updatedAt - a.updatedAt);
			// The retained main view can sit outside `ids` (e.g. a session kept
			// alive only by its retention); fall back to scanning byId.
			if (current === null) {
				for (const id of Object.keys(byId)) {
					const s = byId[id];
					if (s && (s.retainedBy?.mainView ?? 0) > 0) {
						current = id;
						break;
					}
				}
			}
			return { items, current: current };
		}

		function snapshotsEqual(a, b) {
			if (a === b) return true;
			if (!a || !b) return false;
			if (a.current !== b.current) return false;
			if (a.items.length !== b.items.length) return false;
			for (let i = 0; i < a.items.length; i++) {
				const x = a.items[i];
				const y = b.items[i];
				if (x.id !== y.id || x.running !== y.running || x.completed !== y.completed ||
					x.pending !== y.pending || x.unread !== y.unread || x.isMain !== y.isMain ||
					x.updatedAt !== y.updatedAt || x.title !== y.title ||
					x.parentId !== y.parentId || x.isSubagent !== y.isSubagent) {
					return false;
				}
			}
			return true;
		}

		function createDockSource(ctx) {
			const listeners = new Set();
			let state = null;
			let sessions = null;
			let uiSession = null;
			let unsubList = null;
			let unsubStatus = null;
			let listBound = false;
			let statusBound = false;
			let disposed = false;

			const readServices = () => {
				if (!sessions) sessions = ctxRef("sessions") || undefined;
				if (!uiSession) uiSession = ctxRef("uiSession") || undefined;
			};

			const emit = () => {
				if (disposed) return;
				// uiSession may mount after sessions; pick it up on a later emit.
				if (!uiSession) { readServices(); bindStatus(); }
				const next = buildSnapshot(sessions, uiSession);
				if (!snapshotsEqual(next, state)) state = next;
				for (const fn of [...listeners]) fn();
			};

			const bindStatus = () => {
				if (statusBound || !uiSession) return;
				try {
					const src = uiSession.sessionStatus;
					if (src && typeof src.subscribe === "function") {
						statusBound = true;
						unsubStatus = src.subscribe(emit);
					}
				} catch {
					statusBound = false;
					unsubStatus = null;
				}
			};

			const init = () => {
				if (disposed) return;
				readServices();
				if (!listBound && typeof sessions?.list?.subscribe === "function") {
					listBound = true;
					unsubList = sessions.list.subscribe(emit);
				}
				bindStatus();
				emit();
			};

			// Late services: react to declared client events only. `connection/reset`
			// fires once a connection generation is up and `slots/changed` fires when
			// a slot registration set moves, so a service that mounts after this
			// plugin still gets bound without any timer. `ctx.on` is capability
			// gated, so a build without it simply keeps the boot-time binding.
			const listen = (event) => {
				if (typeof ctx.on !== "function") return null;
				try {
					return ctx.on(event, () => init()) || null;
				} catch {
					return null;
				}
			};
			const unsubReset = listen("connection/reset");
			const unsubChanged = listen("slots/changed");
			init();

			return {
				subscribe(fn) {
					listeners.add(fn);
					if (listeners.size === 1 && state === null && sessions) emit();
					return () => {
						listeners.delete(fn);
					};
				},
				getSnapshot() {
					if (state === null) state = buildSnapshot(sessions, uiSession);
					return state;
				},
				dispose() {
					disposed = true;
					if (typeof unsubReset === "function") unsubReset();
				if (typeof unsubChanged === "function") unsubChanged();
					if (typeof unsubList === "function") unsubList();
					if (typeof unsubStatus === "function") unsubStatus();
					listeners.clear();
				}
			};
		}

		// ------------------------------------------------------------------
		// Sound (Web Audio synthesized beep)
		// ------------------------------------------------------------------

		let audioCtx = null;
		function ensureAudioCtx() {
			if (!audioCtx) {
				const AC = window.AudioContext || window.webkitAudioContext;
				if (!AC) return null;
				audioCtx = new AC();
			}
			if (audioCtx.state === "suspended") {
				try { audioCtx.resume(); } catch {}
			}
			return audioCtx;
		}

		/** A short two-tone chime: pleasant but noticeable. */
		function playChime() {
			const ctx = ensureAudioCtx();
			if (!ctx) return;
			const now = ctx.currentTime;
			const notes = [
				{ f: 880, t: 0.00, d: 0.16 },
				{ f: 1174.66, t: 0.14, d: 0.22 }
			];
			for (const n of notes) {
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				osc.type = "sine";
				osc.frequency.value = n.f;
				gain.gain.setValueAtTime(0.0001, now + n.t);
				gain.gain.exponentialRampToValueAtTime(0.28, now + n.t + 0.02);
				gain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);
				osc.connect(gain);
				gain.connect(ctx.destination);
				osc.start(now + n.t);
				osc.stop(now + n.t + n.d + 0.05);
			}
		}

		// ------------------------------------------------------------------
		// Styles
		// ------------------------------------------------------------------

		const STYLE_ID = "dsh-session-top-new-styles";
		function ensureStyles() {
			if (document.getElementById(STYLE_ID)) return;
			const style = document.createElement("style");
			style.id = STYLE_ID;
			style.textContent = `
				/* ── Theme ────────────────────────────────────────────────────────
				   Both surfaces own their palette. data-dsb-theme is written by the
				   theme source: auto resolves to the INVERSE of the page (a dark
				   page gets light chrome) so the floating panel never blends into
				   whatever sits behind it, and 浅色 / 深色 pin it either way. */
				.dsd-root, .dsd-root[data-dsb-theme="dark"] {
					position: absolute;
					z-index: 2147482900;
					display: flex;
					flex-direction: column;
					align-items: flex-end;
					pointer-events: auto;
					font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
					/* light page -> dark dock */
					--dsd-surface: rgba(24, 24, 29, 0.95);
					--dsd-label: #f4f4f5;
					--dsd-label-dim: #a1a1aa;
					--dsd-label-faint: #71717a;
					--dsd-border: rgba(255, 255, 255, 0.09);
					--dsd-divider: rgba(255, 255, 255, 0.14);
					--dsd-hover: rgba(255, 255, 255, 0.07);
					--dsd-hover-strong: rgba(255, 255, 255, 0.12);
					--dsd-active: rgba(255, 255, 255, 0.10);
					--dsd-field-bg: rgba(255, 255, 255, 0.08);
					--dsd-field-border: rgba(255, 255, 255, 0.15);
					--dsd-scrollbar: rgba(255, 255, 255, 0.14);
					--dsd-ring: 0 0 0 0.5px rgba(255, 255, 255, 0.10);
					--dsd-btn-shadow: 0 8px 24px rgba(0, 0, 0, 0.38);
					--dsd-panel-shadow: 0 12px 36px rgba(0, 0, 0, 0.42);
					--dsd-state-done: #22c55e;
					--dsd-state-warn: #f59e0b;
				}
				/* dark page -> light dock */
				.dsd-root[data-dsb-theme="light"] {
					--dsd-surface: rgba(250, 250, 251, 0.97);
					--dsd-label: #18181d;
					--dsd-label-dim: #52525b;
					--dsd-label-faint: #71717a;
					--dsd-border: rgba(0, 0, 0, 0.08);
					--dsd-divider: rgba(0, 0, 0, 0.12);
					--dsd-hover: rgba(0, 0, 0, 0.05);
					--dsd-hover-strong: rgba(0, 0, 0, 0.09);
					--dsd-active: rgba(0, 0, 0, 0.07);
					--dsd-field-bg: rgba(0, 0, 0, 0.04);
					--dsd-field-border: rgba(0, 0, 0, 0.12);
					--dsd-scrollbar: rgba(0, 0, 0, 0.16);
					--dsd-ring: 0 0 0 0.5px rgba(0, 0, 0, 0.10);
					--dsd-btn-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
					--dsd-panel-shadow: 0 12px 36px rgba(0, 0, 0, 0.18);
					--dsd-state-done: #16a34a;
					--dsd-state-warn: #d97706;
				}
				.dsd-btn { cursor: grab; }
				.dsd-btn.dragging { cursor: grabbing; }
				.dsd-btn {
					width: 46px;
					height: 46px;
					border-radius: 50%;
					border: none;
					cursor: pointer;
					background: var(--dsd-surface);
					color: var(--dsd-label);
					font-size: 20px;
					line-height: 1;
					display: flex;
					align-items: center;
					justify-content: center;
					box-shadow: var(--dsd-ring), var(--dsd-btn-shadow);
					transition: transform 0.12s ease, background 0.12s ease;
					position: relative;
				}
				.dsd-btn:hover { transform: scale(1.08); }
				.dsd-btn:active { transform: scale(0.94); }
				/* One glyph, two poses. Every stroke keeps the same transform
				   function list in both states (translateY → rotate → scaleX), so
				   the browser interpolates each part instead of decomposing a
				   matrix and drifting through a skew on the way. */
				.dsd-glyph .dsd-stroke {
					transform-box: view-box;
					transform-origin: 12px 12px;
					/* Not the panel's 260ms ease-out: that curve spends its travel
					   in the first third, which is right for a whole panel-width and
					   wrong for a 20px glyph — the strokes would arrive before the
					   eye catches them. A morph in place wants to leave and land
					   evenly, so the middle of the timeline is the middle of the pose. */
					transition: transform 240ms cubic-bezier(0.45, 0, 0.55, 1);
				}
				/* list: three twelve-unit rows on y = 6 / 12 / 18 */
				.dsd-glyph .g1 { transform: translateY(-6px) rotate(0deg) scaleX(0.7059); }
				.dsd-glyph .g2 { transform: translateY(0px) rotate(0deg) scaleX(0.7059); }
				.dsd-glyph .g3 { transform: translateY(6px) rotate(0deg) scaleX(0.7059); }
				/* close: strokes span 6,6 → 18,18 once they are on the diagonals */
				.dsd-glyph[data-open="true"] .g1 { transform: translateY(0px) rotate(45deg) scaleX(1); }
				.dsd-glyph[data-open="true"] .g2 { transform: translateY(0px) rotate(45deg) scaleX(1); }
				.dsd-glyph[data-open="true"] .g3 { transform: translateY(0px) rotate(-45deg) scaleX(1); }
				.dsd-btn .dsd-badge {
					position: absolute;
					top: -4px;
					right: -4px;
					min-width: 18px;
					height: 18px;
					padding: 0 5px;
					border-radius: 9px;
					background: #ef4444;
					color: #fff;
					font-size: 11px;
					font-weight: 700;
					line-height: 18px;
					text-align: center;
					box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
				}
				.dsd-panel {
					position: absolute;
					right: 0;
					top: calc(100% + 10px);
					width: 300px;
					max-height: 70vh;
					display: flex;
					flex-direction: column;
					background: var(--dsd-surface);
					color: var(--dsd-label);
					border-radius: 14px;
					box-shadow: var(--dsd-ring), var(--dsd-panel-shadow);
					overflow: hidden;
					opacity: 0;
					/* Two offsets compose here: --dsd-fx/--dsd-fy carry the residual
					   left over by the last re-anchor, --dsd-in-x is the entry slide
					   (mirrored, so a rightward panel grows out of the dock too). */
					--dsd-fx: 0px;
					--dsd-fy: 0px;
					--dsd-in-x: 8px;
					transform: translate3d(var(--dsd-fx), var(--dsd-fy), 0)
						translateX(var(--dsd-in-x)) scale(0.96);
					transform-origin: top right;
					pointer-events: none;
					transition: opacity 0.16s ease, transform 0.16s ease,
						background-color 220ms ease, color 220ms ease, box-shadow 220ms ease;
				}
				/* The panel swaps sides when the dock nears an app boundary, which
				   moves it a full panel-width in one frame. The residual offset is
				   applied with transitions off and released on the next style
				   flush, so the panel glides to its new anchor instead of
				   teleporting across the dock. */
				.dsd-panel.reanchor {
					will-change: transform;
					transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1),
						background-color 220ms ease, color 220ms ease, box-shadow 220ms ease;
				}
				.dsd-panel.show {
					opacity: 1;
					transform: translate3d(var(--dsd-fx), var(--dsd-fy), 0)
						translateX(0) scale(1);
					pointer-events: auto;
				}
				/* Open upward when the dock sits too low for a downward panel. */
				.dsd-panel.up {
					top: auto;
					bottom: calc(100% + 10px);
					transform-origin: bottom right;
				}
				/* Open rightward when the dock sits too far left for a 300px panel. */
				.dsd-panel.flipx { right: auto; left: 0; transform-origin: top left; --dsd-in-x: -8px; }
				.dsd-panel.up.flipx { transform-origin: bottom left; }
				.dsd-head {
					flex: none;
					padding: 12px 14px 10px;
					border-bottom: 1px solid var(--dsd-border);
					display: flex;
					align-items: center;
					justify-content: space-between;
					gap: 8px;
				}
				.dsd-title { font-size: 14px; font-weight: 600; color: var(--dsd-label); }
				.dsd-head-actions { display: flex; align-items: center; gap: 6px; }
				.dsd-iconbtn {
					background: none;
					border: none;
					color: var(--dsd-label-dim);
					cursor: pointer;
					line-height: 1;
					width: 28px;
					height: 28px;
					padding: 0;
					border-radius: 8px;
					display: inline-flex;
					align-items: center;
					justify-content: center;
					transition: color 140ms ease, background-color 140ms ease,
						transform 140ms cubic-bezier(0.2, 0.9, 0.3, 1);
				}
				.dsd-iconbtn:hover { color: var(--dsd-label); background: var(--dsd-field-bg); }
				.dsd-iconbtn:active { transform: scale(0.9); }
				.dsd-iconbtn:focus-visible { outline: 2px solid var(--dsd-label-faint); outline-offset: 1px; }
				.dsd-iconbtn svg { transition: transform 260ms cubic-bezier(0.22, 1.4, 0.36, 1); }
				.dsd-iconbtn[aria-expanded="true"] { color: var(--dsd-label); background: var(--dsd-field-bg); }
				.dsd-iconbtn[aria-expanded="true"] svg { transform: rotate(90deg); }

				/* The picker unfolds from a 0fr grid row, so the list below slides
				   instead of jumping, and closing animates back the same way. */
				/* flex: 0 0 auto is load-bearing, same trap as .dsb-settings below: the
				   panel is a column flexbox capped by max-height, so a shrinkable item
				   gets squeezed and the 0fr->1fr row clips the toggles out of sight. */
				.dsd-settings {
					flex: 0 0 auto;
					display: grid;
					grid-template-rows: 0fr;
					opacity: 0;
					padding: 0 12px;
					border-bottom: 1px solid transparent;
					overflow: hidden;
					/* Same trap as the activity picker: height 0 still leaves the buttons
					   tabbable, and aria-hidden alone does not take them out of the tab
					   order. visibility does, once the close transition has run. */
					visibility: hidden;
					pointer-events: none;
					transition: grid-template-rows 240ms cubic-bezier(0.22, 1, 0.36, 1),
						opacity 150ms ease, padding 240ms cubic-bezier(0.22, 1, 0.36, 1),
						border-color 200ms ease, visibility 0s linear 240ms;
				}
				.dsd-settings.show {
					grid-template-rows: 1fr;
					opacity: 1;
					padding: 10px 12px 12px;
					border-bottom-color: var(--dsd-border);
					visibility: visible;
					pointer-events: auto;
					transition-delay: 0s;
					/* Last resort for a very short window: the picker scrolls itself
					   rather than spilling out of the panel's rounded box. */
					max-height: min(52vh, 340px);
					overflow-y: auto;
					overflow-x: hidden;
				}
				.dsd-settings-inner { min-height: 0; display: flex; flex-direction: column; gap: 8px; }
				.dsd-settings-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
				.dsd-settings-label { font-size: 11px; letter-spacing: 0.02em; color: var(--dsd-label-faint); }
				.dsd-settings-now { font-size: 11px; color: var(--dsd-label-dim); }
				.dsd-settings-sw { align-items: center; }
				.dsd-toggle { position: relative; flex: 0 0 34px; width: 34px; height: 20px; padding: 0;
					box-sizing: border-box; border-radius: 999px; border: 1px solid transparent;
					background: rgba(128, 128, 128, 0.30); cursor: pointer;
					transition: background-color 180ms ease; }
				.dsd-toggle::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px;
					height: 14px; border-radius: 50%; background: var(--dsd-label-dim);
					box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
					transition: transform 220ms cubic-bezier(.22, 1, .36, 1), background-color 180ms ease; }
				.dsd-toggle[aria-checked="true"] { background: var(--dsd-label); }
				.dsd-toggle[aria-checked="true"]::after { transform: translateX(14px); background: var(--dsd-surface); }
				.dsd-toggle:active::after { transform: scale(.92); }
				.dsd-toggle[aria-checked="true"]:active::after { transform: translateX(14px) scale(.92); }
				.dsd-toggle:focus-visible { outline: 2px solid var(--dsd-label-dim); outline-offset: 2px; }

				/* Right-click menu on a session row: one action, so no icon column and
				   no separators to speak of. Painted above the panel it was opened on. */
				.dsd-menu {
					position: absolute;
					z-index: 30;
					min-width: 128px;
					padding: 4px;
					box-sizing: border-box;
					border-radius: 9px;
					border: 1px solid var(--dsd-border);
					background: var(--dsd-surface);
					box-shadow: 0 10px 26px rgba(0, 0, 0, 0.24), 0 1px 2px rgba(0, 0, 0, 0.18);
					animation: dsd-menu-in 120ms cubic-bezier(0.2, 0.9, 0.3, 1);
				}
				.dsd-menu-item {
					display: block;
					width: 100%;
					padding: 6px 10px;
					border: 0;
					border-radius: 6px;
					background: none;
					color: var(--dsd-label);
					font: inherit;
					font-size: 12px;
					line-height: 1.5;
					text-align: left;
					cursor: pointer;
					transition: background-color 120ms ease;
				}
				.dsd-menu-item:hover { background: var(--dsd-field-bg); }
				.dsd-menu-item:active { background: var(--dsd-hover-strong); }
				.dsd-menu-item:focus-visible { outline: 2px solid var(--dsd-label-faint); outline-offset: -2px; }
				@keyframes dsd-menu-in { from { opacity: 0; transform: scale(0.96); } }

				/* Segmented control: one thumb slides between the three modes. */
				.dsd-seg {
					position: relative;
					display: flex;
					padding: 3px;
					border-radius: 9px;
					background: var(--dsd-field-bg);
					border: 1px solid var(--dsd-border);
				}
				.dsd-seg::before {
					content: "";
					position: absolute;
					top: 2px;
					bottom: 2px;
					left: 2px;
					width: calc((100% - 4px) / 3);
					border-radius: 7px;
					background: var(--dsd-label);
					box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
					transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
				}
				.dsd-seg[data-mode="light"]::before { transform: translateX(100%); }
				.dsd-seg[data-mode="dark"]::before { transform: translateX(200%); }
				.dsd-seg button {
					position: relative;
					z-index: 1;
					flex: 1;
					padding: 4px 0;
					border: 0;
					border-radius: 7px;
					font: inherit;
					font-size: 12px;
					color: var(--dsd-label-dim);
					background: transparent;
					cursor: pointer;
					transition: color 180ms ease, transform 120ms ease;
				}
				.dsd-seg button:hover { color: var(--dsd-label); }
				.dsd-seg button:active { transform: scale(0.96); }
				.dsd-seg button.on { color: var(--dsd-surface); }
				.dsd-days { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--dsd-label-dim); }
				.dsd-days input {
					width: 40px;
					background: var(--dsd-field-bg);
					border: 1px solid var(--dsd-field-border);
					border-radius: 6px;
					color: var(--dsd-label);
					font-size: 12px;
					padding: 3px 6px;
					text-align: center;
					outline: none;
				}
				.dsd-list {
					flex: 1 1 auto;
					overflow-y: auto;
					padding: 2px 10px 10px;
				}
				.dsd-list::-webkit-scrollbar { width: 8px; }
				.dsd-list::-webkit-scrollbar-thumb { background: var(--dsd-scrollbar); border-radius: 4px; }
				.dsd-item {
					display: flex;
					align-items: center;
					gap: 8px;
					padding: 9px 8px;
					border-radius: 10px;
					cursor: pointer;
					transition: background 0.1s ease;
				}
				.dsd-item:hover { background: var(--dsd-hover); }
				.dsd-item.active { background: var(--dsd-active); }
				/* Host geometry: a 10px slot, one 6px core painted from currentColor. */
				.dsd-state {
					position: relative;
					display: inline-block;
					flex: none;
					width: 10px;
					height: 10px;
				}
				.dsd-state::after {
					content: "";
					position: absolute;
					inset: 20%;
					border-radius: 50%;
					background: currentColor;
				}
				.dsd-state[data-state="done"] { color: var(--dsd-state-done); }
				.dsd-state[data-state="warning"] { color: var(--dsd-state-warn); }
				.dsd-state[data-state="idle"] { color: var(--dsd-label-faint); }
				/* Live work is the one non-dot state: a quiet ring with a breathing arc. */
				.dsd-spin { flex: none; color: var(--dsd-label-faint); }
				.dsd-spin-motion { transform-origin: center; animation: dsd-spin-turn 1.5s linear infinite; }
				.dsd-spin-track, .dsd-spin-arc {
					fill: none;
					stroke: currentColor;
					stroke-width: 2;
					stroke-linecap: round;
				}
				.dsd-spin-track { opacity: 0.25; }
				.dsd-spin-arc { stroke-dasharray: 12 150; animation: dsd-spin-dash 1.5s ease-in-out infinite; }
				.dsd-chevron {
					flex: none;
					width: 16px;
					height: 16px;
					display: flex;
					align-items: center;
					justify-content: center;
					color: var(--dsd-label-faint);
					user-select: none;
					-webkit-user-select: none;
				}
				.dsd-arrow { color: var(--dsd-label-faint); transition: transform 150ms ease-in-out; }
				.dsd-arrow.open { transform: rotate(90deg); }
				.dsd-chevron-on { cursor: pointer; }
				.dsd-chevron-on:hover { color: var(--dsd-label); }
				.dsd-item.dsd-child {
					padding-left: 30px;
					padding-top: 6px;
					padding-bottom: 6px;
					font-size: 12px;
				}
				.dsd-item.dsd-child .dsd-item-title { color: var(--dsd-label-dim); }
				.dsd-item.dsd-child::before {
					content: "";
					flex: none;
					width: 1px;
					height: 14px;
					margin-right: 6px;
					background: var(--dsd-divider);
				}
				@keyframes dsd-spin-turn { to { transform: rotate(360deg); } }
				@keyframes dsd-spin-dash {
					0% { stroke-dasharray: 12 150; stroke-dashoffset: 0; }
					50% { stroke-dasharray: 24 150; stroke-dashoffset: -6; }
					100% { stroke-dasharray: 12 150; stroke-dashoffset: 0; }
				}
				@media (prefers-reduced-motion: reduce) {
					.dsd-spin-motion, .dsd-spin-arc { animation: none; }
					.dsd-spin-arc { stroke-dasharray: 18 150; stroke-dashoffset: -3; }
					.dsd-arrow { transition: none; }
					/* A re-anchor travels a whole panel-width: land it at once. */
					.dsd-panel.reanchor { transition: none; }
					.dsd-glyph .dsd-stroke { transition: none; }
					.dsd-settings, .dsd-settings.show { transition: none; }
					.dsd-menu, .dsd-menu-item { animation: none; transition: none; }
					.dsd-toggle, .dsd-toggle::after { transition: none; }
				}
				.dsd-item-title {
					flex: 1 1 auto;
					min-width: 0;
					overflow: hidden;
					text-overflow: ellipsis;
					white-space: nowrap;
					font-size: 13px;
					color: var(--dsd-label);
				}
				.dsd-item.pending .dsd-item-title { font-weight: 600; }
				.dsd-item-time { flex: none; font-size: 11px; color: var(--dsd-label-faint); }
				/* Dismiss control: revealed on row hover, click hides the row until
				   that session produces something newer. */
				.dsd-dismiss {
					flex: none;
					display: flex;
					align-items: center;
					justify-content: center;
					width: 16px;
					height: 16px;
					border-radius: 4px;
					color: var(--dsd-label-faint);
					cursor: pointer;
					opacity: 0;
					transition: opacity 0.1s ease, color 0.1s ease, background 0.1s ease;
				}
				.dsd-item:hover .dsd-dismiss { opacity: 1; }
				.dsd-dismiss:hover { color: var(--dsd-label); background: var(--dsd-hover-strong); }
				.dsd-empty { padding: 24px 12px; text-align: center; color: var(--dsd-label-faint); font-size: 12px; }
				.dsd-foot {
					flex: none;
					padding: 8px 12px;
					border-top: 1px solid var(--dsd-border);
					font-size: 11px;
					color: var(--dsd-label-faint);
					text-align: center;
				}
				/* ── Panel sections: sessions above, saved replies below ── */
				.dsd-section {
					display: flex;
					flex-direction: column;
					min-height: 0;
					flex: 1 1 auto;
				}
				.dsd-section-fav {
					flex: 0 1 auto;
					border-top: 1px solid rgba(128, 128, 140, 0.28);
					margin-top: 2px;
				}
				.dsd-label {
					flex: none;
					padding: 12px 16px 4px;
					font-size: 11px;
					font-weight: 600;
					color: var(--dsd-label-faint);
				}
				/* About ten rows stay visible, then the session list scrolls. */
				.dsd-sessions { max-height: 430px; min-height: 0; }
				.dsd-favs { max-height: 30vh; min-height: 0; }

				.dsd-empty-sm { padding: 12px 12px 16px; }
				/* Bookmark button in DSH's assistant action strip. It renders OUTSIDE
				   .dsd-root, so it inherits the host's colors instead of our theme
				   variables — only the saved state adds its own accent. */
				.dsd-fav-btn {
					display: flex;
					align-items: center;
					justify-content: center;
					background: none;
					border: none;
					padding: 4px;
					border-radius: 6px;
					color: inherit;
					opacity: 0.6;
					cursor: pointer;
					transition: opacity 0.12s ease, color 0.12s ease, background 0.12s ease;
				}
				.dsd-fav-btn:hover { opacity: 1; background: rgba(128, 128, 140, 0.16); }
				.dsd-fav-btn.on { opacity: 1; color: #f0b429; }
			`;
			document.head.append(style);
		}

		// ------------------------------------------------------------------
		// Persistence (localStorage)
		// ------------------------------------------------------------------

		const DAYS_KEY = "dsh-session-top-new.days";
		const DAYS_EVENT = "dsh-session-top-new:days";
		const MUTE_KEY = "dsh-session-top-new.muted";
		// Whether picking a session also scrolls the host sidebar to its row.
		const REVEAL_KEY = "dsh-session-top-new.reveal";
		const REVEAL_EVENT = "dsh-session-top-new:reveal";
		// Whether the floating dock is mounted at all.
		const DOCK_KEY = "dsh-session-top-new.dock";
		const DOCK_EVENT = "dsh-session-top-new:dock";
		const POS_KEY = "dsh-session-top-new.pos";
		const DISMISS_KEY = "dsh-session-top-new.dismissed";
		const FAV_KEY = "dsh-session-top-new.favorites";
		const THEME_KEY = "dsh-session-top-new.theme";
		// Two independent nudges: a task that finished, and one waiting on a choice.
		const ALERT_DONE_KEY = "dsh-session-top-new.alert.done";
		const ALERT_PICK_KEY = "dsh-session-top-new.alert.pick";

		/** Same-document change notification (the `storage` event only fires cross-tab). */
		const FAV_EVENT = "dsh-session-top-new:favorites";
		const ALERT_EVENT = "dsh-session-top-new:alerts";
		/** Newest-first cap so the store cannot grow without bound. */
		const FAV_LIMIT = 100;

		/** Pre-rename keys, from when this plugin shipped as `dsh-session-dock`. */
		const LEGACY_KEYS = {
			days: "dsh-session-dock.days",
			muted: "dsh-session-dock.muted",
			pos: "dsh-session-dock.pos"
		};

		/**
		 * Read a stored string, falling back to the pre-rename key and migrating it
		 * forward — an existing install keeps its settings across the rename.
		 */
		function readStored(key, legacyKey) {
			try {
				const current = localStorage.getItem(key);
				if (current !== null) return current;
				if (legacyKey) {
					const legacy = localStorage.getItem(legacyKey);
					if (legacy !== null) {
						try {
							localStorage.setItem(key, legacy);
							localStorage.removeItem(legacyKey);
						} catch {}
						return legacy;
					}
				}
			} catch {}
			return null;
		}

		// ------------------------------------------------------------------
		// Theme
		// ------------------------------------------------------------------
		//
		// Both floating surfaces own their palette instead of borrowing the host
		// tokens. The default look is deliberately INVERTED — a dark page gets a
		// light panel — so the panel never dissolves into whatever sits behind it.
		// `auto` keeps that inversion live; `light` / `dark` pin it.

		const THEME_MODES = ["auto", "light", "dark"];
		const THEME_LABELS = { auto: "自动", light: "浅色", dark: "深色" };
		/** The two nudges the bell can send, in the order their switches appear. */
		const ALERT_ROWS = [["done", "任务完成时弹出"], ["pick", "需要选择时弹出"]];

		function loadThemeMode() {
			const raw = readStored(THEME_KEY, null);
			return THEME_MODES.includes(raw) ? raw : "auto";
		}

		/**
		 * True when the page behind this plugin is dark. DSH toggles
		 * `body[data-ds-dark-theme]`; a build that only writes a colour-scheme hint
		 * still resolves here before the media-query fallback.
		 */
		function pageIsDark() {
			for (const el of [document.body, document.documentElement]) {
				if (!el || typeof el.hasAttribute !== "function") continue;
				if (el.hasAttribute("data-ds-dark-theme")) return true;
				const hint = String(el.getAttribute("data-color-scheme") || el.getAttribute("data-theme") || "").toLowerCase();
				if (hint.includes("dark")) return true;
				if (hint.includes("light")) return false;
			}
			try {
				return window.matchMedia("(prefers-color-scheme: dark)").matches;
			} catch {
				return true;
			}
		}

		/**
		 * One theme for every surface this plugin paints. The resolved value is
		 * pushed onto registered roots as `data-dsb-theme`, so CSS owns the palettes
		 * and JS never has to set individual colours.
		 */
		function createThemeSource() {
			const listeners = new Set();
			const roots = new Set();
			let mode = loadThemeMode();
			let resolved = "";
			let observer = null;
			let media = null;

			const resolve = () => mode === "auto" ? (pageIsDark() ? "light" : "dark") : mode;
			const notify = () => { for (const fn of [...listeners]) { try { fn(api.getSnapshot()); } catch {} } };
			const paint = () => {
				for (const el of roots) {
					if (el.isConnected === false) { roots.delete(el); continue; }
					el.setAttribute("data-dsb-theme", resolved);
				}
			};
			const refresh = () => {
				const next = resolve();
				if (next === resolved) return;
				resolved = next;
				paint();
				notify();
			};
			const onStorage = (event) => {
				if (event?.key && event.key !== THEME_KEY) return;
				const next = loadThemeMode();
				if (next === mode) return;
				mode = next;
				refresh();
				notify();
			};
			const api = {
				getSnapshot: () => ({ mode, resolved }),
				subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
				setMode(next) {
					if (!THEME_MODES.includes(next) || next === mode) return;
					mode = next;
					try { localStorage.setItem(THEME_KEY, next); } catch {}
					resolved = resolve();
					paint();
					notify();
				},
				/** Register a root element; the returned handle detaches it. */
				apply(el) {
					if (!el) return () => {};
					roots.add(el);
					el.setAttribute("data-dsb-theme", resolved);
					return () => roots.delete(el);
				},
				dispose() {
					observer?.disconnect();
					observer = null;
					media?.removeEventListener?.("change", refresh);
					media = null;
					window.removeEventListener("storage", onStorage);
					listeners.clear();
					roots.clear();
				}
			};
			resolved = resolve();
			if (typeof MutationObserver === "function") {
				observer = new MutationObserver(refresh);
				for (const el of [document.documentElement, document.body]) {
					if (el) observer.observe(el, {
						attributes: true,
						attributeFilter: ["data-ds-dark-theme", "data-theme", "data-color-scheme", "class"]
					});
				}
			}
			try {
				media = window.matchMedia("(prefers-color-scheme: dark)");
				media?.addEventListener?.("change", refresh);
			} catch {}
			window.addEventListener("storage", onStorage);
			return api;
		}

		/** What the picker resolved to right now, in words. */
		function themeNow(theme) {
			const snap = theme ? theme.getSnapshot() : { mode: "auto", resolved: "dark" };
			const shade = snap.resolved === "light" ? "浅色" : "深色";
			return snap.mode === "auto" ? "自动 · 现在" + shade : "已固定" + shade;
		}

		/** The 自动 / 浅色 / 深色 row, shared by both surfaces. data-mode moves the thumb. */
		function themeSegments(theme, prefix) {
			const mode = theme ? theme.getSnapshot().mode : "auto";
			return React.createElement(
				"div",
				{ className: prefix + "-seg", role: "group", "aria-label": "界面主题", "data-mode": mode },
				THEME_MODES.map((m) => React.createElement(
					"button",
					{
						key: m,
						type: "button",
						className: mode === m ? "on" : "",
						"aria-pressed": String(mode === m),
						onClick: () => theme?.setMode(m)
					},
					THEME_LABELS[m]
				))
			);
		}

		/** Dock button size (px) — the drag/anchoring unit. */
		const BTN = 46;
		/** Panel width (px) — used to decide which way the panel opens. */
		const PANEL_W = 300;
		/** Inset from the right edge while the dock is still at its default spot. */
		const EDGE_INSET = 18;

		function loadDays() {
			const n = parseInt(readStored(DAYS_KEY, LEGACY_KEYS.days), 10);
			if (Number.isFinite(n) && n >= 1) return n;
			return 1; // default: today only
		}

		function loadMuted() {
			return readStored(MUTE_KEY, LEGACY_KEYS.muted) === "1";
		}

		/** Default on: a jump that lands in the main view but not in the list is half a jump. */
		function loadReveal() {
			return readStored(REVEAL_KEY, null) !== "0";
		}

		/** Default on: the dock is the plugin's original surface. */
		function loadDockShown() {
			return readStored(DOCK_KEY, null) !== "0";
		}

		/**
		 * The setting is shared by both surfaces (floating dock and side bell), so it
		 * lives in one small store instead of two copies of localStorage state.
		 */
		const revealPref = (() => {
			let on = loadReveal();
			const listeners = new Set();
			return {
				get() { return on; },
				set(next) {
					on = !!next;
					try { localStorage.setItem(REVEAL_KEY, on ? "1" : "0"); } catch {}
					window.dispatchEvent(new CustomEvent(REVEAL_EVENT));
					for (const fn of listeners) fn(on);
				},
				subscribe(fn) {
					listeners.add(fn);
					return () => { listeners.delete(fn); };
				}
			};
		})();

		/**
		 * The dock can be switched off entirely from the bell: some layouts have no
		 * room for a float, and the bell already does the same job. Same shape as
		 * the reveal store so both surfaces read one value.
		 */
		const dockPref = (() => {
			let on = loadDockShown();
			const listeners = new Set();
			return {
				get() { return on; },
				set(next) {
					on = !!next;
					try { localStorage.setItem(DOCK_KEY, on ? "1" : "0"); } catch {}
					window.dispatchEvent(new CustomEvent(DOCK_EVENT));
					for (const fn of listeners) fn(on);
				},
				subscribe(fn) {
					listeners.add(fn);
					return () => { listeners.delete(fn); };
				}
			};
		})();

		/**
		 * Which events may nudge you: a finished task, a task waiting on a choice.
		 * Stored as "0" when switched off, so a fresh install defaults to both on.
		 */
		function loadAlerts() {
			return {
				done: readStored(ALERT_DONE_KEY, null) !== "0",
				pick: readStored(ALERT_PICK_KEY, null) !== "0"
			};
		}

		function saveAlerts(next) {
			try {
				localStorage.setItem(ALERT_DONE_KEY, next.done ? "1" : "0");
				localStorage.setItem(ALERT_PICK_KEY, next.pick ? "1" : "0");
			} catch {
				// A refused write (private mode, full quota, locked-down policy) means the
				// store still holds the old value. Reporting success would broadcast a
				// change that no surface can read back, so say so instead.
				return false;
			}
			// The switches live in one panel but the counts show on three surfaces,
			// so the change is broadcast instead of only being pushed into state.
			try {
				window.dispatchEvent(new CustomEvent(ALERT_EVENT));
			} catch {}
			return true;
		}

		/**
		 * Rows that should ping you right now. A finished task counts while "done"
		 * is on, a task waiting on a choice while "pick" is on; the session you are
		 * looking at never counts. Rows keep their own flags either way — muting a
		 * nudge is not the same as pretending the work never happened.
		 */
		function countNudges(items, current, alerts) {
			const done = !alerts || alerts.done !== false;
			const pick = !alerts || alerts.pick !== false;
			return items.filter((it) => (it.id !== current) &&
				((done && it.unread) || (pick && it.pending))).length;
		}

		/**
		 * Stored dock position as a fraction of the available travel box
		 * (0..1 per axis), so the dock keeps its relative spot when the window is
		 * resized. Legacy absolute-pixel records are converted once on load.
		 * `null` means "still at the default anchor" (right edge, vertically centered).
		 */
		function loadPos() {
			const raw = readStored(POS_KEY, LEGACY_KEYS.pos);
			if (raw) {
				try {
					const p = JSON.parse(raw);
					// Number.isFinite (not typeof) so a corrupt NaN/null record can
					// never poison the layout — it simply falls back to the anchor.
					if (Number.isFinite(p.xp) && Number.isFinite(p.yp)) {
						return { xp: clamp(p.xp, 0, 1), yp: clamp(p.yp, 0, 1) };
					}
					if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
						const w = Math.max(1, window.innerWidth - BTN);
						const h = Math.max(1, window.innerHeight - BTN);
						return { xp: clamp(p.x / w, 0, 1), yp: clamp(p.y / h, 0, 1) };
					}
				} catch {}
			}
			return { xp: null, yp: null };
		}

		/**
		 * Sessions the user dismissed with the row's ✕, as `{ sessionId: updatedAt }`.
		 * The stored value is the session's `updatedAt` at the moment of dismissal:
		 * the row stays hidden until the session produces something newer, so a new
		 * message brings it back on its own.
		 */
		function loadDismissed() {
			const raw = readStored(DISMISS_KEY, null);
			if (!raw) return {};
			try {
				const parsed = JSON.parse(raw);
				if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
				const out = {};
				for (const [id, ts] of Object.entries(parsed)) {
					// Number.isFinite guards a corrupt record from hiding everything.
					if (typeof id === "string" && Number.isFinite(ts)) out[id] = ts;
				}
				return out;
			} catch {
				return {};
			}
		}

		// ------------------------------------------------------------------
		// Favourites
		// ------------------------------------------------------------------

		/**
		 * Saved replies, newest first:
		 * `{ id, sessionId, sessionTitle, messageId, text, createdAt }`.
		 * `id` is `sessionId:messageId`, so one reply is saved at most once.
		 */
		function loadFavorites() {
			const raw = readStored(FAV_KEY, null);
			if (!raw) return [];
			try {
				const parsed = JSON.parse(raw);
				if (!Array.isArray(parsed)) return [];
				const out = [];
				for (const it of parsed) {
					if (!it || typeof it !== "object") continue;
					if (typeof it.id !== "string" || typeof it.text !== "string") continue;
					if (!it.text.trim()) continue;
					out.push(it);
				}
				return out;
			} catch {
				return [];
			}
		}

		function emitFavorites(list) {
			try {
				window.dispatchEvent(new CustomEvent(FAV_EVENT, { detail: list }));
			} catch {}
		}

		function saveFavorites(list) {
			const capped = list.slice(0, FAV_LIMIT);
			try {
				localStorage.setItem(FAV_KEY, JSON.stringify(capped));
			} catch {}
			emitFavorites(capped);
			return capped;
		}

		/**
		 * One bookmark per session. A reply saved later replaces the session's
		 * earlier bookmark instead of stacking a second row for the same session.
		 */
		function addFavorite(entry) {
			const list = loadFavorites().filter((it) => it.id !== entry.id && it.sessionId !== entry.sessionId);
			list.unshift(entry);
			return saveFavorites(list);
		}

		function removeFavorite(id) {
			return saveFavorites(loadFavorites().filter((it) => it.id !== id));
		}

		function isFavorited(sessionId, messageId) {
			const id = sessionId + ":" + messageId;
			return loadFavorites().some((it) => it.id === id);
		}

		/** The bookmark a session currently has, if any (session or reply kind). */
		function favoriteOfSession(sessionId) {
			return loadFavorites().find((it) => it.sessionId === sessionId) || null;
		}

		/** A session's title, or its id when the list has not caught up yet. */
		function sessionTitleOf(sessionId) {
			try {
				const sessions = ctxRef("sessions");
				const byId = sessions && sessions.list && sessions.list.getSnapshot().byId;
				const rec = byId && byId[sessionId];
				if (rec && typeof rec.displayTitle === "string" && rec.displayTitle.trim()) return rec.displayTitle;
			} catch {}
			return String(sessionId || "");
		}

		/**
		 * Bookmark a whole session — the path that cannot fail. It needs no DOM:
		 * a session has an id and a title whether or not any turn is on screen,
		 * so right-clicking a row always produces a bookmark.
		 */
		function toggleSessionFavorite(sessionId, title) {
			const existing = favoriteOfSession(sessionId);
			if (existing) {
				removeFavorite(existing.id);
				return false;
			}
			const text = (typeof title === "string" && title.trim()) || sessionTitleOf(sessionId);
			addFavorite({
				id: "session:" + sessionId,
				sessionId,
				sessionTitle: text,
				messageId: "",
				text,
				createdAt: Date.now()
			});
			return true;
		}

		/**
		 * The element holding one whole assistant turn. DSH renders a turn's nodes
		 * flat and gives the message body no stable attribute, so walk outward until
		 * a container that actually carries rendered text shows up.
		 */
		function turnContainerOf(node) {
			let el = node;
			for (let i = 0; i < 8 && el && el !== document.body; i++) {
				if (el.querySelector && el.querySelector('[class*="bubble"]')) return el;
				el = el.parentElement;
			}
			return null;
		}

		/**
		 * Read a turn's text. Walks back from the turn tail over its siblings (the
		 * usual flat layout) and falls back to the container's rendered bubbles when
		 * the layout differs — the exact structure is not a published contract.
		 */
		function extractTurnText(node) {
			if (!node) return "";
			const tail =
				(node.closest && node.closest("[data-turn-tail]")) ||
				(node.querySelector && node.querySelector("[data-turn-tail]")) ||
				null;
			const parts = [];
			let cur = tail && tail.previousElementSibling;
			while (cur) {
				if (cur.hasAttribute && cur.hasAttribute("data-turn-tail")) break;
				const t = (cur.innerText || "").trim();
				if (t) parts.unshift(t);
				cur = cur.previousElementSibling;
			}
			const siblingText = parts.join("\n\n").trim();
			if (siblingText.length > 20) return siblingText;
			const scope = turnContainerOf(node);
			if (!scope) return siblingText;
			const chunks = [];
			const bubbles = scope.querySelectorAll('[class*="bubble"]');
			for (const b of bubbles) {
				const t = (b.innerText || "").trim();
				if (t) chunks.push(t);
			}
			return chunks.join("\n\n").trim() || siblingText;
		}

		/** First line of a saved reply, for the list row. */
		function favHeadline(text) {
			const line = String(text || "").split("\n").find((l) => l.trim()) || "";
			const t = line.trim();
			return t.length > 80 ? t.slice(0, 80) + "…" : t;
		}

		/**
		 * The bookmark button in every assistant turn's action strip
		 * (`conversation.chat.assistant-actions`). The slot supplies the owning
		 * `sessionId` and the turn's `messageId` — the only reliable identity for a
		 * reply, since the DOM carries no message id.
		 */
		function FavoriteAction({ sessionId, messageId }) {
			const [saved, setSaved] = React.useState(() => isFavorited(sessionId, messageId));
			const ref = React.useRef(null);


			React.useEffect(() => {
				// Any bookmark for this session lights the button: a session bookmark
				// added from the list is the same reply's home.
				const sync = () => setSaved(Boolean(favoriteOfSession(sessionId)));
				window.addEventListener(FAV_EVENT, sync);
				window.addEventListener("storage", sync);
				return () => {
					window.removeEventListener(FAV_EVENT, sync);
					window.removeEventListener("storage", sync);
				};
			}, [sessionId, messageId]);

			const toggle = () => {
				const id = sessionId + ":" + messageId;
				const existing = favoriteOfSession(sessionId);
				if (existing) {
					removeFavorite(existing.id);
					setSaved(false);
					return;
				}
				// Reading the turn's text is best effort: DSH keeps no stable marker on
				// a message body, so a markup change must cost you the excerpt, never
				// the bookmark. Falling back to the session title keeps the click
				// meaningful and the row addressable.
				const title = sessionTitleOf(sessionId);
				const text = extractTurnText(ref.current) || title;
				addFavorite({ id, sessionId, sessionTitle: title, messageId, text, createdAt: Date.now() });
				setSaved(true);
			};

			return React.createElement(
				"button",
				{
					ref,
					type: "button",
					className: "dsd-fav-btn" + (saved ? " on" : ""),
					title: saved ? "移除书签" : "加入书签",
					"aria-label": saved ? "移除书签" : "加入书签",
					"aria-pressed": saved,
					onClick: toggle
				},
				iconBookmark(15, saved)
			);
		}

		// ------------------------------------------------------------------
		// Widget
		// ------------------------------------------------------------------

		function DockWidget({ useDock, theme }) {
			const dock = typeof useDock === "function" ? useDock((s) => s) : null;

			const [open, setOpen] = React.useState(true); // default expanded
			const [days, setDays] = React.useState(loadDays);
			const [muted, setMuted] = React.useState(loadMuted);
			const [pos, setPos] = React.useState(loadPos);
			const [dragging, setDragging] = React.useState(false);
			const [expandedParents, setExpandedParents] = React.useState({}); // id -> bool
			const [dismissed, setDismissed] = React.useState(loadDismissed); // id -> updatedAt
			const [favorites, setFavorites] = React.useState(loadFavorites);
			// Right-click menu on a session row: { x, y, id, title } in root space.
			const [menu, setMenu] = React.useState(null);
			const [alerts, setAlerts] = React.useState(loadAlerts);
			const [reveal, setReveal] = React.useState(revealPref.get);
			// Live size of the positioning container (the shell overlay layer), so
			// the dock re-anchors whenever the window or the frame resizes.
			const [viewport, setViewport] = React.useState(() => ({
				w: window.innerWidth,
				h: window.innerHeight
			}));
			const [settingsOpen, setSettingsOpen] = React.useState(false);
			const [shown, setShown] = React.useState(dockPref.get);
			const [, setThemeVersion] = React.useState(0);
			const rootRef = React.useRef(null);
			const panelRef = React.useRef(null);
			const menuRef = React.useRef(null);

			// The palette lives in CSS; this only keeps the attribute and the picker in
			// step when the page theme, the OS or the user changes the choice.
			React.useLayoutEffect(() => {
				if (typeof theme?.apply !== "function") return;
				return theme.apply(rootRef.current);
			}, [theme]);

			React.useEffect(() => {
				if (typeof theme?.subscribe !== "function") return;
				return theme.subscribe(() => setThemeVersion((n) => n + 1));
			}, [theme]);

			React.useEffect(() => revealPref.subscribe(setReveal), []);
			// The bell owns this switch; the dock just gets out of the way when it flips.
			React.useEffect(() => dockPref.subscribe(setShown), []);

			const mutedRef = React.useRef(muted);
			mutedRef.current = muted;
			const alertsRef = React.useRef(alerts);
			alertsRef.current = alerts;

			// Running/unread state per session, for the completion chime. The two
			// flags are tracked separately: clearing `unread` means the user just
			// looked at the session, which is not a completion and must stay silent.
			const prevStateRef = React.useRef(null); // Map<id, { running, unread }>

			React.useEffect(() => {
				ensureStyles();
			}, []);

			// A context menu has no anchor of its own: any pointer press outside it,
			// Escape, a scroll or a resize takes it away. Same rules as a native menu.
			React.useEffect(() => {
				if (!menu) return;
				const off = (event) => {
					const box = menuRef.current;
					if (box && event && event.target && box.contains(event.target)) return;
					setMenu(null);
				};
				const key = (event) => { if (event.key === "Escape") setMenu(null); };
				document.addEventListener("pointerdown", off, true);
				document.addEventListener("keydown", key);
				window.addEventListener("resize", off);
				window.addEventListener("scroll", off, true);
				return () => {
					document.removeEventListener("pointerdown", off, true);
					document.removeEventListener("keydown", key);
					window.removeEventListener("resize", off);
					window.removeEventListener("scroll", off, true);
				};
			}, [menu]);

			// Keep the saved list in step with edits made from any surface (the
			// bookmark button in the transcript, another tab, or this panel).
			React.useEffect(() => {
				const sync = () => setFavorites(loadFavorites());
				window.addEventListener(FAV_EVENT, sync);
				window.addEventListener("storage", sync);
				return () => {
					window.removeEventListener(FAV_EVENT, sync);
					window.removeEventListener("storage", sync);
				};
			}, []);

			// The nudge switches live in the activity panel; this surface only counts
			// with them, so it follows the same broadcast (and other windows' writes).
			React.useEffect(() => {
				const sync = () => setAlerts(loadAlerts());
				window.addEventListener(ALERT_EVENT, sync);
				window.addEventListener("storage", sync);
				return () => {
					window.removeEventListener(ALERT_EVENT, sync);
					window.removeEventListener("storage", sync);
				};
			}, []);


			// `shell.overlay` renders inside the layout's overlay layer, which is a
			// positioned element carrying its own z-index. That makes the layer a
			// stacking context, so raising our own z-index can never lift the dock
			// above a sibling layer with a larger z-index (other floating UI such as
			// the session progress rail painted right over it).
			// Re-parenting the root to <body> would fix the layering but silently
			// kill every React handler, because React 17+ delegates events to its
			// root container rather than to document.
			// So raise the overlay layer itself instead: everything DSH mounts in
			// there (settings dialogs, plugin manager, shortcuts) shares this layer
			// and keeps its relative order, so nothing outside is covered.
			React.useEffect(() => {
				const el = rootRef.current;
				const layer = el && el.offsetParent;
				if (!layer || layer === document.body) return;
				const current = parseInt(window.getComputedStyle(layer).zIndex, 10);
				// Only promote a genuine overlay layer, never a content container.
				if (!Number.isFinite(current) || current >= 1000) return;
				const previous = layer.style.zIndex;
				layer.style.zIndex = "2147483000";
				return () => {
					layer.style.zIndex = previous;
				};
			}, []);

			// Keep `viewport` in step with the real positioning box. The dock lives
			// inside the shell overlay layer, so its offsetParent is that layer —
			// measuring it (rather than the window) stays correct when the frame
			// changes size for reasons other than a window resize.
			React.useEffect(() => {
				const el = rootRef.current;
				const target = (el && el.offsetParent) || el;
				const measure = () => {
					const w = (target && target.clientWidth) || window.innerWidth;
					const h = (target && target.clientHeight) || window.innerHeight;
					setViewport((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
				};
				measure();
				window.addEventListener("resize", measure);
				let observer = null;
				if (target && typeof ResizeObserver !== "undefined") {
					observer = new ResizeObserver(measure);
					observer.observe(target);
				}
				return () => {
					window.removeEventListener("resize", measure);
					if (observer) observer.disconnect();
				};
			}, []);

			React.useEffect(() => {
				const items = dock ? dock.items : [];
				const currentId = dock ? dock.current : null;
				const prev = prevStateRef.current;
				const next = {};
				for (const it of items) next[it.id] = { running: !!it.running, unread: !!it.unread };
				if (prev) {
					for (const id of Object.keys(prev)) {
						const was = prev[id];
						const now = next[id];
						if (!was || !now) continue; // session disappeared
						// A real finish: it was running and has stopped.
						const finished = was.running && !now.running;
						// A completion the user has not looked at yet.
						const newlyUnread = !was.unread && now.unread;
						if (!finished && !newlyUnread) continue;
						// Nothing to announce when the user is already looking at it —
						// the answer is right there on screen.
						if (id === currentId) continue;
						if (!mutedRef.current && alertsRef.current.done !== false) playChime();
					}
				}
				prevStateRef.current = next;
			}, [dock]);

			const filtered = React.useMemo(() => {
				if (!dock) return [];
				const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
				return dock.items.filter((it) => {
					// A blank session never received a prompt: it carries no content and
					// opens as an empty "new session" page, so listing it is just noise
					// (and looks like a dead entry you cannot jump to).
					if (it.blank) return false;
					if (it.updatedAt < cutoff) return false;
					// Dismissed rows stay hidden only while nothing newer happened:
					// `updatedAt` moving past the stored stamp brings the row back.
					const stamp = dismissed[it.id];
					if (stamp !== undefined && it.updatedAt <= stamp) return false;
					return true;
				});
			}, [dock, days, dismissed]);

			// Build a parent/child tree: top-level tasks are roots; subagent
			// sessions nest under their parent (matched by parentId).
			const tree = React.useMemo(() => {
				const byId = {};
				for (const it of filtered) byId[it.id] = it;
				const roots = [];
				const childrenOf = {};
				for (const it of filtered) {
					if (it.parentId && byId[it.parentId]) {
						(childrenOf[it.parentId] = childrenOf[it.parentId] || []).push(it);
					} else {
						roots.push(it);
					}
				}
				// Keep parents (by recency) first, then lone children.
				const sortByTime = (arr) => arr.sort((a, b) => b.updatedAt - a.updatedAt);
				sortByTime(roots);
				for (const k of Object.keys(childrenOf)) sortByTime(childrenOf[k]);
				return { roots, childrenOf };
			}, [filtered]);

			const unreadCount = React.useMemo(() => {
				return countNudges(filtered, dock ? dock.current : null, alerts);
			}, [filtered, dock, alerts]);

			const runningCount = React.useMemo(() => {
				return filtered.filter((it) => it.running).length;
			}, [filtered]);

			const onDaysChange = (e) => {
				const v = parseInt(e.target.value, 10);
				const n = Number.isFinite(v) ? clamp(v, 1, 365) : 1;
				setDays(n);
				try { localStorage.setItem(DAYS_KEY, String(n)); } catch {}
				window.dispatchEvent(new CustomEvent(DAYS_EVENT));
			};

			const toggleMute = () => {
				setMuted((m) => {
					const next = !m;
					mutedRef.current = next;
					try { localStorage.setItem(MUTE_KEY, next ? "1" : "0"); } catch {}
					return next;
				});
			};

			/**
			 * Hide a row until that session shows something newer. Dismissing a parent
			 * dismisses its currently visible children too, so a subtree disappears as
			 * one unit instead of leaving orphans behind in the list.
			 */
			const dismissItem = (it) => {
				const kids = tree.childrenOf[it.id] || [];
				const items = (dock && dock.items) || [];
				setDismissed((prev) => {
					const next = {};
					// Drop stale markers: gone sessions and ones that already resurfaced.
					for (const [id, ts] of Object.entries(prev)) {
						const live = items.find((x) => x.id === id);
						if (!live) continue;
						if (live.updatedAt > ts) continue;
						next[id] = ts;
					}
					next[it.id] = it.updatedAt;
					for (const child of kids) next[child.id] = child.updatedAt;
					try { localStorage.setItem(DISMISS_KEY, JSON.stringify(next)); } catch {}
					return next;
				});
			};

			// Navigation belongs to the Workspace controller in current builds
			// (`uiWorkspace.openSession`); older builds exposed `sessions.open`.
			// jumpToSession also honours the "reveal in sidebar" setting.
			const onClickItem = (id) => jumpToSession(id);

			// Drag the dock button. The spot is persisted as a fraction of the travel
			// box so it follows window resizes; the drag maths itself stays in px.
			const dragRef = React.useRef(null);
			const movedRef = React.useRef(false);
			const onBtnDown = React.useCallback((e) => {
				if (e.button !== 0) return; // left button only
				e.preventDefault();
				movedRef.current = false;
				const availW = Math.max(1, viewport.w - BTN);
				const availH = Math.max(1, viewport.h - BTN);
				// Resolve the current on-screen spot once: a stored fraction wins,
				// otherwise the default anchor (right edge, vertically centred).
				dragRef.current = {
					startX: e.clientX,
					startY: e.clientY,
					baseX: pos.xp == null ? availW - EDGE_INSET : clamp(pos.xp, 0, 1) * availW,
					baseY: pos.yp == null ? availH / 2 : clamp(pos.yp, 0, 1) * availH,
					lastXp: pos.xp,
					lastYp: pos.yp
				};
				const onMove = (ev) => {
					const d = dragRef.current;
					if (!d) return;
					const w = Math.max(1, viewport.w - BTN);
					const h = Math.max(1, viewport.h - BTN);
					const x = clamp(d.baseX + (ev.clientX - d.startX), 0, w);
					const y = clamp(d.baseY + (ev.clientY - d.startY), 0, h);
					if (Math.abs(ev.clientX - d.startX) > 4 || Math.abs(ev.clientY - d.startY) > 4) {
						movedRef.current = true;
						setDragging(true);
					}
					d.lastXp = x / w;
					d.lastYp = y / h;
					setPos({ xp: d.lastXp, yp: d.lastYp });
				};
				const onUp = () => {
					const d = dragRef.current;
					dragRef.current = null;
					setDragging(false);
					window.removeEventListener("pointermove", onMove);
					window.removeEventListener("pointerup", onUp);
					if (d && d.lastXp != null && d.lastYp != null) {
						try {
							localStorage.setItem(POS_KEY, JSON.stringify({ xp: d.lastXp, yp: d.lastYp }));
						} catch {}
					}
				};
				window.addEventListener("pointermove", onMove);
				window.addEventListener("pointerup", onUp);
			}, [pos, viewport]);

			const onBtnClick = React.useCallback((e) => {
				if (movedRef.current) return; // it was a drag, not a click
				setOpen((o) => !o);
			}, []);

			const toggleParent = (id) => {
				setExpandedParents((prev) => {
					const next = { ...prev };
					next[id] = !prev[id];
					return next;
				});
			};

			const renderItem = (it, isChild) => {
				const active = it.isMain || (dock && dock.current === it.id);
				const flagged = it.pending || it.unread;
				const kids = tree.childrenOf[it.id] || [];
				const hasKids = kids.length > 0;
				const expanded = !!expandedParents[it.id];
				const chevron = hasKids ? iconTriangle(14, "dsd-arrow", expanded) : null;
				return React.createElement(
					"div",
					{
						key: it.id,
						className: "dsd-item" + (isChild ? " dsd-child" : "") + (active ? " active" : "") + (flagged ? " pending" : ""),
						onClick: () => onClickItem(it.id),
						onContextMenu: (event) => {
							// A session's bookmark needs nothing from the DOM but its id and
							// title, so this path works even while every turn is unrendered.
							event.preventDefault();
							event.stopPropagation();
							const box = rootRef.current?.getBoundingClientRect?.() || { left: 0, top: 0 };
							const left = event.clientX - box.left;
							const top = event.clientY - box.top;
							setMenu({ id: it.id, title: it.title, x: left, y: top });
						},
						title: it.title
					},
					React.createElement(
						"span",
						{
							className: "dsd-chevron" + (hasKids ? " dsd-chevron-on" : ""),
							onClick: hasKids ? (e) => { e.stopPropagation(); toggleParent(it.id); } : undefined
						},
						chevron
					),
					stateDot(rowState(it)),
					React.createElement("span", { className: "dsd-item-title" }, it.title),
					React.createElement("span", { className: "dsd-item-time" }, timeLabel(it.updatedAt)),
					React.createElement(
						"span",
						{
							className: "dsd-dismiss",
							title: hasKids
								? "忽略这条记录及其子任务（有新记录时重新出现）"
								: "忽略这条记录（有新记录时重新出现）",
							"aria-label": "忽略此记录",
							onClick: (e) => {
								e.stopPropagation();
								dismissItem(it);
							}
						},
						iconClose(11)
					)
				);
			};

			const items = [];
			for (const root of tree.roots) {
				items.push(renderItem(root, false));
				if (expandedParents[root.id]) {
					for (const child of (tree.childrenOf[root.id] || [])) {
						items.push(renderItem(child, true));
					}
				}
			}

			// Saved replies render as the panel's second section, newest first.
			const renderFav = (f) => React.createElement(
				"div",
				{
					key: f.id,
					className: "dsd-item dsd-fav",
					title: f.text,
					onClick: () => onClickItem(f.sessionId)
				},
				// Empty chevron slot so saved rows line up with session rows.
				React.createElement("span", { className: "dsd-chevron" }),
				stateDot("warning"),
				React.createElement("span", { className: "dsd-item-title" }, favHeadline(f.text)),
				React.createElement("span", { className: "dsd-item-time" }, timeLabel(f.createdAt)),
				React.createElement(
					"span",
					{
						className: "dsd-dismiss",
						title: "删除书签",
						"aria-label": "删除书签",
						onClick: (event) => {
							event.stopPropagation();
							setFavorites(removeFavorite(f.id));
						}
					},
					iconClose(11)
				)
			);

			const availW = Math.max(1, viewport.w - BTN);
			const availH = Math.max(1, viewport.h - BTN);
			// A null axis means "still at the default anchor" (right edge, vertically
			// centred), which is inherently responsive. A stored fraction is resolved
			// against the CURRENT travel box, so a dragged dock tracks window resizes
			// instead of keeping stale pixel coordinates.
			const dockX = pos.xp == null ? null : clamp(pos.xp, 0, 1) * availW;
			const dockY = pos.yp == null ? null : clamp(pos.yp, 0, 1) * availH;
			const rootStyle = {
				left: dockX === null ? undefined : dockX,
				right: dockX === null ? EDGE_INSET : undefined,
				top: dockY === null ? "50%" : dockY,
				transform: dockY === null ? "translateY(-50%)" : undefined
			};
			// Flip the panel when the dock is too close to an edge to fit it —
			// `.frame` clips overflow, so an off-screen panel would be invisible.
			const dockLeft = dockX === null ? availW - EDGE_INSET : dockX;
			const dockTop = dockY === null ? availH / 2 : dockY;
			const panelFlipX = dockLeft + BTN - PANEL_W < 8;
			const panelUp = viewport.h - (dockTop + BTN) < 260;
			const panelCls = "dsd-panel"
				+ (open ? " show" : "")
				+ (panelFlipX ? " flipx" : "")
				+ (panelUp ? " up" : "");

			// --- Re-anchor animation -------------------------------------------
			// Approaching an app boundary makes the panel swap sides (right↔left,
			// below↔above), which relocates it by roughly a panel-width between two
			// frames. Animate that swap instead of teleporting: remember where the
			// panel was, push the new layout back to that spot with transitions
			// off, then release the offset so it glides into the new anchor.
			//
			// The leftover offset is read back off the computed transform, so a
			// swap that interrupts an unfinished one resumes from the position the
			// panel is actually painted at — no snap-back mid-flight.
			const flipRef = React.useRef({ x: panelFlipX, y: panelUp });
			const anchorRef = React.useRef(null); // panel position in screen space, last commit
			const flipTimerRef = React.useRef(0);
			React.useLayoutEffect(() => {
				/* @flip-effect:start */
				const el = panelRef.current;
				if (!el) return;
				// Measure in screen space. offsetLeft/offsetTop are relative to the
				// dock, and the dock itself travels with the pointer, so offsets
				// alone would drop the root's own move from the compensation and
				// leave a residual jump the size of the last drag step.
				const orbit = el.offsetParent ? el.offsetParent.getBoundingClientRect() : null;
				const left = (orbit ? orbit.left : 0) + el.offsetLeft;
				const top = (orbit ? orbit.top : 0) + el.offsetTop;
				const before = anchorRef.current;
				const was = flipRef.current;
				anchorRef.current = { left, top };
				flipRef.current = { x: panelFlipX, y: panelUp };
				// Nothing to animate on the first commit, while the panel is hidden,
				// or when the anchor held: a drag only moves the root, and the panel
				// keeps its offset inside it, so it must track the pointer exactly.
				if (!before || !open) return;
				if (was.x === panelFlipX && was.y === panelUp) return;
				let restX = 0;
				let restY = 0;
				try {
					const painted = getComputedStyle(el).transform;
					if (painted && painted !== "none") {
						const m = new DOMMatrixReadOnly(painted);
						restX = m.m41;
						restY = m.m42;
					}
				} catch {}
				const dx = before.left + restX - left;
				const dy = before.top + restY - top;
				if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
				clearTimeout(flipTimerRef.current);
				el.classList.remove("reanchor");
				el.style.transition = "none";
				el.style.setProperty("--dsd-fx", dx + "px");
				el.style.setProperty("--dsd-fy", dy + "px");
				void el.offsetWidth; // commit the offset before the transition returns
				el.style.transition = "";
				el.classList.add("reanchor");
				el.style.setProperty("--dsd-fx", "0px");
				el.style.setProperty("--dsd-fy", "0px");
				flipTimerRef.current = setTimeout(() => {
					el.classList.remove("reanchor");
					el.style.removeProperty("--dsd-fx");
					el.style.removeProperty("--dsd-fy");
				}, 360);
				/* @flip-effect:end */
			});
			React.useEffect(() => () => clearTimeout(flipTimerRef.current), []);

			// Switched off from the bell. Nothing is left behind: no root, no badge,
			// no hot zone — the tab keeps working, it just is not on screen.
			if (!shown) return null;

			const closeMenu = () => setMenu(null);
			const menuSaved = menu ? Boolean(favoriteOfSession(menu.id)) : false;
			const onMenuFavorite = () => {
				if (!menu) return;
				toggleSessionFavorite(menu.id, menu.title);
				setMenu(null);
			};

			return React.createElement(
				"div",
				{ className: "dsd-root", style: rootStyle, ref: rootRef },
				React.createElement(
					"button",
					{
						className: "dsd-btn" + (dragging ? " dragging" : ""),
						onPointerDown: onBtnDown,
						onClick: onBtnClick,
						title: open ? "拖拽移动 · 点击收起" : "拖拽移动 · 点击展开",
						"aria-label": "会话列表"
					},
					unreadCount > 0
						? React.createElement("span", { className: "dsd-badge" }, unreadCount > 99 ? "99+" : String(unreadCount))
						: null,
					iconDock(20, open)
				),
				React.createElement(
					"div",
					{ className: panelCls, ref: panelRef },
					React.createElement(
						"div",
						{ className: "dsd-head" },
						React.createElement("span", { className: "dsd-title" }, "会话列表"),
						React.createElement(
							"div",
							{ className: "dsd-head-actions" },
							React.createElement(
								"span",
								{ className: "dsd-days" },
								"近 ",
								React.createElement("input", {
									type: "number",
									min: 1,
									max: 365,
									value: days,
									onChange: onDaysChange,
									"aria-label": "显示近 N 天"
								}),
								" 天"
							),
							React.createElement(
								"button",
								{ className: "dsd-iconbtn", onClick: toggleMute, title: muted ? "开启声音提醒" : "静音提醒" },
								muted ? iconBell(15, true) : iconBell(15, false)
							),
							React.createElement(
								"button",
								{
									className: "dsd-iconbtn",
									onClick: () => setSettingsOpen((value) => !value),
									title: "外观设置",
									"aria-label": "外观设置",
									"aria-expanded": String(settingsOpen)
								},
								iconGear(15)
							)
						)
					),
					React.createElement(
						"div",
						{
							className: "dsd-settings" + (settingsOpen ? " show" : ""),
							"aria-hidden": String(!settingsOpen)
						},
						React.createElement(
							"div",
							{ className: "dsd-settings-inner" },
							React.createElement(
								"div",
								{ className: "dsd-settings-row" },
								React.createElement("span", { className: "dsd-settings-label" }, "界面主题"),
								React.createElement("span", { className: "dsd-settings-now" }, themeNow(theme))
							),
							themeSegments(theme, "dsd"),
							React.createElement(
								"div",
								{ className: "dsd-settings-row dsd-settings-sw" },
								React.createElement("span", { className: "dsd-settings-label" }, "侧栏定位"),
								React.createElement("button", {
									type: "button",
									className: "dsd-toggle",
									role: "switch",
									"aria-checked": String(reveal),
									"aria-label": "跳转会话时滚动左侧边栏",
									title: reveal
										? "已开启：跳到某条会话时，左侧边栏会滚到它的位置"
										: "已关闭：只切换会话，左侧边栏保持原样",
									onClick: () => revealPref.set(!reveal)
								})
							)
						)
					),
					React.createElement(
						"div",
						{ className: "dsd-section" },
						React.createElement("div", { className: "dsd-label" }, "会话"),
						React.createElement(
							"div",
							{ className: "dsd-list dsd-sessions" },
							items.length === 0
								? React.createElement("div", { className: "dsd-empty" }, "暂无会话记录")
								: items
						)
					),
					React.createElement(
						"div",
						{ className: "dsd-section dsd-section-fav" },
						React.createElement("div", { className: "dsd-label" }, "书签 " + (favorites.length || "")),
						React.createElement(
							"div",
							{ className: "dsd-list dsd-favs" },
							favorites.length === 0
								? React.createElement("div", { className: "dsd-empty dsd-empty-sm" }, "右键会话即可加书签")
								: favorites.map(renderFav)
						)
					),
					React.createElement(
						"div",
						{ className: "dsd-foot" },
						(runningCount > 0 ? runningCount + " 个进行中 · " : "") + unreadCount + " 个未读结果"
					)
				),
				menu
					? React.createElement(
						"div",
						{
							className: "dsd-menu",
							role: "menu",
							ref: menuRef,
							style: { left: menu.x + "px", top: menu.y + "px" },
							onContextMenu: (event) => event.preventDefault()
						},
						React.createElement(
							"button",
							{
								type: "button",
								className: "dsd-menu-item",
								role: "menuitem",
								onClick: onMenuFavorite
							},
							menuSaved ? "移除书签" : "加入书签"
						)
					)
					: null
			);
		}

		function createBellSource(dockSource, ctx) {
			const listeners = new Set();
			let disposed = false;
			let alerts = loadAlerts();
			let state = { items: [], current: null, unreadCount: 0, runningCount: 0, open: false, alerts };
			let previous = null;
			let previousDays = null;
			let panel = null;
			// Sessions this panel has opened: the host can keep completionUnread set until
			// its own viewer reports activity, so the bell clears the flag itself and the
			// row drops into "Recent" the moment you click it.
			const seen = new Set();
			const notify = () => { for (const fn of listeners) fn(); };
			const sync = () => {
				if (disposed) return;
				const dock = dockSource.getSnapshot();
				const days = loadDays();
				const nextAlerts = loadAlerts();
				if (dock === previous && days === previousDays &&
					nextAlerts.done === alerts.done && nextAlerts.pick === alerts.pick) return;
				previous = dock;
				previousDays = days;
				alerts = nextAlerts;
				const cutoff = Date.now() - days * 86400000;
				const raw = dock?.items || [];
				const current = dock?.current ?? null;
				// The session on screen is not "unread": you are looking straight at it. The
				// host keeps completionUnread set until its own viewer reacts, so the flag is
				// cleared here — otherwise a row you just read sits in Unread forever.
				if (current && raw.some((it) => it.id === current && it.unread)) seen.add(current);
				const hostUnread = new Map();
				for (const it of raw) hostUnread.set(it.id, !!it.unread);
				for (const id of seen) if (hostUnread.get(id) !== true) seen.delete(id);
				const items = [];
				for (const it of raw) {
					if (it.blank || it.updatedAt < cutoff) continue;
					items.push(seen.has(it.id) && it.unread ? { ...it, unread: false } : it);
				}
				const next = {
					items, current, open: state.open, alerts,
					unreadCount: countNudges(items, current, alerts),
					runningCount: items.filter((it) => it.running).length
				};
				// Rows can be identical while the count moves (the switches mute a whole
				// kind of nudge), so the guard has to look at the count and the switches
				// as well — otherwise the badge keeps the number it had before the flip.
				if (snapshotsEqual(next, state) &&
					next.unreadCount === state.unreadCount &&
					next.alerts.done === state.alerts.done &&
					next.alerts.pick === state.alerts.pick) return;
				state = next;
				notify();
			};
			const markSeen = (id) => {
				if (disposed || !id || seen.has(id)) return;
				const raw = (dockSource.getSnapshot()?.items || []).find((it) => it.id === id);
				if (!raw) return;
				seen.add(id);
				if (!raw.unread) return;
				previous = null;
				previousDays = null;
				sync();
			};
			/**
			 * Clear every unread row at once. Rows waiting on a choice stay: one of them
			 * still needs an answer, and silencing it would hide what it is asking for.
			 */
			const markAllSeen = () => {
				if (disposed) return;
				let changed = false;
				for (const it of dockSource.getSnapshot()?.items || []) {
					if (!it.unread || seen.has(it.id)) continue;
					seen.add(it.id);
					changed = true;
				}
				if (!changed) return;
				previous = null;
				previousDays = null;
				sync();
			};
			const unsubscribe = dockSource.subscribe(sync);
			window.addEventListener(DAYS_EVENT, sync);
			window.addEventListener("storage", sync);
			sync();
			return {
				getSnapshot: () => state,
				subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
				setOpen(open) {
					if (disposed || state.open === open) return;
					if (open) sync();
					state = { ...state, open };
					notify();
				},
				// A copy: a caller that pokes the result must not move the source of truth.
				getAlerts: () => ({ ...alerts }),
				/** Flip one switch, then resync so badge, list and footer repaint together. */
				setAlert(which, on) {
					if (disposed || (which !== "done" && which !== "pick")) return;
					const next = { ...alerts, [which]: !!on };
					if (next.done === alerts.done && next.pick === alerts.pick) return;
					const before = alerts;
					alerts = next;
					// Write first and keep the old truth on refusal: the switch, the store and
					// the badge must never tell three different stories.
					if (!saveAlerts(next)) {
						alerts = before;
						return;
					}
					state = { ...state, alerts };
					previous = null;
					previousDays = null;
					sync();
					notify();
				},
				attachPanel(hook) { panel = hook; return () => { if (panel === hook) panel = null; }; },
				positionPanel() { panel?.position(); },
				markSeen,
				markAllSeen,
				openSession(id) {
					markSeen(id);
					jumpToSession(id);
				},
				dispose() {
					this.setOpen(false);
					disposed = true;
					panel?.dispose();
					panel = null;
					unsubscribe();
					window.removeEventListener(DAYS_EVENT, sync);
					window.removeEventListener("storage", sync);
					listeners.clear();
				}
			};
		}

		function ensureBellStyles() {
			if (document.getElementById("dsh-session-top-new-bell-styles")) return null;
			const style = document.createElement("style");
			style.id = "dsh-session-top-new-bell-styles";
			style.textContent = `
				.dsb-button { position: relative; display: inline-flex; align-items: center; justify-content: center;
					flex: 0 0 28px; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px;
					color: inherit; background: transparent; opacity: .72; cursor: pointer;
					transition: opacity 120ms ease, background-color 120ms ease, transform 120ms cubic-bezier(.2,.9,.3,1); }
				.dsb-button:hover, .dsb-button[aria-expanded="true"] { opacity: 1; background: rgba(127,127,127,.12); }
				.dsb-button:active { transform: scale(.9); }
				.dsb-button:focus-visible { outline: 2px solid rgba(127,127,127,.5); outline-offset: 1px; }
				.dsb-button svg { transition: transform 180ms cubic-bezier(.2,.9,.3,1); transform-origin: 50% 20%; }
				.dsb-button[aria-expanded="true"] svg { transform: rotate(-12deg); }
				.dsb-button.dsb-rail { display: none; }
				/* A count, not a dot: the number is how many finished sessions you have
				   not looked at yet. */
				.dsb-badge { display: none; position: absolute; top: 1px; right: 1px; box-sizing: border-box;
					min-width: 15px; height: 15px; padding: 0 4px; border-radius: 8px;
					background: #ef4444; color: #fff; text-align: center;
					font: 600 10px/15px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
					font-variant-numeric: tabular-nums; letter-spacing: -.01em;
					box-shadow: 0 0 0 1.5px rgba(0,0,0,.22); }
				.dsb-unread .dsb-badge { display: block;
					animation: dsb-pop 190ms cubic-bezier(.2,1.5,.4,1); }
				@keyframes dsb-breathe { 50% { opacity: .45; } }
				@keyframes dsb-pop { from { transform: scale(.2); opacity: 0; } }
				/* Own palette, inverted by default — never the host tokens. */
				.dsb-panel { position: fixed; z-index: 2147483001; width: 320px; max-width: calc(100vw - 16px);
					max-height: min(60vh, 480px); display: flex; flex-direction: column; overflow: hidden;
					--dsb-surface: #212226; --dsb-label: #e9eaec; --dsb-label-dim: #969aa1;
					--dsb-border: rgba(255,255,255,.10); --dsb-hover: rgba(255,255,255,.07);
					--dsb-active: rgba(255,255,255,.10); --dsb-field: rgba(255,255,255,.08);
					--dsb-shadow: 0 12px 36px rgba(0,0,0,.42);
					--dsb-ok: #22c55e; --dsb-warn: #f59e0b;
					border-radius: 12px; border: 1px solid var(--dsb-border);
					color: var(--dsb-label); background: var(--dsb-surface);
					box-shadow: var(--dsb-shadow);
					font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
					transform-origin: var(--dsb-origin, top left);
					opacity: 0; visibility: hidden; pointer-events: none;
					transform: translate3d(0, var(--dsb-from, -6px), 0) scale(.965);
					transition: opacity 110ms ease-in, transform 130ms cubic-bezier(.4, 0, .8, 1), visibility 0s linear 130ms; }
				.dsb-panel.dsb-in { opacity: 1; visibility: visible; pointer-events: auto; transform: none;
					will-change: opacity, transform;
					transition: opacity 130ms ease-out, transform 190ms cubic-bezier(.16, 1, .3, 1), visibility 0s; }
				/* In-place mode: the card stands where the sidebar list is, not beside it. */
				.dsb-panel.dsb-fill { border-radius: 10px; }
				.dsb-panel.dsb-fill .dsb-scroll { padding-bottom: 10px; }
				.dsb-panel[data-dsb-theme="light"] {
					--dsb-surface: rgba(250,250,251,.98); --dsb-label: #18181d; --dsb-label-dim: #52525b;
					--dsb-border: rgba(0,0,0,.09); --dsb-hover: rgba(0,0,0,.05);
					--dsb-active: rgba(0,0,0,.07); --dsb-field: rgba(0,0,0,.05);
					--dsb-shadow: 0 12px 36px rgba(0,0,0,.18);
					--dsb-ok: #16a34a; --dsb-warn: #d97706; }
				.dsb-head { display: flex; align-items: center; gap: 6px; padding: 10px 8px 8px 14px; }
				.dsb-heading { flex: 1; font-size: 14px; font-weight: 600; }
				.dsb-iconbtn { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 28px;
					width: 28px; height: 28px; padding: 0; border: 0; border-radius: 8px; cursor: pointer;
					color: var(--dsb-label-dim); background: transparent;
					transition: color 140ms ease, background-color 140ms ease,
						transform 140ms cubic-bezier(.2,.9,.3,1); }
				.dsb-iconbtn:hover { color: var(--dsb-label); background: var(--dsb-hover); }
				.dsb-iconbtn:active { transform: scale(.9); }
				.dsb-iconbtn:focus-visible { outline: 2px solid var(--dsb-label-dim); outline-offset: 1px; }
				.dsb-iconbtn svg { transition: transform 260ms cubic-bezier(.22,1.4,.36,1); }
				.dsb-iconbtn[aria-expanded="true"] { color: var(--dsb-label); background: var(--dsb-hover); }
				.dsb-iconbtn[aria-expanded="true"] svg { transform: rotate(90deg); }
				/* Picker unfolds from a 0fr grid row so the list slides, not jumps. */
				/* flex: 0 0 auto is load-bearing: the panel is a column flexbox capped by
				   max-height, so a shrinkable item would be squeezed to ~half its height
				   and the 0fr->1fr row would clip the picker's buttons out of sight. */
				.dsb-settings { display: grid; grid-template-rows: 0fr; opacity: 0; padding: 0 12px;
					overflow: hidden; flex: 0 0 auto;
					/* Height 0 is not "hidden": a collapsed row still leaves five buttons in
					   the tab order and in the a11y tree. Match what the panel itself does. */
					visibility: hidden; pointer-events: none;
					transition: grid-template-rows 240ms cubic-bezier(.22,1,.36,1), opacity 150ms ease,
						padding 240ms cubic-bezier(.22,1,.36,1), visibility 0s linear 240ms; }
				.dsb-settings.dsb-show { grid-template-rows: 1fr; opacity: 1; padding: 0 12px 10px;
					visibility: visible; pointer-events: auto; transition-delay: 0s; }
				/* In a very short window the panel cannot hold head + picker + footer, so the
				   picker scrolls itself instead of squeezing the footer out of the box. The
				   query keeps a scrollbar from flashing while the row unfolds normally. */
				@media (max-height: 420px) {
					.dsb-settings.dsb-show { max-height: calc(min(60vh, 480px) - 88px);
						overflow-y: auto; overflow-x: hidden; }
				}
				.dsb-settings-inner { min-height: 0; display: flex; flex-direction: column; gap: 8px; }
				.dsb-settings-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
				.dsb-settings-label { font-size: 11px; letter-spacing: .02em; color: var(--dsb-label-dim); }
				.dsb-settings-now { font-size: 11px; color: var(--dsb-label-dim); opacity: .72; }
				/* Alert switches: the same row rhythm, control parked on the right. */
				.dsb-settings-alert, .dsb-settings-sw { align-items: center; }
				.dsb-settings-alert .dsb-settings-label { flex: 1; }
				.dsb-toggle { position: relative; flex: 0 0 34px; width: 34px; height: 20px; padding: 0;
					box-sizing: border-box; border-radius: 999px; border: 1px solid transparent;
					background: rgba(128,128,128,.30); cursor: pointer;
					transition: background-color 180ms ease; }
				.dsb-toggle::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px;
					height: 14px; border-radius: 50%; background: var(--dsb-label-dim);
					box-shadow: 0 1px 2px rgba(0,0,0,.18);
					transition: transform 220ms cubic-bezier(.22,1,.36,1), background-color 180ms ease; }
				.dsb-toggle[aria-checked="true"] { background: var(--dsb-label); }
				.dsb-toggle[aria-checked="true"]::after { transform: translateX(14px);
					background: var(--dsb-surface); }
				.dsb-toggle:active::after { transform: scale(.92); }
				.dsb-toggle[aria-checked="true"]:active::after { transform: translateX(14px) scale(.92); }
				.dsb-toggle:focus-visible { outline: 2px solid var(--dsb-label-dim); outline-offset: 2px; }
				/* Right-click menu on a row. Parked inside the panel, above the list. */
				.dsb-menu { position: absolute; z-index: 5; min-width: 128px; padding: 4px;
					box-sizing: border-box; border-radius: 9px;
					border: 1px solid var(--dsb-border); background: var(--dsb-surface);
					box-shadow: 0 10px 26px rgba(0,0,0,.34), 0 1px 2px rgba(0,0,0,.24);
					animation: dsb-menu-in 120ms cubic-bezier(.2,.9,.3,1); }
				.dsb-menu-item { display: block; width: 100%; padding: 6px 10px; border: 0;
					border-radius: 6px; background: none; color: var(--dsb-label);
					font: inherit; font-size: 12px; line-height: 1.5; text-align: left; cursor: pointer;
					transition: background-color 120ms ease; }
				.dsb-menu-item:hover { background: var(--dsb-hover); }
				.dsb-menu-item:active { background: var(--dsb-active); }
				.dsb-menu-item:focus-visible { outline: 2px solid var(--dsb-label-dim); outline-offset: -2px; }
				@keyframes dsb-menu-in { from { opacity: 0; transform: scale(.96); } }
				.dsb-seg { position: relative; display: flex; padding: 3px; border-radius: 9px;
					background: var(--dsb-field); border: 1px solid var(--dsb-border); }
				.dsb-seg::before { content: ""; position: absolute; top: 2px; bottom: 2px; left: 2px;
					width: calc((100% - 4px) / 3); border-radius: 7px; background: var(--dsb-label);
					box-shadow: 0 1px 2px rgba(0,0,0,.18);
					transition: transform 240ms cubic-bezier(.22,1,.36,1); }
				.dsb-seg[data-mode="light"]::before { transform: translateX(100%); }
				.dsb-seg[data-mode="dark"]::before { transform: translateX(200%); }
				.dsb-seg button { position: relative; z-index: 1; flex: 1; padding: 4px 0; border: 0;
					border-radius: 7px; font: inherit; font-size: 12px; color: var(--dsb-label-dim);
					background: transparent; cursor: pointer;
					transition: color 180ms ease, transform 120ms ease; }
				.dsb-seg button:hover { color: var(--dsb-label); }
				.dsb-seg button:active { transform: scale(.96); }
				.dsb-seg button.on { color: var(--dsb-surface); }
				.dsb-scroll { overflow-y: auto; min-height: 0; padding: 0 6px 6px; }
				.dsb-group { padding: 10px 8px 5px; opacity: .6; font-size: 11px; }
				/* Same row, two columns: the label, and the one control that can empty it. */
				.dsb-group.dsb-group-act { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
				.dsb-clear { font: inherit; font-size: 11px; line-height: 1; color: var(--dsb-label-dim);
					background: transparent; border: 0; border-radius: 4px; padding: 3px 5px; margin-right: -3px;
					cursor: pointer; opacity: .55;
					transition: opacity 120ms ease, color 120ms ease, background-color 120ms ease; }
				.dsb-clear:hover { opacity: 1; color: var(--dsb-label); background: var(--dsb-hover); }
				.dsb-clear:active { transform: scale(.96); }
				.dsb-clear[hidden] { display: none; }
				.dsb-clear:focus-visible { opacity: 1; outline: 2px solid rgba(127,127,127,.5); outline-offset: 1px; }
				.dsb-row { display: flex; align-items: center; gap: 7px; padding: 8px; border-radius: 6px; }
				.dsb-row:hover { background: var(--dsb-hover); }
				.dsb-row.dsb-active { background: var(--dsb-active); }
				.dsb-row button { font: inherit; color: inherit; border: 0; background: transparent; cursor: pointer; padding: 0; }
				.dsb-disclosure, .dsb-spacer { flex: 0 0 14px; width: 14px; display: flex;
					align-items: center; justify-content: center; color: var(--dsb-label-dim); }
				.dsb-disclosure { transition: color 140ms ease; }
				.dsb-disclosure:hover { color: var(--dsb-label); }
				.dsb-row .dsb-jump { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; text-align: left; }
				/* Same slot as the host: 10px box, one 6px core painted from currentColor. */
				.dsb-state { position: relative; display: inline-block; flex: none; width: 10px; height: 10px; }
				.dsb-state::after { content: ""; position: absolute; inset: 20%; border-radius: 50%;
					background: currentColor; }
				.dsb-state[data-state="done"] { color: var(--dsb-ok); }
				.dsb-state[data-state="warning"] { color: var(--dsb-warn); }
				.dsb-state[data-state="idle"] { color: var(--dsb-label-dim); opacity: .5; }
				.dsb-spin { flex: none; color: var(--dsb-label-dim); }
				.dsb-spin-motion { transform-origin: center; animation: dsb-spin-turn 1.5s linear infinite; }
				.dsb-spin-track, .dsb-spin-arc { fill: none; stroke: currentColor; stroke-width: 2;
					stroke-linecap: round; }
				.dsb-spin-track { opacity: .25; }
				.dsb-spin-arc { stroke-dasharray: 12 150; animation: dsb-spin-dash 1.5s ease-in-out infinite; }
				.dsb-arrow { transition: transform 150ms ease-in-out; }
				.dsb-arrow.open { transform: rotate(90deg); }
				@keyframes dsb-spin-turn { to { transform: rotate(360deg); } }
				@keyframes dsb-spin-dash {
					0% { stroke-dasharray: 12 150; stroke-dashoffset: 0; }
					50% { stroke-dasharray: 24 150; stroke-dashoffset: -6; }
					100% { stroke-dasharray: 12 150; stroke-dashoffset: 0; }
				}
				/* Two lines: the title, and the project it belongs to. */
				.dsb-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
				.dsb-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
				.dsb-sub { font-size: 11px; line-height: 1.3; opacity: .42;
					overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
				.dsb-day { padding-top: 12px; }
				.dsb-flagged .dsb-title { font-weight: 600; }
				.dsb-time { font-size: 11px; opacity: .5; flex: none; }
				.dsb-empty { padding: 16px 8px; opacity: .55; font-size: 12px; }
				.dsb-footer { padding: 9px 12px; border-top: 1px solid var(--dsb-border); opacity: .6; font-size: 11px; }
				@media (prefers-reduced-motion: reduce) {
					.dsb-badge, .dsb-spin-motion, .dsb-spin-arc, .dsb-arrow { animation: none; transition: none; }
					.dsb-spin-arc { stroke-dasharray: 18 150; stroke-dashoffset: -3; }
					.dsb-button, .dsb-button svg { transition: none; }
					.dsb-toggle, .dsb-toggle::after { transition: none; }
					.dsb-clear { transition: none; }
					.dsb-settings, .dsb-settings.dsb-show { transition: none; }
					.dsb-menu, .dsb-menu-item { animation: none; transition: none; }
					.dsb-panel, .dsb-panel.dsb-in { transform: none; transition: opacity 80ms linear, visibility 0s; }
				}
			`;
			document.head.append(style);
			return style;
		}

		function mountSidebarBell(source) {
			const style = ensureBellStyles();
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "dsb-button";
			btn.setAttribute("aria-label", "活动 Activity");
			btn.setAttribute("aria-haspopup", "dialog");
			btn.setAttribute("aria-controls", "dsh-session-top-new-activity");
			// Reuse iconBell's SVG description without creating a second React root.
			const icon = iconBell(16);
			const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			for (const [key, value] of Object.entries({ ...SVG_PROPS, width: 16, height: 16 })) {
				if (key === "style") continue;
				svg.setAttribute(key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()).replace("view-box", "viewBox"), String(value));
			}
			for (const part of icon.props.children) {
				const path = document.createElementNS(svg.namespaceURI, part.type);
				path.setAttribute("d", part.props.d);
				svg.append(path);
			}
			const badge = document.createElement("span");
			badge.className = "dsb-badge";
			badge.setAttribute("aria-hidden", "true");
			btn.append(svg, badge);
			let sidebar = null;
			let row = null;
			let observer = null;
			let resizeObserver = null;
			let frame = 0;
			let dirty = false;
			let expandedState = null;
			let disposed = false;
			let collapsed = false;
			const sidebarSelector = '[data-slot="sidebar"], [data-sidebar="sidebar"], [data-testid="sidebar"], aside, [role="navigation"], [class*="sidebar" i]';
			const searchSelector = 'input[type="search"], [aria-label*="search" i], [title*="search" i], [aria-label*="搜索"], [title*="搜索"], [data-lucide="search"], svg[class*="search" i]';
			const controls = 'button, [role="button"], input[type="search"]';
			const findRow = (scope) => {
				const candidates = scope.querySelectorAll("h1, h2, h3, h4, span, div, p");
				for (const label of candidates) {
					if (label.children.length || !/^(工作区|Workspaces?|会话|Sessions)$/i.test(label.textContent.trim())) continue;
					for (let el = label.parentElement, depth = 0; el && el !== scope && depth < 5; el = el.parentElement, depth++) {
						const count = el.querySelectorAll(controls).length;
						if (count >= 2 && count <= 8) return el;
					}
				}
				for (const search of scope.querySelectorAll(searchSelector)) {
					for (let el = search.parentElement; el && el !== scope; el = el.parentElement) {
						const count = el.querySelectorAll(controls).length;
						if (count > 8) break;
						const rowLike = el.matches('header, [role="toolbar"], [class*="header" i], [class*="toolbar" i], [class*="row" i]');
						const directControls = [...el.children].filter((child) => child.matches(controls)).length;
						if (count >= 2 && (rowLike || directControls >= 2)) return el;
					}
				}
				return null;
			};
			const update = () => {
				const snap = source.getSnapshot();
				const text = snap.unreadCount > 99 ? "99+" : String(snap.unreadCount);
				if (badge.textContent !== text) badge.textContent = text;
				btn.classList.toggle("dsb-unread", snap.unreadCount > 0);
				// Only write when the value moves: a streaming turn re-emits the
				// snapshot several times a second and attribute writes are not free.
				const title = "活动 Activity · " + text + " 未读 / unread";
				if (btn.title !== title) btn.title = title;
				const expanded = String(snap.open);
				if (expandedState !== expanded) {
					expandedState = expanded;
					btn.setAttribute("aria-expanded", expanded);
				}
			};
			const measureRail = () => {
				// A document-wide scope has no rail width of its own; the collapsed
				// sidebar simply stops rendering the section label, which the row
				// search already reports as "no anchor".
				if (!sidebar || sidebar === document.body || disposed) return;
				collapsed = sidebar.clientWidth < 80;
				btn.classList.toggle("dsb-rail", collapsed);
				if (collapsed) source.setOpen(false);
				else source.positionPanel();
			};
			let scanBackoff = 0;
			let lastScan = 0;
			const recover = () => {
				frame = 0;
				if (disposed || !dirty) return;
				dirty = false;
				if (btn.isConnected && btn.parentElement === row && row?.isConnected) return;
				const now = Date.now();
				// A document-wide anchor scan on every streaming mutation would be the
				// one real jank source here. Failed scans back off progressively and a
				// later mutation — the very thing that could create the anchor — retries;
				// the interval is state, not a timer.
				if (scanBackoff && now - lastScan < scanBackoff) return;
				lastScan = now;
				source.setOpen(false);
				const next = findRow(sidebar);
				if (!next) {
					scanBackoff = Math.min(scanBackoff ? scanBackoff * 2 : 400, 8000);
					warnOnce("activity: no reliable sidebar header anchor; use the floating dock");
					return;
				}
				scanBackoff = 0;
				row = next;
				const firstControl = row.querySelector(controls);
				let seat = firstControl;
				while (seat.parentElement !== row) seat = seat.parentElement;
				row.insertBefore(btn, seat);
			};
			// The shell can paint its sidebar after this plugin applies. Rather than
			// giving up on the first frame, keep a boot-only observer alive until the
			// sidebar shows up; probes are throttled and the whole watch self-cancels
			// after a short budget so a build without a sidebar costs nothing.
			let bootObserver = null;
			let bootProbe = 0;
			const awaitSidebar = () => {
				if (bootObserver || disposed) return;
				const started = Date.now();
				bootObserver = new MutationObserver(() => {
					if (disposed || sidebar) return;
					const now = Date.now();
					if (now - started > 15000) {
						if (bootObserver) bootObserver.disconnect();
						bootObserver = null;
						warnOnce("activity: no reliable sidebar header anchor; use the floating dock");
						return;
					}
					// At most four probes a second, and never while one is queued.
					if (frame || now - bootProbe < 250) return;
					bootProbe = now;
					frame = requestAnimationFrame(() => {
						frame = 0;
						if (disposed || sidebar) return;
						if (bootObserver) bootObserver.disconnect();
						bootObserver = null;
						initialize();
					});
				});
				bootObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
			};
			// The shipped sidebar root only carries hashed CSS-module classes
			// (e.g. `wtg9ga_root`), so no stable attribute selector can match it.
			// Try the selector list first because a scoped scan is cheap, then fall
			// back to the document and let the row search anchor the bell on its own.
			const resolveScope = () => {
				for (const candidate of document.querySelectorAll(sidebarSelector)) {
					if (candidate === document.body || candidate === document.documentElement) continue;
					if (findRow(candidate)) return candidate;
				}
				if (document.body && findRow(document.body)) return document.body;
				return null;
			};
			const initialize = () => {
				frame = 0;
				if (disposed) return;
				if (!sidebar) sidebar = resolveScope();
				if (!sidebar) {
					awaitSidebar();
					return;
				}
				dirty = true;
				recover();
				observer = new MutationObserver(() => {
					if (btn.isConnected && btn.parentElement === row && row?.isConnected) return;
					dirty = true;
					if (!frame) frame = requestAnimationFrame(recover);
				});
				observer.observe(sidebar, { childList: true, subtree: true });
				if (typeof ResizeObserver !== "undefined") {
					resizeObserver = new ResizeObserver(measureRail);
					resizeObserver.observe(sidebar);
				}
			};
			const click = () => {
				measureRail();
				if (!collapsed) source.setOpen(!source.getSnapshot().open);
			};
			btn.addEventListener("click", click);
			const unsubscribe = source.subscribe(update);
			update();
			window.addEventListener("resize", measureRail);
			frame = requestAnimationFrame(initialize);
			return {
				button: btn,
				/** The sidebar box, so the panel can sit in the list instead of beside it. */
				sidebarRect() {
					if (!sidebar || !sidebar.isConnected) return null;
					const r = sidebar.getBoundingClientRect();
					if (!r || r.width < 1) return null;
					return { left: r.left, top: r.top, width: r.width, height: r.height, bottom: r.bottom };
				},
				dispose() {
					disposed = true;
					cancelAnimationFrame(frame);
					observer?.disconnect();
					bootObserver?.disconnect();
					bootObserver = null;
					resizeObserver?.disconnect();
					unsubscribe();
					window.removeEventListener("resize", measureRail);
					btn.removeEventListener("click", click);
					btn.remove();
					style?.remove();
					source.dispose();
				}
			};
		}

		function BellPanel({ source, anchor, theme }) {
			const [mounted, setMounted] = React.useState(false);
			const rootRef = React.useRef(null);
			React.useEffect(() => {
				let unsubscribe = () => {};
				const show = () => {
					if (!source.getSnapshot().open) return;
					unsubscribe();
					setMounted(true);
				};
				unsubscribe = source.subscribe(show);
				show();
				return unsubscribe;
			}, [source]);
			React.useLayoutEffect(() => {
				const root = rootRef.current;
				if (!mounted || !root) return;
				const scroll = root.querySelector(".dsb-scroll");
				const settings = root.querySelector(".dsb-settings");
				const gear = root.querySelector('[data-settings="1"]');
				// Palette + picker. The DOM here is owned by draw(), so the settings row is
				// built once and only its selection state is rewritten.
				const detachTheme = typeof theme?.apply === "function" ? theme.apply(root) : () => {};
				let settingsOpen = false;
				// A collapsed picker keeps its five buttons in the DOM; height 0 alone leaves
				// them in the tab order and in the a11y tree, so mark the row hidden too.
				settings?.setAttribute("aria-hidden", "true");
				const drawSettings = () => {
					if (!settings) return;
					if (!settings.children.length) {
						const inner = document.createElement("div");
						inner.className = "dsb-settings-inner";
						const row = document.createElement("div");
						row.className = "dsb-settings-row";
						const label = document.createElement("span");
						label.className = "dsb-settings-label";
						label.textContent = "界面主题";
						const now = document.createElement("span");
						now.className = "dsb-settings-now";
						row.append(label, now);
						const seg = document.createElement("div");
						seg.className = "dsb-seg";
						seg.setAttribute("role", "group");
						seg.setAttribute("aria-label", "界面主题");
						for (const m of THEME_MODES) {
							const button = document.createElement("button");
							button.type = "button";
							button.dataset.mode = m;
							button.textContent = THEME_LABELS[m];
							seg.append(button);
						}
						inner.append(row, seg);
							// Jump-then-reveal: keep the host sidebar pointing at the same session.
							const revealRow = document.createElement("div");
							revealRow.className = "dsb-settings-row dsb-settings-sw";
							const revealName = document.createElement("span");
							revealName.className = "dsb-settings-label";
							revealName.textContent = "侧栏定位";
							const revealToggle = document.createElement("button");
							revealToggle.type = "button";
							revealToggle.className = "dsb-toggle";
							revealToggle.dataset.reveal = "1";
							revealToggle.setAttribute("role", "switch");
							revealToggle.setAttribute("aria-label", "跳转会话时滚动左侧边栏");
							revealRow.append(revealName, revealToggle);
							inner.append(revealRow);
							// One switch for the whole floating dock: some windows have no room
							// for a float, and the bell already lists the same sessions.
							const dockRow = document.createElement("div");
							dockRow.className = "dsb-settings-row dsb-settings-sw";
							const dockName = document.createElement("span");
							dockName.className = "dsb-settings-label";
							dockName.textContent = "悬浮条";
							const dockToggle = document.createElement("button");
							dockToggle.type = "button";
							dockToggle.className = "dsb-toggle";
							dockToggle.dataset.dock = "1";
							dockToggle.setAttribute("role", "switch");
							dockToggle.setAttribute("aria-label", "显示悬浮的会话条");
							dockRow.append(dockName, dockToggle);
							inner.append(dockRow);
						// Do-not-disturb: one switch per kind of nudge the bell can send.
						for (const [key, text] of ALERT_ROWS) {
							const line = document.createElement("div");
							line.className = "dsb-settings-row dsb-settings-alert";
							const name = document.createElement("span");
							name.className = "dsb-settings-label";
							name.textContent = text;
							const toggle = document.createElement("button");
							toggle.type = "button";
							toggle.className = "dsb-toggle";
							toggle.dataset.alert = key;
							toggle.setAttribute("role", "switch");
							toggle.setAttribute("aria-label", text);
							line.append(name, toggle);
							inner.append(line);
						}
						settings.append(inner);
					}
					const mode = theme ? theme.getSnapshot().mode : "auto";
					const seg = settings.querySelector(".dsb-seg");
					if (seg) seg.setAttribute("data-mode", mode);
					const now = settings.querySelector(".dsb-settings-now");
					if (now) now.textContent = themeNow(theme);
					// Scope to the segment's own buttons: a bare [data-mode] sweep would also
					// hit the seg element itself (it carries data-mode to move the thumb).
					for (const button of seg ? seg.querySelectorAll("button") : []) {
						button.classList.toggle("on", button.dataset.mode === mode);
						button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
					}
					const revealNow = revealPref.get();
					for (const toggle of settings.querySelectorAll("[data-reveal]")) {
						toggle.setAttribute("aria-checked", String(revealNow));
						toggle.title = revealNow
							? "已开启：跳到某条会话时，左侧边栏会滚到它的位置"
							: "已关闭：只切换会话，左侧边栏保持原样";
					}
					const dockNow = dockPref.get();
					for (const toggle of settings.querySelectorAll("[data-dock]")) {
						toggle.setAttribute("aria-checked", String(dockNow));
						toggle.title = dockNow
							? "已显示：右下角悬浮条可用，点它展开会话列表"
							: "已隐藏：只剩这个铃铛，会话列表在面板里看";
					}
					const alertsNow = typeof source.getAlerts === "function"
						? source.getAlerts()
						: { done: true, pick: true };
					for (const toggle of settings.querySelectorAll("[data-alert]")) {
						const on = alertsNow[toggle.dataset.alert] !== false;
						toggle.setAttribute("aria-checked", String(on));
						toggle.title = on ? "已开启，这类事件会弹提醒" : "已关闭，这类事件不再弹提醒";
					}
				};
				drawSettings();
				const unsubscribeTheme = typeof theme?.subscribe === "function" ? theme.subscribe(drawSettings) : () => {};
				const unsubscribeReveal = revealPref.subscribe(drawSettings);
				const unsubscribeDock = dockPref.subscribe(drawSettings);
				let previous = null;
				let wasOpen = false;
				const position = () => {
					if (!source.getSnapshot().open || !anchor.button.isConnected) return;
					const rect = anchor.button.getBoundingClientRect();
					const side = typeof anchor.sidebarRect === "function" ? anchor.sidebarRect() : null;
					// The bell opens the activity list *in place of* the sidebar list: same
					// column, from under the bell down to the bottom of the sidebar. A narrow
					// window (or a rail) has no room for that, so it keeps the floating card.
					const fill = side && side.width >= 200 && window.innerWidth >= 720;
					root.classList.toggle("dsb-fill", Boolean(fill));
					if (fill) {
						root.style.left = Math.round(side.left + 4) + "px";
						root.style.width = Math.round(side.width - 8) + "px";
						root.style.top = Math.round(Math.max(rect.bottom + 6, side.top)) + "px";
						root.style.bottom = Math.round(Math.max(6, window.innerHeight - side.bottom + 8)) + "px";
						root.style.maxHeight = "none";
						root.style.setProperty("--dsb-origin", "top center");
						root.style.setProperty("--dsb-from", "-8px");
						return;
					}
					const height = Math.min(window.innerHeight * .6, 480);
					const below = window.innerHeight - rect.bottom - 8;
					const above = below < height && rect.top - 8 > below;
					root.style.width = "320px";
					root.style.left = clamp(rect.left, 8, Math.max(8, window.innerWidth - 328)) + "px";
					root.style.top = above ? "auto" : (rect.bottom + 6) + "px";
					root.style.bottom = above ? (window.innerHeight - rect.top + 6) + "px" : "auto";
					root.style.maxHeight = Math.max(0, Math.min(height, above ? rect.top - 14 : below - 6)) + "px";
					// The panel grows out of the bell: origin and the entry offset follow the flip.
					root.style.setProperty("--dsb-origin", above ? "bottom left" : "top left");
					root.style.setProperty("--dsb-from", above ? "6px" : "-6px");
				};
				// Right-click menu. Built on demand and parked inside the panel, so it
				// needs no anchor: a session row carries the id and the title the
				// bookmark wants, and nothing else has to be on screen.
				let menu = null;
				const closeMenu = () => {
					if (!menu) return;
					menu.remove();
					menu = null;
				};
				const openMenu = (sessionId, sessionTitle, clientX, clientY) => {
					if (!sessionId) return;
					closeMenu();
					const box = root.getBoundingClientRect();
					const el = document.createElement("div");
					el.className = "dsb-menu";
					el.setAttribute("role", "menu");
					const item = document.createElement("button");
					item.type = "button";
					item.className = "dsb-menu-item";
					item.setAttribute("role", "menuitem");
					item.setAttribute("data-fav-toggle", sessionId);
					// Carry the row's title too: the session list is the canonical source,
					// but a row can be on screen for a session the list has already dropped.
					if (sessionTitle) item.setAttribute("data-fav-title", sessionTitle);
					const saved = Boolean(favoriteOfSession(sessionId));
					item.textContent = saved ? "移除书签" : "加入书签";
					el.append(item);
					// Keep the menu inside the panel even when the click lands on the edge.
					const width = root.offsetWidth || 320;
					const height = root.offsetHeight || 400;
					el.style.left = clamp(clientX - box.left, 6, Math.max(6, width - 136)) + "px";
					el.style.top = clamp(clientY - box.top, 6, Math.max(6, height - 40)) + "px";
					root.append(el);
					menu = el;
					item.focus?.({ preventScroll: true });
				};
				const draw = (snap) => {
					closeMenu();
					const byId = new Map(snap.items.map((it) => [it.id, it]));
					// One line per conversation: a parent owns its subagent rows.
					const roots = snap.items.filter((it) => !(it.parentId && it.parentId !== it.id && byId.has(it.parentId)));
					// Running first inside a bucket, then newest: the thing you are waiting on
					// outranks the thing that merely happened later.
					const ordered = roots.slice().sort((a, b) => (Number(b.running) - Number(a.running)) || (b.updatedAt - a.updatedAt));
					const fragment = document.createDocumentFragment();
					const element = (tag, cls, text) => {
						const el = document.createElement(tag);
						el.className = cls;
						if (text !== undefined) el.textContent = text;
						return el;
					};
					// Buckets are contiguous: the list is already sorted by time.
					const buckets = [];
					let bucketKey = null;
					for (const it of ordered) {
						const key = dayStart(it.updatedAt || Date.now());
						if (key !== bucketKey) { buckets.push([key, []]); bucketKey = key; }
						buckets[buckets.length - 1][1].push(it);
					}
					for (const [key, group] of buckets) {
						fragment.append(element("div", "dsb-group dsb-day", dayLabel(key)));
						for (const it of group) {
							const flagged = it.pending || it.unread;
							const row = element("div", "dsb-row" + (flagged ? " dsb-flagged" : "") + (snap.current === it.id ? " dsb-active" : ""));
							const jump = element("button", "dsb-jump");
							jump.type = "button";
							jump.dataset.session = it.id;
							jump.title = it.folder ? it.title + " · " + it.folder : it.title;
							const main = element("span", "dsb-main");
							main.append(element("span", "dsb-title", it.title));
							// Day buckets mix projects, so the folder is the only cue for which
							// sibling the session belongs to.
							if (it.folder) main.append(element("span", "dsb-sub", it.folder));
							jump.append(domStateDot(rowState(it)), main, element("span", "dsb-time", timeLabel(it.updatedAt)));
							row.append(jump);
							fragment.append(row);
						}
					}
					if (!roots.length) fragment.append(element("div", "dsb-empty", "还没有活动 / No activity yet"));
					// "Mark all read" lives in the header now, so it has to hide itself the
					// moment there is nothing left to clear.
					const headClear = root.querySelector("[data-clear-unread]");
					if (headClear) headClear.hidden = !roots.some((it) => it.unread);
					const scrollTop = scroll.scrollTop;
					scroll.replaceChildren(fragment);
					scroll.scrollTop = scrollTop;
				};
				const sync = () => {
					const snap = source.getSnapshot();
					const opening = snap.open && !wasOpen;
					// Place the panel before the class flips so the entry animation starts
					// from the correct origin and the exit plays towards the bell.
					if (opening) position();
					if (snap.open && !snapshotsEqual(previous, snap)) { draw(snap); previous = snap; }
					// Visibility is a CSS state, not the hidden attribute: closing keeps the
					// node in the document long enough for the fade to finish.
					if (opening) {
						// The first open inserts this node. Settle the closed style first, or the
						// browser paints it already open and the whole transition is skipped.
						void root.offsetWidth;
						root.classList.add("dsb-in");
					} else {
						root.classList.toggle("dsb-in", snap.open);
					}
					root.setAttribute("aria-hidden", snap.open ? "false" : "true");
					if (opening) root.focus({ preventScroll: true });
					wasOpen = snap.open;
				};
				const contextmenu = (event) => {
					const row = event.target.closest && event.target.closest("[data-session]");
					if (!row) return;
					event.preventDefault();
					event.stopPropagation();
					// dataset first: real DOM reflects both, the test fixture does not.
					const id = row.dataset?.session || row.getAttribute("data-session");
					openMenu(id, row.title || sessionTitleOf(id), event.clientX, event.clientY);
				};
				const click = (event) => {
					const favHit = event.target.closest("[data-fav-toggle]");
					if (favHit) {
						// getAttribute, not dataset: the same selector has to work against
						// the DOM this is built with and the plain-object rows in test.
						toggleSessionFavorite(
							favHit.getAttribute("data-fav-toggle"),
							favHit.getAttribute("data-fav-title") || ""
						);
						closeMenu();
						return;
					}
					if (menu && event.target && !menu.contains(event.target)) closeMenu();
					const clearHit = event.target.closest("[data-clear-unread]");
					if (clearHit) {
						// The source notifies, and the subscription redraws the list.
						if (typeof source.markAllSeen === "function") source.markAllSeen();
						return;
					}
					const gearHit = event.target.closest('[data-settings="1"]');
					if (gearHit) {
						settingsOpen = !settingsOpen;
						settings?.classList.toggle("dsb-show", settingsOpen);
						gearHit.setAttribute("aria-expanded", String(settingsOpen));
						settings?.setAttribute("aria-hidden", String(!settingsOpen));
						// Focus may be sitting on a control that just collapsed; park it on the
						// gear, or the next Tab would resume from inside the hidden block.
						if (!settingsOpen && settings?.contains?.(document.activeElement)) gearHit.focus({ preventScroll: true });
						if (settingsOpen) drawSettings();
						return;
					}
					const revealHit = event.target.closest("[data-reveal]");
					if (revealHit) {
						revealPref.set(!revealPref.get());
						drawSettings();
						return;
					}
					const dockHit = event.target.closest("[data-dock]");
					if (dockHit) {
						// The dock subscribes to this store and unmounts itself; nothing to
						// repaint here beyond the switch the user just touched.
						dockPref.set(!dockPref.get());
						drawSettings();
						return;
					}
					const alertHit = event.target.closest("[data-alert]");
					if (alertHit) {
						// Read the stored value, not the painted attribute: another window may
						// have flipped the switch since the last repaint, and acting on the
						// stale paint would send a no-op that looks like a broken button.
						const live = typeof source.getAlerts === "function" ? source.getAlerts() : null;
						const on = live && alertHit.dataset.alert in live
							? live[alertHit.dataset.alert] !== false
							: alertHit.getAttribute("aria-checked") === "true";
						if (typeof source.setAlert === "function") source.setAlert(alertHit.dataset.alert, !on);
						drawSettings();
						return;
					}
					const modeHit = event.target.closest("[data-mode]");
					if (modeHit) {
						theme?.setMode(modeHit.dataset.mode);
						drawSettings();
						return;
					}
					const jump = event.target.closest("[data-session]");
					if (jump) source.openSession(jump.dataset.session);
				};
				const outside = (event) => {
					if (!root.contains(event.target) && !anchor.button.contains(event.target)) source.setOpen(false);
				};
				const key = (event) => {
					if (event.key !== "Escape") return;
					if (menu) {
						closeMenu();
						return;
					}
					// One Escape closes the settings row, the next one closes the panel.
					if (settingsOpen) {
						settingsOpen = false;
						settings?.classList.remove("dsb-show");
						gear?.setAttribute("aria-expanded", "false");
						settings?.setAttribute("aria-hidden", "true");
						if (settings?.contains?.(document.activeElement)) gear?.focus?.({ preventScroll: true });
						return;
					}
					if (!source.getSnapshot().open) return;
					source.setOpen(false);
					anchor.button.focus({ preventScroll: true });
				};
				const unsubscribe = source.subscribe(() => {
					sync();
					// The two do-not-disturb switches are shared across windows: keep the
					// painted picker in step when another window flips one.
					if (settingsOpen) drawSettings();
				});
				let disposed = false;
				const dispose = () => {
					if (disposed) return;
					disposed = true;
					unsubscribe();
					unsubscribeTheme();
					unsubscribeReveal();
					unsubscribeDock();
					detachTheme();
					root.classList.remove("dsb-in");
					root.setAttribute("aria-hidden", "true");
					root.removeEventListener("click", click);
					root.removeEventListener("contextmenu", contextmenu);
					closeMenu();
					scroll.removeEventListener("scroll", position);
					window.removeEventListener("resize", position);
					document.removeEventListener("pointerdown", outside, true);
					document.removeEventListener("keydown", key);
				};
				const detach = source.attachPanel({ position, dispose });
				root.addEventListener("click", click);
				root.addEventListener("contextmenu", contextmenu);
				scroll.addEventListener("scroll", position, { passive: true });
				window.addEventListener("resize", position);
				document.addEventListener("pointerdown", outside, true);
				document.addEventListener("keydown", key);
				sync();
				return () => { detach(); dispose(); };
			}, [mounted, source, anchor]);
			return mounted ? React.createElement("div", {
				id: "dsh-session-top-new-activity", className: "dsb-panel", role: "dialog",
				"aria-label": "活动", tabIndex: -1, ref: rootRef, "aria-hidden": "true"
			},
			React.createElement("div", { className: "dsb-head" },
				React.createElement("span", { className: "dsb-heading" }, "活动 / Activity"),
				React.createElement("button", {
					type: "button",
					className: "dsb-clear dsb-head-clear",
					"data-clear-unread": "1",
					"aria-label": "把未读全部标为已读 / Mark all unread as read",
					title: "把未读全部标为已读 / Mark all unread as read"
				}, "全部已读"),
				React.createElement("button", {
					type: "button",
					className: "dsb-iconbtn",
					"data-settings": "1",
					"aria-label": "外观设置",
					"aria-expanded": "false",
					title: "外观设置"
				}, iconGear(15))),
			React.createElement("div", { className: "dsb-settings" }),
			React.createElement("div", { className: "dsb-scroll" }),
			React.createElement("div", { className: "dsb-footer" }, "显示悬浮窗")) : null;
		}

		// ------------------------------------------------------------------
		// Plugin entry
		// ------------------------------------------------------------------

		// A ref back to the client services this widget navigates through,
		// resolved lazily so it still works when a service mounts slightly after
		// this plugin's apply.
		let ctxRef = () => null;

		/** Open a session through whichever controller this build exposes. */
		function openSessionById(id) {
			try {
				const ws = ctxRef("uiWorkspace");
				if (ws && typeof ws.openSession === "function") {
					ws.openSession(id);
					return true;
				}
			} catch (error) {
				warnOnce("openSession failed", error);
			}
			try {
				const sessions = ctxRef("sessions");
				if (sessions && typeof sessions.open === "function") {
					sessions.open(id);
					return true;
				}
			} catch (error) {
				warnOnce("sessions.open failed", error);
			}
			warnOnce("no session-open capability found on this DSH build");
			return false;
		}

		/**
		 * Scroll the host sidebar so this session's row is on screen. The host owns
		 * that list; we only read its row marker (`data-row-key="session:<id>"`) and
		 * ask it to scroll, which is exactly what its own rows do on click. A row that
		 * is not in the DOM — a collapsed project, a filtered list — is left alone:
		 * expanding other people's tree from here would fight the user's own state.
		 */
		function revealSidebarRow(id) {
			if (!id || typeof document === "undefined") return;
			const raw = String(id);
			const safe = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(raw) : raw;
			const row = document.querySelector('[data-row-key="session:' + safe + '"]');
			if (row && typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
		}

		/** Jump to a session, then optionally put its row on screen in the sidebar. */
		function jumpToSession(id) {
			const ok = openSessionById(id);
			if (ok && revealPref.get()) revealSidebarRow(id);
		}

		function apply(ctx) {
			ctxRef = (name) => {
				// ctx.get() reads an optional service without an inject declaration;
				// fall back to the reflection face for builds that only expose it there.
				try {
					const viaGet = ctx.get(name);
					if (viaGet !== undefined && viaGet !== null) return viaGet;
				} catch {}
				try {
					return ctx.reflect.get(name) ?? null;
				} catch {
					return null;
				}
			};

			ctx.effect(() => {
				const themeSource = createThemeSource();
				return ctx.slots.inject("shell.overlay", () => {
					const dockSource = createDockSource(ctx);
					const bellSource = createBellSource(dockSource, ctx);
					const anchor = mountSidebarBell(bellSource);
					const disposeDock = ctx.slots.register({
						name: "shell.overlay",
						id: "dsh-session-top-new",
						registrant: "dsh-session-top-new",
						inject: () => ({ hooks: { dock: dockSource }, theme: themeSource })
					}, DockWidget);
					const disposeBell = ctx.slots.register({
						name: "shell.overlay",
						id: "dsh-session-top-new-bell",
						registrant: "dsh-session-top-new",
						inject: () => ({ source: bellSource, anchor, theme: themeSource })
					}, BellPanel);
					return () => {
						anchor.dispose();
						disposeBell();
						disposeDock();
						dockSource.dispose();
						themeSource.dispose();
					};
				});
			}, "dsh-session-top-new: overlay dock");

			// Bookmark button in every assistant turn's action strip. The slot is
			// session-scoped and passes the owning sessionId plus the turn's
			// messageId, which is the only stable identity a reply has.
			ctx.effect(() => ctx.slots.inject("conversation.chat.assistant-actions", () => {
				const dispose = ctx.slots.register({
					name: "conversation.chat.assistant-actions",
					id: "dsh-session-top-new-favorite",
					registrant: "dsh-session-top-new",
					order: 30,
					inject: (sessionId) => ({ sessionId })
				}, FavoriteAction);
				return () => {
					dispose();
				};
			}), "dsh-session-top-new: favourite action");
		}

		/** ctx capabilities this plugin needs (gate for ctx.slots access). */
		const inject = ["slots"];

		module.exports = { apply, inject };
		return module.exports;
	}
});

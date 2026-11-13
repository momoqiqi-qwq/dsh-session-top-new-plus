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

		/** Session list: three rows with leading dots. */
		function iconList(size) {
			return svgIcon(size, [
				React.createElement("circle", { key: "d1", cx: 4.5, cy: 6, r: 1.3, fill: "currentColor", stroke: "none" }),
				React.createElement("circle", { key: "d2", cx: 4.5, cy: 12, r: 1.3, fill: "currentColor", stroke: "none" }),
				React.createElement("circle", { key: "d3", cx: 4.5, cy: 18, r: 1.3, fill: "currentColor", stroke: "none" }),
				React.createElement("line", { key: "l1", x1: 9.5, y1: 6, x2: 20, y2: 6 }),
				React.createElement("line", { key: "l2", x1: 9.5, y1: 12, x2: 20, y2: 12 }),
				React.createElement("line", { key: "l3", x1: 9.5, y1: 18, x2: 20, y2: 18 })
			]);
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

		/** Disclosure chevron; `down` = expanded, `right` = collapsed. */
		function iconChevron(size, dir) {
			return svgIcon(size, React.createElement("polyline", {
				points: dir === "down" ? "6 9 12 15 18 9" : "9 6 15 12 9 18"
			}));
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
					isSubagent: s.origin === "subagent" || s.parentId !== undefined
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
				   The dock deliberately INVERTS the page theme: a light page gets
				   dark chrome, a dark page gets light chrome, so the floating panel
				   never blends into whatever sits behind it.
				   Keyed on body[data-ds-dark-theme], the attribute DSH toggles for
				   its dark theme (see dsh-client-ui-theme). */
				.dsd-root {
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
					--dsd-active: rgba(99, 102, 241, 0.24);
					--dsd-field-bg: rgba(255, 255, 255, 0.08);
					--dsd-field-border: rgba(255, 255, 255, 0.15);
					--dsd-scrollbar: rgba(255, 255, 255, 0.14);
					--dsd-ring: 0 0 0 0.5px rgba(255, 255, 255, 0.10);
					--dsd-btn-shadow: 0 8px 24px rgba(0, 0, 0, 0.38);
					--dsd-panel-shadow: 0 12px 36px rgba(0, 0, 0, 0.42);
					--dsd-dot-running: #22c55e;
					--dsd-dot-pending: #f59e0b;
				}
				/* dark page -> light dock */
				body[data-ds-dark-theme] .dsd-root {
					--dsd-surface: rgba(250, 250, 251, 0.97);
					--dsd-label: #18181d;
					--dsd-label-dim: #52525b;
					--dsd-label-faint: #71717a;
					--dsd-border: rgba(0, 0, 0, 0.08);
					--dsd-divider: rgba(0, 0, 0, 0.12);
					--dsd-hover: rgba(0, 0, 0, 0.05);
					--dsd-hover-strong: rgba(0, 0, 0, 0.09);
					--dsd-active: rgba(99, 102, 241, 0.16);
					--dsd-field-bg: rgba(0, 0, 0, 0.04);
					--dsd-field-border: rgba(0, 0, 0, 0.12);
					--dsd-scrollbar: rgba(0, 0, 0, 0.16);
					--dsd-ring: 0 0 0 0.5px rgba(0, 0, 0, 0.10);
					--dsd-btn-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
					--dsd-panel-shadow: 0 12px 36px rgba(0, 0, 0, 0.18);
					--dsd-dot-running: #16a34a;
					--dsd-dot-pending: #d97706;
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
					transform: translateX(8px) scale(0.96);
					transform-origin: top right;
					pointer-events: none;
					transition: opacity 0.16s ease, transform 0.16s ease;
				}
				.dsd-panel.show {
					opacity: 1;
					transform: translateX(0) scale(1);
					pointer-events: auto;
				}
				/* Open upward when the dock sits too low for a downward panel. */
				.dsd-panel.up {
					top: auto;
					bottom: calc(100% + 10px);
					transform-origin: bottom right;
				}
				/* Open rightward when the dock sits too far left for a 300px panel. */
				.dsd-panel.flipx { right: auto; left: 0; transform-origin: top left; }
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
					font-size: 14px;
					line-height: 1;
					padding: 4px;
					border-radius: 6px;
					display: flex;
				}
				.dsd-iconbtn:hover { color: var(--dsd-label); background: var(--dsd-field-bg); }
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
				.dsd-dot {
					flex: none;
					width: 8px;
					height: 8px;
					border-radius: 50%;
					background: transparent;
				}
				.dsd-dot.running { background: var(--dsd-dot-running); animation: dsd-pulse 1.2s ease-in-out infinite; }
				.dsd-dot.pending { background: var(--dsd-dot-pending); }
				.dsd-dot.done { background: transparent; }
				.dsd-chevron {
					flex: none;
					width: 12px;
					display: flex;
					align-items: center;
					justify-content: center;
					color: var(--dsd-label-faint);
					user-select: none;
					-webkit-user-select: none;
				}
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
				@keyframes dsd-pulse {
					0%, 100% { opacity: 1; transform: scale(1); }
					50% { opacity: 0.45; transform: scale(0.75); }
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
				.dsd-dot.fav { background: #f0b429; }
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
		const POS_KEY = "dsh-session-top-new.pos";
		const DISMISS_KEY = "dsh-session-top-new.dismissed";
		const FAV_KEY = "dsh-session-top-new.favorites";

		/** Same-document change notification (the `storage` event only fires cross-tab). */
		const FAV_EVENT = "dsh-session-top-new:favorites";
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

		function addFavorite(entry) {
			const list = loadFavorites().filter((it) => it.id !== entry.id);
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
				const sync = () => setSaved(isFavorited(sessionId, messageId));
				window.addEventListener(FAV_EVENT, sync);
				window.addEventListener("storage", sync);
				return () => {
					window.removeEventListener(FAV_EVENT, sync);
					window.removeEventListener("storage", sync);
				};
			}, [sessionId, messageId]);

			const toggle = () => {
				const id = sessionId + ":" + messageId;
				if (isFavorited(sessionId, messageId)) {
					removeFavorite(id);
					setSaved(false);
					return;
				}
				const text = extractTurnText(ref.current);
				if (!text) {
					warnOnce("favourite: could not read this turn's text");
					return;
				}
				const sessions = ctxRef("sessions");
				let title = "";
				try {
					const byId = sessions && sessions.list && sessions.list.getSnapshot().byId;
					const rec = byId && byId[sessionId];
					if (rec && typeof rec.displayTitle === "string") title = rec.displayTitle;
				} catch {}
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

		function DockWidget({ useDock }) {
			const dock = typeof useDock === "function" ? useDock((s) => s) : null;

			const [open, setOpen] = React.useState(true); // default expanded
			const [days, setDays] = React.useState(loadDays);
			const [muted, setMuted] = React.useState(loadMuted);
			const [pos, setPos] = React.useState(loadPos);
			const [dragging, setDragging] = React.useState(false);
			const [expandedParents, setExpandedParents] = React.useState({}); // id -> bool
			const [dismissed, setDismissed] = React.useState(loadDismissed); // id -> updatedAt
			const [favorites, setFavorites] = React.useState(loadFavorites);
			// Live size of the positioning container (the shell overlay layer), so
			// the dock re-anchors whenever the window or the frame resizes.
			const [viewport, setViewport] = React.useState(() => ({
				w: window.innerWidth,
				h: window.innerHeight
			}));
			const rootRef = React.useRef(null);

			const mutedRef = React.useRef(muted);
			mutedRef.current = muted;

			// Running/unread state per session, for the completion chime. The two
			// flags are tracked separately: clearing `unread` means the user just
			// looked at the session, which is not a completion and must stay silent.
			const prevStateRef = React.useRef(null); // Map<id, { running, unread }>

			React.useEffect(() => {
				ensureStyles();
			}, []);

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
						if (!mutedRef.current) playChime();
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
				return filtered.filter((it) => (it.pending || it.unread) && it.id !== (dock ? dock.current : null)).length;
			}, [filtered, dock]);

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

			const onClickItem = (id) => {
				// Navigation belongs to the Workspace controller in current builds
				// (`uiWorkspace.openSession`); older builds exposed `sessions.open`.
				try {
					const ws = ctxRef("uiWorkspace");
					if (ws && typeof ws.openSession === "function") {
						ws.openSession(id);
						return;
					}
				} catch (error) {
					warnOnce("openSession failed", error);
				}
				try {
					const sessions = ctxRef("sessions");
					if (sessions && typeof sessions.open === "function") {
						sessions.open(id);
						return;
					}
				} catch (error) {
					warnOnce("sessions.open failed", error);
				}
				warnOnce("no session-open capability found on this DSH build");
				// Keep the panel open after jumping to a session.
			};

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
				const dotCls = it.running ? "dsd-dot running" : (flagged ? "dsd-dot pending" : "dsd-dot done");
				const kids = tree.childrenOf[it.id] || [];
				const hasKids = kids.length > 0;
				const expanded = !!expandedParents[it.id];
				const chevron = hasKids ? (expanded ? iconChevron(10, "down") : iconChevron(10, "right")) : null;
				return React.createElement(
					"div",
					{
						key: it.id,
						className: "dsd-item" + (isChild ? " dsd-child" : "") + (active ? " active" : "") + (flagged ? " pending" : ""),
						onClick: () => onClickItem(it.id),
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
					React.createElement("span", { className: dotCls }),
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
				React.createElement("span", { className: "dsd-dot fav" }),
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
					open ? iconClose(20) : iconList(20)
				),
				React.createElement(
					"div",
					{ className: panelCls },
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
								? React.createElement("div", { className: "dsd-empty dsd-empty-sm" }, "回复下方点书签即可添加")
								: favorites.map(renderFav)
						)
					),
					React.createElement(
						"div",
						{ className: "dsd-foot" },
						(runningCount > 0 ? runningCount + " 个进行中 · " : "") + unreadCount + " 个未读结果"
					)
				),
			);
		}

		function createBellSource(dockSource, ctx) {
			const listeners = new Set();
			let disposed = false;
			let state = { items: [], current: null, unreadCount: 0, runningCount: 0, open: false };
			let previous = null;
			let previousDays = null;
			let panel = null;
			const notify = () => { for (const fn of listeners) fn(); };
			const sync = () => {
				if (disposed) return;
				const dock = dockSource.getSnapshot();
				const days = loadDays();
				if (dock === previous && days === previousDays) return;
				previous = dock;
				previousDays = days;
				const cutoff = Date.now() - days * 86400000;
				const items = (dock?.items || []).filter((it) => !it.blank && it.updatedAt >= cutoff);
				const current = dock?.current ?? null;
				const next = {
					items, current, open: state.open,
					unreadCount: items.filter((it) => (it.pending || it.unread) && it.id !== current).length,
					runningCount: items.filter((it) => it.running).length
				};
				if (snapshotsEqual(next, state)) return;
				state = next;
				notify();
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
				attachPanel(hook) { panel = hook; return () => { if (panel === hook) panel = null; }; },
				positionPanel() { panel?.position(); },
				openSession(id) {
					try {
						const ws = ctxRef("uiWorkspace");
						if (typeof ws?.openSession === "function") { ws.openSession(id); return; }
						const sessions = ctxRef("sessions");
						if (typeof sessions?.open === "function") { sessions.open(id); return; }
						warnOnce("no session-open capability found on this DSH build");
					} catch (error) { warnOnce("activity openSession failed", error); }
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
					color: inherit; background: transparent; opacity: .72; cursor: pointer; }
				.dsb-button:hover, .dsb-button[aria-expanded="true"] { opacity: 1; background: rgba(127,127,127,.12); }
				.dsb-button.dsb-rail { display: none; }
				.dsb-badge { display: none; position: absolute; top: 3px; right: 3px; width: 6px; height: 6px;
					border-radius: 50%; background: #ef4444; font-size: 0; }
				.dsb-unread .dsb-badge { display: block; animation: dsb-breathe 2s ease-in-out infinite; }
				@keyframes dsb-breathe { 50% { opacity: .45; } }
				.dsb-panel { position: fixed; z-index: 2147483001; width: 320px; max-width: calc(100vw - 16px);
					max-height: min(60vh, 480px); display: flex; flex-direction: column; overflow: hidden;
					border-radius: 12px; border: 1px solid rgba(127,127,127,.2); pointer-events: auto;
					color: var(--dsw-alias-label-primary, CanvasText); background: var(--dsw-alias-bg-base, Canvas);
					box-shadow: var(--dsd-panel-shadow, 0 12px 36px rgba(0,0,0,.24));
					font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
				.dsb-panel[hidden] { display: none; }
				.dsb-heading { padding: 12px 14px; font-size: 14px; font-weight: 600; }
				.dsb-scroll { overflow-y: auto; min-height: 0; padding: 0 6px 6px; }
				.dsb-group { padding: 10px 8px 5px; opacity: .6; font-size: 11px; }
				.dsb-row { display: flex; align-items: center; gap: 7px; padding: 8px; border-radius: 6px; }
				.dsb-row:hover, .dsb-row.dsb-active { background: rgba(127,127,127,.12); }
				.dsb-row button { font: inherit; color: inherit; border: 0; background: transparent; cursor: pointer; padding: 0; }
				.dsb-disclosure, .dsb-spacer { flex: 0 0 14px; width: 14px; }
				.dsb-row .dsb-jump { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; text-align: left; }
				.dsb-dot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: rgba(127,127,127,.4); }
				.dsb-running { background: #22c55e; animation: dsb-breathe 1.2s ease-in-out infinite; }
				.dsb-pending { background: #f59e0b; }
				.dsb-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
				.dsb-flagged .dsb-title { font-weight: 600; }
				.dsb-time { font-size: 11px; opacity: .5; flex: none; }
				.dsb-empty { padding: 16px 8px; opacity: .55; font-size: 12px; }
				.dsb-footer { padding: 9px 12px; border-top: 1px solid rgba(127,127,127,.2); opacity: .6; font-size: 11px; }
				@media (prefers-reduced-motion: reduce) { .dsb-badge, .dsb-running { animation: none; } }
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
				const text = String(snap.unreadCount);
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
				if (!sidebar || disposed) return;
				collapsed = sidebar.clientWidth < 80;
				btn.classList.toggle("dsb-rail", collapsed);
				if (collapsed) source.setOpen(false);
				else source.positionPanel();
			};
			const recover = () => {
				frame = 0;
				if (disposed || !dirty) return;
				dirty = false;
				if (btn.isConnected && btn.parentElement === row && row?.isConnected) return;
				source.setOpen(false);
				const next = findRow(sidebar);
				if (!next) {
					warnOnce("activity: no reliable sidebar header anchor; use the floating dock");
					return;
				}
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
			const initialize = () => {
				frame = 0;
				if (disposed) return;
				for (const candidate of document.querySelectorAll(sidebarSelector)) {
					if (candidate === document.body || candidate === document.documentElement) continue;
					if (!sidebar) sidebar = candidate;
					if (findRow(candidate)) { sidebar = candidate; break; }
				}
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

		function BellPanel({ source, anchor }) {
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
				const expanded = new Set();
				let previous = null;
				let wasOpen = false;
				const position = () => {
					if (!source.getSnapshot().open || !anchor.button.isConnected) return;
					const rect = anchor.button.getBoundingClientRect();
					const height = Math.min(window.innerHeight * .6, 480);
					const below = window.innerHeight - rect.bottom - 8;
					const above = below < height && rect.top - 8 > below;
					root.style.left = clamp(rect.left, 8, Math.max(8, window.innerWidth - 328)) + "px";
					root.style.top = above ? "auto" : (rect.bottom + 6) + "px";
					root.style.bottom = above ? (window.innerHeight - rect.top + 6) + "px" : "auto";
					root.style.maxHeight = Math.max(0, Math.min(height, above ? rect.top - 14 : below - 6)) + "px";
				};
				const draw = (snap) => {
					const byId = new Map(snap.items.map((it) => [it.id, it]));
					const children = new Map();
					const roots = [];
					for (const it of snap.items) {
						if (it.parentId && it.parentId !== it.id && byId.has(it.parentId)) {
							if (!children.has(it.parentId)) children.set(it.parentId, []);
							children.get(it.parentId).push(it);
						} else roots.push(it);
					}
					const priority = (it) => it.running ? 0 : ((it.pending || it.unread) && it.id !== snap.current ? 1 : 2);
					const groups = [[], [], []];
					// A parent's group includes its descendants' activity, even while collapsed.
					const visited = new Set();
					const rank = (it) => {
						if (visited.has(it.id)) return priority(it);
						visited.add(it.id);
						return Math.min(priority(it), ...(children.get(it.id) || []).map(rank));
					};
					for (const it of roots) groups[rank(it)].push(it);
					const fragment = document.createDocumentFragment();
					const element = (tag, cls, text) => {
						const el = document.createElement(tag);
						el.className = cls;
						if (text !== undefined) el.textContent = text;
						return el;
					};
					const rendered = new Set();
					const render = (it, depth) => {
						if (rendered.has(it.id)) return;
						rendered.add(it.id);
						const kids = children.get(it.id) || [];
						const flagged = it.pending || it.unread;
						const row = element("div", "dsb-row" + (flagged ? " dsb-flagged" : "") + (snap.current === it.id ? " dsb-active" : ""));
						row.style.paddingLeft = (8 + Math.min(depth, 8) * 16) + "px";
						if (kids.length) {
							const toggle = element("button", "dsb-disclosure", expanded.has(it.id) ? "▾" : "▸");
							toggle.type = "button";
							toggle.dataset.expand = it.id;
							toggle.setAttribute("aria-label", "展开或收起子会话 / Expand or collapse children");
							toggle.setAttribute("aria-expanded", String(expanded.has(it.id)));
							row.append(toggle);
						} else row.append(element("span", "dsb-spacer"));
						const jump = element("button", "dsb-jump");
						jump.type = "button";
						jump.dataset.session = it.id;
						jump.title = it.title;
						jump.append(element("span", "dsb-dot" + (it.running ? " dsb-running" : flagged ? " dsb-pending" : "")),
							element("span", "dsb-title", it.title), element("span", "dsb-time", timeLabel(it.updatedAt)));
						row.append(jump);
						fragment.append(row);
						if (expanded.has(it.id)) for (const child of kids) render(child, depth + 1);
					};
					const labels = ["运行中 / Running", "未读 / Unread", "最近 / Recent"];
					groups.forEach((group, index) => {
						if (!group.length) return;
						fragment.append(element("div", "dsb-group", labels[index]));
						for (const it of group) render(it, 0);
					});
					if (!roots.length) fragment.append(element("div", "dsb-empty", "没有进行中的会话 / No running sessions"));
					const scrollTop = scroll.scrollTop;
					scroll.replaceChildren(fragment);
					scroll.scrollTop = scrollTop;
				};
				const sync = () => {
					const snap = source.getSnapshot();
					root.hidden = !snap.open;
					if (snap.open && !snapshotsEqual(previous, snap)) { draw(snap); previous = snap; }
					if (snap.open && !wasOpen) { position(); root.focus({ preventScroll: true }); }
					wasOpen = snap.open;
				};
				const click = (event) => {
					const toggle = event.target.closest("[data-expand]");
					if (toggle) {
						const id = toggle.dataset.expand;
						if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
						draw(source.getSnapshot());
						return;
					}
					const jump = event.target.closest("[data-session]");
					if (jump) source.openSession(jump.dataset.session);
				};
				const outside = (event) => {
					if (!root.contains(event.target) && !anchor.button.contains(event.target)) source.setOpen(false);
				};
				const key = (event) => {
					if (event.key !== "Escape" || !source.getSnapshot().open) return;
					source.setOpen(false);
					anchor.button.focus({ preventScroll: true });
				};
				const unsubscribe = source.subscribe(sync);
				let disposed = false;
				const dispose = () => {
					if (disposed) return;
					disposed = true;
					unsubscribe();
					root.hidden = true;
					root.removeEventListener("click", click);
					scroll.removeEventListener("scroll", position);
					window.removeEventListener("resize", position);
					document.removeEventListener("pointerdown", outside, true);
					document.removeEventListener("keydown", key);
				};
				const detach = source.attachPanel({ position, dispose });
				root.addEventListener("click", click);
				scroll.addEventListener("scroll", position, { passive: true });
				window.addEventListener("resize", position);
				document.addEventListener("pointerdown", outside, true);
				document.addEventListener("keydown", key);
				sync();
				return () => { detach(); dispose(); };
			}, [mounted, source, anchor]);
			return mounted ? React.createElement("div", {
				id: "dsh-session-top-new-activity", className: "dsb-panel", role: "dialog",
				"aria-label": "活动", tabIndex: -1, ref: rootRef, hidden: true
			}, React.createElement("div", { className: "dsb-heading" }, "活动 / Activity"),
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
				return ctx.slots.inject("shell.overlay", () => {
					const dockSource = createDockSource(ctx);
					const bellSource = createBellSource(dockSource, ctx);
					const anchor = mountSidebarBell(bellSource);
					const disposeDock = ctx.slots.register({
						name: "shell.overlay",
						id: "dsh-session-top-new",
						registrant: "dsh-session-top-new",
						inject: () => ({ hooks: { dock: dockSource } })
					}, DockWidget);
					const disposeBell = ctx.slots.register({
						name: "shell.overlay",
						id: "dsh-session-top-new-bell",
						registrant: "dsh-session-top-new",
						inject: () => ({ source: bellSource, anchor })
					}, BellPanel);
					return () => {
						anchor.dispose();
						disposeBell();
						disposeDock();
						dockSource.dispose();
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

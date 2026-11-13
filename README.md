# dsh-session-top-new

**Session list too long to search through? The newest session always buried?**

A session overview dock for the **DeepSeek Harness Web GUI**: every session's
unread and running state in one floating panel, one click to jump to any of
them, and a chime when one finishes — so the newest and the unread never get
lost in a long list again.

**会话列表越长越难找？最新会话总被淹没？**

一个 DSH Web GUI 的会话总览悬浮栏：所有会话的未读与运行状态集中在一个小面板里，
点一下就能跳过去，会话跑完会响一声——最新和未读的再也不会被长列表埋掉。

![Session dock panel](assets/screenshot-panel.png)

![Collapsed button with unread badge](assets/screenshot-button.png)

## Features

- **Overview, not per-session** — the dock is a global aggregate: you see the
  state of *all* sessions while you are inside one of them.
- **Live status** — a running session shows a pulsing green dot; a session
  whose result you have not looked at shows an amber dot and a bold title; the
  round button carries a red badge counting unread results.
- **N-day history** — shows sessions updated within the last N days (default:
  today only). N is editable in the panel header, 1–365.
- **Click to jump** — clicking a session switches the main view straight to it.
  The panel stays open.
- **Parent / child grouping** — subagent sessions nest under their parent and
  stay collapsed until you expand them, instead of flattening into one list.
- **Completion chime** — a synthesized two-tone chime (Web Audio, no asset
  files) plays when a session finishes, with a mute toggle.
- **Draggable and resize-aware** — drag the button anywhere; the position is
  stored as a fraction of the window, so it keeps its relative spot when the
  window is resized. The panel flips up or sideways near a screen edge.
- **Dismiss a row** — the ✕ that appears on hover hides that row; it comes back
  by itself once the session produces something newer. Dismissing a parent also
  hides its currently visible subagent rows.
- **Inverts the page theme** — a light page gets dark chrome and a dark page gets
  light chrome, so the panel never blends into whatever is behind it. It follows
  DSH's own theme switch, so there is nothing to configure.
- **Collapsible** — expands by default; click the button to collapse it back to
  a single round button.

The dock in both themes — left is a light page, right is a dark one:

![Theme inversion preview](assets/theme-preview.png)

## Sidebar activity bell / 侧栏活动铃铛

Version 0.2.0 adds a 28px bell beside the search, filter and new-session
controls in the left sidebar's Workspace / 工作区 header. It also recognizes
Sessions / 会话 headers. The red dot breathes while there are unread results;
the tooltip shows their count. The button follows the host theme and hides
when the sidebar collapses to its narrow rail.

Click the bell to open a 320px activity panel grouped as **Running / 运行中**,
**Unread / 未读**, then **Recent / 最近**. Child sessions stay nested and
collapsed until expanded; a child's activity promotes its parent group.
Click a session to jump to it. Escape or a click outside closes the panel.
The list uses the floating dock's N-day setting. The floating dock, its
bookmarks, dragging, dismissal controls and completion chime remain available.
The bell shares the dock's snapshot and never plays a second chime.

DSH exposes no public actions slot in the sidebar header. The plugin therefore
injects only the button into the header DOM and registers the panel as a second
`shell.overlay` entry, `dsh-session-top-new-bell`. It never replaces
`sidebar.workspaces`. The shipped sidebar root only carries hashed CSS-module
classes (`wtg9ga_root`) and its section header is a plain `div`, so no stable
attribute selector matches it: the plugin looks for the `工作区 / Workspaces`
(or `会话 / Sessions`) label, climbs to the row that holds two to eight
controls, and inserts the button immediately before the search control. When no
scoped container matches, that search falls back to the document. Header markup
can change between DSH releases. If a reliable title or search-control row
cannot be found, the plugin logs one warning and leaves the floating dock as
the entry point.

Performance guards: one `MutationObserver` watches the anchor subtree — the
sidebar when a scoped element matched, otherwise the document — with an
immediate return while the button remains anchored. Header replacements
coalesce into one animation-frame lookup, with no layout reads in the mutation
callback and no anchor polling. Failed lookups back off from 400 ms to 8 s, so a
collapsed sidebar or a streaming turn cannot turn into a per-frame document
scan; the backoff is state rather than a timer, so an idle page schedules
nothing. Badge changes update DOM text and classes
directly. The panel's contents mount lazily on the first open and remain hidden
on close, preserving their scroll position and subscriptions. Rows stay within
the dock's N-day window and are replaced through a `DocumentFragment` only when
the snapshot changes. Unloading disconnects observers and removes the injected
button, its stylesheet, panel hooks and shared data subscriptions.

侧栏铃铛位于「工作区 / Workspace」标题旁，与搜索、筛选和新建会话按钮同排。
点击查看运行中、未读及最近会话，子会话默认折叠，点击条目即可跳转。
按 Escape 或点击面板外关闭，再次打开会保留滚动位置。侧栏收窄时自动隐藏。
表头没有公共插槽，因此按钮采用 DOM 注入；宿主升级若改变表头结构，可能需要
适配。找不到可靠位置时只警告一次，仍可使用原有悬浮窗。

## 中文说明

功能一览：

- 圆形按钮可**拖拽**到任意位置，窗口缩放时按比例跟随
- 「近 N 天」可自定义（默认当天）
- 运行中显示绿色脉冲点，未查看结果显示琥珀点，按钮红色角标显示未读数
- 子任务折叠在主任务下，不平铺
- 点击会话直接跳转，面板不自动收起
- 鼠标悬停行尾出现 **×**：忽略该记录，等这个会话有新记录时自动重新出现
  （忽略主任务会同时忽略它当前显示的子任务）
- 配色**反色于页面主题**：浅色主题下用深色外壳、深色主题下用浅色外壳，跟随
  DSH 的主题开关自动切换，无需设置，任何时候都清晰可辨
- 结束提示音使用 Web Audio 合成，无需音频文件，可静音

## Install

```bash
dsh plugin --profile web add github:cuijiajun/dsh-session-top-new
```

Install from source builds the package once, so the first install asks for the
usual build approval.

Then **restart the Web GUI** — the client-modules scan caches package verdicts
per boot, so a newly installed plugin only appears after a restart.

## Layout

```
dsh.plugin.json     plugin manifest (id / version / main / engines)
cordis.patch.yml    bundle patch: mounts the host plugin row
lib/index.js        host entry (no-op; exists so the bundle mounts)
lib/client.js       dock + sidebar bell: __ModuleLoader__ bundle (no build step)
assets/             screenshots
screenshots.json    storefront screenshot list
```

## How it works

The dock registers a root-scope `shell.overlay` entry, so it floats above the
whole app regardless of panel or session. It reads two client services and
keeps only the leaf fields it renders:

| Purpose | Source |
| --- | --- |
| Session list and metadata | `sessions.list` — `ids`, `byId[id]` with `displayTitle`, `running`, `updatedAt`, `parentId`, `origin`, `retainedBy.mainView` |
| Running / unread state | `uiSession.sessionStatus` — `{ running, pendingInteraction, completionUnread }` |
| Jump to a session | `uiWorkspace.openSession(id)` |

The `dock` observable subscribes to both sources, extracts a flat snapshot of
scalars, and hands both surfaces a referentially stable object. The bell derives
its counts and list from that source without subscribing to host services again.
A `running →
finished` transition (or a new `completionUnread` flag) triggers the chime,
respecting the mute toggle.

## Compatibility

This plugin talks to the DSH **client runtime services** named above. They are
the interfaces the official UI itself uses, but they are not a frozen public
API, so a Harness upgrade may rename or restructure them. When that happens the
dock can lose its click-to-jump or status markers until the plugin is updated —
if a control stops responding, check the browser console for a
`[dsh-session-top-new]` warning, which is emitted instead of failing silently.

Tested against DSH builds current as of October 2026.

## License

MIT

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
- **Live status, in the host's own language** — rows use the same StateDot the
  official sidebar uses, with the same precedence: a session waiting on you is
  amber, a *running* one is the rotating ring (not a dot), a result you have not
  looked at is a solid green dot, everything else is neutral. The round button
  carries a red badge counting unread results.
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
- **Inverts the page theme by default** — a light page gets dark chrome and a
  dark page gets light chrome, so the panel never blends into whatever is behind
  it. A gear offers 自动 / 浅色 / 深色 if you would rather pin one.
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
Click a session to jump to it. Opening an unread session clears its flag on
the spot, so the row leaves Unread and lands in Recent the moment you click
it — even while the host is still reporting it unread. The session on screen
is never unread (you are looking at it), and the Unread header carries a
small **全部已读 / mark all read** control, so the whole group can be emptied
in one click instead of one row at a time. Rows waiting on a choice stay:
they are asking for an answer, not for attention. Escape or a click outside
closes the panel.

The panel grows out of the bell: 190ms scale-and-fade on the way in, 130ms
fade back towards it on the way out, with the transform origin following the
flip side so it always leaves from the edge nearest the button. The bell
nudges 12° while the panel is open, presses to 0.9 scale, and the unread dot
pops in before it starts breathing. Panel visibility is a CSS state rather
than the hidden attribute, so the exit animation finishes instead of being
cut off; prefers-reduced-motion drops the transforms and keeps a short fade.
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

### Row markers / 行首标识

The row leading mark is a copy of the host's, not a look-alike:

| State | Mark | Source of truth |
| --- | --- | --- |
| waiting on you | amber dot | `StateDot` `warning` |
| running | 14px rotating ring + breathing arc | `StateDot` `ongoing` |
| finished, not opened | green dot | `StateDot` `done` |
| idle | neutral dot at 50% | `StateDot` `idle` |

Geometry follows the host exactly: a 10px slot painting a 6px core through
`inset: 20%` and `currentColor`; the ring is a 24-unit viewBox with two `r 9.5`
circles, a 25%-opacity track and a `12 150` → `24 150` dash cycle over 1.5s. The
disclosure chevron is also the host's filled triangle (`0 0 16 16`), rotated 90°
by CSS so opening animates instead of swapping glyphs. Reduced-motion disables
both the spin and the rotation, leaving the arc as a static 18-unit segment.

Deliberate consequence: "running" is no longer green. Green belongs to
*finished and unread* — that is the host's meaning, and matching it is the whole
point of this section.

## Theme settings / 主题设置

Version 0.3.0 adds a gear at the right of both panel headers (the sidebar bell
panel and the floating dock). It opens a 自动 / 浅色 / 深色 row; the choice is
shared by both surfaces and persists in localStorage under
dsh-session-top-new.theme.

**自动 is the inversion,** not the page's own colour: on a light page the panels
are dark, on a dark page they are light. That keeps the chrome from blending
into the surface behind it, which is the reason the plugin inverts in the first
place. It watches body[data-ds-dark-theme] (falling back to a data-color-scheme
or data-theme hint, then prefers-color-scheme), so flipping DSH's own theme
switches the panels at the same moment. 浅色 and 深色 pin the palette and ignore
the page.

Each surface paints from its own data-dsb-theme attribute and a small set of CSS
variables (--dsb-surface, --dsb-label, --dsb-active and friends), so the panel
never depends on host tokens that a theme switch could leave stale. Escape
closes the settings row before it closes the panel.

### Motion / 动效

0.3.1 makes the gear feel like a button and the row feel like it belongs to it:
the gear turns 90° and fills in when open, scales down on press, and settles on
hover; the settings row unfolds from a 0fr grid track (240ms) instead of
appearing; the three modes share a sliding thumb (240ms, one element moving
under the labels) rather than three buttons swapping backgrounds; the panel
cross-fades its colours (220ms) when you pick a mode, and the hint on the right
of the row spells out what 自动 resolved to right now. All of it is transform
and opacity only, and prefers-reduced-motion keeps just the cross-fade.

主题设置：两个面板右上角的齿轮打开「自动 / 浅色 / 深色」，选择由两个面板共享，
并保存在 localStorage 的 dsh-session-top-new.theme 下。**自动 = 与页面反色**
（浅色页配深色面板，深色页配浅色面板），跟随 DSH 主题开关同步切换；浅色与深色
则固定配色、忽略页面。

## Reveal in sidebar / 侧栏定位

0.3.3 adds a 侧栏定位 switch under the theme row, in both panels. On by default.
With it on, clicking a session here (bell or dock) does two things in order: the
session opens, then the host sidebar scrolls so that session's own row is on
screen — the same `scrollIntoView({ block: 'nearest' })` the shipped rows use
themselves, aimed at their `data-row-key="session:<id>"` marker. Off, only the
session opens and the sidebar stays where you left it.

The plugin never expands a collapsed project group to reach a row that is not
mounted: that tree belongs to you, and silently reshaping it to satisfy a scroll
would be worse than doing nothing. The preference lives in localStorage under
dsh-session-top-new.reveal and is shared by both surfaces, like the theme.

侧栏定位：两个面板的主题行下面多一个开关，默认开启。开启后点这里的会话（铃铛或
悬浮条）会先切到该会话，再把左侧边栏滚到它自己那一行——用的是官方行自己也在用的
`scrollIntoView({ block: 'nearest' }`），定位靠官方行的 `data-row-key="session:<id>"`
标记。关闭后只切会话，侧栏不动。**不会替你展开折叠的项目分组**：那棵树的状态归你，
为了滚一下去改它比什么都不做更糟。开关存在 localStorage 的
dsh-session-top-new.reveal 下，两个面板共享。

## Hide the dock / 隐藏悬浮条

0.3.4 adds a 悬浮条 switch to the bell's settings. Off, the floating dock is not
mounted at all — no button, no badge, no drag zone, no hot corner. The bell keeps
working and lists the same sessions, so nothing is lost; switching it back on puts
the dock back where you left it (its position is remembered separately).

The same release fixes the dock's own settings block being clipped: it is a column
flexbox item inside a max-height panel and was shrinking along with the session
list, so the toggles got cut off mid-row. It now keeps its natural height (the list
absorbs the loss) and scrolls itself only in a very short window.

悬浮条：铃铛的设置里多一个开关。关掉后悬浮条整个不挂载——没有按钮、没有角标、没有
拖拽区。铃铛照常工作、列的是同一批会话，不会丢功能；再打开时悬浮条回到原来的位置
（位置单独记着）。同一版修掉了悬浮条自己的设置区被裁一半的问题：它作为列向 flex
子项在限高面板里会跟着会话列表一起被压缩，现在固定占自己该占的高度，列表让位；
只有窗口特别矮时才让设置区自己滚动。开关存在 localStorage 的
dsh-session-top-new.dock 下。

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

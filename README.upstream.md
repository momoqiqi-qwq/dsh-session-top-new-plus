<!-- 中文速览 — 上游 cuijiajun/dsh-session-top-new 的原始说明存档，只读参考，不在这一版维护。 -->
# dsh-session-top-new

**Session list too lon
g to search through? The newest session alway
s buried?**

A session overview dock for the 
**DeepSeek Harness Web GUI**: every session's

unread and running state in one floating pan
el, one click to jump to any of
them, and a c
hime when one finishes — so the newest and 
the unread never get
lost in a long list agai
n.

**会话列表越长越难找？最新会
话总被淹没？**

一个 DSH Web GUI 的�
��话总览悬浮栏：所有会话的未读�
��运行状态集中在一个小面板里，

点一下就能跳过去，会话跑完会响
一声——最新和未读的再也不会被
长列表埋掉。

![Session dock panel](ass
ets/screenshot-panel.png)

![Collapsed button
 with unread badge](assets/screenshot-button.
png)

## Features

- **Overview, not per-sess
ion** — the dock is a global aggregate: you
 see the
  state of *all* sessions while you 
are inside one of them.
- **Live status** —
 a running session shows a pulsing green dot;
 a session
  whose result you have not looked
 at shows an amber dot and a bold title; the

  round button carries a red badge counting u
nread results.
- **N-day history** — shows 
sessions updated within the last N days (defa
ult:
  today only). N is editable in the pane
l header, 1–365.
- **Click to jump** — cl
icking a session switches the main view strai
ght to it.
  The panel stays open.
- **Delive
rables of the active session** — the lower 
section lists the files
  the active session 
produced (whatever it declared through `prese
nt`), one row
  per file with its extension. 
Click a row to open it in the workspace's
  d
ocument pane.
- **Parent / child grouping** �
�� subagent sessions nest under their parent 
and
  stay collapsed until you expand them, i
nstead of flattening into one list.
- **Compl
etion chime** — a synthesized two-tone chim
e (Web Audio, no asset
  files) plays when a 
session finishes, with a mute toggle.
- **Dra
ggable and resize-aware** — drag the button
 anywhere; the position is
  stored as a frac
tion of the window, so it keeps its relative 
spot when the
  window is resized. The panel 
flips up or sideways near a screen edge.
- **
Dismiss a row** — the ✕ that appears on h
over hides that row; it comes back
  by itsel
f once the session produces something newer. 
Dismissing a parent also
  hides its currentl
y visible subagent rows.
- **Inverts the page
 theme** — a light page gets dark chrome an
d a dark page gets
  light chrome, so the pan
el never blends into whatever is behind it. I
t follows
  DSH's own theme switch, so there 
is nothing to configure.
- **Collapsible** �
� expands by default; click the button to col
lapse it back to
  a single round button.

Th
e dock in both themes — left is a light pag
e, right is a dark one:

![Theme inversion pr
eview](assets/theme-preview.png)

## 中文�
�明

功能一览：

- 圆形按钮可**拖
拽**到任意位置，窗口缩放时按比�
��跟随
- 「近 N 天」可自定义（默�
��当天）
- 运行中显示绿色脉冲点�
��未查看结果显示琥珀点，按钮红�
��角标显示未读数
- 子任务折叠在�
��任务下，不平铺
- 点击会话直接�
��转，面板不自动收起
- 鼠标悬停�
��尾出现 **×**：忽略该记录，等这
个会话有新记录时自动重新出现
  
（忽略主任务会同时忽略它当前显
示的子任务）
- 配色**反色于页面�
��题**：浅色主题下用深色外壳、�
�色主题下用浅色外壳，跟随
  DSH �
��主题开关自动切换，无需设置，�
��何时候都清晰可辨
- 结束提示音�
��用 Web Audio 合成，无需音频文件�
�可静音

## Install

```bash
dsh plugin --
profile web add github:cuijiajun/dsh-session-
top-new
```

Install from source builds the p
ackage once, so the first install asks for th
e
usual build approval.

Then **restart the W
eb GUI** — the client-modules scan caches p
ackage verdicts
per boot, so a newly installe
d plugin only appears after a restart.

## La
yout

```
dsh.plugin.json     plugin manifest
 (id / version / main / engines)
cordis.patch
.yml    bundle patch: mounts the host plugin 
row
lib/index.js        host entry (no-op; ex
ists so the bundle mounts)
lib/client.js     
  the dock: __ModuleLoader__ bundle (apply + 
widget)
assets/             screenshots
scree
nshots.json    storefront screenshot list
```


## How it works

The widget registers a roo
t-scope `shell.overlay` entry, so it floats a
bove the
whole app regardless of panel or ses
sion. It reads two client services and
keeps 
only the leaf fields it renders:

| Purpose |
 Source |
| --- | --- |
| Session list and me
tadata | `sessions.list` — `ids`, `byId[id]
` with `displayTitle`, `running`, `updatedAt`
, `parentId`, `origin`, `retainedBy.mainView`
 |
| Running / unread state | `uiSession.sess
ionStatus` — `{ running, pendingInteraction
, completionUnread }` |
| Jump to a session |
 `uiWorkspace.openSession(id)` |

The `dock` 
observable subscribes to both sources, extrac
ts a flat snapshot of
scalars, and hands the 
widget a referentially stable object. A `runn
ing →
finished` transition (or a new `compl
etionUnread` flag) triggers the chime,
respec
ting the mute toggle.

## Compatibility

This
 plugin talks to the DSH **client runtime ser
vices** named above. They are
the interfaces 
the official UI itself uses, but they are not
 a frozen public
API, so a Harness upgrade ma
y rename or restructure them. When that happe
ns the
dock can lose its click-to-jump or sta
tus markers until the plugin is updated —
i
f a control stops responding, check the brows
er console for a
`[dsh-session-top-new]` warn
ing, which is emitted instead of failing sile
ntly.

Tested against DSH builds current as o
f October 2026.

## License

MIT



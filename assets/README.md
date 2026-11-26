# assets

README 用的演示图与上架图标。全部是静态 HTML + Chrome headless 截图出来的，没有设计稿，
所以改图不用打开设计软件：改 HTML → 重截。

| 文件 | 是什么 |
| --- | --- |
| `hero.svg` | README 顶部横幅，手写 SVG（右侧卡片是活动列表示意） |
| `demo-activity.png` | 铃铛面板铺在侧栏那一列的形态，1400×800 @2x |
| `demo-activity-float.png` | 同一份面板在窄窗口下的浮层形态，960×720 @2x |
| `demo-resize.png` | 面板右下角的拖拽手柄与两条可拖的边 |
| `demo-settings.png` | 齿轮设置：主题、侧栏定位、悬浮条、两个免打扰开关 |
| `demo-surface.png` | 齿轮里的背景色色板，面板已换成墨蓝色 |
| `demo-search.png` | 搜索行里打 `cyy`，列表只剩两条「C语言」会话 |
| `demo-dock.png` | 上游那颗悬浮条 |
| `demo-bookmark.png` | 会话行右键的加入书签菜单 |
| `icon-180.png` | 插件市场 180px 图标 |

重截：`chrome --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=2
--virtual-time-budget=1200 --window-size=W,H --screenshot=OUT file:///…`。
截 SVG 要先把它内联进 HTML——`<img src=…>` 截出来是空白页。

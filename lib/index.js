/**
 * dsh-session-dock host entry.
 *
 * The dock is a pure client plugin (it renders in the browser via
 * `lib/client.js`); the host side only needs to exist so the bundle mounts as
 * a profile layer and the client-modules scan picks up the package's
 * `dsh.client` declaration.
 */
/**
 * 中文速览 — 宿主侧占位入口：插件的界面全在 lib/client.js（浏览器里跑）。
 *   这个文件存在只是为了让 bundle 作为一层 profile 挂上去、让客户端模块扫描
 *   读到 package 里的 dsh.client 声明。别在这里加业务代码。
 */

const name = "dsh-session-dock";

function apply(_ctx) {
  // Nothing host-side to do: the web client renders the dock and reads the
  // sessions service directly through the client context.
}

export { name, apply };

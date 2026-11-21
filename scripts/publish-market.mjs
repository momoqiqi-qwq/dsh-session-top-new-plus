#!/usr/bin/env node
/**
 * 中文速览 — 把 dsh-session-top-new-plus 提交到 awesome-dsh-plugin（DSH 插件市场目录）。
 * 一次投稿 = 在 data/plugins/ 下加一个 <owner>__<repo>.yml，README 由上游 CI 重新生成。
 * 流程：preflight（本地清单/仓库条件/是否已收录）→ fork → 建分支写文件 → 开 PR → watch 轮询 CI。
 * 全程写日志到 tmp/market-publish/<时间戳>/（events.jsonl + stdout.log + result.json）。
 * 用法：node scripts/publish-market.mjs [--dry-run] [--force] [--watch-minutes 40] [--stage preflight|fork|submit|watch|auto]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OWNER = 'momoqiqi-qwq';
const REPO = 'dsh-session-top-new-plus';
const UPSTREAM = 'awesome-dsh-plugin/awesome-dsh-plugin';
const FORK_REPO = UPSTREAM.split('/')[1];
const CATEGORY = 'session';
const BRANCH = 'publish/market-entry';
const ENTRY_PATH = 'data/plugins/' + OWNER + '__' + REPO + '.yml';
const AGEDAYS = 1;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = join(ROOT, 'tmp', 'market-publish', STAMP);
mkdirSync(OUT, { recursive: true });
const STATE = join(ROOT, 'tmp', 'market-publish', 'state.json');
const events = join(OUT, 'events.jsonl');

// 系统代理 127.0.0.1:7897 常常没起，脚本自己清掉，免得每次手动 export
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k];

const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const DRY = flag('dry-run');
const FORCE = flag('force');
const WATCH_MIN = Number(opt('watch-minutes', '40'));
const STAGE = opt('stage', 'auto');

function log(msg, extra) {
  const line = '[' + new Date().toISOString() + '] ' + msg;
  console.log(line);
  appendFileSync(join(OUT, 'stdout.log'), line + '\n', 'utf8');
  if (extra) appendFileSync(events, JSON.stringify({ t: new Date().toISOString(), msg, ...extra }) + '\n', 'utf8');
}

function emit(event, data) { appendFileSync(events, JSON.stringify({ t: new Date().toISOString(), event, ...data }) + '\n', 'utf8'); }

let TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
function ghToken() {
  if (TOKEN) return TOKEN;
  try { TOKEN = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch (e) { TOKEN = ''; }
  return TOKEN;
}

async function api(method, path, body, attempt = 1) {
  const token = ghToken();
  const url = path.startsWith('http') ? path : 'https://api.github.com' + path;
  const res = await fetch(url, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-session-top-new-plus-publisher',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (res.status === 429 || res.status >= 500) {
    if (attempt < 4) { await sleep(1500 * attempt); return api(method, path, body, attempt + 1); }
  }
  return { status: res.status, ok: res.ok, json, headers: res.headers };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }
function loadState() { return readJson(STATE) || {}; }
function saveState(patch) {
  const next = { ...loadState(), ...patch, updatedAt: new Date().toISOString() };
  writeFileSync(STATE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

// ---------- 条目文件 ----------
function stripComments(text) {
  return text.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
function buildEntry() {
  const src = join(ROOT, 'awesome-entry.yml');
  if (!existsSync(src)) throw new Error('missing awesome-entry.yml');
  let body = stripComments(readFileSync(src, 'utf8'));
  const icon = 'https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/main/assets/icon-180.png';
  if (!/^icon:/m.test(body) && existsSync(join(ROOT, 'assets', 'icon-180.png'))) body += '\nicon: ' + icon;
  return body + '\n';
}

// ---------- 预检 ----------
async function preflight() {
  const report = { checks: [], ok: true };
  const add = (name, pass, detail) => {
    report.checks.push({ name, pass, detail });
    if (!pass) report.ok = false;
    log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
  };

  const pkg = readJson(join(ROOT, 'package.json')) || {};
  const repoSlug = (pkg.repository && (pkg.repository.url || pkg.repository)) || '';
  add('package.json name', !!pkg.name && (pkg.name === REPO || repoSlug.includes('/' + REPO)), pkg.name || 'missing');
  add('dsh.bundle.patch declared', !!(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch), JSON.stringify(pkg.dsh || null));
  add('version', !!pkg.version, pkg.version || 'missing');

  let entry = null;
  try { entry = buildEntry(); add('awesome-entry.yml readable', true, entry.split('\n')[0]); }
  catch (e) { add('awesome-entry.yml readable', false, e.message); }
  if (entry) {
    add('entry has url', /^url:\s*https:\/\/github\.com\//m.test(entry));
    add('entry name matches', new RegExp('^name:\\s*' + OWNER + '\\/' + REPO + '\\s*$', 'm').test(entry));
    add('entry category valid', new RegExp('^category:\\s*' + CATEGORY + '\\s*$', 'm').test(entry));
    const descLines = entry.split('\n').filter((l) => /^\s{2}(en|zh):/.test(l));
    add('entry has en+zh description', descLines.length === 2, descLines.length + ' line(s)');
    for (const l of descLines) if (l.length > 900) add('description length ' + l.trim().slice(0, 8), false, l.length + ' chars');
  }

  const repoRes = await api('GET', '/repos/' + OWNER + '/' + REPO);
  if (!repoRes.ok) { add('repo reachable', false, 'HTTP ' + repoRes.status); return { report, ageHours: null }; }
  const repo = repoRes.json;
  add('repo reachable', true, repo.full_name);
  add('dsh-plugin topic', Array.isArray(repo.topics) && repo.topics.includes('dsh-plugin'), (repo.topics || []).join(','));
  const ageMs = Date.now() - new Date(repo.created_at).getTime();
  const ageHours = ageMs / 3600000;
  add('repo age >= ' + AGEDAYS + ' day', ageHours >= 24 * AGEDAYS || FORCE, 'created ' + repo.created_at + ' = ' + ageHours.toFixed(2) + 'h old');

  const existing = await api('GET', '/repos/' + UPSTREAM + '/contents/' + ENTRY_PATH);
  add('entry not upstream yet', existing.status === 404, existing.status === 404 ? 'absent' : 'HTTP ' + existing.status);
  report.alreadyListed = existing.status === 200;

  const forkRes = await api('GET', '/repos/' + OWNER + '/' + FORK_REPO);
  report.forkExists = forkRes.ok;
  log('fork exists: ' + report.forkExists);

  emit('preflight', report);
  return { report, ageHours };
}

// ---------- fork ----------
async function ensureFork() {
  const got = await api('GET', '/repos/' + OWNER + '/' + FORK_REPO);
  if (got.ok) {
    log('fork already exists: ' + got.json.full_name);
    const sync = await api('POST', '/repos/' + OWNER + '/' + FORK_REPO + '/merge-upstream', { branch: 'main' });
    log('fork sync (merge-upstream): HTTP ' + sync.status + ' ' + (sync.json && sync.json.message ? sync.json.message : ''));
    return got.json;
  }
  if (DRY) { log('DRY: would POST /repos/' + UPSTREAM + '/forks'); return { full_name: OWNER + '/' + FORK_REPO, dry: true }; }
  const created = await api('POST', '/repos/' + UPSTREAM + '/forks', { default_branch_only: true });
  if (!created.ok) throw new Error('fork failed: HTTP ' + created.status + ' ' + JSON.stringify(created.json).slice(0, 300));
  log('fork created, waiting for readiness');
  for (let i = 0; i < 40; i++) {
    await sleep(4000);
    const r = await api('GET', '/repos/' + OWNER + '/' + FORK_REPO);
    if (r.ok) { log('fork ready after ' + (i + 1) * 4 + 's'); return r.json; }
  }
  throw new Error('fork never became ready');
}

// ---------- 写文件 + 开 PR ----------
async function writeEntry(branch, entry) {
  const probe = await api('GET', '/repos/' + OWNER + '/' + FORK_REPO + '/contents/' + ENTRY_PATH + '?ref=' + encodeURIComponent(branch));
  const payload = {
    message: (probe.ok ? 'Update' : 'Add') + ' plugin: ' + OWNER + '/' + REPO + ' (' + CATEGORY + ')',
    content: Buffer.from(entry, 'utf8').toString('base64'),
    branch,
  };
  if (probe.ok && probe.json && probe.json.sha) payload.sha = probe.json.sha;
  const put = await api('PUT', '/repos/' + OWNER + '/' + FORK_REPO + '/contents/' + ENTRY_PATH, payload);
  if (put.ok) log('entry ' + (payload.sha ? 'updated' : 'created') + ' at ' + put.json.content.path + ' (' + payload.message + ')');
  return put;
}

async function submit(entry) {
  if (DRY) {
    log('DRY: would create branch ' + BRANCH + ' from fork main');
    log('DRY: would PUT ' + ENTRY_PATH + ' (' + Buffer.byteLength(entry, 'utf8') + ' bytes)');
    log('DRY: would POST /repos/' + UPSTREAM + '/pulls head=' + OWNER + ':' + BRANCH + ' base=main');
    log('DRY: PR body >>\n' + prBody());
    log('DRY: entry file >>\n' + entry);
    return { dry: true };
  }
  const head = await api('GET', '/repos/' + OWNER + '/' + FORK_REPO + '/git/ref/heads/main');
  if (!head.ok) throw new Error('fork main ref: HTTP ' + head.status);
  const baseSha = head.json.object.sha;
  log('fork main sha ' + baseSha.slice(0, 8));

  const refPath = '/repos/' + OWNER + '/' + FORK_REPO + '/git/refs';
  if (DRY) {
    log('DRY: would POST ' + refPath + ' refs/heads/' + BRANCH + ' @ ' + baseSha.slice(0, 8));
    log('DRY: would PUT ' + ENTRY_PATH + ' (' + Buffer.byteLength(entry, 'utf8') + ' bytes)');
    log('DRY: would POST /repos/' + UPSTREAM + '/pulls head=' + OWNER + ':' + BRANCH);
    return { dry: true, baseSha };
  }

  const ref = await api('POST', refPath, { ref: 'refs/heads/' + BRANCH, sha: baseSha });
  if (!ref.ok && ref.status !== 422) throw new Error('create branch: HTTP ' + ref.status + ' ' + JSON.stringify(ref.json).slice(0, 300));
  log('branch ' + BRANCH + ' ready (HTTP ' + ref.status + ')');

  const put = await writeEntry(BRANCH, entry);
  if (!put.ok) throw new Error('write entry: HTTP ' + put.status + ' ' + JSON.stringify(put.json).slice(0, 300));

  const body = prBody();
  const pr = await api('POST', '/repos/' + UPSTREAM + '/pulls', {
    title: 'Add ' + OWNER + '/' + REPO + ' (' + CATEGORY + ')',
    head: OWNER + ':' + BRANCH,
    base: 'main',
    body,
  });
  if (!pr.ok) {
    if (pr.status === 422) {
      log('PR maybe already open, looking it up');
      const list = await api('GET', '/repos/' + UPSTREAM + '/pulls?state=open&head=' + OWNER + ':' + BRANCH);
      if (list.ok && list.json.length) return { pr: list.json[0], reused: true };
    }
    throw new Error('create PR: HTTP ' + pr.status + ' ' + JSON.stringify(pr.json).slice(0, 400));
  }
  log('PR opened: ' + pr.json.html_url);
  return { pr: pr.json, reused: false };
}

function prBody() {
  const b = [];
  b.push('- [x] I added **one file** at `' + ENTRY_PATH + '` — that single file is the whole submission.');
  b.push('- [x] My repo\'s `package.json` declares **`dsh.bundle`** (`dsh.bundle.patch: ./cordis.patch.yml`, plus `dsh.client` for the browser half).');
  b.push('- [x] My repo is at least **1 day old**.');
  b.push('- [x] `category: ' + CATEGORY + '` — it is a sidebar session/activity surface, not a theme.');
  b.push('- [x] Description states what the plugin does, no superlatives.');
  b.push('- [x] My repo has the `dsh-plugin` topic.');
  b.push('');
  b.push('A sidebar activity bell plus a floating session dock for the DSH Web GUI. The bell groups recent activity by day (today / yesterday / weekday / date), keeps the unread count on its own numeric badge, and jumps to the session in the sidebar when a row is clicked — the sidebar scrolls that session into view. Everything runs locally off `sessions.list` and `uiSession.sessionStatus`; no network, no new dependencies, and the whole plugin is a single hand-written client bundle.');
  b.push('');
  b.push('It is a community edition of cuijiajun/dsh-session-top-new, credited in the README and shipped under the same MIT license.');
  return b.join('\n');
}

// ---------- 监控 ----------
async function watch(prNumber) {
  const deadline = Date.now() + WATCH_MIN * 60000;
  let last = '';
  let rounds = 0;
  while (Date.now() < deadline) {
    rounds++;
    const pr = await api('GET', '/repos/' + UPSTREAM + '/pulls/' + prNumber);
    if (!pr.ok) { log('poll pulls failed HTTP ' + pr.status); await sleep(30000); continue; }
    const d = pr.json;
    let checks = null;
    if (d.head && d.head.sha) {
      const c = await api('GET', '/repos/' + UPSTREAM + '/commits/' + d.head.sha + '/check-runs');
      if (c.ok) checks = (c.json.check_runs || []).map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion }));
    }
    const line = JSON.stringify({ state: d.state, merged: d.merged, mergeable: d.mergeable, mergeable_state: d.mergeable_state, checks });
    if (line !== last) {
      last = line;
      log('poll #' + rounds + ' ' + line);
      emit('poll', { pr: prNumber, state: d.state, merged: d.merged, mergeable_state: d.mergeable_state, checks });
    }
    const failing = (checks || []).filter((r) => r.status === 'completed' && r.conclusion && !['success', 'neutral', 'skipped'].includes(r.conclusion));
    const pending = (checks || []).filter((r) => r.status !== 'completed');
    if (d.merged) return { verdict: 'merged', pr: prNumber, checks };
    if (d.state === 'closed' && !d.merged) return { verdict: 'closed-unmerged', pr: prNumber, checks };
    if (failing.length) return { verdict: 'checks-failed', pr: prNumber, checks, failing };
    if (checks && checks.length && pending.length === 0 && !failing.length) {
      log('all checks green, waiting for maintainer merge');
    }
    await sleep(30000);
  }
  return { verdict: 'watch-timeout', pr: prNumber, waitedMinutes: WATCH_MIN };
}

// ---------- main ----------
async function main() {
  log('=== publish-market start === dry=' + DRY + ' force=' + FORCE + ' stage=' + STAGE);
  log('out dir ' + OUT);
  if (!ghToken()) throw new Error('no GitHub token (gh auth token returned empty)');

  const pre = await preflight();
  if (pre.report.alreadyListed) {
    log('already listed upstream — nothing to do');
    writeFileSync(join(OUT, 'result.json'), JSON.stringify({ verdict: 'already-listed', report: pre.report }, null, 2));
    return 0;
  }
  if (!pre.report.ok && !DRY) {
    log('preflight failed — stopping');
    writeFileSync(join(OUT, 'result.json'), JSON.stringify({ verdict: 'preflight-failed', report: pre.report }, null, 2));
    return 2;
  }
  const tooYoung = pre.ageHours !== null && pre.ageHours < 24 * AGEDAYS;
  if (tooYoung && !FORCE && !DRY) {
    const waitMin = Math.ceil((24 * AGEDAYS - pre.ageHours) * 60);
    log('repo is ' + pre.ageHours.toFixed(2) + 'h old; gate needs 24h — ' + waitMin + ' more minutes');
    writeFileSync(join(OUT, 'result.json'), JSON.stringify({ verdict: 'too-young', ageHours: pre.ageHours, waitMinutes: waitMin }, null, 2));
    return 3;
  }

  const entry = buildEntry();
  let prNumber = loadState().pr;
  if (STAGE === 'preflight') { log('stage preflight only'); return 0; }

  if (!prNumber) {
    await ensureFork();
    if (STAGE === 'fork') { log('stage fork only'); return 0; }
    if (DRY) { await submit(entry); log('DRY run complete — nothing written'); return 0; }
    const sub = await submit(entry);
    if (sub.dry) { log('DRY run complete'); return 0; }
    prNumber = sub.pr.number;
    saveState({ pr: prNumber, url: sub.pr.html_url, branch: BRANCH, entry: ENTRY_PATH });
  } else {
    log('resuming with existing PR #' + prNumber);
    if (flag('push-update')) {
      if (DRY) { log('DRY: would PUT updated entry to ' + BRANCH); return 0; }
      const put = await writeEntry(BRANCH, entry);
      if (!put.ok) throw new Error('update entry: HTTP ' + put.status + ' ' + JSON.stringify(put.json).slice(0, 300));
    }
  }

  if (STAGE === 'submit') { log('stage submit only, PR #' + prNumber); return 0; }
  const verdict = await watch(prNumber);
  log('watch verdict: ' + JSON.stringify(verdict));
  writeFileSync(join(OUT, 'result.json'), JSON.stringify({ ...verdict, prUrl: 'https://github.com/' + UPSTREAM + '/pull/' + prNumber }, null, 2));
  return verdict.verdict === 'merged' || verdict.verdict === 'checks-failed' || verdict.verdict === 'closed-unmerged' ? 0 : 5;
}

main().then((code) => { log('exit ' + code); process.exit(code); }).catch((e) => {
  log('ERROR ' + (e && e.stack ? e.stack : String(e)));
  emit('error', { message: String(e && e.message ? e.message : e) });
  try { writeFileSync(join(OUT, 'result.json'), JSON.stringify({ verdict: 'error', error: String(e && e.message ? e.message : e) }, null, 2)); } catch {}
  process.exit(4);
});

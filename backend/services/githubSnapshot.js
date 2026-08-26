'use strict';
/**
 * GitHub-backed snapshot persistence.
 *
 * Render's free disk is wiped on every deploy, which used to force a full
 * Firestore reload at next boot (~3.5k reads). Mirroring the local snapshot
 * file to a GitHub repo removes that cost entirely:
 *
 *   boot  : local file missing -> download raw snapshot -> hydrate RAM (0 reads)
 *   runtime: when the debounced local save lands, push the file back to GitHub
 *            every GITHUB_SNAPSHOT_INTERVAL seconds (default 15 min).
 *
 * Env (all optional — feature is OFF unless repo+path are set):
 *   GITHUB_SNAPSHOT_REPO   'owner/repo'
 *   GITHUB_SNAPSHOT_PATH   'backend/data/price-cache.json'
 *   GITHUB_TOKEN           fine-grained PAT, Contents Read/Write on that repo
 *                          (only needed for PUSH; public repos restore without it)
 *   GITHUB_SNAPSHOT_BRANCH defaults to the repo's default branch (auto-detected)
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO = process.env.GITHUB_SNAPSHOT_REPO || '';
const FILE_PATH = process.env.GITHUB_SNAPSHOT_PATH || '';
const TOKEN = process.env.GITHUB_TOKEN || '';
const INTERVAL_SECONDS = Math.max(60, Number(process.env.GITHUB_SNAPSHOT_INTERVAL || 900));
const SNAPSHOT_PATH = path.join(__dirname, '..', 'data', 'price-cache.json');
const API = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;
const UA = 'wmarket-price-sync';

let enabled = Boolean(REPO && FILE_PATH);
let timer = null;
let dirty = false;
let pushing = false;
let branch = process.env.GITHUB_SNAPSHOT_BRANCH || '';

function headers(extra = {}) {
  const h = { 'User-Agent': UA, Accept: 'application/vnd.github+json', ...extra };
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

/** Download the mirrored snapshot to the local path (no-op if exists/enabled-off/fails). */
async function pullToLocal() {
  if (!enabled) return false;
  try {
    if (fs.existsSync(SNAPSHOT_PATH)) return true; // local already warm
    if (!branch) branch = await detectBranch();
    const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${branch}/${FILE_PATH}`, { headers: headers() });
    if (!res.ok) {
      console.log(`[gh-snapshot] no remote snapshot yet (${res.status}) — will create on first push`);
      enabled = true;
      return false;
    }
    const text = await res.text();
    const parsed = JSON.parse(text); // validate shape before trusting it
    if (!parsed || parsed.v !== 1 || Object.keys(parsed.prices || {}).length === 0) {
      console.log('[gh-snapshot] remote snapshot empty/invalid — ignoring, will rescan');
      return false;
    }
    fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
    const tmp = `${SNAPSHOT_PATH}.dl`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, SNAPSHOT_PATH);
    console.log('[gh-snapshot] restored snapshot from GitHub — zero Firestore reads needed');
    return true;
  } catch (e) {
    console.log(`[gh-snapshot] pull skipped: ${e.message}`);
    return false;
  }
}

async function detectBranch() {
  const res = await fetch(`https://api.github.com/repos/${REPO}`, { headers: headers() });
  if (!res.ok) throw new Error(`repo lookup ${res.status}`);
  const meta = await res.json();
  return meta.default_branch || 'main';
}

/** Create the mirror branch from the repo's default head if it doesn't exist. */
async function ensureBranch() {
  if (!branch) branch = await detectBranch();
  const chk = await fetch(`https://api.github.com/repos/${REPO}/git/ref/heads/${encodeURIComponent(branch)}`, { headers: headers() });
  if (chk.ok) return;
  const meta = await fetch(`https://api.github.com/repos/${REPO}`, { headers: headers() });
  const def = (await meta.json()).default_branch || 'master';
  const base = await fetch(`https://api.github.com/repos/${REPO}/git/ref/heads/${def}`, { headers: headers() });
  if (!base.ok) throw new Error(`base branch ${def}: ${base.status}`);
  const sha = (await base.json()).object.sha;
  const made = await fetch(`https://api.github.com/repos/${REPO}/git/refs`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });
  if (!made.ok && made.status !== 422) throw new Error(`create branch ${branch}: ${made.status}`);
  console.log(`[gh-snapshot] created branch '${branch}' from ${def}`);
}

async function pushOnce() {
  if (pushing) return;
  pushing = true;
  try {
    if (!fs.existsSync(SNAPSHOT_PATH)) return;
    if (!branch) branch = await detectBranch();
    let res = await attemptPut();
    if (res.status === 404 && /Branch/i.test(await res.text())) {
      await ensureBranch();
      res = await attemptPut();
    }
    if (!res.ok) throw new Error(`put ${res.status}: ${(await res.text()).slice(0, 120)}`);
    dirty = false;
    console.log(`[gh-snapshot] pushed ${(fs.statSync(SNAPSHOT_PATH).size / 1024).toFixed(0)}KB to ${REPO}:${FILE_PATH} @${branch}`);
  } catch (e) {
    console.log(`[gh-snapshot] push failed (will retry next tick): ${e.message}`);
  } finally {
    pushing = false;
  }
}

function attemptPut() {
  let sha;
  return fetch(`${API}?ref=${encodeURIComponent(branch)}`, { headers: headers() })
    .then(async (cur) => {
      if (cur.ok) sha = (await cur.json()).sha;
      else if (cur.status !== 404) throw new Error(`head ${cur.status}`);
      const content = fs.readFileSync(SNAPSHOT_PATH);
      return fetch(API, {
        method: 'PUT',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          message: `chore(snapshot) ${new Date().toISOString()}`,
          content: content.toString('base64'),
          sha,
          branch,
        }),
      });
    });
}

/** Called by priceService right after a successful local save. */
function noteSnapshotWritten() {
  if (!enabled) return;
  dirty = true;
}

function start() {
  if (!enabled || timer) return;
  console.log(`[gh-snapshot] enabled -> ${REPO}:${FILE_PATH} every ${INTERVAL_SECONDS}s`);
  timer = setInterval(() => {
    // Refresh the local file from RAM even without price deltas, so the
    // GitHub mirror stays warm on quiet markets too. Empty-RAM saves are
    // rejected by priceService's guard, and pushOnce skips a missing file.
    try { require('./priceService').scheduleSnapshotSave(); } catch { /* noop */ }
    setTimeout(() => { pushOnce(); }, 6_000);
  }, INTERVAL_SECONDS * 1000);
  if (typeof timer.unref === 'function') timer.unref();
}

module.exports = { enabled, pullToLocal, noteSnapshotWritten, start, pushOnce };

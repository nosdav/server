#!/usr/bin/env node

/**
 * nosdav - NosDAV
 * Just works, batteries included
 */

import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, delimiter } from 'path';
import chalk from 'chalk';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, statSync, copyFileSync, cpSync } from 'fs';
import { randomBytes } from 'crypto';
import { createServer } from 'net';

const __dirname = dirname(fileURLToPath(import.meta.url));
// The script lives in `bin/`; templates + package.json are at the
// repo/package root one level up. `pkgRoot` is the canonical path for
// reading bundled assets (welcome.html, data-browser.js, etc.).
const pkgRoot = dirname(__dirname);
const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));

// Build a browser-friendly URL from a host/port pair. Normalizes wildcard
// addresses (0.0.0.0, ::) to localhost and brackets IPv6 literals so the
// result is always a valid URL the user (and the browser) can open.
// IPv6 zone identifiers (e.g. `fe80::1%lo0`) are rejected at CLI parse
// time — the WHATWG URL spec doesn't support them, so any URL we built
// with one would be unparseable by Node and by the browser regardless
// of `%` encoding.
function formatUrl(host, port) {
  if (host === '0.0.0.0' || host === '::' || host === '*') {
    return `http://localhost:${port}`;
  }
  if (host.includes(':')) {
    return `http://[${host}]:${port}`;
  }
  return `http://${host}:${port}`;
}

// Parse CLI arguments
const args = process.argv.slice(2);

// Subcommand dispatch — must run before the flag-parsing loop below, which
// is shaped for the "start the server" command. New subcommands branch off
// here and exit; the start path is reached only when args[0] isn't one.
if (args[0] === 'install') {
  await runInstall(args.slice(1));
  process.exit(0);
}

async function runInstall(rest) {
  const opts = {
    pod: 'http://localhost:5544',
    user: 'me',
    password: process.env.JSS_SINGLE_USER_PASSWORD || 'me',
    apps: []
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--pod') opts.pod = rest[++i];
    else if (a === '--user') opts.user = rest[++i];
    else if (a === '--password') opts.password = rest[++i];
    else if (a === '--help' || a === '-h') { printInstallHelp(); process.exit(0); }
    else if (a.startsWith('--')) {
      console.error(chalk.red(`✗ Unknown flag: ${a}`));
      printInstallHelp();
      process.exit(1);
    }
    else opts.apps.push(a);
  }
  if (opts.apps.length === 0) {
    opts.apps = ['chrome', 'vellum', 'win98', 'pdf', 'hub'];
  }
  opts.pod = opts.pod.replace(/\/$/, '');

  console.log(chalk.bold.white(`\nInstalling ${opts.apps.length} app${opts.apps.length === 1 ? '' : 's'} → `) +
              chalk.green(opts.pod));
  console.log('');

  // Authenticate against the local pod's IDP. Token is needed to push to
  // /public/apps/<name>/ on a default nosdav (private-write inherits from
  // /public/.acl: public-read, owner-write).
  let token;
  try {
    const r = await fetch(`${opts.pod}/idp/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: opts.user, password: opts.password })
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    token = j.access_token;
    if (!token) throw new Error('no access_token in response');
  } catch (e) {
    console.error(chalk.red(`✗ Could not authenticate against ${opts.pod}: ${e.message}`));
    console.error(chalk.dim('  Is nosdav running?  → ') + chalk.bold('npx nosdav'));
    process.exit(1);
  }

  let okCount = 0;
  for (const input of opts.apps) {
    const spec = parseAppSpec(input);
    if (spec.error) {
      console.error(chalk.red(`✗ ${input}: ${spec.error}`));
      continue;
    }
    const { source, name, ref } = spec;
    const dest = `${opts.pod}/public/apps/${name}`;
    const tmp = join('/tmp', `nosdav-install-${name}-${process.pid}`);

    // Clean stale tmp from a previous failed run
    if (existsSync(tmp)) spawnSync('rm', ['-rf', tmp], { stdio: 'ignore' });

    // Full clone (no --depth: shallow pushes are rejected by JSS git-receive).
    // --branch picks a tag or branch when pinned (e.g. `foo/bar#v2`).
    const cloneArgs = ['clone', '--quiet'];
    if (ref) cloneArgs.push('--branch', ref);
    cloneArgs.push(source, tmp);
    const clone = spawnSync('git', cloneArgs, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (clone.status !== 0) {
      console.error(chalk.red(`✗ ${input}: clone failed`));
      const err = clone.stderr?.toString?.().trim() || '';
      if (err) console.error(chalk.dim(`  ${err.slice(0, 300)}`));
      continue;
    }

    // Push to the pod. `updateInstead` (which extracts the working tree)
    // only fires when the push targets the branch HEAD points at on the
    // server. JSS 0.0.197+ auto-inits with HEAD=main; older versions
    // honor the operator's `init.defaultBranch` (often `main`, sometimes
    // `gh-pages` for GitHub-Pages-heavy users). Push to both — the one
    // matching server-side HEAD extracts; the other just creates a ref.
    // Idempotent on re-run.
    const pushArgs = (branch) => ['-C', tmp, '-c',
      `http.extraHeader=Authorization: Bearer ${token}`,
      'push', dest, `HEAD:${branch}`];

    const pushMain = spawnSync('git', pushArgs('main'),
      { stdio: ['ignore', 'pipe', 'pipe'] });
    const errMain = pushMain.stderr?.toString?.() || '';

    // If the first push failed for a "won't auto-init" reason (path
    // already has content, e.g. nosdav's bundled pilot), don't keep going.
    if (pushMain.status !== 0 && (errMain.includes('not found') || errMain.includes('404'))) {
      console.log(chalk.yellow(`⊘ ${input}: skipped (path already in use — bundled or manually placed)`));
      spawnSync('rm', ['-rf', tmp], { stdio: 'ignore' });
      continue;
    }

    const pushPages = spawnSync('git', pushArgs('gh-pages'),
      { stdio: ['ignore', 'pipe', 'pipe'] });

    if (pushMain.status !== 0 && pushPages.status !== 0) {
      console.error(chalk.red(`✗ ${input}: push failed`));
      const err = (errMain + '\n' + (pushPages.stderr?.toString?.() || '')).trim();
      console.error(chalk.dim(`  ${err.slice(0, 400)}`));
      spawnSync('rm', ['-rf', tmp], { stdio: 'ignore' });
      continue;
    }

    console.log(chalk.green(`✓ ${input}`) + chalk.dim(` → ${dest}/`));
    okCount++;
    spawnSync('rm', ['-rf', tmp], { stdio: 'ignore' });
  }

  console.log('');
  console.log(chalk.bold(`${okCount}/${opts.apps.length} installed.`));
  if (okCount > 0) {
    console.log(chalk.dim('Open in browser: ') + chalk.cyan(`${opts.pod}/public/apps/`));
  }
}

// Parse the app spec string the user passed to `nosdav install`. Accepts:
//   - bare name              → github.com/solid-apps/<name>  (default registry)
//   - "<org>/<repo>"         → github.com/<org>/<repo>
//   - "https://..." full URL → as-is (must point at a git repo)
// Each form may carry an optional "#<ref>" suffix to pin a tag or branch:
//   chrome#v1.2 / solid-apps/chrome#main / https://...#v2
// And an optional "=<name>" suffix to override the pod-path name, useful
// when the repo's last segment isn't what you want under /public/apps/
// (e.g. "litecut/litecut.github.io=litecut").
function parseAppSpec(input) {
  // Pull off the rename suffix first, then the ref suffix.
  let base = input;
  let renameName = null;
  const eqIx = base.lastIndexOf('=');
  if (eqIx > 0) {
    renameName = base.slice(eqIx + 1);
    base = base.slice(0, eqIx);
  }
  let ref = null;
  const hashIx = base.lastIndexOf('#');
  if (hashIx > 0) {
    ref = base.slice(hashIx + 1) || null;
    base = base.slice(0, hashIx);
  }
  let source, name;
  if (/^https?:\/\//.test(base)) {
    source = base.replace(/\.git$/, '').replace(/\/$/, '');
    name = source.split('/').pop();
  } else if (base.includes('/')) {
    const cleaned = base.replace(/\.git$/, '').replace(/^\/+|\/+$/g, '');
    if (cleaned.split('/').length !== 2) {
      return { error: 'expected <org>/<repo> shorthand' };
    }
    source = `https://github.com/${cleaned}`;
    name = cleaned.split('/').pop();
  } else {
    source = `https://github.com/solid-apps/${base}`;
    name = base;
  }
  if (renameName) name = renameName;
  if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(name)) {
    return { error: `invalid pod-path name "${name}"` };
  }
  if (ref && !/^[a-z0-9][a-z0-9_./-]*$/i.test(ref)) {
    return { error: `invalid ref "${ref}"` };
  }
  return { source, name, ref };
}

function printInstallHelp() {
  console.log(chalk.cyan(`
╔═══════════════════════════════════════════════════════════════════╗
║                   nosdav install - Help                             ║
╚═══════════════════════════════════════════════════════════════════╝
`));
  console.log(chalk.white('Usage:'));
  console.log(chalk.yellow('  nosdav install') + chalk.dim(' [options] [<app>...]\n'));
  console.log(chalk.white('Options:'));
  console.log(chalk.green('  --pod ') + chalk.yellow('<url>') + chalk.dim('       Target pod (default: http://localhost:5544)'));
  console.log(chalk.green('  --user ') + chalk.yellow('<name>') + chalk.dim('      Username (default: me)'));
  console.log(chalk.green('  --password ') + chalk.yellow('<pw>') + chalk.dim('     Password (default: $JSS_SINGLE_USER_PASSWORD or "me")'));
  console.log(chalk.green('  --help') + chalk.dim('             Show this help message\n'));
  console.log(chalk.white('App spec:') + chalk.dim('  <name> | <org>/<repo> | https://github.com/<org>/<repo>'));
  console.log(chalk.dim('             Optional suffixes:  #<branch-or-tag>   =<pod-path-name>'));
  console.log('');
  console.log(chalk.white('Examples:'));
  console.log(chalk.dim('  nosdav install chrome                            # solid-apps/chrome'));
  console.log(chalk.dim('  nosdav install chrome vellum pdf                 # several at once'));
  console.log(chalk.dim('  nosdav install                                   # curated set: chrome vellum win98 pdf hub'));
  console.log(chalk.dim('  nosdav install JavaScriptSolidServer/git         # any GitHub org/repo'));
  console.log(chalk.dim('  nosdav install litecut/litecut.github.io=litecut # rename pod path'));
  console.log(chalk.dim('  nosdav install solid-apps/chrome#v1              # pin a tag or branch'));
  console.log(chalk.dim('  nosdav install --pod http://192.168.0.1:5544 chrome'));
  console.log('');
}

const options = {
  port: 5544,
  host: 'localhost',
  root: './pod-data',
  multiuser: false,
  auth: true,
  open: true,
  git: true,
  // On by default — the Nostr-native opinion. JSS provisions a Schnorr
  // secp256k1 owner keypair on first start, writes it to
  // <pod>/private/privkey.jsonld, publishes the pubkey in the WebID
  // profile as a Multikey verificationMethod, and serves the
  // /.well-known/did/nostr/<pubkey> resolution endpoint. Opt out with
  // --no-provision-keys.
  provisionKeys: true,
  // On by default — the other half of "Nostr-native". JSS exposes a
  // Nostr relay at <pod>/relay with NIP-98 auth. Pairs with the
  // provisioned owner key so the pod has a Nostr identity *and*
  // speaks Nostr. Opt out with --no-nostr.
  nostr: true
};

// Auth-ladder rung-1 credentials. See issue #6: nosdav ships a deliberately
// weak default sign-in so the new user is on a working pod within seconds,
// with a clearly-marked path to climb (change password / add a passkey).
// Safe because the default host is localhost-only.
// Username is fixed by JSS for root pods (server.js:970). Password defaults
// to 'me' but can be overridden via JSS_SINGLE_USER_PASSWORD so the env
// override documented in the README actually takes effect (and the banner
// shows the effective password, not a stale default).
const RUNG_1_USERNAME = 'me';
const RUNG_1_PASSWORD = process.env.JSS_SINGLE_USER_PASSWORD || 'me';
const RUNG_1_PASSWORD_FROM_ENV = !!process.env.JSS_SINGLE_USER_PASSWORD;

// Require a value after a value-taking flag. Without this guard, a stray
// `nosdav --host` (no value) reads `undefined` from args[++i] and the next
// .replace() call throws a cryptic TypeError. We also reject values that
// look like another option (`-`-prefixed) — otherwise `nosdav --host
// --no-auth` would silently consume `--no-auth` as the host value, drop
// the intended flag, and bind the server to a literal string '--no-auth'.
function requireValue(flag, value) {
  if (value === undefined) {
    console.error(chalk.red(`✗ Missing value for ${flag}`));
    console.error(chalk.dim('Use --help for usage information'));
    process.exit(1);
  }
  if (value.startsWith('-')) {
    console.error(chalk.red(`✗ Missing value for ${flag}`));
    console.error(chalk.dim(`  Got: ${value} (looks like another option, not a value)`));
    console.error(chalk.dim('Use --help for usage information'));
    process.exit(1);
  }
  return value;
}

for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg === '--port' || arg === '-p') {
    const raw = requireValue(arg, args[++i]);
    const parsed = parseInt(raw, 10);
    // Reject non-numeric / out-of-range / privileged ports. parseInt('abc')
    // returns NaN, which would silently propagate to JSS as `--port NaN`
    // and produce a confusing crash deep in the server.
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535 || String(parsed) !== raw.trim()) {
      console.error(chalk.red(`✗ Invalid port: ${raw}`));
      console.error(chalk.dim('Port must be an integer in the range 1-65535.'));
      process.exit(1);
    }
    options.port = parsed;
  } else if (arg === '--host' || arg === '-h') {
    // Strip optional brackets from IPv6 literals so a user-friendly
    // `--host [::1]` paste-in stays canonical. formatUrl re-adds the
    // brackets where they belong in URLs; the raw host going to JSS
    // and to comparisons remains the unbracketed literal.
    const rawHost = requireValue(arg, args[++i]).replace(/^\[|\]$/g, '');
    // Reject IPv6 zone identifiers — WHATWG URL spec doesn't support
    // them, so any URL we built (banner, browser auto-open, readiness
    // probe) would be unparseable. Better to fail fast with a clear
    // message than to ship a broken auto-open silently.
    if (rawHost.includes('%')) {
      console.error(chalk.red(`✗ IPv6 zone identifiers are not supported: ${rawHost}`));
      console.error(chalk.dim('Bind to a non-zoned address (e.g. ::1, 127.0.0.1, or your LAN IP) instead.'));
      process.exit(1);
    }
    options.host = rawHost;
  } else if (arg === '--root' || arg === '-r') {
    options.root = requireValue(arg, args[++i]);
  } else if (arg === '--multiuser') {
    options.multiuser = true;
  } else if (arg === '--no-auth') {
    options.auth = false;
  } else if (arg === '--no-open') {
    options.open = false;
  } else if (arg === '--no-git') {
    options.git = false;
  } else if (arg === '--provision-keys') {
    options.provisionKeys = true;
  } else if (arg === '--no-provision-keys') {
    options.provisionKeys = false;
  } else if (arg === '--nostr') {
    options.nostr = true;
  } else if (arg === '--no-nostr') {
    options.nostr = false;
  } else if (arg === '--version' || arg === '-v') {
    console.log(`nosdav v${pkg.version}`);
    process.exit(0);
  } else if (arg === '--help') {
    console.log(chalk.cyan(`
╔═══════════════════════════════════════════════════════════════════╗
║                         nosdav - Help                               ║
╚═══════════════════════════════════════════════════════════════════╝
`));
    console.log(chalk.white('Usage:'));
    console.log(chalk.yellow('  nosdav') + chalk.dim(' [options]') + chalk.dim('              Start the pod (default)'));
    console.log(chalk.yellow('  nosdav install') + chalk.dim(' [<app>...]') + chalk.dim('     Install Solid apps from solid-apps/<name>'));
    console.log(chalk.dim('                                 (see `nosdav install --help`)\n'));
    console.log(chalk.white('Options:'));
    console.log(chalk.green('  -p, --port ') + chalk.yellow('<number>') + chalk.dim('     Port to listen on (default: 5544)'));
    console.log(chalk.green('  -h, --host ') + chalk.yellow('<address>') + chalk.dim('    Host to bind to (default: localhost)'));
    console.log(chalk.green('  -r, --root ') + chalk.yellow('<path>') + chalk.dim('       Data directory (default: ./pod-data)'));
    console.log(chalk.green('  --multiuser') + chalk.dim('            Enable multi-user mode'));
    console.log(chalk.green('  --no-auth') + chalk.dim('              Disable authentication'));
    console.log(chalk.green('  --no-open') + chalk.dim('              Do not open the browser automatically'));
    console.log(chalk.green('  --no-git') + chalk.dim('               Disable JSS\'s git HTTP backend (it is on by default)'));
    console.log(chalk.green('  --no-provision-keys') + chalk.dim('     Skip auto-generating a Nostr owner keypair (default: on)'));
    console.log(chalk.green('  --no-nostr') + chalk.dim('              Disable the Nostr relay at <pod>/relay (default: on)'));
    console.log(chalk.green('  -v, --version') + chalk.dim('           Show nosdav version'));
    console.log(chalk.green('  --help') + chalk.dim('                  Show this help message\n'));
    console.log(chalk.white('Examples:'));
    console.log(chalk.dim('  nosdav'));
    console.log(chalk.dim('  nosdav --port 8080 --root /var/pods'));
    console.log(chalk.dim('  nosdav --multiuser\n'));
    console.log(chalk.white('Features:'));
    console.log(chalk.dim('  • Solid Protocol compliant'));
    console.log(chalk.dim('  • WebID authentication'));
    console.log(chalk.dim('  • Passkey support'));
    console.log(chalk.dim('  • WebSocket notifications'));
    console.log(chalk.dim('  • JSON-LD native\n'));
    console.log(chalk.white('Resources:'));
    console.log(chalk.blue('  https://github.com/nosdav/server'));
    console.log(chalk.blue('  https://solidproject.org\n'));
    process.exit(0);
  } else {
    console.error(chalk.red(`✗ Unknown option: ${arg}`));
    console.error(chalk.dim('Use --help for usage information'));
    process.exit(1);
  }
}

// Ensure data directory exists
if (!existsSync(options.root)) {
  mkdirSync(options.root, { recursive: true });
}

// Find a free port starting at the requested one. Mirrors Vite's
// behaviour: shift up by one and try again, up to 10 attempts. We probe
// by binding a throwaway server on the same host the spawned JSS will
// use, so the result reflects the actual interface we'll claim.
async function findFreePort(startPort, host, maxTries = 10) {
  for (let p = startPort; p < startPort + maxTries; p++) {
    const free = await new Promise((resolve) => {
      const srv = createServer();
      srv.once('error', () => resolve(false));
      srv.once('listening', () => srv.close(() => resolve(true)));
      srv.listen(p, host);
    });
    if (free) return p;
  }
  return null;
}

const requestedPort = options.port;
const freePort = await findFreePort(requestedPort, options.host);
if (freePort === null) {
  console.error(chalk.red(`✗ No free port in range ${requestedPort}-${requestedPort + 9} on ${options.host}.`));
  console.error(chalk.dim('Pass --port <number> to pick a different starting port.'));
  process.exit(1);
}
if (freePort !== requestedPort) {
  console.log(chalk.yellow(`Port ${requestedPort} is in use, using ${freePort} instead.`));
}
options.port = freePort;

// Resolve the JWT signing secret. Priority:
//   1. TOKEN_SECRET env var (operator-controlled)
//   2. Persisted random secret at <root>/.token-secret (generated on
//      first run, mode 0600). Same data dir always produces the same
//      effective secret across restarts — sessions and refresh tokens
//      survive process bounces.
// Generating per-data-dir avoids the previous footgun of a hardcoded
// fallback string that anyone could use to forge JWTs against a
// non-loopback deployment.
function resolveTokenSecret(rootDir) {
  if (process.env.TOKEN_SECRET) return process.env.TOKEN_SECRET;
  const secretFile = join(rootDir, '.token-secret');
  if (existsSync(secretFile)) {
    // Tighten perms on every read: writeFileSync's `mode` option only
    // applies to *creation*, so a regenerated file (overwritten in
    // place) or a manually-touched file may have inherited broader
    // permissions. Stat-then-chmod also warns the operator if the
    // file was previously group/world-readable.
    ensureMode0600(secretFile);
    const loaded = readFileSync(secretFile, 'utf8').trim();
    // Guard against a truncated / empty / accidentally-overwritten
    // secret file. A short-or-empty secret would silently weaken JWT
    // signing — regenerate and warn rather than ship the bad value.
    if (loaded.length >= 32) return loaded;
    console.warn(chalk.yellow(
      `⚠  ${secretFile} is empty or too short (${loaded.length} chars); regenerating.`
    ));
  }
  const secret = randomBytes(48).toString('base64');
  writeFileSync(secretFile, secret, { mode: 0o600 });
  // Explicit chmod covers the overwrite case (mode option in
  // writeFileSync is ignored when the file already exists).
  ensureMode0600(secretFile);
  return secret;
}

function ensureMode0600(path) {
  try {
    const mode = statSync(path).mode & 0o777;
    if (mode !== 0o600) {
      // Surface the previous mode so operators can investigate how the
      // file became group/world-readable (or just learn that nosdav is
      // tightening it for them).
      console.warn(chalk.yellow(
        `⚠  Tightening permissions on ${path} (was ${mode.toString(8).padStart(3, '0')}, now 600)`
      ));
      chmodSync(path, 0o600);
    }
  } catch {
    // chmod is a no-op on Windows and may fail on exotic filesystems.
    // Don't crash startup over it; the secret is still in use.
  }
}
const tokenSecret = resolveTokenSecret(options.root);

// Display startup banner. Plain-text for now; an ASCII-art "NosDAV"
// is a fine polish item once we settle on a brand mark.
console.log(chalk.cyan(`
╔═══════════════════════════════════════════════════════════════════╗
║                                                                   ║
║                                                                   ║
║                            ${chalk.bold.white('NosDAV')}                                 ║
║                                                                   ║
║                  ${chalk.bold.yellow('Nostr-native Solid storage')}                       ║
║                  ${chalk.dim('Powered by JSS')}                                   ║
║                                                                   ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
`));

console.log(chalk.blue('🚀 Starting Solid server...\n'));

console.log(chalk.bold.white('📡 Server Configuration:\n'));
console.log(chalk.cyan('   ├─ ') + chalk.white('URL:       ') + chalk.bold.green(formatUrl(options.host, options.port)));
console.log(chalk.cyan('   ├─ ') + chalk.white('Port:      ') + chalk.yellow(options.port));
console.log(chalk.cyan('   ├─ ') + chalk.white('Host:      ') + chalk.yellow(options.host));
console.log(chalk.cyan('   ├─ ') + chalk.white('Pod Root:  ') + chalk.yellow(options.root));
console.log(chalk.cyan('   └─ ') + chalk.white('Mode:      ') + (options.multiuser ? chalk.yellow('Multi-user') : chalk.yellow('Single-user')));

if (options.auth && !options.multiuser) {
  const rungLabel = RUNG_1_PASSWORD_FROM_ENV
    ? 'Sign In (password from JSS_SINGLE_USER_PASSWORD):'
    : 'Sign In (rung 1 of the auth ladder):';
  console.log('\n' + chalk.bold.white(`🔑 ${rungLabel}\n`));
  console.log(chalk.cyan('   ├─ ') + chalk.white('Username:  ') + chalk.bold.green(RUNG_1_USERNAME));
  // Only print the literal password when it's the rung-1 default. If
  // the user set a real password via env, echoing it to stdout would
  // leak into terminal scrollback, shell history capture, CI logs, and
  // shared sessions. They already know the value they set; the banner
  // just confirms it was picked up.
  if (RUNG_1_PASSWORD_FROM_ENV) {
    console.log(chalk.cyan('   ├─ ') + chalk.white('Password:  ') + chalk.dim('(hidden — set via JSS_SINGLE_USER_PASSWORD)'));
  } else {
    console.log(chalk.cyan('   ├─ ') + chalk.white('Password:  ') + chalk.bold.green(RUNG_1_PASSWORD));
  }
  console.log(chalk.cyan('   └─ ') + chalk.dim('Climb: change the password or add a passkey from account settings'));

  // Loud warning if the rung-1 known credentials are reachable beyond
  // the local machine. See issue #6 ("auth ladder"): rung 1 is only
  // safe when the host is loopback-only. Any other bind exposes the
  // well-known me/me credentials to the LAN (or worse).
  // Loopback covers the full 127.0.0.0/8 IPv4 range plus IPv6 ::1.
  // (Bracketed `[::1]` input is stripped to `::1` at CLI parse time
  // — see options.host parsing — so it matches here without a
  // bracketed branch.)
  const isLoopback =
    options.host === 'localhost' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(options.host) ||
    options.host === '::1';
  if (!isLoopback) {
    if (RUNG_1_PASSWORD_FROM_ENV) {
      // Custom password from env. Still worth warning the user that
      // their sign-in is now reachable from anywhere this host
      // answers, but no longer accurate to call the credentials
      // "well-known."
      console.log('\n' + chalk.bold.red('⚠  Warning: ') + chalk.yellow(
        `--host ${options.host} exposes single-user sign-in beyond localhost.`
      ));
      console.log(chalk.dim('   Make sure your JSS_SINGLE_USER_PASSWORD is strong, and use HTTPS in production.'));
    } else {
      console.log('\n' + chalk.bold.red('⚠  Warning: ') + chalk.yellow(
        `--host ${options.host} exposes the well-known me/me credentials beyond localhost.`
      ));
      console.log(chalk.dim('   Set JSS_SINGLE_USER_PASSWORD=... before running, or bind to localhost.'));
    }
  }
}

console.log('\n' + chalk.bold.white('✨ Features:\n'));
console.log(chalk.cyan('   ├─ ') + chalk.green('Solid Protocol     ') + chalk.bold.green('✓'));
console.log(chalk.cyan('   ├─ ') + chalk.green('WebID Auth         ') + (options.auth ? chalk.bold.green('✓') : chalk.dim('✗')));
console.log(chalk.cyan('   ├─ ') + chalk.green('Passkeys           ') + (options.auth ? chalk.bold.green('✓') : chalk.dim('✗')));
console.log(chalk.cyan('   ├─ ') + chalk.green('Notifications      ') + chalk.bold.green('✓'));
console.log(chalk.cyan('   └─ ') + chalk.green('JSON-LD Native     ') + chalk.bold.green('✓'));

console.log('\n' + chalk.bold.white('📚 Resources:\n'));
console.log(chalk.cyan('   ├─ ') + chalk.white('Server:     ') + chalk.blue.underline('https://github.com/nosdav/server'));
console.log(chalk.cyan('   ├─ ') + chalk.white('Solid:      ') + chalk.blue.underline('https://solidproject.org'));
console.log(chalk.cyan('   └─ ') + chalk.white('WebID:      ') + chalk.blue.underline('https://www.w3.org/2005/Incubator/webid/spec'));

console.log('\n' + chalk.dim('Press ') + chalk.bold.red('Ctrl+C') + chalk.dim(' to stop the server\n'));
console.log(chalk.yellow('⏳ Initializing server components...\n'));

// Point JSS at the canonical NosDAV data browser. nosdav.com/browser is
// a full mashlib bundle (tabbed Folder/Data/Source/Sharing UI, CRUD,
// WAC sharing pane) — much richer than a minimal pretty-printer. Same
// surface across every nosdav release; no per-version pinning needed.
const dataBrowserUrl = 'https://nosdav.com/browser/mashlib.js';

// Build jss arguments
const jssArgs = [
  'start',
  '--port', options.port.toString(),
  '--host', options.host,
  '--root', options.root,
  '--notifications',
  '--conneg',
  '--mashlib-module', dataBrowserUrl
];

if (options.multiuser) {
  // Multi-user mode is an explicit opt-out from nosdav's single-user
  // positioning (#3). The IDP stays available so users can register.
  if (options.auth) jssArgs.push('--idp');
} else {
  // Default: single-user personal pod with rung-1 credentials seeded.
  // The pod, IDP, and known credentials are created on first start;
  // every subsequent start is a no-op (JSS is idempotent on the seed).
  jssArgs.push('--no-multiuser', '--single-user');
  if (options.auth) {
    jssArgs.push('--idp');
    // Pass the rung-1 placeholder on argv (it has no secrecy property
    // — anyone reading the docs already knows the literal 'me'). For
    // an env-supplied password, *don't* re-expose it on argv where
    // `ps`, service-manager logs, and other local users can read it.
    // JSS reads JSS_SINGLE_USER_PASSWORD from env directly when no
    // CLI flag is given, and we forward process.env to the child.
    if (!RUNG_1_PASSWORD_FROM_ENV) {
      jssArgs.push('--single-user-password', RUNG_1_PASSWORD);
    }
  }
}

if (!options.auth) {
  // JSS's `--public` is the real no-auth switch: skip WAC, open
  // read/write. Without it, `--no-auth` would only mean "no IDP"
  // — the pod would still be ACL-gated and unreachable.
  jssArgs.push('--public');
}

// Enable JSS's git HTTP backend by default so the pod is a real
// git remote (clone for public-read paths, push for owner-write
// paths, auto-init on first push since JSS 0.0.195). Users who
// don't want this surface can pass --no-git.
jssArgs.push(options.git ? '--git' : '--no-git');

// Off by default. JSS generates a Schnorr secp256k1 keypair on first
// start, writes it to <pod>/private/privkey.jsonld (mode 0600), and
// publishes the pubkey in the WebID profile as a Multikey
// verificationMethod. Pairs with the existing /.well-known/did/nostr/
// resolution endpoint so the pod becomes its own DID resolver.
if (options.provisionKeys) jssArgs.push('--provision-keys');

// JSS's --nostr enables a Nostr relay at <pod>/relay with NIP-98 auth.
// On by default for nosdav's Nostr-native positioning.
if (options.nostr) jssArgs.push('--nostr');

// Start JSS with enhanced PATH to find the binary
const jss = spawn('jss', jssArgs, {
  stdio: 'inherit',
  env: {
    ...process.env,
    PATH: `${join(pkgRoot, 'node_modules', '.bin')}${delimiter}${process.env.PATH}`,
    TOKEN_SECRET: tokenSecret,
    NODE_ENV: process.env.NODE_ENV || 'development'
  }
});

jss.on('error', (error) => {
  console.error(chalk.red('\n✗ Failed to start server'));
  console.error(chalk.dim(error.message));
  process.exit(1);
});

// Auto-open the browser once the server is responsive (single-user first-run delight).
// Opt out with --no-open, or by running in CI / SSH / non-TTY environments.
const browserUrl = formatUrl(options.host, options.port);

function shouldAutoOpen() {
  if (!options.open) return false;
  // Require both stdin and stdout to be TTYs so that piped invocations
  // (e.g. `echo | nosdav`) are treated as non-interactive.
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  if (process.env.CI) return false;
  if (process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY) return false;
  if (process.env.TERM === 'dumb') return false;
  return true;
}

async function waitForReady(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 1000);
      await fetch(url, { signal: ac.signal, redirect: 'manual' });
      clearTimeout(t);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return false;
}

function openInBrowser(url) {
  let cmd, args;
  if (process.platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {}); // best-effort; never block the server
  child.unref();
}

// Share one readiness check between the welcome-overwrite step and the
// auto-open path so we don't poll the server twice.
const ready = waitForReady(browserUrl);

// Always overwrite pod-data/index.html with nosdav's welcome page once
// JSS has finished its pod init. This is a stopgap — there's no clean
// hook in JSS today for a downstream wrapper to ship its own root
// landing page. Tracked upstream in a separate issue. Doing this
// after readiness avoids a race where JSS's init might rewrite the
// file on top of ours.
//
// Also seed pod-data/public/links.jsonld on first start so the /public/
// tile lands the user on something tangible instead of an empty
// container listing. This one is skip-if-exists (it's user content
// — never overwrite a customized version).
ready.then((ok) => {
  if (!ok) return;
  try {
    const indexSrc = join(pkgRoot, 'welcome.html');
    const indexDst = join(options.root, 'index.html');
    if (existsSync(indexSrc)) copyFileSync(indexSrc, indexDst);

    // signin.html is a nosdav-owned static page; always-overwrite so
    // upgrades to the sign-in flow ship immediately. Pair with a .acl
    // granting public read so unauthenticated visitors can reach it
    // (mirrors JSS's index.html.acl pattern).
    const signinSrc = join(pkgRoot, 'signin.html');
    const signinDst = join(options.root, 'signin.html');
    if (existsSync(signinSrc)) copyFileSync(signinSrc, signinDst);
    const signinAclSrc = join(pkgRoot, 'signin.html.acl');
    const signinAclDst = join(options.root, 'signin.html.acl');
    if (existsSync(signinAclSrc)) copyFileSync(signinAclSrc, signinAclDst);

    // account.html — post-sign-in dashboard. Same overwrite + public-
    // read pattern as signin.html. Both pages render their useful
    // state from a restored solid-oidc session; signed-out visitors
    // see a "sign in" prompt rather than a blank page.
    const acctSrc = join(pkgRoot, 'account.html');
    const acctDst = join(options.root, 'account.html');
    if (existsSync(acctSrc)) copyFileSync(acctSrc, acctDst);
    const acctAclSrc = join(pkgRoot, 'account.html.acl');
    const acctAclDst = join(options.root, 'account.html.acl');
    if (existsSync(acctAclSrc)) copyFileSync(acctAclSrc, acctAclDst);

    // docs.html + .acl — operator-facing reference. Same overwrite +
    // public-read pattern as the rest of the nosdav-owned static pages.
    const docsSrc = join(pkgRoot, 'docs.html');
    const docsDst = join(options.root, 'docs.html');
    if (existsSync(docsSrc)) copyFileSync(docsSrc, docsDst);
    const docsAclSrc = join(pkgRoot, 'docs.html.acl');
    const docsAclDst = join(options.root, 'docs.html.acl');
    if (existsSync(docsAclSrc)) copyFileSync(docsAclSrc, docsAclDst);

    const linksSrc = join(pkgRoot, 'links.jsonld');
    const linksDst = join(options.root, 'public', 'links.jsonld');
    if (existsSync(linksSrc) && !existsSync(linksDst)) {
      copyFileSync(linksSrc, linksDst);
    }

    // Self-host bundled Solid apps under /public/apps/. Skip-if-exists
    // so the user can pin / upgrade individual apps manually. The
    // public/.acl already grants public read with acl:default, so no
    // separate ACLs are needed for these subdirectories.
    const appsSrc = join(pkgRoot, 'apps');
    const appsDst = join(options.root, 'public', 'apps');
    if (existsSync(appsSrc) && !existsSync(appsDst)) {
      cpSync(appsSrc, appsDst, { recursive: true });
    }
  } catch {
    // best-effort: failures are silent; user falls back to whatever
    // JSS already wrote (or nothing for links.jsonld).
  }
});

if (shouldAutoOpen()) {
  ready.then((ok) => {
    if (ok) {
      console.log(chalk.green(`\n🌐 Opening ${browserUrl} in your browser...`));
      openInBrowser(browserUrl);
    }
  });
}

jss.on('exit', (code) => {
  if (code !== 0) {
    console.error(chalk.red(`\n✗ Server exited with code ${code}`));
    process.exit(code);
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n' + chalk.yellow('⚠  Shutting down gracefully...'));
  jss.kill('SIGTERM');
  setTimeout(() => {
    console.log(chalk.green('✓  Server stopped'));
    console.log(chalk.dim('\nGoodbye! 👋\n'));
    process.exit(0);
  }, 1000);
});

process.on('SIGTERM', () => {
  jss.kill('SIGTERM');
  process.exit(0);
});

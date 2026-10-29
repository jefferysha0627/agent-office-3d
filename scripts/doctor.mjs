// npm run doctor: read-only environment check for people and AI agents.
// It never installs anything, never edits files, and never accepts the Minecraft EULA.
//
// Exit codes (so an agent can decide what to do next):
//   0  everything is ready: the office and the Minecraft demo can both run
//   2  the office can run, but Minecraft is not ready yet (Java missing/old, or minecraft:setup not done)
//   1  the office cannot run yet (Node too old, packages missing, config invalid, or port in use)
//
// Flags: --json prints machine-readable results instead of text.
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.js';
import { javaMajor } from '../lib/java.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MC_DIR = path.join(ROOT, 'minecraft');
const MC_PORT = 25570;
const JSON_OUT = process.argv.includes('--json');

const results = [];
// level: 'required' (office needs it) or 'minecraft' (only the Minecraft demo needs it)
function report(id, level, ok, message, fix = '') {
  results.push({ id, level, ok, message, fix });
}

// ---- Office (required) ----

const nodeMajor = Number(process.versions.node.split('.')[0]);
report('node', 'required', nodeMajor >= 20, `Node.js ${process.versions.node}`, 'Install Node.js 20 or newer from https://nodejs.org/ (ask the user first).');

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const missing = Object.entries(pkg.dependencies || {}).filter(([name, version]) => {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version !== version;
  } catch {
    return true;
  }
});
report(
  'packages',
  'required',
  missing.length === 0,
  missing.length ? `npm packages missing or wrong version: ${missing.map(([n]) => n).join(', ')}` : 'npm packages installed',
  'Run: npm ci',
);

let config = null;
try {
  config = loadConfig(ROOT);
  const file = config.file ? path.relative(ROOT, config.file) : '(built-in defaults)';
  report('config', 'required', config.staff.length > 0, `Config ${file}: ${config.staff.length} staff, source "${config.source.type}", Minecraft ${config.minecraft.enabled ? 'enabled' : 'off (demo:minecraft turns it on)'}`, 'Add at least one entry to "staff" in office.config.json.');
} catch (e) {
  report('config', 'required', false, e.message, 'Fix the JSON in office.config.json (or delete it to fall back to office.config.example.json).');
}

// A port is "free" if we can listen on it. If the office port is taken, check whether it is Agent Office itself.
function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}
function isAgentOffice(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/config', headers: { Host: `127.0.0.1:${port}` }, timeout: 1500 }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        try {
          resolve(Array.isArray(JSON.parse(body).staff));
        } catch {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => req.destroy());
  });
}

const officePort = config?.port || 4870;
if (await portFree(officePort)) {
  report('port-office', 'required', true, `Port ${officePort} is free`);
} else if (await isAgentOffice(officePort)) {
  report('port-office', 'required', true, `Agent Office is already running at http://127.0.0.1:${officePort}/`);
} else {
  report('port-office', 'required', false, `Port ${officePort} is used by another program`, 'Stop that program, or set "port" in office.config.json to a free port.');
}

// ---- Minecraft (optional) ----

const javaBin = config?.minecraft.java || 'java';
const jv = javaMajor(javaBin);
report(
  'java',
  'minecraft',
  !!jv && jv >= 21,
  jv ? `Java ${jv} (${javaBin})` : `Java not found (${javaBin})`,
  'Install Java 21 (ask the user first): macOS `brew install openjdk@21`, Windows `winget install Microsoft.OpenJDK.21`, Linux `sudo apt install openjdk-21-jre-headless`. If java is not on PATH, set "minecraft.java" in office.config.json or the MC_JAVA environment variable.',
);

const jar = path.join(MC_DIR, 'server.jar');
report('mc-server', 'minecraft', existsSync(jar), existsSync(jar) ? 'minecraft/server.jar present' : 'minecraft/server.jar not downloaded yet', 'The USER runs `npm run minecraft:setup` in their own terminal (it asks them to accept the EULA).');

// EULA: read only. Only the user may accept it, by typing yes in npm run minecraft:setup.
let eula = 'missing';
try {
  eula = /^eula=true\s*$/m.test(readFileSync(path.join(MC_DIR, 'eula.txt'), 'utf8')) ? 'accepted' : 'not accepted';
} catch {
  eula = 'missing';
}
report(
  'eula',
  'minecraft',
  eula === 'accepted',
  `Minecraft EULA: ${eula}`,
  'STOP and ask the user to run `npm run minecraft:setup` in their own terminal and type yes themselves. Agents must never accept the EULA or edit eula.txt.',
);

const propsFile = path.join(MC_DIR, 'server.properties');
const props = existsSync(propsFile) ? readFileSync(propsFile, 'utf8') : '';
const localOnly = /^server-ip=127\.0\.0\.1\s*$/m.test(props);
report(
  'mc-properties',
  'minecraft',
  localOnly,
  props ? (localOnly ? 'server.properties binds to 127.0.0.1' : 'server.properties does not bind to 127.0.0.1') : 'server.properties not written yet',
  'Run `npm run minecraft:setup` (the user runs it, because of the EULA step).',
);

if (await portFree(MC_PORT)) report('port-minecraft', 'minecraft', true, `Port ${MC_PORT} is free`);
else report('port-minecraft', 'minecraft', false, `Port ${MC_PORT} is in use (another Minecraft server, or the demo is already running)`, 'Stop the other Minecraft server before starting the demo.');

// ---- Result ----

const officeOk = results.filter((r) => r.level === 'required').every((r) => r.ok);
const mcOk = results.filter((r) => r.level === 'minecraft').every((r) => r.ok);
const code = !officeOk ? 1 : mcOk ? 0 : 2;
const next = !officeOk
  ? 'Fix the ✗ items above, then run npm run doctor again.'
  : mcOk
    ? 'Ready: run `npm run demo:minecraft` (or `npm start` for the office only).'
    : 'The office works now (`npm start`). For the Minecraft demo, fix the ✗ items above; the EULA step must be done by the user.';

if (JSON_OUT) {
  console.log(JSON.stringify({ code, officeReady: officeOk, minecraftReady: mcOk, next, checks: results }, null, 2));
} else {
  for (const section of ['required', 'minecraft']) {
    console.log(section === 'required' ? '\nOffice (required)' : '\nMinecraft demo (optional)');
    for (const r of results.filter((x) => x.level === section)) {
      console.log(`  ${r.ok ? '✓' : '✗'} ${r.message}`);
      if (!r.ok && r.fix) console.log(`      → ${r.fix}`);
    }
  }
  console.log(`\nResult: ${code === 0 ? 'all ready' : code === 2 ? 'office ready, Minecraft not ready' : 'office not ready'} (exit code ${code})`);
  console.log(next);
}
process.exit(code);

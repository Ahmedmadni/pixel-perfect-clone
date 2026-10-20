import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");

test("browser compose binds both externally mapped ports to loopback", () => {
  const compose = read("compose.browser.yml");
  assert.match(compose, /127\.0\.0\.1:4300:4300/);
  assert.match(compose, /127\.0\.0\.1:6080:6080/);
  const published = [...compose.matchAll(/^\s*-\s*["']?([^\n"'#]+:\d+)["']?\s*$/gm)]
    .map((match) => match[1].trim());
  assert.deepEqual(published.sort(), ["127.0.0.1:4300:4300", "127.0.0.1:6080:6080"].sort());
});

test("browser container retains non-root and least-privilege settings", () => {
  const compose = read("compose.browser.yml");
  const dockerfile = read("browser-worker/Dockerfile");
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/);
  assert.match(dockerfile, /^USER pwuser$/m);
});

test("Windows production startup cannot enable CI browser bypass", () => {
  const start = read("scripts/windows/start.ps1");
  const launch = read("scripts/windows/launch.ps1");
  const preflight = read("scripts/windows/preflight.ps1");
  const compose = read("compose.browser.yml");
  assert.match(start, /preflight\.ps1/);
  assert.match(start, /docker info --format "\{\{\.OSType\}\}"/);
  assert.match(start, /\$dockerOs -ne "linux"/);
  assert.match(preflight, /BROWSER_CI_TRUSTED_SMOKE/);
  for (const [name, source] of [["start",start],["launch",launch],["compose",compose]]) {
    assert.doesNotMatch(source, /--no-sandbox|--disable-setuid-sandbox|BROWSER_CI_TRUSTED_SMOKE\s*[=:]\s*true/i, name);
  }
});

test("Windows stop script only stops named containers and preserves volumes", () => {
  const source = read("scripts/windows/stop.ps1");
  const commands = source.split("\n").filter((line) => /^\s*& docker compose\b/.test(line));
  assert.equal(commands.length, 4, "Two configs validated before two scoped stops");
  assert.match(source, /Missing local database config; no containers changed/);
  assert.ok(source.includes('docker info --format "{{.OSType}}"'));
  assert.ok(source.includes('$dockerOs -ne "linux"'));
  assert.ok(source.indexOf("docker info --format") < source.indexOf("stop -t 30 browser-worker"));

  assert.ok(source.includes('Test-Path -LiteralPath (Join-Path $root "local\\.env")'));
  assert.ok(source.indexOf('Test-Path -LiteralPath (Join-Path $root "local\\.env")') < source.indexOf('stop -t 30 browser-worker'),
    "missing DB config must fail before stopping browser");

  assert.match(commands[0], /compose\.browser\.yml" config --quiet/);
  assert.match(commands[1], /compose\.database\.yml" config --quiet/);
  assert.match(commands[2], /compose\.browser\.yml" stop -t 30 browser-worker/);
  assert.match(commands[3], /compose\.database\.yml" stop -t 30 database/);
  for (const line of commands) {
    assert.doesNotMatch(line, /\bdown\b|\brm\b|\bprune\b|--volumes|\s-v\b/i);
  }
  assert.doesNotMatch(source, /^\s*(?:Remove-Item|rm|rmdir|del)\b/im);
});

test("Windows browser restart is scoped, preserves volumes and waits for STOPPED", () => {
  const source = read("scripts/windows/restart-browser.ps1");
  const commands = source.split("\n").filter((line) => /^\s*& docker compose\b/.test(line));
  assert.equal(commands.length, 3);
  assert.match(commands[0], /compose\.browser\.yml" config --quiet/);
  assert.match(commands[1], /-f "compose\.browser\.yml" stop(?: -t 30)? browser-worker/);
  assert.match(commands[2], /-f "compose\.browser\.yml" up -d --no-deps browser-worker/);
  assert.match(source, /\$health\.mode -eq "STOPPED"/);
  assert.match(source, /\$health\.viewOnly/);
  assert.match(source, /\$before\.viewOnly/);
  assert.match(source, /\$before\.mode -ne "STOPPED"/);
  assert.match(source, /Cannot verify browser ownership before restart/);
  assert.match(source, /Browser ownership changed or became unreachable; no containers changed/);
  assert.match(source, /Cannot confirm STOPPED handoff; no containers changed/);
  assert.ok(source.includes('/maintenance/lock'));
  assert.match(source, /\\$freeze\\.maintenanceLocked/);
  assert.ok(source.indexOf('$freeze.mode -ne "STOPPED"') < source.indexOf('stop -t 30 browser-worker'));

  assert.match(source, /\$current\.mode -ne "STOPPED"/);
  assert.ok(source.indexOf('$current.mode -ne "STOPPED"') < source.indexOf('stop -t 30 browser-worker'));

  assert.ok(source.indexOf('$before.mode -ne "STOPPED"') < source.indexOf('stop -t 30 browser-worker'), "pre-stop ownership check must precede container stop");
  assert.match(source, /\$dockerOs -ne "linux"/);
  assert.match(source, /BROWSER_CI_TRUSTED_SMOKE/);
  assert.doesNotMatch(source, /^\s*(?:Remove-Item|rm|rmdir|del)\b/im);
  for (const line of commands) assert.doesNotMatch(line, /\bdown\b|\brm\b|\bprune\b|--volumes|\s-v\b/i);
});

test("browser maintenance lock prevents handoff and fails closed until worker restart", () => {
  const worker = read("browser-worker/src/server.mjs");
  assert.match(worker, /maintenanceLocked && target !== "STOPPED"/);
  assert.match(worker, /pathname === "\/maintenance\/lock"/);
  assert.match(worker, /mode !== "STOPPED"/);
  assert.match(worker, /maintenanceLocked = true/);
  assert.doesNotMatch(worker, /pathname === "\/maintenance\/unlock"/);
});

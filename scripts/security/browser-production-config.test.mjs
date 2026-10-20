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
  assert.equal(commands.length, 2, "Expected exactly two scoped compose commands");
  assert.match(commands[0], /-f "compose\.browser\.yml" stop(?: -t 30)? browser-worker/);
  assert.match(commands[1], /--env-file "local\/\.env" -f "compose\.database\.yml" stop(?: -t 30)? database/);
  for (const line of commands) {
    assert.doesNotMatch(line, /\bdown\b|\brm\b|\bprune\b|--volumes|\s-v\b/i);
  }
  assert.doesNotMatch(source, /^\s*(?:Remove-Item|rm|rmdir|del)\b/im);
});

test("Windows browser restart is scoped, preserves volumes and waits for STOPPED", () => {
  const source = read("scripts/windows/restart-browser.ps1");
  const commands = source.split("\n").filter((line) => /^\s*& docker compose\b/.test(line));
  assert.equal(commands.length, 2);
  assert.match(commands[0], /-f "compose\.browser\.yml" stop(?: -t 30)? browser-worker/);
  assert.match(commands[1], /-f "compose\.browser\.yml" up -d --no-deps browser-worker/);
  assert.match(source, /\$health\.mode -eq "STOPPED"/);
  assert.match(source, /\$before\.mode -ne "STOPPED"/);
  assert.match(source, /Cannot verify browser ownership before restart/);
  assert.ok(source.indexOf('$before.mode -ne "STOPPED"') < source.indexOf('stop -t 30 browser-worker'), "pre-stop ownership check must precede container stop");
  assert.match(source, /\$dockerOs -ne "linux"/);
  assert.match(source, /BROWSER_CI_TRUSTED_SMOKE/);
  assert.doesNotMatch(source, /^\s*(?:Remove-Item|rm|rmdir|del)\b/im);
  for (const line of commands) assert.doesNotMatch(line, /\bdown\b|\brm\b|\bprune\b|--volumes|\s-v\b/i);
});

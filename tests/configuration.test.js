/** Verify real process startup loads .env and rejects malformed configuration. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

test("server starts from .env without contacting the enterprise model", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "aigw-startup-"));
  const file = path.join(directory, ".env");
  writeFileSync(file, 'HOST=127.0.0.1\nPORT=0\nGEMINI_CLIENT=connector\nGEMINI_CONNECTOR_ID=startup-test\nGEMINI_CONNECTOR_MODEL=env-model\nGEMINI_CONNECTOR_API_KEY="test#key"\n');
  const env = { ...process.env, AIGW_CONFIG: file };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GEMINI_") || key === "HOST" || key === "PORT") delete env[key];
  }
  const child = spawn(process.execPath, ["src/server/server.js"], { env, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  t.after(async () => {
    child.kill();
    await exited;
    unlinkSync(file);
    rmdirSync(directory);
  });
  let output = "";
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Startup timed out: ${output}`)), 10000);
    child.stdout.on("data", chunk => {
      output += chunk;
      const match = /AIGW listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
  });
  const response = await fetch(`${url}/v1/models`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data[0].id, "env-model");
  assert.equal((await fetch(`${url}/.env`)).status, 404);
});

test("invalid configuration fails startup rather than silently selecting defaults", () => {
  const result = spawnSync(process.execPath, ["src/server/server.js"], {
    env: { ...process.env, PORT: "invalid" }, encoding: "utf8", timeout: 10000
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ZodError/);
});

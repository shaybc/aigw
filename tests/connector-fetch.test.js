/** Verify nested transport diagnostics never include request or exception secrets. */
import test from "node:test";
import assert from "node:assert/strict";
import { describeConnectorFailure, fetchConnector } from "../src/server/services/ai/connectorFetch.js";

test("nested DNS and certificate failures have actionable descriptions", () => {
  for (const code of ["ENOTFOUND", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"]) {
    const error = new TypeError("fetch failed", { cause: Object.assign(new Error("secret error text"), { code }) });
    const result = describeConnectorFailure(error);
    assert.equal(result[1].code, code);
    assert.ok(result[1].message);
    assert.ok(!JSON.stringify(result).includes("secret"));
  }
});

test("aggregate IPv4/IPv6 failures retain address and port and tolerate cycles", () => {
  const child = Object.assign(new Error("private"), { code: "ECONNREFUSED", address: "::1", port: 3999, syscall: "connect" });
  const error = new AggregateError([child, Object.assign(new Error(), { code: "ETIMEDOUT", address: "127.0.0.1", port: 443 })]);
  child.cause = error;
  const result = describeConnectorFailure(new TypeError("fetch failed", { cause: error }));
  assert.equal(result.length, 4);
  assert.deepEqual(result[2], { name: "Error", code: "ECONNREFUSED", message: "Connection refused", syscall: "connect", address: "::1", port: 3999 });
  assert.equal(result[3].code, "ETIMEDOUT");
});

test("fetch preserves failures and excludes credentials from console and file diagnostics", async t => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const originalFetch = global.fetch;
  const originalConsole = console.error;
  const secret = "diagnostic-test-secret-credential";
  const failure = new TypeError(`https://user:${secret}@host/path?key=${secret}`, {
    cause: Object.assign(new Error(`Authorization: Bearer ${secret}`), { code: "ECONNREFUSED", address: secret, syscall: secret })
  });
  const output = [];
  global.fetch = async () => { throw failure; };
  console.error = (...args) => output.push(args.join(" "));
  t.after(() => { global.fetch = originalFetch; console.error = originalConsole; });
  await assert.rejects(fetchConnector(`https://user:${secret}@host`, { headers: { Authorization: `Bearer ${secret}` }, body: secret }), error => error === failure);
  assert.match(output.join(""), /ECONNREFUSED/);
  assert.ok(!output.join("").includes(secret));
  // Allow the copied asynchronous file logger to flush its diagnostic entry.
  await new Promise(resolve => setTimeout(resolve, 50));
  const logs = readdirSync("log").filter(name => name.startsWith("aigw_")).map(name => readFileSync(`log/${name}`, "utf8")).join("\n");
  assert.match(logs, /Connection refused/);
  assert.ok(!logs.includes(secret));
});

test("successful responses pass through unchanged", async t => {
  const originalFetch = global.fetch;
  const response = new Response("ok");
  global.fetch = async () => response;
  t.after(() => { global.fetch = originalFetch; });
  assert.equal(await fetchConnector("http://unused", {}), response);
});

/** Exercise the real gateway HTTP endpoints against a loopback-only connector. */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("DCC-compatible gateway baseline", async t => {
  let captured;
  let status = 200;
  let answer = { candidates: [{ content: { role: "model", parts: [{ text: "hello" }] } }] };
  const upstream = http.createServer(async (req, res) => {
    let data = "";
    for await (const chunk of req) data += chunk;
    captured = { url: req.url, headers: req.headers, body: JSON.parse(data) };
    // Gemini requires functionResponse.response to be a JSON object.
    for (const turn of captured.body.contents || []) {
      for (const part of turn.parts || []) {
        if (!part.functionResponse) continue;
        const result = part.functionResponse.response;
        if (result === null || typeof result !== "object" || Array.isArray(result)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "functionResponse.response must be an object" }));
          return;
        }
      }
    }
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ response: answer }));
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const temporary = mkdtempSync(path.join(tmpdir(), "aigw-test-"));
  const configPath = path.join(temporary, ".env");
  writeFileSync(configPath, [
    `GEMINI_CONNECTOR_BASE_URL=http://127.0.0.1:${upstream.address().port}`,
    "GEMINI_CONNECTOR_ID=test-connector",
    "GEMINI_CONNECTOR_API_KEY=test-key",
    "GEMINI_CONNECTOR_MODE=raw",
    "GEMINI_CONNECTOR_MODEL=test-model",
    "OPENAI_RESPONSE_LOG_ENABLED=false",
    "AI_CLIENT_TRAFFIC_LOG_ENABLED=false"
  ].join("\n"));
  process.env.AIGW_CONFIG = configPath;
  // Keep tests on loopback even when the shell contains production AI settings.
  Object.assign(process.env, {
    GEMINI_CLIENT: "connector",
    GEMINI_CONNECTOR_BASE_URL: `http://127.0.0.1:${upstream.address().port}`,
    GEMINI_CONNECTOR_ID: "test-connector",
    GEMINI_CONNECTOR_API_KEY: "test-key",
    GEMINI_CONNECTOR_MODE: "raw",
    GEMINI_CONNECTOR_MODEL: "test-model",
    OPENAI_RESPONSE_LOG_ENABLED: "false",
    AI_CLIENT_TRAFFIC_LOG_ENABLED: "false"
  });
  const { createApp } = await import("../src/server/app.js");
  const app = await createApp();
  const gateway = app.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  t.after(async () => {
    await Promise.all([new Promise(resolve => gateway.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
    unlinkSync(configPath);
    rmdirSync(temporary);
  });
  const base = `http://127.0.0.1:${gateway.address().port}/v1`;
  const post = (endpoint, body) => fetch(`${base}${endpoint}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });

  await t.test("lists the configured model without contacting an external registry", async () => {
    const response = await fetch(`${base}/models`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data[0].id, "test-model");
  });
  await t.test("chat preserves raw endpoint, authentication, system instruction and generation settings", async () => {
    const response = await post("/chat/completions", {
      messages: [{ role: "system", content: "Be helpful" }, { role: "user", content: "Hi" }],
      temperature: 0.4, max_tokens: 100
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).choices[0].message.content, "hello");
    assert.equal(captured.url, "/api/connectors/test-connector/v1beta/models/test-model:generateContent");
    assert.equal(captured.headers.authorization, "Bearer test-key");
    assert.equal(captured.body.systemInstruction.parts[0].text, "Be helpful");
    assert.equal(captured.body.generationConfig.maxOutputTokens, 100);
    assert.equal(captured.body.generationConfig.temperature, 0.4);
  });
  // Exercise the same output-limit contract for JSON and SSE on both routes.
  for (const endpoint of ["/chat/completions", "/completions"]) {
    const input = endpoint === "/chat/completions"
      ? { messages: [{ role: "user", content: "Hi" }] }
      : { prompt: "Hi" };
    for (const stream of [false, true]) {
      for (const [label, limits, expected] of [
        ["legacy limit", { max_tokens: 100 }, 100],
        ["LiteLLM limit", { max_completion_tokens: 200 }, 200],
        ["modern limit takes precedence", { max_tokens: 100, max_completion_tokens: 200 }, 200],
        ["minimum limit", { max_completion_tokens: 1 }, 1],
        ["maximum limit", { max_completion_tokens: 65536 }, 65536],
        ["omitted limit", {}, undefined]
      ]) {
        await t.test(`${endpoint} ${label} (stream=${stream})`, async () => {
          const response = await post(endpoint, { ...input, ...limits, stream });
          assert.equal(response.status, 200);
          await response.text();
          assert.equal(captured.body.generationConfig?.maxOutputTokens, expected);
        });
      }
    }
    for (const field of ["max_tokens", "max_completion_tokens"]) {
      for (const value of [0, -1, 65537, "100", null]) {
        await t.test(`${endpoint} rejects ${field}=${JSON.stringify(value)}`, async () => {
          const previous = captured;
          const response = await post(endpoint, { ...input, [field]: value });
          assert.equal(response.status, 400);
          assert.equal((await response.json()).error.type, "invalid_request_error");
          assert.equal(captured, previous, "invalid limits must not reach the connector");
        });
      }
    }
    await t.test(`${endpoint} rejects an invalid modern limit even with a valid legacy limit`, async () => {
      const response = await post(endpoint, { ...input, max_tokens: 100, max_completion_tokens: 0 });
      assert.equal(response.status, 400);
    });
  }
  await t.test("converts JSON schemas and tool declarations using DCC behavior", async () => {
    await post("/chat/completions", {
      messages: [{ role: "user", content: "Read file" }],
      tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object", additionalProperties: false } } }],
      tool_choice: "auto", response_format: { type: "json_object" }
    });
    assert.equal(captured.body.tools[0].functionDeclarations[0].name, "read_file");
    assert.equal(captured.body.tools[0].functionDeclarations[0].parameters.additionalProperties, undefined);
    assert.equal(captured.body.toolConfig.functionCallingConfig.mode, "AUTO");
    assert.equal(captured.body.generationConfig.responseMimeType, "application/json");
  });
  await t.test("streams OpenAI-compatible text events and terminates with DONE", async () => {
    const response = await post("/chat/completions", { messages: [{ role: "user", content: "Hi" }], stream: true });
    const text = await response.text();
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    assert.match(text, /"content":"hello"/);
    assert.match(text, /data: \[DONE\]/);
  });
  await t.test("completion keeps prompt-echo stripping and stop handling", async () => {
    answer = { candidates: [{ content: { parts: [{ text: "prefix result STOP hidden" }] } }] };
    const response = await post("/completions", { prompt: "prefix", stop: "STOP" });
    assert.equal((await response.json()).choices[0].text, " result ");
  });
  await t.test("returns validation and upstream errors", async () => {
    assert.equal((await post("/chat/completions", { messages: [] })).status, 400);
    status = 503;
    const response = await post("/chat/completions", { messages: [{ role: "user", content: "Hi" }] });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error.message, /503/);
    status = 200;
  });
  await t.test("connector embeddings keep DCC's explicit unsupported error", async () => {
    const response = await post("/embeddings", { input: "hello" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error.message, /embedText is not supported/);
  });
  await t.test("JSON tool calls survive a complete assistant/result round trip", async () => {
    answer = { candidates: [{ content: { parts: [{ functionCall: { name: "read_project_file", args: { path: "README.md" } } }] } }] };
    const first = await post("/chat/completions", { messages: [{ role: "user", content: "Read README" }] });
    const assistant = (await first.json()).choices[0].message;
    assert.equal(assistant.content, null);
    const id = assistant.tool_calls[0].id;
    answer = { candidates: [{ content: { parts: [{ text: "Reviewed" }] } }] };
    const result = await post("/chat/completions", { messages: [
      { role: "user", content: "Read README" }, assistant,
      { role: "tool", tool_call_id: id, content: "{\"text\":\"Project README\"}" }
    ] });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).choices[0].message.content, "Reviewed");
    assert.deepEqual(captured.body.contents[1].parts[0].functionCall, { name: "read_project_file", args: { path: "README.md" } });
    assert.deepEqual(captured.body.contents[2].parts[0].functionResponse, { name: "read_project_file", response: { text: "Project README" } });
  });
  const contentParts = [
    { type: "text", text: "Files in C:\\Workspace\\project:\nREADME.md" },
    { type: "text", text: "Second result block" }
  ];
  for (const stream of [false, true]) {
    for (const [label, content, expected] of [
      ["OpenHands content array", contentParts, { content: contentParts }],
      ["empty content array", [], { content: [] }],
      ["JSON array", '["README.md", "src"]', { content: ["README.md", "src"] }],
      ["JSON number", "42", { content: 42 }],
      ["JSON boolean", "false", { content: false }],
      ["JSON null", "null", { content: null }],
      ["JSON string", '\"done\"', { content: "done" }],
      ["plain text", "Files listed", { content: "Files listed" }],
      ["JSON object", '{"files":["README.md"]}', { files: ["README.md"] }],
      ["null message content", null, { content: "" }],
      ["omitted message content", undefined, { content: "" }]
    ]) {
      await t.test(`tool result ${label} is a Gemini object (stream=${stream})`, async () => {
        const response = await post("/chat/completions", { stream, messages: [
          { role: "user", content: "Review project" },
          { role: "assistant", content: null, tool_calls: [
            { id: "opaque-editor-call", type: "function", function: { name: "file_editor", arguments: '{"command":"view","path":"README.md"}' } }
          ] },
          { role: "tool", tool_call_id: "opaque-editor-call", content }
        ] });
        assert.equal(response.status, 200, await response.text());
        const result = captured.body.contents[2].parts[0].functionResponse;
        assert.equal(result.name, "file_editor");
        assert.deepEqual(result.response, expected);
        assert.equal(typeof result.response, "object");
        assert.ok(result.response !== null && !Array.isArray(result.response));
      });
    }
  }
  await t.test("parallel tool results resolve opaque IDs and preserve assistant text", async () => {
    const response = await post("/chat/completions", { messages: [
      { role: "user", content: "Inspect files" },
      { role: "assistant", content: "Inspecting", tool_calls: [
        { id: "opaque-a", type: "function", function: { name: "read_file", arguments: "{\"path\":\"a\"}" } },
        { id: "opaque-b", type: "function", function: { name: "list_project_files", arguments: "{}" } }
      ] },
      { role: "tool", tool_call_id: "opaque-b", content: "files" },
      { role: "tool", tool_call_id: "opaque-a", content: "contents" }
    ] });
    assert.equal(response.status, 200);
    assert.equal(captured.body.contents[1].parts[0].text, "Inspecting");
    assert.equal(captured.body.contents[2].parts[0].functionResponse.name, "list_project_files");
    assert.equal(captured.body.contents[3].parts[0].functionResponse.name, "read_file");
  });
  await t.test("tool results retain explicit names and legacy underscore IDs", async () => {
    await post("/chat/completions", { messages: [
      { role: "user", content: "Continue" },
      { role: "tool", tool_call_id: "opaque", name: "explicit_name", content: "one" },
      { role: "tool", tool_call_id: "call_read_project_file_12", content: "two" }
    ] });
    assert.equal(captured.body.contents[1].parts[0].functionResponse.name, "explicit_name");
    assert.equal(captured.body.contents[2].parts[0].functionResponse.name, "read_project_file");
  });
  await t.test("SSE tool calls survive the next request's history", async () => {
    answer = { candidates: [{ content: { parts: [{ functionCall: { name: "run_project_test", args: { command: "npm test" } } }] } }] };
    const response = await post("/chat/completions", { messages: [{ role: "user", content: "Test" }], stream: true });
    const events = (await response.text()).split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
    const call = events.flatMap(event => event.choices[0].delta.tool_calls || [])[0];
    assert.equal(events.at(-1).choices[0].finish_reason, "tool_calls");
    answer = { candidates: [{ content: { parts: [{ text: "Tests passed" }] } }] };
    const next = await post("/chat/completions", { messages: [
      { role: "user", content: "Test" },
      { role: "assistant", content: null, tool_calls: [call] },
      { role: "tool", tool_call_id: call.id, content: "passed" }
    ] });
    assert.equal(next.status, 200);
    assert.equal(captured.body.contents[2].parts[0].functionResponse.name, "run_project_test");
  });
  await t.test("regular mode preserves DCC's form payload and endpoint", async () => {
    const { GeminiConnectorClient } = await import("../src/server/services/ai/geminiConnectorClient.js");
    const client = new GeminiConnectorClient({ baseUrl: `http://127.0.0.1:${upstream.address().port}`, connectorId: "regular", apiKey: "key", mode: "regular" });
    answer = "regular answer";
    const result = await client.generateText({ prompt: "hello" });
    assert.equal(captured.url, "/api/connectors/regular");
    assert.equal(result.candidates[0].content.parts[0].text, "regular answer");
  });
});

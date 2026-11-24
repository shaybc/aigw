# AIGW — AI Gateway

Standalone Node.js gateway extracted from DCC's AI connector layers. It translates
OpenAI-compatible requests into the enterprise Gemini connector protocol.

```text
Coding agent → http://127.0.0.1:3100/v1 → enterprise connector → AI model
```

## Start

Requires Node.js 22 or newer. The prepared project includes only its runtime
dependencies, copied from DCC's installed packages; it can start without npm or
internet access:

```powershell
cd C:\GitHub\shaybc\aigw
# .env is already provided with placeholder values. Edit it before using the model.
node src/server/server.js
```

For a source-only checkout, install dependencies with `npm ci` on a connected
preparation machine, then transfer the project and `node_modules` to the offline
machine. Run `npm test` to exercise the gateway against a local mock connector.

## Configuration

Edit `.env`; restart AIGW after changes. This uses the same dotenv technology as
DCC, with clear-text values. There is no Settings UI, SQLite database, or runtime
configuration endpoint. No credentials were copied from DCC.

| Variable | Purpose |
| --- | --- |
| `HOST`, `PORT` | Listener address; default `127.0.0.1:3100` |
| `GEMINI_CLIENT` | `connector` for enterprise use; `aistudio` retains DCC's optional direct Google client |
| `GEMINI_CONNECTOR_BASE_URL` | Internal connector host, without `/api/connectors/...` |
| `GEMINI_CONNECTOR_ID` | Enterprise connector identifier |
| `GEMINI_CONNECTOR_API_KEY` | Bearer credential sent to the connector |
| `GEMINI_CONNECTOR_MODEL` | Model exposed through the connector |
| `GEMINI_CONNECTOR_MODE` | `raw` for coding agents; `regular` preserves DCC's text-only connector mode |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Optional AI Studio settings; unused in connector mode |
| `OPENAI_RESPONSE_LOG_ENABLED` | Log OpenAI request/response payloads |
| `AI_CLIENT_TRAFFIC_LOG_ENABLED` | Log upstream connector/client traffic |
| `AI_RESPONSE_LOG_MAX_LENGTH` | Payload logging truncation limit |
| `LOG_FILE_MAX_SIZE_MB`, `LOG_FILE_MAX_FILES` | DCC-style rotating file logging limits |
| `AIGW_CONFIG` | Optional environment variable selecting another `.env` file |

Process environment variables override `.env`, following dotenv's normal behavior.
Quote values containing `#` or surrounding spaces. The gateway does not serve
the `.env` file over HTTP. Log files are written under `log/` relative to the
working directory. `.env`, logs, and dependencies are excluded from Git.

## Client connection

Configure a coding agent's **OpenAI-compatible Chat Completions** provider with:

```text
Base URL: http://127.0.0.1:3100/v1
Model:    the value of GEMINI_CONNECTOR_MODEL
API key:  a nonempty placeholder if the client requires one
```

As in DCC, inbound requests are not API-key authenticated. The configured
enterprise credential is used on outbound requests. The listener defaults to
loopback. AIGW does not implement the OpenAI Responses API.

## Preserved endpoints and behavior

- `GET /v1/models`: synthesizes the configured connector model list.
- `POST /v1/chat/completions`: text, tool declarations, tool calls, structured output,
  generation settings, and OpenAI-compatible SSE output.
- `POST /v1/completions`: text/FIM completion, prompt-echo removal, stop sequences,
  and SSE output.
- `POST /v1/embeddings`: retains DCC's behavior. Enterprise connector mode reports
  that embeddings are unsupported without a dedicated embedding connector; the
  route does not configure one. AI Studio mode retains its original embedding call.

The enterprise raw endpoint is:

```text
POST {GEMINI_CONNECTOR_BASE_URL}/api/connectors/{connectorId}/v1beta/models/{model}:generateContent
```

Connector-mode streaming remains simulated: the gateway waits for the upstream
response and then emits SSE chunks. Token usage remains zero, matching DCC.
Multimodal contents, thought signatures, and other protocol extensions have not
been expanded beyond DCC's existing mappings.

## Extraction and tool-history correction

The AI routes, Gemini connector, AI Studio client, AI settings normalization,
payload logging, and file rotation were copied from DCC. Project management,
editors, agent runners, scanning, database code, and the Settings UI were omitted.
The server entry point and `.env` settings adapter make those layers standalone.
Log filenames use `aigw_` in place of `dcc_`.

Baseline HTTP checks passed before the tool-history changes. The subsequent fix
is confined to `src/server/routes/openai.js`:

- Accept assistant `content: null` and retain `tool_calls`, `tool_call_id`, and `name`.
- Resolve tool result names from their corresponding assistant call IDs.
- Preserve explicit tool names and legacy IDs containing underscores.

Validation uses a real HTTP gateway and a loopback mock enterprise connector,
including JSON and SSE tool-call round trips, parallel tool results, opaque IDs,
errors, and baseline behavior. The actual enterprise model and an OpenCode client
have not been connected in this environment.

In connector mode, AIGW makes no model-catalog, update, or external startup
requests. Only model operations contact the configured connector. Offline tools,
dependencies, and network settings for the coding agent itself must be prepared
separately.

## Windows launcher

Run `run-aigw.cmd` to check Node.js 22+ and installed runtime dependencies.
Missing or invalid dependencies are installed with `npm ci --no-audit --no-fund`
using your configured npm registry before AIGW starts. A valid installed
dependency tree is reused. Configure your internal Artifactory npm registry
through your existing npm configuration.

## OpenHands client

The Python runner is a separate sibling project at `C:\GitHub\shaybc\ohands`.
Start AIGW here, then run `run-ohands.cmd` from that project. OHANDS has its own
Python requirements, prompt, and `.env`; point its `LLM_BASE_URL` at this gateway's
`/v1` endpoint. Enterprise connector credentials remain in AIGW's `.env`.

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

## Run an OpenHands task

`ohands.py` runs the installed OpenHands Software Agent SDK using its embedded
LiteLLM client and AIGW's Chat Completions endpoint. Use a Python 3.12+ environment
containing `openhands-sdk`, `openhands-tools`, and `python-dotenv`. Prepare those
packages and their dependencies through your organization's offline installation
process. The SDK terminal tool also needs its platform runtime dependencies
(including tmux where its terminal backend requires it).

1. Configure `.env` and start AIGW with `npm start` in a separate terminal.
2. Edit the multiline `PROMPT` and `WORKSPACE` in `ohands.py`.
3. Activate your SDK's Python environment and run `run-ohands.cmd`. It installs
   `requirements.txt` and launches `ohands.py`, stopping if installation fails.
   To launch without reinstalling requirements, use `python ohands.py`.

For offline installation, point the batch file at a folder containing all required
Python packages (including transitive dependencies):

```bat
set "AIGW_WHEELHOUSE=C:\path\to\wheels"
run-ohands.cmd
```

Without `AIGW_WHEELHOUSE`, pip uses its normal configured package index/cache.
`run-ohands.cmd` uses the active `python` interpreter and requires Python 3.12 or newer.
It runs from the AIGW project directory and does not start the gateway server.

The runner registers terminal, file editor, and task tracker tools. The SDK's
conversation loop executes the task and displays its standard progress output.
This is a single-task runner, not a persistent interactive chat interface. Tools
execute locally with the Python process's permissions; the workspace is a working
directory, not a filesystem sandbox. The supplied prompt requests review only;
replace it with your implementation task to allow edits.

The runner reads AIGW's `.env` beside `ohands.py` (or the file selected by
`AIGW_CONFIG`). The model defaults to `openai/{GEMINI_CONNECTOR_MODEL}`. The default
URL is derived from `HOST` and `PORT`; wildcard bind hosts become loopback.
Optional runner settings can be placed in `.env` or the process environment:
`LLM_MODEL` (include `openai/`), `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_TIMEOUT`
(default 300 seconds), `LLM_MAX_OUTPUT_TOKENS` (8192), `AIGW_WORKSPACE`, and
`AIGW_MAX_ITERATIONS` (100). The inbound AIGW key is a placeholder, not the enterprise
connector credential. For container deployments, set `LLM_BASE_URL` to a reachable
gateway address.

Offline LiteLLM catalog settings are applied before SDK imports. Tokenizer data,
project dependencies, and any external integrations still need offline preparation.
Runner tests use SDK mocks: `python -m unittest discover -s tests -p test_run.py`.
An actual SDK/model run must be verified in your prepared enterprise environment.

## Windows launchers

Start `run-aigw.cmd` to check Node.js 22+ and the installed runtime dependencies.
If dependencies are missing or invalid, it runs `npm ci --no-audit --no-fund`
using your configured npm registry, then starts AIGW. A valid installed dependency
tree is reused without reinstalling it. Configure your internal Artifactory npm
registry through your existing npm configuration before running this launcher.

In another terminal, use `run-ohands.cmd` to install the Python requirements
through your configured pip registry (or `AIGW_WHEELHOUSE`) and run `ohands.py`.
The two launchers change to the project directory before running commands.

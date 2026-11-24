/** Start the standalone AI Gateway HTTP listener. */
import { createApp } from "./app.js";
import { readConfiguration } from "./utils/configuration.js";
const { host, port } = readConfiguration();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const app = await createApp();
const server = app.listen(port, host, () => {
  console.log(`AIGW listening on http://${host}:${server.address().port}`);
});

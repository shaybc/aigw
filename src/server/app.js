/** Assemble only the AI gateway endpoints extracted from DCC. */
import express from "express";
import openaiRouter from "./routes/openai.js";
import { loadAiLogConfigFromSettings } from "./utils/aiLogging.js";
import { loadLoggerFileConfigFromSettings } from "./utils/logger.js";

/** Create the HTTP application after loading AI logging settings. */
export async function createApp() {
  await loadAiLogConfigFromSettings();
  await loadLoggerFileConfigFromSettings();
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  app.use("/v1", openaiRouter);
  return app;
}

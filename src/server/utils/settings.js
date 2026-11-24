/** Adapt DCC's AI settings interface to .env without a database or Settings UI. */
import { readConfiguration } from "./configuration.js";
const keys = {
  geminiClient: "GEMINI_CLIENT",
  geminiConnectorBaseUrl: "GEMINI_CONNECTOR_BASE_URL",
  geminiConnectorId: "GEMINI_CONNECTOR_ID",
  geminiConnectorApiKey: "GEMINI_CONNECTOR_API_KEY",
  geminiConnectorModel: "GEMINI_CONNECTOR_MODEL",
  geminiConnectorMode: "GEMINI_CONNECTOR_MODE",
  geminiApiKey: "GEMINI_API_KEY",
  geminiModel: "GEMINI_MODEL",
  openAiResponseLogEnabled: "OPENAI_RESPONSE_LOG_ENABLED",
  aiClientTrafficLogEnabled: "AI_CLIENT_TRAFFIC_LOG_ENABLED",
  aiResponseLogMaxLength: "AI_RESPONSE_LOG_MAX_LENGTH",
  logFileMaxSizeMb: "LOG_FILE_MAX_SIZE_MB",
  logFileMaxFiles: "LOG_FILE_MAX_FILES"
};
const runtimeDefaults = new Map();

/** Resolve an AI setting from the validated startup configuration. */
export async function getSetting(key) {
  return readConfiguration()[keys[key]] ?? runtimeDefaults.get(key) ?? null;
}

/** Retain copied DCC loaders' default writes in memory; never rewrite .env. */
export async function setSetting(key, value) {
  runtimeDefaults.set(key, value);
}

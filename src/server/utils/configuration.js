/** Load clear-text .env configuration using DCC's dotenv/Zod stack. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

export const configurationPath = process.env.AIGW_CONFIG
  ? path.resolve(process.env.AIGW_CONFIG)
  : fileURLToPath(new URL("../../../.env", import.meta.url));
const loaded = dotenv.config({ path: configurationPath });
if (loaded.error && (process.env.AIGW_CONFIG || loaded.error.code !== "ENOENT")) throw loaded.error;
const boolean = z.enum(["true", "false"]).transform(value => value === "true");
const config = z.object({
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(0).max(65535).default(3100),
  GEMINI_CLIENT: z.enum(["connector", "aistudio"]).default("connector"),
  GEMINI_CONNECTOR_BASE_URL: z.string().url().default("http://127.0.0.1:3999"),
  GEMINI_CONNECTOR_ID: z.string().default(""),
  GEMINI_CONNECTOR_API_KEY: z.string().default(""),
  GEMINI_CONNECTOR_MODEL: z.string().min(1).default("gemini-2.5-pro"),
  GEMINI_CONNECTOR_MODE: z.enum(["raw", "regular"]).default("raw"),
  GEMINI_API_KEY: z.string().default(""),
  GEMINI_MODEL: z.string().min(1).default("gemini-2.5-pro"),
  OPENAI_RESPONSE_LOG_ENABLED: boolean.default("false"),
  AI_CLIENT_TRAFFIC_LOG_ENABLED: boolean.default("false"),
  AI_RESPONSE_LOG_MAX_LENGTH: z.coerce.number().int().min(50).max(99999).default(300),
  LOG_FILE_MAX_SIZE_MB: z.coerce.number().int().min(10).max(1024).default(100),
  LOG_FILE_MAX_FILES: z.coerce.number().int().min(1).max(365).default(30)
}).parse(process.env);

/** Return validated startup settings; restart after editing .env. */
export function readConfiguration() {
  return { ...config, host: config.HOST, port: config.PORT };
}

/** Supply copied DCC AI modules' defaults from .env. */
import { readConfiguration } from "./configuration.js";
const config = readConfiguration();
export const env = {
  GEMINI_API_KEY: config.GEMINI_API_KEY,
  GEMINI_MODEL: config.GEMINI_MODEL,
  OPENAI_RESPONSE_LOG_ENABLED: config.OPENAI_RESPONSE_LOG_ENABLED
};

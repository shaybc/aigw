/** Log credential-free transport diagnostics while preserving connector failures. */
import { isIP } from "node:net";
import { logError } from "../../utils/logger.js";

// Use fixed descriptions rather than arbitrary exception text that may contain secrets.
const descriptions = {
  ECONNREFUSED: "Connection refused",
  ENOTFOUND: "Hostname could not be resolved",
  EAI_AGAIN: "Temporary DNS resolution failure",
  ECONNRESET: "Connection reset",
  ETIMEDOUT: "Connection timed out",
  EHOSTUNREACH: "Host unreachable",
  ENETUNREACH: "Network unreachable",
  UND_ERR_CONNECT_TIMEOUT: "Connection timed out",
  UND_ERR_HEADERS_TIMEOUT: "Response headers timed out",
  UND_ERR_BODY_TIMEOUT: "Response body timed out",
  UND_ERR_SOCKET: "Socket failure",
  DEPTH_ZERO_SELF_SIGNED_CERT: "Self-signed server certificate",
  SELF_SIGNED_CERT_IN_CHAIN: "Self-signed certificate in chain",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "Unable to verify server certificate",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "Local issuer certificate unavailable",
  CERT_HAS_EXPIRED: "Certificate expired",
  ERR_TLS_CERT_ALTNAME_INVALID: "Certificate hostname mismatch",
  ERR_INVALID_URL: "Invalid connector URL"
};

/** Extract only allowlisted fields from nested causes and AggregateError children. */
export function describeConnectorFailure(error) {
  const seen = new Set();
  const failures = [];
  function visit(current) {
    if (!current || typeof current !== "object" || seen.has(current) || failures.length >= 10) return;
    seen.add(current);
    const detail = { name: ["Error", "TypeError", "AggregateError"].includes(current.name) ? current.name : "Error" };
    if (Object.hasOwn(descriptions, current.code)) {
      detail.code = current.code;
      detail.message = descriptions[current.code];
    }
    if (["connect", "getaddrinfo", "read", "write"].includes(current.syscall)) detail.syscall = current.syscall;
    if (typeof current.address === "string" && isIP(current.address)) detail.address = current.address;
    if (Number.isInteger(current.port) && current.port >= 0 && current.port <= 65535) detail.port = current.port;
    failures.push(detail);
    visit(current.cause);
    if (Array.isArray(current.errors)) current.errors.forEach(visit);
  }
  visit(error);
  return failures;
}

/** Fetch a connector response; log transport failures without changing the thrown error. */
export async function fetchConnector(url, options) {
  try {
    return await fetch(url, options);
  } catch (error) {
    const details = describeConnectorFailure(error);
    logError("[CONNECTOR] fetch failed", { causes: details });
    console.error("[CONNECTOR] fetch failed", JSON.stringify({ causes: details }));
    throw error;
  }
}

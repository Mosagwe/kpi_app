import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function loadEnv() {
  const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const rootDir = path.resolve(backendDir, "..");
  dotenv.config({ path: path.join(rootDir, ".env") });
  dotenv.config({ path: path.join(backendDir, ".env") });
  return { backendDir, rootDir, env: process.env };
}

export function getProxyConfig(env = process.env) {
  const raw = env.OPENAI_PROXY_URL?.trim()
    || env.HTTPS_PROXY?.trim()
    || env.HTTP_PROXY?.trim()
    || "";
  if (!raw) return { url: "", error: "" };
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Unsupported protocol");
    return { url: raw, error: "" };
  } catch {
    return {
      url: "",
      error: "The proxy setting is invalid. Use a complete URL such as http://proxy.company.com:8080."
    };
  }
}

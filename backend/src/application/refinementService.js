import { AppError } from "./errors.js";
import { buildRefinementPrompt } from "../domain/kpi.js";

export function createRefinementService({ env, proxyConfig, refinementGateway }) {
  return {
    async refineAchievement({ kpi, tone, instruction }) {
      const apiKey = env.OPENAI_API_KEY?.trim();
      if (!apiKey || apiKey.includes("your_api_key")) {
        throw new AppError("OpenAI is not configured. Add OPENAI_API_KEY to the .env file and restart the app.", 503);
      }
      if (!kpi?.title || !kpi?.achievement?.trim()) {
        throw new AppError("Add an achievement draft before refining it.", 400);
      }

      const proxy = proxyConfig();
      if (proxy.error) throw new AppError(proxy.error, 500);

      return refinementGateway.refine({
        apiKey,
        model: env.OPENAI_MODEL || "gpt-5.5",
        proxyUrl: proxy.url,
        prompt: buildRefinementPrompt(kpi, { tone, instruction })
      });
    }
  };
}

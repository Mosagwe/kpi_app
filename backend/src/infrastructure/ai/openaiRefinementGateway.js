import OpenAI from "openai";
import { fetch as undiciFetch, ProxyAgent } from "undici";

export function createOpenAiRefinementGateway() {
  return {
    async refine({ apiKey, model, proxyUrl, prompt }) {
      const clientOptions = { apiKey, timeout: 30000, maxRetries: 1 };
      if (proxyUrl) {
        clientOptions.fetch = undiciFetch;
        clientOptions.fetchOptions = { dispatcher: new ProxyAgent(proxyUrl) };
      }
      const client = new OpenAI(clientOptions);
      const response = await client.responses.create({ model, input: prompt });
      const refined = response.output_text?.trim();
      if (!refined) throw new Error("The model returned an empty response.");
      return { refined };
    }
  };
}

export function createConfigService({ env, proxyConfig }) {
  const hasApiKey = () => Boolean(env.OPENAI_API_KEY?.trim() && !env.OPENAI_API_KEY.includes("your_api_key"));

  return {
    getClientConfig() {
      const proxy = proxyConfig();
      return {
        aiConfigured: hasApiKey(),
        model: env.OPENAI_MODEL || "gpt-5.5",
        proxyConfigured: Boolean(proxy.url),
        proxyError: proxy.error
      };
    },
    getRefinementStatus() {
      const proxy = proxyConfig();
      return {
        ready: hasApiKey(),
        method: "POST",
        proxyConfigured: Boolean(proxy.url),
        proxyError: proxy.error,
        message: "AI refinement is ready. Use the Refine with AI button inside a quarterly KPI."
      };
    }
  };
}

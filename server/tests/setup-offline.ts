// Server tests never reach a model provider: their keys are removed before anything reads them.
// A test that exercises the router gives it its own fetch and keys.
for (const env of ['NVIDIA_API_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'NEAR_AI_API_KEY', 'ECONOMY_CLOCK_SPEED']) {
  delete process.env[env];
}

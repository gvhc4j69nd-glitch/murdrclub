const Anthropic = require('@anthropic-ai/sdk');

let anthropic = null;
function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic;
}

module.exports = { getAnthropicClient };

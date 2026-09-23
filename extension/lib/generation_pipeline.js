import { callOpenRouter, callGroq, callLocal, aiScore } from './provider_client.js';
import { buildRefinePrompt } from './prompt_builders.js';

const AI_SCORE_TARGET = 20;
export const MAX_REFINE_ATTEMPTS = 5;

function generateText(text, provider, config) {
  if (provider === 'openrouter') return callOpenRouter(text, config.apiKey, config.model);
  if (provider === 'groq') return callGroq(text, config.apiKey, config.model);
  return callLocal(text, config.endpoint, config.model, config.apiKey);
}

export async function runGenerationPipeline({ prompt, contextBlock, generationProvider, generationConfig, scoringProvider, scoringConfig, onStage }) {
  onStage('writing');
  let text = await generateText(prompt, generationProvider, generationConfig);

  onStage('scoring');
  let score = await aiScore(text, scoringProvider, scoringConfig);

  let attempts = 0;
  while (score >= AI_SCORE_TARGET && attempts < MAX_REFINE_ATTEMPTS) {
    attempts++;
    onStage('rewriting', attempts);
    text = await generateText(buildRefinePrompt(text, score, contextBlock), generationProvider, generationConfig);
    onStage('scoring', attempts);
    score = await aiScore(text, scoringProvider, scoringConfig);
  }

  return { text, score, attempts };
}

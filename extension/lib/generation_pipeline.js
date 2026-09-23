import { callOpenRouter, callGroq, callLocal, aiScore } from './provider_client.js';
import { buildRefinePrompt } from './prompt_builders.js';

const AI_SCORE_TARGET = 20;
export const MAX_REFINE_ATTEMPTS = 5;

function generateText(text, provider, config) {
  if (provider === 'openrouter') return callOpenRouter(text, config.apiKey, config.model, config.effort);
  if (provider === 'groq') return callGroq(text, config.apiKey, config.model, config.effort);
  return callLocal(text, config.endpoint, config.model, config.apiKey, config.effort);
}

function assertConfigured(role, provider, config) {
  const ready = provider === 'local' ? config.endpoint && config.model : config.apiKey && config.model;
  if (!ready) {
    throw new Error(`The ${role} provider (${provider}) isn't set up \u2014 add its ${provider === 'local' ? 'endpoint and model' : 'API key and model'} in Settings.`);
  }
}

export async function runGenerationPipeline({ prompt, contextBlock, generationProvider, generationConfig, scoringProvider, scoringConfig, onStage }) {
  assertConfigured('generation', generationProvider, generationConfig);
  assertConfigured('scoring', scoringProvider, scoringConfig);

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

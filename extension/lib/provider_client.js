export async function callChatCompletions(url, headers, model, prompt) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  const data = await response.json();

  if (!data.choices || !data.choices[0]?.message?.content) {
    throw new Error(`API returned invalid response: ${JSON.stringify(data)}`);
  }

  return data.choices[0].message.content.trim();
}

export async function callOpenRouter(prompt, apiKey, model) {
  const headers = {
    Authorization: "Bearer " + apiKey,
    "Content-Type": "application/json",
  };
  const url = "https://openrouter.ai/api/v1/chat/completions";
  return callChatCompletions(url, headers, model, prompt);
}

export async function callGroq(prompt, apiKey, model) {
  const headers = {
    Authorization: "Bearer " + apiKey,
    "Content-Type": "application/json",
  };
  const url = "https://api.groq.com/openai/v1/chat/completions";
  return callChatCompletions(url, headers, model, prompt);
}

export async function callLocal(prompt, endpoint, model, apiKey) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = "Bearer " + apiKey;
  }
  return callChatCompletions(endpoint, headers, model, prompt);
}

export async function aiScore(text, provider, config) {
  const prompt =
    "Rate the probability that the following text was written by an AI. Output ONLY a single integer from 0 (definitely human) to 100 (definitely AI). No explanation.\n\nText:\n" + text;

  let response;
  try {
    if (provider === "openrouter") {
      response = await callOpenRouter(prompt, config.apiKey, config.model);
    } else if (provider === "groq") {
      response = await callGroq(prompt, config.apiKey, config.model);
    } else if (provider === "local") {
      response = await callLocal(prompt, config.endpoint, config.model, config.apiKey);
    } else {
      return 0;
    }
  } catch (error) {
    return 0;
  }

  const match = response.match(/\b(\d{1,3})\b/);
  return match ? Math.min(parseInt(match[1], 10), 100) : 100;
}

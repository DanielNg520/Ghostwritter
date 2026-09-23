export function buildContext(rulesText, memoryText) {
  const parts = [];
  if (rulesText) {
    parts.push(`--- RULES (must follow) ---\n${rulesText}`);
  }
  if (memoryText) {
    parts.push(`--- MEMORY (keep in mind) ---\n${memoryText}`);
  }
  return parts.join("\n\n");
}

export function buildTextPrompt(productTitle, productDetails, userComment, contextBlock, samplesText) {
  let strategy;
  if (userComment) {
    strategy =
      `The author left these notes about ${productTitle}:\n"${userComment}"\n` +
      "Use them as the primary basis for the review.";
  } else {
    strategy =
      `Search the internet for real customer reviews of '${productTitle}'. ` +
      "If none are found, search for the product description instead. " +
      "Base the review on that research.";
  }

  return `You are a ghostwriter writing an Amazon Vine review.

Product title: ${productTitle}
Product details: ${productDetails ? productDetails : "(none provided)"}
No product image is available; use the product title and details above to identify what the product is.

${strategy}

Writing samples (replicate this author's voice, rhythm, and sentence structure):
${samplesText}

${contextBlock}

Output ONLY the finished review text. Nothing else.`;
}

export function buildGeneralistPrompt(pageTitle, pageText, userPrompt, category, contextBlock, samplesText) {
  const pageBlock =
    `Page title: ${pageTitle ? pageTitle : "(none provided)"}\n` +
    `Page text: ${pageText ? pageText : "(none provided)"}`;

  return `You are a ghostwriter helping someone write a piece of text.

The user currently has this page open in their browser (optional reference
material — use it only if it's relevant to the request below):
${pageBlock}

What the user wants written:
${userPrompt ? userPrompt : "(no specific instructions provided — use the page content above as the basis for what to write)"}

Voice/category to write in: ${category ? category : "(none specified)"}

Writing samples (replicate this author's voice, rhythm, and sentence structure):
${samplesText}

${contextBlock}

Output ONLY the finished text. Nothing else.`;
}

export function buildRefinePrompt(reviewText, score, contextBlock) {
  return `This review scored ${score}% on an AI-detection scale (lower is more human).
Rewrite it to sound more natural and human. Do not change the core content.

${contextBlock}

Output ONLY the rewritten review text. Nothing else.

Original review:
${reviewText}`;
}

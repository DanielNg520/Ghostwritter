export const SAMPLE_CATEGORIES = ["formal", "casual", "academic", "creative", "narrative", "technical", "review", "cover_letter"];

const SAMPLES_CHAR_LIMIT = 60000;

function sanitizeFilename(name) {
  let clean = name.replace(/[/\\:*?"<>|]/g, ' ');
  clean = clean.replace(/\s+/g, ' ').trim();
  return clean.length > 180 ? clean.slice(0, 180) : clean;
}

export async function listSampleCategories() {
  return SAMPLE_CATEGORIES;
}

export async function listSamples(category) {
  const stored = await chrome.storage.local.get('samples');
  const samples = stored.samples || {};
  return Object.keys(samples[category] || {}).sort();
}

export async function saveSample(category, filename, content) {
  const base = sanitizeFilename(filename.replace(/\.[^.]*$/, '')) || 'sample';
  const finalName = `${base}.md`;
  const stored = await chrome.storage.local.get('samples');
  const samples = stored.samples || {};
  samples[category] = { ...(samples[category] || {}), [finalName]: content };
  await chrome.storage.local.set({ samples });
  return finalName;
}

export async function deleteSample(category, filename) {
  const stored = await chrome.storage.local.get('samples');
  const samples = stored.samples || {};
  if (!samples[category] || !samples[category][filename]) {
    return false;
  }
  delete samples[category][filename];
  await chrome.storage.local.set({ samples });
  return true;
}

export async function readSamplesText(category) {
  const stored = await chrome.storage.local.get('samples');
  const samples = stored.samples || {};
  const entries = [];
  let totalLen = 0;
  let omitted = false;
  const categorySamples = samples[category] || {};
  for (const filename of Object.keys(categorySamples)) {
    const content = categorySamples[filename];
    if (!content) continue;
    const entry = `--- ${filename} ---\n${content}`;
    if (totalLen + entry.length > SAMPLES_CHAR_LIMIT) {
      omitted = true;
      continue;
    }
    entries.push(entry);
    totalLen += entry.length;
  }
  if (omitted) {
    entries.push('[additional samples omitted for length]');
  }
  return entries.join('\n\n');
}

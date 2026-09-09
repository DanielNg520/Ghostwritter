const providerAgy = document.getElementById('provider-agy');
const providerClaudeCode = document.getElementById('provider-claude-code');
const providerOpenrouter = document.getElementById('provider-openrouter');
const providerGroq = document.getElementById('provider-groq');
const providerLocal = document.getElementById('provider-local');
const localEndpoint = document.getElementById('local-endpoint');
const localModel = document.getElementById('local-model');
const localApiKey = document.getElementById('local-api-key');
const openrouterApiKey = document.getElementById('openrouter-api-key');
const openrouterModel = document.getElementById('openrouter-model');
const groqApiKey = document.getElementById('groq-api-key');
const groqModel = document.getElementById('groq-model');
const saveBtn = document.getElementById('save-btn');
const settingsStatus = document.getElementById('settings-status');

chrome.storage.local.get('providerSettings').then((result) => {
  const settings = result.providerSettings;
  const activeProvider = settings?.activeProvider;

  if (activeProvider === 'claude_code') {
    providerClaudeCode.checked = true;
  } else if (activeProvider === 'openrouter') {
    providerOpenrouter.checked = true;
  } else if (activeProvider === 'groq') {
    providerGroq.checked = true;
  } else if (activeProvider === 'local') {
    providerLocal.checked = true;
  } else {
    providerAgy.checked = true;
  }

  openrouterApiKey.value = settings?.openrouter?.apiKey ?? '';
  openrouterModel.value = settings?.openrouter?.model ?? '';
  groqApiKey.value = settings?.groq?.apiKey ?? '';
  groqModel.value = settings?.groq?.model ?? '';
  localEndpoint.value = settings?.local?.endpoint ?? '';
  localModel.value = settings?.local?.model ?? '';
  localApiKey.value = settings?.local?.apiKey ?? '';
});

saveBtn.addEventListener('click', () => {
  const activeProvider = document.querySelector('input[name="provider"]:checked').value;

  const providerSettings = {
    activeProvider,
    openrouter: {
      apiKey: openrouterApiKey.value,
      model: openrouterModel.value,
    },
    groq: {
      apiKey: groqApiKey.value,
      model: groqModel.value,
    },
    local: {
      endpoint: localEndpoint.value,
      model: localModel.value,
      apiKey: localApiKey.value,
    },
  };

  chrome.storage.local.set({ providerSettings }).then(() => {
    settingsStatus.textContent = 'Settings saved.';
  });
});

// --- Writing Samples manager (Phase 5) ---
// Category panels are generated dynamically from this list rather than
// hand-written 7x in settings.html, to avoid near-duplicate markup drift.
const SAMPLE_CATEGORIES = [
  'formal',
  'casual',
  'academic',
  'creative',
  'narrative',
  'technical',
  'review',
];

const SAMPLES_API = 'http://localhost:8000/samples';

const samplesSection = document.getElementById('samples-section');
const samplesStatus = document.getElementById('samples-status');

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// Build the static per-category panel markup once.
SAMPLE_CATEGORIES.forEach((category) => {
  const panel = document.createElement('div');
  panel.className = 'sample-panel';
  panel.innerHTML = `
    <h2>${capitalize(category)}</h2>
    <ul id="samples-list-${category}" class="samples-list"></ul>
    <div class="sample-upload-row">
      <label for="sample-file-${category}">Upload file (.txt or .md)</label>
      <input type="file" id="sample-file-${category}" accept=".txt,.md" data-category="${category}">
    </div>
    <div class="sample-paste-row">
      <label for="sample-name-${category}">Sample name</label>
      <input type="text" id="sample-name-${category}" placeholder="Sample name" data-category="${category}" class="sample-name-input">
      <label for="sample-text-${category}">Paste text</label>
      <textarea id="sample-text-${category}" placeholder="Paste sample text here..." data-category="${category}" class="sample-text-input"></textarea>
      <button type="button" data-category="${category}" class="add-sample-btn">Add Sample</button>
    </div>
    <div class="sample-panel-message" id="sample-message-${category}"></div>
  `;
  samplesSection.appendChild(panel);
});

function renderSampleList(category, filenames) {
  const list = document.getElementById(`samples-list-${category}`);
  list.innerHTML = '';
  if (!filenames || filenames.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'samples-empty';
    empty.textContent = 'No samples yet.';
    list.appendChild(empty);
    return;
  }
  filenames.forEach((filename) => {
    const item = document.createElement('li');
    item.className = 'sample-item';

    const name = document.createElement('span');
    name.className = 'sample-filename';
    name.textContent = filename;

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'sample-delete-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteSample(category, filename));

    item.appendChild(name);
    item.appendChild(deleteBtn);
    list.appendChild(item);
  });
}

async function loadAllSamples() {
  try {
    const response = await fetch(SAMPLES_API);
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    const data = await response.json();
    const categories = data.categories || {};
    SAMPLE_CATEGORIES.forEach((category) => {
      renderSampleList(category, categories[category] || []);
    });
    samplesStatus.textContent = '';
  } catch (err) {
    samplesStatus.textContent = 'Could not load samples — make sure Ghost Writer\'s server is running.';
  }
}

async function refreshCategory(category) {
  try {
    const response = await fetch(SAMPLES_API);
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    const data = await response.json();
    const categories = data.categories || {};
    renderSampleList(category, categories[category] || []);
    samplesStatus.textContent = '';
  } catch (err) {
    samplesStatus.textContent = 'Could not load samples — make sure Ghost Writer\'s server is running.';
  }
}

function setSampleMessage(category, message) {
  const el = document.getElementById(`sample-message-${category}`);
  if (el) {
    el.textContent = message;
  }
}

async function deleteSample(category, filename) {
  try {
    const response = await fetch(SAMPLES_API, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, filename }),
    });
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    await refreshCategory(category);
  } catch (err) {
    samplesStatus.textContent = 'Could not load samples — make sure Ghost Writer\'s server is running.';
  }
}

async function addSample(category, filename, content) {
  try {
    const response = await fetch(SAMPLES_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, filename, content }),
    });
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    await refreshCategory(category);
    return true;
  } catch (err) {
    samplesStatus.textContent = 'Could not load samples — make sure Ghost Writer\'s server is running.';
    return false;
  }
}

// Wire file inputs.
SAMPLE_CATEGORIES.forEach((category) => {
  const fileInput = document.getElementById(`sample-file-${category}`);
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      await addSample(category, file.name, reader.result);
      fileInput.value = '';
    };
    reader.readAsText(file);
  });
});

// Wire "Add Sample" buttons for pasted text.
document.querySelectorAll('.add-sample-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const category = btn.dataset.category;
    const nameInput = document.getElementById(`sample-name-${category}`);
    const textInput = document.getElementById(`sample-text-${category}`);
    const filename = nameInput.value.trim();
    const content = textInput.value.trim();

    if (!filename || !content) {
      setSampleMessage(category, 'Please provide both a sample name and some text.');
      return;
    }

    setSampleMessage(category, '');
    const ok = await addSample(category, filename, content);
    if (ok) {
      nameInput.value = '';
      textInput.value = '';
    }
  });
});

loadAllSamples();

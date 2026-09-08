const providerAgy = document.getElementById('provider-agy');
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

  if (activeProvider === 'openrouter') {
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

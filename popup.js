const GEMINI_MODEL_MODES = Object.freeze({
  auto: 'auto',
  manual: 'manual',
});

const GEMINI_MODEL_FALLBACK_ORDER = Object.freeze([
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
  'gemma-4-31b',
  'gemma-4-26b-a4b',
  'gemma-3-27b',
  'gemma-3-12b',
  'gemma-3-4b',
  'gemma-3-2b',
  'gemma-3-1b',
]);

const DEFAULT_GEMINI_MODEL = GEMINI_MODEL_FALLBACK_ORDER[0];

document.addEventListener('DOMContentLoaded', () => {
  const toggleFilter = document.getElementById('toggleFilter');
  const toggleTime = document.getElementById('toggleTime');
  const toggleDailyTarget = document.getElementById('toggleDailyTarget');
  const toggleAutoSkip = document.getElementById('toggleAutoSkip');
  const toggleAlwaysFocus = document.getElementById('toggleAlwaysFocus');
  const toggleCopyText = document.getElementById('toggleCopyText');
  const toggleDownload = document.getElementById('toggleDownload');
  const toggleSlideDownload = document.getElementById('toggleSlideDownload');
  const toggleProofread = document.getElementById('toggleProofread');
  const geminiApiKeyInput = document.getElementById('geminiApiKey');
  const geminiModelMode = document.getElementById('geminiModelMode');
  const geminiSelectedModel = document.getElementById('geminiSelectedModel');
  const saveGeminiApiKey = document.getElementById('saveGeminiApiKey');
  const geminiApiKeyStatus = document.getElementById('geminiApiKeyStatus');
  let lastSavedApiKey = '';

  const normalizeModelMode = (value) => {
    return value === GEMINI_MODEL_MODES.manual ? GEMINI_MODEL_MODES.manual : GEMINI_MODEL_MODES.auto;
  };

  const normalizeModelName = (value) => {
    return GEMINI_MODEL_FALLBACK_ORDER.includes(value) ? value : DEFAULT_GEMINI_MODEL;
  };

  const getModelDisplayName = (modelName) => {
    if (modelName === 'gemini-2.5-flash') {
      return `${modelName}（推奨）`;
    }
    return modelName;
  };

  const setApiKeyStatus = (message) => {
    if (geminiApiKeyStatus) {
      const suffix = toggleProofread && !toggleProofread.checked ? ' / AI校正はOFF' : '';
      geminiApiKeyStatus.textContent = `${message}${suffix}`;
    }
  };

  const getCurrentModelSettings = () => {
    return {
      geminiModelMode: normalizeModelMode(geminiModelMode?.value),
      geminiSelectedModel: normalizeModelName(geminiSelectedModel?.value),
    };
  };

  const getCurrentModeLabel = () => {
    const { geminiModelMode: currentMode, geminiSelectedModel: currentModel } = getCurrentModelSettings();
    return currentMode === GEMINI_MODEL_MODES.manual ? getModelDisplayName(currentModel) : '自動選択';
  };

  const hasUnsavedApiKey = () => {
    if (!geminiApiKeyInput) return false;
    return geminiApiKeyInput.value.trim() !== lastSavedApiKey;
  };

  const populateModelOptions = () => {
    if (!geminiSelectedModel) return;

    geminiSelectedModel.innerHTML = '';
    for (const modelName of GEMINI_MODEL_FALLBACK_ORDER) {
      const option = document.createElement('option');
      option.value = modelName;
      option.textContent = getModelDisplayName(modelName);
      geminiSelectedModel.appendChild(option);
    }
  };

  const updateModelUi = () => {
    if (!geminiModelMode || !geminiSelectedModel) return;

    const isManual = geminiModelMode.value === GEMINI_MODEL_MODES.manual;
    geminiSelectedModel.disabled = !isManual;
  };

  const saveApiKey = () => {
    if (!geminiApiKeyInput) return;

    const geminiApiKey = geminiApiKeyInput.value.trim();

    chrome.storage.local.set({ geminiApiKey }, () => {
      const lastError = chrome.runtime?.lastError || null;
      if (lastError) {
        setApiKeyStatus('保存に失敗しました');
        return;
      }

      lastSavedApiKey = geminiApiKey;
      const prefix = geminiApiKey ? 'APIキーを保存しました' : 'APIキーを削除しました';
      setApiKeyStatus(`${prefix} (${getCurrentModeLabel()})`);
    });
  };

  const saveModelSettings = () => {
    const modelSettings = getCurrentModelSettings();

    chrome.storage.local.set(modelSettings, () => {
      const lastError = chrome.runtime?.lastError || null;
      if (lastError) {
        setApiKeyStatus('モデル設定の保存に失敗しました');
        return;
      }

      const suffix = hasUnsavedApiKey() ? ' / APIキーは未保存' : '';
      setApiKeyStatus(`モデル設定を保存しました (${getCurrentModeLabel()})${suffix}`);
    });
  };

  populateModelOptions();

  // 初期状態を読み込んでUIのスイッチに反映
  chrome.storage.local.get(
    {
      forceEssentialEnabled: true,
      showTotalTime: true,
      showDailyTarget: true,
      autoSkipEnabled: false,
      alwaysFocusEnabled: true,
      copyTextEnabled: true,
      downloadEnabled: true,
      slideDownloadEnabled: true,
      proofreadEnabled: true,
      geminiApiKey: '',
      geminiModelMode: GEMINI_MODEL_MODES.auto,
      geminiSelectedModel: DEFAULT_GEMINI_MODEL,
    },
    (result) => {
      toggleFilter.checked = result.forceEssentialEnabled;
      if (toggleTime) toggleTime.checked = result.showTotalTime;
      if (toggleDailyTarget) toggleDailyTarget.checked = result.showDailyTarget;
      if (toggleAutoSkip) toggleAutoSkip.checked = result.autoSkipEnabled;
      if (toggleAlwaysFocus) toggleAlwaysFocus.checked = result.alwaysFocusEnabled;
      if (toggleCopyText) toggleCopyText.checked = result.copyTextEnabled;
      if (toggleDownload) toggleDownload.checked = result.downloadEnabled;
      if (toggleSlideDownload) toggleSlideDownload.checked = result.slideDownloadEnabled;
      if (toggleProofread) toggleProofread.checked = result.proofreadEnabled;
      if (geminiApiKeyInput) geminiApiKeyInput.value = result.geminiApiKey || '';
      lastSavedApiKey = (result.geminiApiKey || '').trim();
      if (geminiModelMode) geminiModelMode.value = normalizeModelMode(result.geminiModelMode);
      if (geminiSelectedModel) geminiSelectedModel.value = normalizeModelName(result.geminiSelectedModel);
      updateModelUi();

      const modeLabel = normalizeModelMode(result.geminiModelMode) === GEMINI_MODEL_MODES.manual
        ? getModelDisplayName(normalizeModelName(result.geminiSelectedModel))
        : '自動選択';
      setApiKeyStatus(result.geminiApiKey ? `APIキー保存済み (${modeLabel})` : `APIキー未設定 (${modeLabel})`);
    }
  );

  // トグル変更時に即座に保存
  toggleFilter.addEventListener('change', () => {
    chrome.storage.local.set({ forceEssentialEnabled: toggleFilter.checked });
  });

  toggleTime.addEventListener('change', () => {
    chrome.storage.local.set({ showTotalTime: toggleTime.checked });
  });

  if (toggleDailyTarget) {
    toggleDailyTarget.addEventListener('change', () => {
      chrome.storage.local.set({ showDailyTarget: toggleDailyTarget.checked });
    });
  }

  if (toggleAutoSkip) {
    toggleAutoSkip.addEventListener('change', () => {
      chrome.storage.local.set({ autoSkipEnabled: toggleAutoSkip.checked });
    });
  }

  if (toggleAlwaysFocus) {
    toggleAlwaysFocus.addEventListener('change', () => {
      chrome.storage.local.set({ alwaysFocusEnabled: toggleAlwaysFocus.checked });
    });
  }

  if (toggleCopyText) {
    toggleCopyText.addEventListener('change', () => {
      chrome.storage.local.set({ copyTextEnabled: toggleCopyText.checked });
    });
  }

  if (toggleDownload) {
    toggleDownload.addEventListener('change', () => {
      chrome.storage.local.set({ downloadEnabled: toggleDownload.checked });
    });
  }

  if (toggleSlideDownload) {
    toggleSlideDownload.addEventListener('change', () => {
      chrome.storage.local.set({ slideDownloadEnabled: toggleSlideDownload.checked });
    });
  }

  if (toggleProofread) {
    toggleProofread.addEventListener('change', () => {
      chrome.storage.local.set({ proofreadEnabled: toggleProofread.checked }, () => {
        const lastError = chrome.runtime?.lastError || null;
        if (lastError) {
          setApiKeyStatus('AI文章校正の設定保存に失敗しました');
          return;
        }

        const prefix = toggleProofread.checked ? 'AI文章校正を有効化しました' : 'AI文章校正を無効化しました';
        setApiKeyStatus(`${prefix} (${getCurrentModeLabel()})`);
      });
    });
  }

  if (saveGeminiApiKey) {
    saveGeminiApiKey.addEventListener('click', saveApiKey);
  }

  if (geminiApiKeyInput) {
    geminiApiKeyInput.addEventListener('input', () => {
      setApiKeyStatus(`APIキーを保存してください (${getCurrentModeLabel()})`);
    });
    geminiApiKeyInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        saveApiKey();
      }
    });
  }

  if (geminiModelMode) {
    geminiModelMode.addEventListener('change', () => {
      updateModelUi();
      saveModelSettings();
    });
  }

  if (geminiSelectedModel) {
    geminiSelectedModel.addEventListener('change', () => {
      saveModelSettings();
    });
  }
});

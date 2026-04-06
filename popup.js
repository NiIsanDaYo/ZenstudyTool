document.addEventListener('DOMContentLoaded', () => {
  const toggleFilter = document.getElementById('toggleFilter');
  const toggleTime = document.getElementById('toggleTime');
  const toggleDailyTarget = document.getElementById('toggleDailyTarget');
  const toggleAutoSkip = document.getElementById('toggleAutoSkip');
  const toggleAlwaysFocus = document.getElementById('toggleAlwaysFocus');
  const toggleCopyText = document.getElementById('toggleCopyText');
  const toggleDownload = document.getElementById('toggleDownload');

  // 初期状態を読み込んでUIのスイッチに反映
  chrome.storage.local.get(
    { forceEssentialEnabled: true, showTotalTime: true, showDailyTarget: true, autoSkipEnabled: false, alwaysFocusEnabled: true, copyTextEnabled: true, downloadEnabled: true },
    (result) => {
      toggleFilter.checked = result.forceEssentialEnabled;
      if (toggleTime) toggleTime.checked = result.showTotalTime;
      if (toggleDailyTarget) toggleDailyTarget.checked = result.showDailyTarget;
      if (toggleAutoSkip) toggleAutoSkip.checked = result.autoSkipEnabled;
      if (toggleAlwaysFocus) toggleAlwaysFocus.checked = result.alwaysFocusEnabled;
      if (toggleCopyText) toggleCopyText.checked = result.copyTextEnabled;
      if (toggleDownload) toggleDownload.checked = result.downloadEnabled;
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
});

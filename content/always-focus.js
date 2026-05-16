class ZenstudyToolAlwaysFocus {
  constructor() {
    this.enabled = false;
    this.playObserver = null;

    safeStorageGet(
      { [STORAGE_KEYS.alwaysFocusEnabled]: true },
      (result) => {
        this.setEnabled(Boolean(result[STORAGE_KEYS.alwaysFocusEnabled]));
      }
    );

    addSafeStorageChangeListener((changes, area) => {
      if (area !== "local") return;
      const change = changes[STORAGE_KEYS.alwaysFocusEnabled];
      if (change === undefined) return;
      this.setEnabled(Boolean(change.newValue));
    });
  }

  setEnabled(enabled) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    enabled ? this.start() : this.stop();
  }

  start() {
    this.addPlayListener();

    if (this.playObserver) return;
    this.playObserver = new MutationObserver(() => {
      this.addPlayListener();
    });
    this.playObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  stop() {
    if (this.playObserver) {
      this.playObserver.disconnect();
      this.playObserver = null;
    }
    this.removePlayListener();
  }

  playVideo = (event) => {
    const video = event.target;
    // 動画が完全に終わっている(video.ended)時以外は強制再開する
    if (this.enabled && !video.ended) {
      video.play().catch((e) => console.warn('[ZenstudyTool] Auto-play failed', e));
      console.log('[ZenstudyTool] 自動的に動画を再開（バックグラウンド再生）');
    }
  }

  addPlayListener() {
    const videoElements = document.querySelectorAll('video');
    videoElements.forEach((video) => {
      // 登録の重複を避ける
      video.removeEventListener('pause', this.playVideo);
      video.addEventListener('pause', this.playVideo);
    });
  }

  removePlayListener() {
    const videoElements = document.querySelectorAll('video');
    videoElements.forEach((video) => {
      video.removeEventListener('pause', this.playVideo);
    });
  }
}

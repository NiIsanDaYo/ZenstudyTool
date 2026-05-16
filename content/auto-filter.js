class ZenstudyToolAutoFilter {
  constructor() {
    this.observer = null;
    this.isRunning = false;
    this.lastClickTime = 0;
    this.intervalId = null;

    // ストレージから初期状態を読み込んで開始/停止
    safeStorageGet(
      { [STORAGE_KEYS.forceEssentialEnabled]: true },
      (result) => {
        if (result[STORAGE_KEYS.forceEssentialEnabled]) this.start();
      }
    );

    // ストレージ変更を監視してリアルタイムに切り替え
    addSafeStorageChangeListener((changes, area) => {
      if (area !== "local") return;
      const change = changes[STORAGE_KEYS.forceEssentialEnabled];
      if (change === undefined) return;
      change.newValue ? this.start() : this.stop();
    });
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.enforceEssentialOnly();
    this.observer = createDebouncedObserver(() => this.enforceEssentialOnly());
    this.intervalId = setInterval(
      () => this.enforceEssentialOnly(),
      FILTER_POLL_INTERVAL_MS
    );
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.disableActiveFilter();
  }

  /**
   * フィルタが未選択状態かどうかを判定する。
   * 必修ボタンとNプラスボタンのCSSクラスを比較し、
   * Nプラスボタン固有のクラスが無い＝両方同じ外見＝フィルタ未適用と判断。
   */
  isFilterInactive(essentialBtn, plusBtn) {
    const essentialClasses = new Set(essentialBtn.classList);
    const plusUniqueClasses = Array.from(plusBtn.classList).filter(
      (c) => !essentialClasses.has(c)
    );
    return plusUniqueClasses.length === 0;
  }

  /** フィルタを解除する（停止時に呼ばれる） */
  disableActiveFilter() {
    const { essentialBtn, plusBtn } = this.getFilterButtons();
    if (!essentialBtn || !plusBtn) return;
    if (this.isFilterInactive(essentialBtn, plusBtn)) return;
    essentialBtn.click();
  }

  /** フィルタが非アクティブなら有効化する */
  enforceEssentialOnly() {
    const { essentialBtn, plusBtn } = this.getFilterButtons();
    if (!essentialBtn || !plusBtn) return;

    if (this.isFilterInactive(essentialBtn, plusBtn)) {
      const now = Date.now();
      if (now - this.lastClickTime < FILTER_CLICK_COOLDOWN_MS) return;
      this.lastClickTime = now;
      essentialBtn.click();
    }
  }

  /** フィルタボタン要素を取得する */
  getFilterButtons() {
    return {
      essentialBtn: document.querySelector(
        `button[aria-label="${ARIA_LABELS.essential}"]`
      ),
      plusBtn: document.querySelector(
        `button[aria-label="${ARIA_LABELS.nPlus}"]`
      ),
    };
  }
}

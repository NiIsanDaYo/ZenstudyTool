class ZenstudyToolUI {
  constructor(timeLogic) {
    this.timeLogic = timeLogic;
    this.processedAnchors = new WeakSet();
    this.processedSidebars = new WeakSet();
    this.showTime = true;
    this.showDailyTarget = true;

    // ストレージから初期状態を読み込み
    safeStorageGet(
      { [STORAGE_KEYS.showTotalTime]: true, [STORAGE_KEYS.showDailyTarget]: true },
      (result) => {
        this.showTime = result[STORAGE_KEYS.showTotalTime];
        this.showDailyTarget = result[STORAGE_KEYS.showDailyTarget];
        this.updateGlobalVisibility();
      }
    );

    // ストレージ変更をリアルタイムに反映
    addSafeStorageChangeListener((changes, area) => {
      if (area !== "local") return;
      let shouldUpdate = false;
      if (changes[STORAGE_KEYS.showTotalTime] !== undefined) {
        this.showTime = changes[STORAGE_KEYS.showTotalTime].newValue;
        shouldUpdate = true;
      }
      if (changes[STORAGE_KEYS.showDailyTarget] !== undefined) {
        this.showDailyTarget = changes[STORAGE_KEYS.showDailyTarget].newValue;
        shouldUpdate = true;
      }
      if (shouldUpdate) this.updateGlobalVisibility();
    });

    // DOM変更を監視してウィジェットを注入
    this.observer = createDebouncedObserver(() => this.scanDOM());
  }

  /** 表示/非表示をグローバルCSSで切り替える */
  updateGlobalVisibility() {
    let styleEl = document.getElementById("zenstudy-tool-toggle-style");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "zenstudy-tool-toggle-style";
      document.head.appendChild(styleEl);
    }
    let css = "";
    if (!this.showTime) {
      css += `.${CSS_CLASSES.wrapper} { display: none !important; }\n`;
    }
    if (!this.showDailyTarget) {
      css += `.${CSS_CLASSES.dailyTarget} { display: none !important; }\n`;
    }
    styleEl.textContent = css;
  }

  /**
   * 時間データからウィジェットDOM要素を生成する
   * @param {{goal:number, current:number}} data
   * @returns {HTMLElement}
   */
  createTimeWidget(data, deadline = null) {
    const timeText =
      data.goal > 0
        ? `${formatTime(data.current)} / ${formatTime(data.goal)}`
        : "- / -";

    // 日割り計算
    let dailyHtml = "";
    if (deadline && data.goal > 0) {
      const remaining = data.goal - data.current;
      const daily = calculateDailyTarget(remaining, deadline);
      if (daily) {
        if (daily.expired) {
          dailyHtml = ` <span class="${CSS_CLASSES.dailyTarget}" style="color:#e53935;font-weight:bold">(期限切れ - 遅刻です)</span>`;
        } else {
          dailyHtml = ` <span class="${CSS_CLASSES.dailyTarget}" style="color:#1e88e5">(1日あたり: ${formatDailyTime(daily.secondsPerDay)})</span>`;
        }
      }
    }

    const el = createElement("div", {
      className: data.goal === 0 ? CSS_CLASSES.faint : "",
    });
    el.innerHTML = timeText + dailyHtml;
    return el;
  }

  /** DOMをスキャンしてウィジェットを注入する */
  scanDOM() {
    this.scanAnchors();
    this.scanChapterSidebar();
  }

  /**
   * ウィジェットの挿入先要素を決定する
   * - H4（タイトル行）があればそこに配置
   * - レポート一覧など特殊構造にも対応
   */
  getInjectTarget(element) {
    const h4 = element.querySelector("h4");
    if (h4) return h4;

    // レポート一覧の特殊構造
    if (element.matches('a[aria-label$="のレポート"]')) {
      return element.querySelector(":scope > :nth-child(1) > :nth-child(1)") || element;
    }
    if (element.matches('a:has([aria-label^="進捗度"])')) {
      return element.querySelector(":scope > :nth-child(1) > :nth-child(2)") || element;
    }

    return element.firstElementChild || element;
  }

  /**
   * 親要素に時間ウィジェットを注入する
   * @param {HTMLElement} parent - 注入先の親要素
   * @param {string} href - データ取得対象のURL
   * @param {boolean} isAnchor - アンカー要素かどうか
   */
  injectToParent(parent, href, isAnchor = true) {
    if (this.processedAnchors.has(parent)) return;
    this.processedAnchors.add(parent);

    Promise.all([
      this.timeLogic.fetchDataByUrl(href),
      this.timeLogic.getDeadlineForUrl(href),
    ]).then(([data, deadline]) => {
      if (!data) return;

      // 通信完了時に元要素が消滅していたら描画をキャンセル
      if (!document.body.contains(parent)) return;

      const targetEl = isAnchor ? this.getInjectTarget(parent) : parent;
      if (targetEl.querySelector(`.${CSS_CLASSES.wrapper}`)) return;

      const widget = this.createTimeWidget(data, deadline);
      const wrapper = createElement("div", {
        className: CSS_CLASSES.wrapper,
      }, [widget]);

      targetEl.appendChild(wrapper);

      // アンカー内の場合、タイトルと時間を横並びにする
      if (isAnchor) {
        const isNestedDiv =
          targetEl.tagName === "DIV" &&
          targetEl !== parent &&
          targetEl !== parent.firstElementChild;
        const isHeading = targetEl.tagName === "H4";

        if (isNestedDiv || isHeading) {
          targetEl.style.display = "flex";
          targetEl.style.alignItems = "center";
          targetEl.style.justifyContent = "space-between";
        }
      }
    });
  }

  /** ページ内のアンカー要素をスキャンしてウィジェットを注入 */
  scanAnchors() {
    const selectors = [
      '[aria-label="チャプター一覧"] a:has(h4)',
      '[aria-label="コース一覧"] a:has(h4)',
      'a:has([aria-label^="進捗度"])',
      'a[aria-label$="のレポート"]',
    ];
    const anchors = document.querySelectorAll(selectors.join(", "));

    for (const anchor of anchors) {
      if (anchor.href) this.injectToParent(anchor, anchor.href, true);
    }
  }

  /** サイドバーの教材リストに時間ウィジェットを注入 */
  scanChapterSidebar() {
    const sidebarList = document.querySelector(
      ':has(> [aria-label$="教材リスト"]) > div:nth-child(1):not(:has([aria-label="教材フィルタ"]))'
    );
    if (sidebarList && !this.processedSidebars.has(sidebarList)) {
      this.processedSidebars.add(sidebarList);
      this.injectToParent(sidebarList, window.location.href, false);
    }
  }
}

/**
 * ZenstudyTool - Content Script
 *
 * 機能一覧:
 *   1. 「必修教材のみ」フィルタの常時・強制有効化
 *   2. 必修動画の合計時間をインライン表示
 *   3. 期限までの1日あたり必要視聴時間を自動計算・表示
 *   4. 完了済み教材の自動スキップ
 */

// ============================================================
// 定数
// ============================================================

/** CSSクラス名 */
const CSS_CLASSES = {
  wrapper: "__ZENSTUDYTOOL_wrapper",
  faint: "__ZENSTUDYTOOL_faint",
  dailyTarget: "__ZENSTUDYTOOL_dailyTarget",
  downloadButton: "__ZENSTUDYTOOL_downloadButton",
};

/** DOM要素ID */
const ELEMENT_IDS = {
  copyButton: "__ZENSTUDYTOOL_copy_btn",
  downloadButton: "__ZENSTUDYTOOL_download_btn",
};

/** ダウンロードボタン文言 */
const DOWNLOAD_BUTTON_TEXT = {
  ready: "ダウンロード",
  waiting: "URL取得中...",
  preparing: "準備中...",
  downloading: "ダウンロード中...",
  saving: "保存中...",
  started: "保存開始",
  success: "完了",
  failed: "失敗",
};

/** DOM監視のデバウンス間隔 (ms) */
const DEBOUNCE_MS = 50;

/** フィルタボタンの連打防止間隔 (ms) */
const FILTER_CLICK_COOLDOWN_MS = 500;

/** フィルタ状態を定期チェックする間隔 (ms) */
const FILTER_POLL_INTERVAL_MS = 2000;

/** 自動スキップの遷移後に次の操作を待つ間隔 (ms) */
const AUTO_SKIP_DELAY_MS = 1500;

/** ストレージキー */
const STORAGE_KEYS = {
  forceEssentialEnabled: "forceEssentialEnabled",
  showTotalTime: "showTotalTime",
  showDailyTarget: "showDailyTarget",
  autoSkipEnabled: "autoSkipEnabled",
  alwaysFocusEnabled: "alwaysFocusEnabled",
  copyTextEnabled: "copyTextEnabled",
  downloadEnabled: "downloadEnabled",
};

/** ボタンのaria-label */
const ARIA_LABELS = {
  essential: "必修教材のみ",
  nPlus: "Nプラス教材のみ",
};

/** API エンドポイント */
const API_BASE_URL = "https://api.nnn.ed.nico";

// ============================================================
// ユーティリティ
// ============================================================

/**
 * DOM要素を簡易生成する
 * @param {string} tag  - タグ名
 * @param {Object} props - 要素に設定するプロパティ
 * @param {Array<string|Node>} children - 子要素
 * @returns {HTMLElement}
 */
const createElement = (tag, props = {}, children = []) => {
  const el = document.createElement(tag);
  Object.assign(el, props);
  for (const child of children) {
    if (typeof child === "string") {
      el.appendChild(document.createTextNode(child));
    } else if (child) {
      el.appendChild(child);
    }
  }
  return el;
};

/**
 * 秒数を "H:MM:SS" 形式にフォーマットする
 * @param {number} seconds
 * @returns {string}
 */
const formatTime = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const minuteStr = `${h ? String(m).padStart(2, "0") : m}:`;
  const secondStr = String(s).padStart(2, "0");
  return `${h ? `${h}:` : ""}${minuteStr}${secondStr}`;
};

/**
 * バイト数を読みやすい単位に整形する
 * @param {number} bytes
 * @returns {string}
 */
const formatByteSize = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const fractionDigits = value >= 100 || unitIndex === 0
    ? 0
    : value >= 10
      ? 1
      : 2;

  return `${value.toFixed(fractionDigits)}${units[unitIndex]}`;
};

/**
 * 日割り秒数を "X時間Y分" 形式にフォーマットする
 * @param {number} seconds
 * @returns {string}
 */
const formatDailyTime = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.ceil(seconds % 60);
  
  let res = "";
  if (h > 0) res += `${h}時間`;
  if (m > 0 || h > 0) res += `${m}分`;
  res += `${s}秒`;
  return res;
};

/**
 * 残り秒数と期限日から1日あたりの必要視聴時間を計算する
 * @param {number} remainingSeconds - 残りの視聴時間（秒）
 * @param {Date} deadlineDate - 期限日（この日の0:00が締切）
 * @returns {{secondsPerDay:number, daysRemaining:number}|{expired:true}|null}
 */
const calculateDailyTarget = (remainingSeconds, deadlineDate) => {
  if (remainingSeconds <= 0) return null;
  const now = new Date();
  const msRemaining = deadlineDate.getTime() - now.getTime();
  if (msRemaining <= 0) return { expired: true };
  const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
  const secondsPerDay = remainingSeconds / daysRemaining;
  return { secondsPerDay, daysRemaining };
};

/**
 * デバウンス付き MutationObserver を生成・開始する
 * @param {Function} callback  - デバウンス後に実行されるコールバック
 * @param {number}   delayMs   - デバウンス間隔
 * @returns {MutationObserver}
 */
const createDebouncedObserver = (callback, delayMs = DEBOUNCE_MS, observeAttributes = false) => {
  let timeoutId = null;
  const observer = new MutationObserver(() => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(callback, delayMs);
  });
  const config = { childList: true, subtree: true };
  if (observeAttributes) config.attributes = true;
  observer.observe(document.body, config);
  return observer;
};

/**
 * 時間データの配列を合算する
 * @param {Array<{goal:number, current:number}|null>} results
 * @returns {{goal:number, current:number}}
 */
const sumTimeResults = (results) => {
  const sums = { goal: 0, current: 0 };
  for (const result of results) {
    if (result) {
      sums.goal += result.goal;
      sums.current += result.current;
    }
  }
  return sums;
};

let didWarnExtensionContextInvalidated = false;

const isExtensionContextInvalidatedError = (value) => {
  const message = typeof value === "string" ? value : value?.message || "";
  return /Extension context invalidated/i.test(message);
};

const reportExtensionContextInvalidated = (error) => {
  if (didWarnExtensionContextInvalidated) return;
  didWarnExtensionContextInvalidated = true;
  console.warn(
    "[ZenstudyTool] Extension context invalidated. Reload the page after reloading or updating the extension.",
    error
  );
};

const safeStorageGet = (defaults, callback) => {
  try {
    chrome.storage.local.get(defaults, (result) => {
      const lastError = chrome.runtime?.lastError || null;
      if (lastError) {
        if (isExtensionContextInvalidatedError(lastError)) {
          reportExtensionContextInvalidated(lastError);
        } else {
          console.warn("[ZenstudyTool] chrome.storage.local.get failed", lastError);
        }
        callback(defaults);
        return;
      }

      callback(result);
    });
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) {
      reportExtensionContextInvalidated(error);
      callback(defaults);
      return;
    }

    throw error;
  }
};

const addSafeStorageChangeListener = (listener) => {
  try {
    chrome.storage.onChanged.addListener(listener);
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) {
      reportExtensionContextInvalidated(error);
      return;
    }

    throw error;
  }
};

const addSafeRuntimeMessageListener = (listener) => {
  try {
    chrome.runtime.onMessage.addListener(listener);
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) {
      reportExtensionContextInvalidated(error);
      return;
    }

    throw error;
  }
};

const safeRuntimeSendMessage = (message, callback = () => {}) => {
  try {
    chrome.runtime.sendMessage(message, (response) => {
      const lastError = chrome.runtime?.lastError || null;
      if (lastError && isExtensionContextInvalidatedError(lastError)) {
        reportExtensionContextInvalidated(lastError);
        callback(undefined, lastError);
        return;
      }

      callback(response, lastError);
    });
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) {
      reportExtensionContextInvalidated(error);
      callback(undefined, error);
      return;
    }

    throw error;
  }
};

// ============================================================
// 必修フィルタ自動有効化
// ============================================================

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

// ============================================================
// 動画時間データ取得ロジック
// ============================================================

class ZenstudyToolTimeLogic {
  constructor() {
    this.cache = new Map();
  }

  /**
   * APIからデータを取得する（キャッシュ付き）
   * @param {string} path - APIパス
   * @returns {Promise<Object|null>}
   */
  fetchApi(path) {
    if (this.cache.has(path)) return this.cache.get(path);

    const promise = fetch(`${API_BASE_URL}${path}`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);

    this.cache.set(path, promise);
    return promise;
  }

  /**
   * URLパスからページ種別とIDを解析する
   * @param {string} pathname
   * @returns {{type:string, courseId?:string, chapterId?:string, year?:string, month?:string}|null}
   */
  parsePathname(pathname) {
    // チャプターページ
    const chapterMatch =
      pathname.match(/^\/courses\/(\d+)\/chapters\/(\d+)/) ||
      pathname.match(/^\/contents\/courses\/(\d+)\/chapters\/(\d+)/);
    if (chapterMatch) {
      return {
        type: "chapter",
        courseId: chapterMatch[1],
        chapterId: chapterMatch[2],
      };
    }

    // コースページ
    const courseMatch = pathname.match(/^\/courses\/(\d+)\/?$/);
    if (courseMatch) {
      return { type: "course", courseId: courseMatch[1] };
    }

    // 月間レポートページ
    const monthMatch = pathname.match(
      /^\/study_plans\/month\/(\d+)\/(\d+)\/?$/
    );
    if (monthMatch) {
      return { type: "month", year: monthMatch[1], month: monthMatch[2] };
    }

    return null;
  }

  /**
   * チャプター単位の必修動画時間を取得する
   * @returns {Promise<{goal:number, current:number}|null>}
   */
  async fetchChapterProgress(courseId, chapterId) {
    const data = await this.fetchApi(
      `/v2/material/courses/${courseId}/chapters/${chapterId}`
    );
    if (!data) return null;
    return this.calculateChapterTime(data.course_type, data.chapter);
  }

  /**
   * コース全体の必修動画時間を取得する（全チャプターを並行通信）
   * @returns {Promise<{goal:number, current:number}|null>}
   */
  async fetchCourseProgress(courseId) {
    const data = await this.fetchApi(`/v2/material/courses/${courseId}`);
    if (!data?.course?.chapters) return null;

    const chapters = data.course.chapters.filter(
      (c) => c.resource_type === "chapter"
    );
    const results = await Promise.all(
      chapters.map((chap) => this.fetchChapterProgress(courseId, chap.id))
    );
    return sumTimeResults(results);
  }

  /**
   * 月間レポートの必修動画時間を取得する
   * @returns {Promise<{goal:number, current:number}|null>}
   */
  async fetchMonthProgress(year, month) {
    const data = await this.fetchApi(
      `/v2/dashboard/report_progresses/monthly/${year}/${month}`
    );
    if (!data) return null;

    const chapters = [
      ...(data.deadline_groups || []).flatMap((d) => d.chapters),
      ...(data.completed_chapters || []),
    ];
    const results = await Promise.all(
      chapters.map((chap) =>
        this.fetchChapterProgress(chap.course_id, chap.chapter_id)
      )
    );
    return sumTimeResults(results);
  }

  /**
   * チャプターデータからコースタイプに応じた必修動画時間を計算する
   * @param {string} courseType - "n_school" | "advanced"
   * @param {Object} chapter
   * @returns {{goal:number, current:number}}
   */
  calculateChapterTime(courseType, chapter) {
    if (courseType === "n_school") {
      return this.calculateNSchoolTime(chapter);
    }
    if (courseType === "advanced") {
      return this.calculateAdvancedTime(chapter);
    }
    return { goal: 0, current: 0 };
  }

  /** N予備校形式のチャプター時間を計算 */
  calculateNSchoolTime(chapter) {
    let goal = 0;
    let current = 0;
    const movies = (chapter.sections || []).filter(
      (s) => s.resource_type === "movie"
    );
    for (const movie of movies) {
      if (movie.material_type === "main") {
        const length = movie.length || 0;
        goal += length;
        if (movie.passed) current += length;
      }
    }
    return { goal, current };
  }

  /** アドバンスド形式のチャプター時間を計算 */
  calculateAdvancedTime(chapter) {
    let goal = 0;
    let current = 0;
    const headers = chapter.class_headers || [];
    const movies = headers
      .filter((h) => h.name === "section")
      .flatMap((h) => h.sections?.filter((s) => s.resource_type === "movie") || []);
    for (const movie of movies) {
      const length = movie.length || 0;
      const comprehension = movie.progress?.comprehension || {};
      const passed = comprehension.good === comprehension.limit;
      goal += length;
      if (passed) current += length;
    }
    return { goal, current };
  }

  /**
   * URLから適切なデータ取得メソッドにディスパッチする
   * @param {string} url
   * @returns {Promise<{goal:number, current:number}|null>}
   */
  async fetchDataByUrl(url) {
    const info = this.parsePathname(new URL(url, location.origin).pathname);
    if (!info) return null;

    switch (info.type) {
      case "chapter":
        return this.fetchChapterProgress(info.courseId, info.chapterId);
      case "course":
        return this.fetchCourseProgress(info.courseId);
      case "month":
        return this.fetchMonthProgress(info.year, info.month);
      default:
        return null;
    }
  }

  // --- 期限マッピング ---

  /**
   * 月間レポートAPIを叩いて courseId → { year, month } のマッピングを構築する。
   * 当年の前月〜12月分を並行取得し、キャッシュする。
   * @returns {Promise<Map<string, {year:number, month:number}>>}
   */
  async buildCourseDeadlineMap() {
    if (this._deadlineMap) return this._deadlineMap;
    if (this._deadlineMapPromise) return this._deadlineMapPromise;

    this._deadlineMapPromise = (async () => {
      const now = new Date();
      const year = now.getFullYear();
      const currentMonth = now.getMonth() + 1;

      // 前月〜12月を対象にする（前月は期限切れチェック用）
      const months = [];
      for (let m = Math.max(1, currentMonth - 1); m <= 12; m++) {
        months.push({ year, month: m });
      }

      const results = await Promise.all(
        months.map(({ year: y, month: m }) =>
          this.fetchApi(
            `/v2/dashboard/report_progresses/monthly/${y}/${m}`
          ).then((data) => ({ year: y, month: m, data }))
        )
      );

      const map = new Map();
      for (const { year: y, month: m, data } of results) {
        if (!data) continue;
        const chapters = [
          ...(data.deadline_groups || []).flatMap((d) => d.chapters),
          ...(data.completed_chapters || []),
        ];
        for (const chap of chapters) {
          const cid = String(chap.course_id);
          if (!map.has(cid)) {
            map.set(cid, { year: y, month: m });
          }
        }
      }

      this._deadlineMap = map;
      return map;
    })();

    return this._deadlineMapPromise;
  }

  /**
   * URLから期限日を特定する。
   * - month URL → 直接 year/month から算出
   * - course/chapter URL → deadlineMap で逆引き
   * @param {string} url
   * @returns {Promise<Date|null>} 期限日（16日 0:00 = 15日の翌0時）
   */
  async getDeadlineForUrl(url) {
    const info = this.parsePathname(new URL(url, location.origin).pathname);
    if (!info) return null;

    let year, month;

    if (info.type === "month") {
      year = parseInt(info.year);
      month = parseInt(info.month);
    } else if (info.type === "course" || info.type === "chapter") {
      const map = await this.buildCourseDeadlineMap();
      const entry = map.get(info.courseId);
      if (!entry) return null;
      year = entry.year;
      month = entry.month;
    } else {
      return null;
    }

    // 毎月15日が期限 → 実質の締切は16日の0:00
    return new Date(year, month - 1, 16, 0, 0, 0);
  }
}

// ============================================================
// UI注入 (時間表示ウィジェット)
// ============================================================

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

// ============================================================
// 視聴済み教材の自動スキップ
// ============================================================

/**
 * シンプルなロジック:
 *   教材リストを上から順に見て、最初の「緑じゃない行」をクリックする。
 *   全部緑なら何もしない。
 */
class ZenstudyToolAutoSkip {
  constructor() {
    this.enabled = false;
    this.observer = null;
    this.isSkipping = false;
    /** 直前にクリックした教材名（連打防止） */
    this.lastClickedName = "";

    // ストレージから初期状態を読み込み
    safeStorageGet(
      { [STORAGE_KEYS.autoSkipEnabled]: false },
      (result) => {
        this.enabled = result[STORAGE_KEYS.autoSkipEnabled];
        if (this.enabled) this.start();
      }
    );

    // ストレージ変更をリアルタイムに反映
    addSafeStorageChangeListener((changes, area) => {
      if (area !== "local") return;
      const change = changes[STORAGE_KEYS.autoSkipEnabled];
      if (change === undefined) return;
      this.enabled = change.newValue;
      change.newValue ? this.start() : this.stop();
    });
  }

  start() {
    if (this.observer) return;
    this.lastClickedName = "";
    // DOM変更と属性変更（SVGのcolor変化）を監視
    this.observer = createDebouncedObserver(() => this.checkAndSkip(), 500, true);
    // 初回チェック
    this.checkAndSkip();
  }

  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.lastClickedName = "";
  }

  /**
   * 教材リストを上から見て、最初の「緑じゃない行」をクリックする。
   */
  checkAndSkip() {
    if (this.isSkipping) return;

    // 教材リスト・レポートリストをDOM順にまとめて取得
    const items = Array.from(
      document.querySelectorAll('ul[aria-label$="リスト"] > li')
    );
    if (items.length === 0) return;

    // 上から順に、最初の緑じゃない行を探す
    for (const item of items) {
      if (!this.isGreen(item)) {
        // この行が緑じゃない = まだ未完了 → ここをクリックすべき先
        const name = this.getItemName(item);

        // 既にこの教材をクリック済みなら何もしない（視聴中）
        if (name && name === this.lastClickedName) return;

        // クリック実行
        this.isSkipping = true;
        this.lastClickedName = name;

        setTimeout(() => {
          const clickTarget = item.querySelector("div");
          if (clickTarget) clickTarget.click();
          this.isSkipping = false;
        }, AUTO_SKIP_DELAY_MS);

        return;
      }
    }
    // 全部緑 → 何もしない
  }

  /**
   * 行が「緑」（視聴済み）かどうか
   * @param {HTMLElement} item - <li>要素
   * @returns {boolean}
   */
  isGreen(item) {
    return item.querySelector('svg[color="#00c541"]') !== null;
  }

  /**
   * 行から教材名を取得
   * @param {HTMLElement} item - <li>要素
   * @returns {string}
   */
  getItemName(item) {
    const span = item.querySelector('span[font-size="1.5rem"]');
    return span ? span.textContent.trim() : "";
  }
}

// ============================================================
// バックグラウンド再生の許可（pause時の強制再開）
// ============================================================

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

// ============================================================
// 問題文コピー機能
// ============================================================

class ZenstudyToolCopyText {
  constructor() {
    this.enabled = true;
    this.btn = null;
    this.observer = createDebouncedObserver(() => this.checkIframe(), 500);
    
    // ストレージから初期状態を読み込み
    safeStorageGet({ [STORAGE_KEYS.copyTextEnabled]: true }, (result) => {
      this.enabled = result[STORAGE_KEYS.copyTextEnabled];
      this.checkIframe();
    });

    // ストレージ変更をリアルタイムに反映
    addSafeStorageChangeListener((changes, area) => {
      if (area !== "local") return;
      const change = changes[STORAGE_KEYS.copyTextEnabled];
      if (change !== undefined) {
        this.enabled = change.newValue;
        this.checkIframe();
      }
    });
  }

  checkIframe() {
    // evaluation_tests, reports, essay_tests の iframe があるか
    const iframe = document.querySelector('iframe[src*="evaluation_tests"], iframe[src*="reports"], iframe[src*="essay_tests"]');
    if (this.enabled && iframe) {
      this.showButton(iframe);
    } else {
      this.hideButton(iframe);
    }
  }

  getIframeDocument(iframe) {
    if (!iframe) return null;
    try {
      return iframe.contentDocument || iframe.contentWindow?.document || null;
    } catch (err) {
      console.warn('[ZenstudyTool] iframe document access failed', err);
      return null;
    }
  }

  showButton(iframe) {
    const iframeDoc = this.getIframeDocument(iframe);
    if (!iframeDoc) return;

    // もしすでにIFrame内にボタンが存在していたら何もしない
    if (iframeDoc.getElementById(ELEMENT_IDS.copyButton)) return;

    // フッターのボタンラッパーを探す
    const evaluateButtonWrapper = iframeDoc.querySelector('.evaluate-button');
    if (!evaluateButtonWrapper) return;

    this.btn = iframeDoc.createElement('button');
    this.btn.id = ELEMENT_IDS.copyButton;
    
    // ZEN Studyの既存の「答え合わせ」「再受講する」と同じボタンデザインを拝借する
    this.btn.className = 'u-button type-primary-light';
    this.btn.innerHTML = '問題文をコピー';
    
    // 隣のボタンと並べるためのマージンを追加（ボタンコンテナがflexで中央揃え等を想定）
    this.btn.style.marginLeft = '16px';
    
    this.btn.addEventListener('click', async () => {
      try {
        const text = await this.extractText(iframe);
        if (!text) {
          throw new Error("問題テキストが見つかりません。");
        }
        
        // IFrame内からのコピーだと失敗するブラウザがあるため、親ウィンドウのAPIを叩く
        await window.top.navigator.clipboard.writeText(text);
        
        // 成功時の見た目変更
        const originalText = this.btn.innerHTML;
        this.btn.innerHTML = 'コピー完了！';
        
        // 成功を伝えるために一時的に緑色に変更
        this.btn.style.backgroundColor = '#00c541';
        this.btn.style.color = '#fff';
        this.btn.style.borderColor = '#00c541';

        setTimeout(() => {
          if (iframeDoc.getElementById(ELEMENT_IDS.copyButton)) {
            this.btn.innerHTML = originalText;
            this.btn.style.backgroundColor = '';
            this.btn.style.color = '';
            this.btn.style.borderColor = '';
          }
        }, 2000);
      } catch (err) {
        console.error("[ZenstudyTool] Copy failed", err);
        alert("コピーに失敗しました（" + err.message + "）");
      }
    });

    evaluateButtonWrapper.appendChild(this.btn);
    // もし親のコンテナが縦並びなどになっていたら横並びに補正する
    evaluateButtonWrapper.style.display = 'flex';
    evaluateButtonWrapper.style.justifyContent = 'center';
  }

  hideButton(iframe) {
    if (this.btn && this.btn.parentNode) {
      this.btn.parentNode.removeChild(this.btn);
    }
    this.btn = null;

    if (iframe) {
      const iframeDoc = this.getIframeDocument(iframe);
      if (iframeDoc) {
        const existingBtn = iframeDoc.getElementById(ELEMENT_IDS.copyButton);
        if (existingBtn) existingBtn.remove();
      }
    }
  }

  parseCourseAndChapterIds() {
    const match = window.location.pathname.match(
      /^\/(?:contents\/)?courses\/(\d+)\/chapters\/(\d+)/
    );
    if (match) {
      return { courseId: match[1], chapterId: match[2] };
    }

    const courseOnlyMatch = window.location.pathname.match(
      /^\/(?:contents\/)?courses\/(\d+)(?:\/|$)/
    );
    if (courseOnlyMatch) {
      return { courseId: courseOnlyMatch[1], chapterId: null };
    }

    const breadcrumbCourseLink = document.querySelector('a[href*="/courses/"]');
    const href = breadcrumbCourseLink ? breadcrumbCourseLink.getAttribute("href") : "";
    const linkMatch = href ? href.match(/\/(?:contents\/)?courses\/(\d+)/) : null;
    if (linkMatch) {
      return { courseId: linkMatch[1], chapterId: null };
    }

    return null;
  }

  normalizeTextForMatch(text) {
    if (!text) return "";
    return text
      .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0))
      .replace(/\u3000/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  findTextbookMetaInText(text) {
    if (!text) return "";
    const segments = text
      .replace(/\r/g, "\n")
      .split(/\n+/)
      .flatMap((line) => line.split(/[。※]/))
      .map((line) => line.trim())
      .filter(Boolean);

    if (segments.length === 0) return "";

    const yearAndPublicationPattern = /(?:(?:19|20)\d{2}\s*(?:年度|年)(?:\s*発行)?|令和\s*\d+\s*年度?(?:\s*発行)?)/;
    const publisherPattern = /(東京書籍|実教出版|啓林館|数研出版|第一学習社|教育図書|大修館書店|三省堂|山川出版社|帝国書院|清水書院|開隆堂出版)/;
    const subjectPattern = /(情報|数学|国語|英語|物理|化学|生物|地学|地理|歴史|公民|日本史|世界史|政治・経済|倫理|家庭|保健体育|体育|音楽|美術|書道|古典|探究)/;
    const textbookDescriptorPattern = /(教科書|新編|版|普通科|総合|科目)/;
    const noisyLinePattern = /(ヘルプ|お問い合わせ|利用規約|個人情報保護方針|採用情報|開発者ブログ|Copyright|受講中|チャプター|進捗度)/i;

    let best = "";
    let bestScore = -1;

    for (const raw of segments) {
      const normalized = this.normalizeTextForMatch(raw);
      if (!normalized) continue;

      const hasYear = yearAndPublicationPattern.test(normalized);
      const hasPublisher = publisherPattern.test(normalized);
      const hasSubject = subjectPattern.test(normalized);
      const hasDescriptor = textbookDescriptorPattern.test(normalized);

      // 教科書情報に関係しないノイズ行を落とす
      if (normalized.length < 4 || normalized.length > 120) continue;
      if (noisyLinePattern.test(normalized)) continue;
      if (!hasYear && !hasPublisher) continue;

      let score = 0;
      if (hasYear) score += 6;
      if (hasPublisher) score += 5;
      if (hasSubject) score += 3;
      if (hasDescriptor) score += 2;
      if (normalized.length > 60) score -= 1;
      if (normalized.length > 90) score -= 2;

      if (score > bestScore) {
        bestScore = score;
        best = raw.trim();
      }
    }

    return best;
  }

  extractTextbookMetaFromCurrentDom() {
    const candidates = [
      ".sc-3mweml-1", // コース詳細の説明エリア（クラス名は変わりうるので優先ヒントとして使用）
      '[style*="white-space: pre-line"]',
      'a[href^="/courses/"] span',
      'nav[aria-label="パンくずリスト"] span',
    ];

    for (const selector of candidates) {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        const text = node.textContent || "";
        const meta = this.findTextbookMetaInText(text);
        if (meta) return meta;
      }
    }

    return "";
  }

  async fetchTextbookMetaFromCoursePage(courseId) {
    if (!courseId) return "";

    const candidatePaths = [
      `/courses/${courseId}`,
      `/contents/courses/${courseId}`,
    ];

    for (const path of candidatePaths) {
      try {
        const res = await fetch(path, { credentials: "include" });
        if (!res.ok) continue;

        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");

        const prioritizedSelectors = [
          ".sc-3mweml-1",
          '[style*="white-space: pre-line"]',
          "main",
          "body",
        ];

        for (const selector of prioritizedSelectors) {
          const node = doc.querySelector(selector);
          if (!node) continue;
          const text = node.textContent || "";
          const meta = this.findTextbookMetaInText(text);
          if (meta) return meta;
        }
      } catch (err) {
        console.warn("[ZenstudyTool] Course page textbook fetch failed", path, err);
      }
    }

    return "";
  }

  async fetchTextbookMetaFromApi(courseId) {
    if (!courseId) return "";

    try {
      const res = await fetch(`${API_BASE_URL}/v2/material/courses/${courseId}`, {
        credentials: "include",
      });
      if (!res.ok) return "";

      const data = await res.json();
      let found = "";
      const walk = (value) => {
        if (found || value == null) return;
        if (typeof value === "string") {
          const meta = this.findTextbookMetaInText(value);
          if (meta) found = meta;
          return;
        }
        if (Array.isArray(value)) {
          value.forEach((v) => walk(v));
          return;
        }
        if (typeof value === "object") {
          Object.values(value).forEach((v) => walk(v));
        }
      };

      walk(data);
      return found;
    } catch (err) {
      console.warn("[ZenstudyTool] Textbook API fetch failed", err);
      return "";
    }
  }

  async getTextbookMeta() {
    const ids = this.parseCourseAndChapterIds();

    const fromCurrentDom = this.extractTextbookMetaFromCurrentDom();
    if (fromCurrentDom) return fromCurrentDom;

    const fromCoursePage = await this.fetchTextbookMetaFromCoursePage(ids?.courseId);
    if (fromCoursePage) return fromCoursePage;

    return this.fetchTextbookMetaFromApi(ids?.courseId);
  }

  async extractText(iframe) {
    const iframeDoc = this.getIframeDocument(iframe);
    if (!iframeDoc) {
      throw new Error("IFrameのドキュメントにアクセスできません。");
    }

    let resultText = "";

    // 1. 親ページからコース名と単元名を取得
    const courseNameEl = document.querySelector('a[href^="/courses/"] span');
    let chapterNameEl = document.querySelector('h1 span');
    if (!chapterNameEl) chapterNameEl = document.querySelector('h2 span');
    
    const courseName = courseNameEl ? courseNameEl.textContent.trim() : "";
    let chapterName = "";
    if (chapterNameEl) {
      chapterName = chapterNameEl.textContent.trim();
    } else {
      const h1h2 = document.querySelector('h1, h2');
      if (h1h2) chapterName = h1h2.textContent.trim();
    }

    let textbookMeta = await this.getTextbookMeta();
    if (!textbookMeta && courseName) {
      textbookMeta = this.findTextbookMetaInText(courseName);
    }

    if (courseName || chapterName || textbookMeta) {
      if (courseName) resultText += courseName + "\n";
      if (chapterName) resultText += chapterName + "\n";
      if (textbookMeta) {
        resultText += `教科書情報: ${textbookMeta}\n`;
      }
      resultText += "\n";
    }

    // 2. IFrame内から問題文をスクレイピング
    const exercises = iframeDoc.querySelectorAll('section.exercise');
    if (exercises.length === 0) {
      return null;
    }

    exercises.forEach(exercise => {
      // 大問 (問1 など)
      const statementEl = exercise.querySelector('.statement');
      if (statementEl) {
        resultText += statementEl.textContent.trim() + "\n";
      }

      // 小問リストとその選択肢
      const questions = exercise.querySelectorAll('.question-list > li.exercise-item');
      questions.forEach(qItem => {
        const questionTextEl = qItem.querySelector('.question p, .question');
        if (questionTextEl) {
          resultText += questionTextEl.textContent.trim() + "\n";
        }

        const answers = qItem.querySelectorAll('.answers-choice');
        if (answers.length > 0) {
          answers.forEach(ans => {
            const spanEl = ans.querySelector('span');
            if (spanEl) {
              resultText += spanEl.textContent.trim() + "\n";
            } else {
              resultText += ans.textContent.trim() + "\n";
            }
          });
        }
      });
      resultText += "\n";
    });

    return resultText.trim();
  }
}



// ============================================================
// 動画ダウンロード機能
// ============================================================

class ZenstudyToolDownloader {
  constructor() {
    this.enabled = true;
    this.videoInfo = null;
    this.title = '';
    this.sectionTitle = '';
    this.lastSelectedTitle = '';
    this.btn = null;
    this.resetTimerId = null;
    this.waitingPollTimerId = null;
    this.activeConversionRequestId = null;
    this.isDownloading = false;
    this.nextDownloadSequence = 0;
    this.activeDownloadSequence = 0;
    this.activeLessonFingerprint = '';
    this.activeLessonChangedAt = 0;
    this.chapterDataCache = new Map();

    this.handlePotentialLessonSelection = this.handlePotentialLessonSelection.bind(this);
    document.addEventListener('click', this.handlePotentialLessonSelection, true);

    safeStorageGet({ [STORAGE_KEYS.downloadEnabled]: true }, (result) => {
      this.enabled = result[STORAGE_KEYS.downloadEnabled];
      if (this.enabled) this.checkAndShow();
    });

    addSafeStorageChangeListener((changes, area) => {
      if (area !== "local") return;
      const downloadChange = changes[STORAGE_KEYS.downloadEnabled];
      if (downloadChange !== undefined) {
        this.enabled = downloadChange.newValue;
        if (this.enabled) {
          this.checkAndShow();
        } else {
          this.removeButton();
        }
      }
    });

    addSafeRuntimeMessageListener((message) => {
      if (message.type === 'ZST_VIDEO_URL_DETECTED') {
        const didUpdate = this.applyVideoInfo(message.videoInfo);
        if (didUpdate && this.enabled) this.checkAndShow();
      } else if (message.type === 'ZST_CONVERSION_PROGRESS') {
        this.updateProgress(message);
      }
    });

    this.observer = createDebouncedObserver(() => {
      if (this.enabled) this.checkAndShow();
    }, 150);
  }

  getDownloadButton() {
    if (this.btn && document.body.contains(this.btn)) return this.btn;
    const existingBtn = document.getElementById(ELEMENT_IDS.downloadButton);
    this.btn = existingBtn || null;
    return this.btn;
  }

  getCurrentLessonFingerprint() {
    const iframe = this.getModalIframe();
    const src = iframe?.getAttribute('src') || iframe?.src || '';
    if (!src) return '';

    try {
      const url = new URL(src, window.location.origin);
      return `${url.pathname}${url.search}`;
    } catch (_) {
      return src;
    }
  }

  syncLessonContext() {
    const nextFingerprint = this.getCurrentLessonFingerprint();
    if (nextFingerprint === this.activeLessonFingerprint) return false;

    this.activeLessonFingerprint = nextFingerprint;
    this.activeLessonChangedAt = nextFingerprint ? Date.now() : 0;
    this.videoInfo = null;
    this.activeConversionRequestId = null;
    this.isDownloading = false;
    this.activeDownloadSequence = 0;

    if (this.resetTimerId) {
      clearTimeout(this.resetTimerId);
      this.resetTimerId = null;
    }

    return true;
  }

  isVideoInfoRelevant(videoInfo) {
    if (!videoInfo) return false;
    if (!this.activeLessonChangedAt) return true;
    return videoInfo.timestamp >= this.activeLessonChangedAt - 1000;
  }

  hasCurrentVideoInfo() {
    if (!this.isVideoInfoRelevant(this.videoInfo)) {
      this.videoInfo = null;
      return false;
    }
    return true;
  }

  applyVideoInfo(videoInfo) {
    if (!this.isVideoInfoRelevant(videoInfo)) return false;
    this.videoInfo = videoInfo;
    return true;
  }

  requestLatestVideoInfo() {
    safeRuntimeSendMessage({ type: 'ZST_GET_VIDEO_URL' }, (response, error) => {
      if (error) return;
      if (response && response.videoInfo && this.applyVideoInfo(response.videoInfo) && this.enabled) {
        this.checkAndShow();
      }
    });
  }

  normalizeTitleText(text) {
    if (!text) return '';

    return text
      .replace(/\s+/g, ' ')
      .replace(/\s+\d{1,2}:\d{2}(?::\d{2})?\s*\/\s*\d{1,2}:\d{2}(?::\d{2})?[\s\S]*$/, '')
      .replace(/\s+-\s+ZEN Study$/, '')
      .replace(/\s+\|\s+N予備校$/, '')
      .replace(/\s+-\s+N予備校$/, '')
      .trim();
  }

  isUsableLessonTitle(text) {
    const normalized = this.normalizeTitleText(text);
    if (!normalized) return false;
    if (normalized === '教材' || normalized === '動画' || normalized === 'ZEN Study') {
      return false;
    }

    const sectionTitle = this.normalizeTitleText(this.getSectionTitle());
    if (sectionTitle && normalized === sectionTitle) {
      return false;
    }

    return true;
  }

  pickTitleFromNode(node) {
    if (!node) return '';

    const selectors = [
      '[font-size="1.5rem"]',
      '[font-size="1.6rem"]',
      'h1 span',
      'h1',
      'h2 span',
      'h2',
      'h3 span',
      'h3',
      'h4 > span',
      'h4',
    ];

    for (const selector of selectors) {
      const el = node.querySelector(selector);
      if (!el) continue;

      const text = this.normalizeTitleText(el.textContent || '');
      if (this.isUsableLessonTitle(text)) return text;
    }

    return '';
  }

  handlePotentialLessonSelection(event) {
    if (!(event.target instanceof Element)) return;

    const listItem = event.target.closest('ul[aria-label="必修教材リスト"] li');
    if (!listItem) return;
    if (!listItem.querySelector('svg[type="movie-rounded"]')) return;

    const title = this.pickTitleFromNode(listItem);
    if (!title) return;

    this.lastSelectedTitle = title;
  }

  getModalIframe() {
    return document.querySelector('.ReactModal__Content iframe[src*="/movies/"]');
  }

  getIframeDocument(iframe) {
    if (!iframe) return null;

    try {
      return iframe.contentDocument || iframe.contentWindow?.document || null;
    } catch (err) {
      console.warn('[ZenstudyTool] iframe document access failed', err);
      return null;
    }
  }

  extractTitleFromDocument(doc) {
    if (!doc) return '';

    const fromBody = this.pickTitleFromNode(doc.body || doc);
    if (fromBody) return fromBody;

    const metaCandidates = [
      doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || '',
      doc.querySelector('meta[name="twitter:title"]')?.getAttribute('content') || '',
      doc.title || '',
    ];

    for (const candidate of metaCandidates) {
      const title = this.normalizeTitleText(candidate);
      if (this.isUsableLessonTitle(title)) return title;
    }

    return '';
  }

  getMovieContextFromIframe() {
    const iframe = this.getModalIframe();
    const src = iframe?.getAttribute('src') || iframe?.src || '';
    if (!src) return null;

    try {
      const url = new URL(src, window.location.origin);
      const match = url.pathname.match(/^\/(?:contents\/)?courses\/(\d+)\/chapters\/(\d+)\/movies\/(\d+)/);
      if (!match) return null;

      return {
        courseId: match[1],
        chapterId: match[2],
        movieId: match[3],
      };
    } catch (_) {
      return null;
    }
  }

  fetchChapterData(courseId, chapterId) {
    const cacheKey = `${courseId}:${chapterId}`;
    if (this.chapterDataCache.has(cacheKey)) {
      return this.chapterDataCache.get(cacheKey);
    }

    const promise = fetch(`${API_BASE_URL}/v2/material/courses/${courseId}/chapters/${chapterId}`, {
      credentials: 'include',
    })
      .then((res) => (res.ok ? res.json() : null))
      .catch((err) => {
        console.warn('[ZenstudyTool] Chapter data fetch failed', err);
        return null;
      });

    this.chapterDataCache.set(cacheKey, promise);
    return promise;
  }

  findMovieTitleInValue(value, movieId) {
    const seen = new WeakSet();
    const queue = [value];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || typeof current !== 'object') continue;

      if (Array.isArray(current)) {
        for (const item of current) queue.push(item);
        continue;
      }

      if (seen.has(current)) continue;
      seen.add(current);

      const idCandidates = [current.id, current.movie_id, current.material_id, current.resource_id]
        .filter((candidate) => candidate !== undefined && candidate !== null)
        .map((candidate) => String(candidate));
      const urlCandidates = [current.url, current.href, current.path]
        .filter((candidate) => typeof candidate === 'string');

      const matchesMovie = idCandidates.includes(String(movieId))
        || urlCandidates.some((candidate) => candidate.includes(`/movies/${movieId}`));

      if (matchesMovie) {
        const title = this.normalizeTitleText(
          current.name
          || current.title
          || current.display_name
          || current.resource_name
          || current.label
          || ''
        );
        if (this.isUsableLessonTitle(title)) return title;
      }

      for (const child of Object.values(current)) {
        if (child && typeof child === 'object') queue.push(child);
      }
    }

    return '';
  }

  async resolveTitle() {
    if (this.isUsableLessonTitle(this.lastSelectedTitle)) {
      return this.normalizeTitleText(this.lastSelectedTitle);
    }

    const iframeDoc = this.getIframeDocument(this.getModalIframe());
    const iframeTitle = this.extractTitleFromDocument(iframeDoc);
    if (iframeTitle) return iframeTitle;

    const movieContext = this.getMovieContextFromIframe();
    if (movieContext) {
      const chapterData = await this.fetchChapterData(movieContext.courseId, movieContext.chapterId);
      const apiTitle = this.findMovieTitleInValue(chapterData?.chapter || chapterData, movieContext.movieId);
      if (apiTitle) return apiTitle;
    }

    return this.getTitle();
  }

  setButtonState(state, text) {
    const btn = this.getDownloadButton();
    if (!btn) return;
    btn.dataset.state = state;
    btn.textContent = text;
  }

  setReadyState() {
    const btn = this.getDownloadButton();
    if (!btn) return;

    this.activeConversionRequestId = null;

    if (this.hasCurrentVideoInfo()) {
      this.stopWaitingPoll();
      this.setButtonState('ready', DOWNLOAD_BUTTON_TEXT.ready);
      btn.disabled = false;
    } else {
      this.setButtonState('waiting', DOWNLOAD_BUTTON_TEXT.waiting);
      btn.disabled = true;
      this.requestLatestVideoInfo();
      this.startWaitingPoll();
    }
  }

  startWaitingPoll() {
    if (this.waitingPollTimerId) return;

    this.waitingPollTimerId = setInterval(() => {
      if (!this.enabled || !this.isModalOpen()) {
        this.stopWaitingPoll();
        return;
      }

      if (this.hasCurrentVideoInfo()) {
        this.stopWaitingPoll();
        this.setReadyState();
        return;
      }

      this.requestLatestVideoInfo();
    }, 1200);
  }

  stopWaitingPoll() {
    if (!this.waitingPollTimerId) return;
    clearInterval(this.waitingPollTimerId);
    this.waitingPollTimerId = null;
  }

  setBusyState(text = DOWNLOAD_BUTTON_TEXT.preparing) {
    const btn = this.getDownloadButton();
    if (!btn) return;
    this.setButtonState('loading', text);
    btn.disabled = true;
  }

  setResultState(state, text) {
    const btn = this.getDownloadButton();
    if (!btn) return;

    this.setButtonState(state, text);
    btn.disabled = state !== 'error';

    if (this.resetTimerId) clearTimeout(this.resetTimerId);
    this.resetTimerId = setTimeout(() => {
      this.setReadyState();
    }, 2500);
  }

  isModalOpen() {
    return !!document.querySelector('.ReactModal__Overlay--after-open');
  }

  getTitle() {
    if (this.isUsableLessonTitle(this.lastSelectedTitle)) {
      return this.normalizeTitleText(this.lastSelectedTitle);
    }

    const iframeTitle = this.extractTitleFromDocument(this.getIframeDocument(this.getModalIframe()));
    if (iframeTitle) return iframeTitle;

    const list = document.querySelector('ul[aria-label="必修教材リスト"]');
    if (list) {
      const activeItem = Array.from(list.children).find(li => {
        const row = li.querySelector('div > div');
        return !!row && (
          row.getAttribute('aria-current') === 'true'
          || li.getAttribute('aria-current') === 'true'
        );
      });
      if (activeItem) {
        const listTitle = this.pickTitleFromNode(activeItem);
        if (listTitle) return listTitle;
      }
    }

    const breadcrumbTitle = document.querySelector('nav[aria-label="パンくずリスト"] h2 span');
    if (breadcrumbTitle && breadcrumbTitle.textContent.trim()) {
      return this.normalizeTitleText(breadcrumbTitle.textContent);
    }

    const titleEl = document.querySelector('h1, [class*="title"]');
    if (titleEl) return this.normalizeTitleText(titleEl.textContent);
    return this.normalizeTitleText(document.title);
  }

  getSectionTitle() {
    const selectors = [
      'main h1 span',
      'main h1',
      'nav[aria-label="パンくずリスト"] h2 span',
      'h1 span',
      'h1',
      'h2 span',
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const text = (el.textContent || '').trim();
      if (text) return text;
    }

    return '';
  }

  checkAndShow() {
    if (!this.isModalOpen()) {
      this.syncLessonContext();
      this.removeButton();
      return;
    }

    const lessonChanged = this.syncLessonContext();

    const modalContent = document.querySelector('.ReactModal__Content');
    if (!modalContent) return;

    let btn = this.getDownloadButton();
    
    if (btn) {
      if (lessonChanged || (!this.hasCurrentVideoInfo() && btn.dataset.state !== 'waiting') || (this.hasCurrentVideoInfo() && btn.dataset.state === 'waiting')) {
        this.setReadyState();
      }
      return;
    }

    this.title = this.getTitle();
    this.sectionTitle = this.getSectionTitle();

    this.btn = document.createElement('button');
    btn = this.btn;
    btn.id = ELEMENT_IDS.downloadButton;
    btn.type = 'button';
    btn.className = CSS_CLASSES.downloadButton;
    btn.addEventListener('click', () => this.handleDownloadClick());

    // モーダルの直下に挿入
    modalContent.appendChild(btn);
    this.setReadyState();
  }

  async startDownload() {
    if (this.isDownloading || !this.hasCurrentVideoInfo()) return false;

    const btn = this.getDownloadButton();
    if (btn && btn.disabled) return false;

    const requestedVideoInfo = this.videoInfo;
    const downloadSequence = ++this.nextDownloadSequence;
    this.activeDownloadSequence = downloadSequence;
    this.isDownloading = true;
    this.title = await this.resolveTitle();
    this.sectionTitle = this.getSectionTitle();
    this.activeConversionRequestId = null;

    if (this.activeDownloadSequence !== downloadSequence) {
      return false;
    }

    this.setBusyState(DOWNLOAD_BUTTON_TEXT.preparing);

    safeRuntimeSendMessage({
      type: 'ZST_DOWNLOAD_VIDEO',
      videoInfo: requestedVideoInfo,
      title: this.title,
      sectionTitle: this.sectionTitle,
    }, (response, error) => {
      const isActiveDownload = this.activeDownloadSequence === downloadSequence;

      const handleFailure = (message) => {
        if (isActiveDownload) {
          this.isDownloading = false;
          this.activeDownloadSequence = 0;
          this.setResultState('error', DOWNLOAD_BUTTON_TEXT.failed);
        }

        alert('ダウンロードに失敗しました: ' + message);
      };

      if (error) {
        handleFailure(error.message || '不明なエラー');
        return;
      }

      if (!response || !response.success) {
        handleFailure(response?.message || '不明なエラー');
        return;
      }

      if (!isActiveDownload) return;
    });

    return true;
  }

  handleDownloadClick() {
    void this.startDownload();
  }

  removeButton() {
    this.stopWaitingPoll();
    this.lastSelectedTitle = '';

    if (this.resetTimerId) {
      clearTimeout(this.resetTimerId);
      this.resetTimerId = null;
    }

    const existingBtn = document.getElementById(ELEMENT_IDS.downloadButton);
    if (existingBtn) existingBtn.remove();
    this.btn = null;
  }

  updateProgress(msg) {
    if (!this.getDownloadButton() || !this.isDownloading) return;

    if (msg && msg.requestId) {
      if (this.activeConversionRequestId && this.activeConversionRequestId !== msg.requestId) {
        return;
      }
      if (!this.activeConversionRequestId && (msg.phase === 'init' || msg.phase === 'download' || msg.phase === 'save')) {
        this.activeConversionRequestId = msg.requestId;
      }
    }
    
    if (msg.phase === 'init') {
      this.setBusyState(DOWNLOAD_BUTTON_TEXT.preparing);
    } else if (msg.phase === 'download') {
      const percentage = msg.total > 0
        ? Math.floor((msg.current / msg.total) * 100)
        : 0;
      this.setBusyState(`${DOWNLOAD_BUTTON_TEXT.downloading} ${percentage}%`);
    } else if (msg.phase === 'save') {
      if (msg.total > 0) {
        const percentage = Math.floor((msg.current / msg.total) * 100);
        this.setBusyState(`${DOWNLOAD_BUTTON_TEXT.saving} ${percentage}%`);
      } else if (msg.current > 0) {
        this.setBusyState(`${DOWNLOAD_BUTTON_TEXT.saving} ${formatByteSize(msg.current)}`);
      } else {
        this.setBusyState(DOWNLOAD_BUTTON_TEXT.saving);
      }
    } else if (msg.phase === 'done') {
      this.setResultState('success', DOWNLOAD_BUTTON_TEXT.success);
      this.isDownloading = false;
      this.activeDownloadSequence = 0;
      this.activeConversionRequestId = null;
    } else if (msg.phase === 'error') {
      this.setResultState('error', DOWNLOAD_BUTTON_TEXT.failed);
      this.isDownloading = false;
      this.activeDownloadSequence = 0;
      this.activeConversionRequestId = null;
    }
  }
}

// ============================================================
// エントリーポイント
// ============================================================

const alwaysFocus = new ZenstudyToolAlwaysFocus();

// iframe 内では UI の追加や自動スキップは実行しない
if (window.top === window.self) {
  const autoFilter = new ZenstudyToolAutoFilter();
  const timeLogic = new ZenstudyToolTimeLogic();
  const ui = new ZenstudyToolUI(timeLogic);
  const autoSkip = new ZenstudyToolAutoSkip();
  const copyText = new ZenstudyToolCopyText();
  const downloader = new ZenstudyToolDownloader();
}

/**
 * ZenstudyTool - Content Script
 *
 * 機能一覧:
 *   1. 「必修教材のみ」フィルタの常時・強制有効化
 *   2. 必修動画の合計時間をインライン表示
 *   3. 期限までの1日あたり必要視聴時間を自動計算・表示
 *   4. 完了済み教材の自動スキップ
 */

// 定数

const {
  STORAGE_KEYS,
  MESSAGE_TYPES,
} = globalThis.ZenstudyToolConstants;

/** CSSクラス名 */
const CSS_CLASSES = {
  wrapper: "__ZENSTUDYTOOL_wrapper",
  faint: "__ZENSTUDYTOOL_faint",
  dailyTarget: "__ZENSTUDYTOOL_dailyTarget",
  downloadButtonGroup: "__ZENSTUDYTOOL_downloadButtonGroup",
  downloadButton: "__ZENSTUDYTOOL_downloadButton",
  slideDownloadButton: "__ZENSTUDYTOOL_slideDownloadButton",
  actionRow: "__ZENSTUDYTOOL_actionRow",
  footerActionButton: "__ZENSTUDYTOOL_footerActionButton",
  fieldProofreadRow: "__ZENSTUDYTOOL_fieldProofreadRow",
  fieldProofreadRowTextarea: "__ZENSTUDYTOOL_fieldProofreadRowTextarea",
  fieldProofreadActions: "__ZENSTUDYTOOL_fieldProofreadActions",
  fieldProofreadButton: "__ZENSTUDYTOOL_fieldProofreadButton",
  answerLengthHint: "__ZENSTUDYTOOL_answerLengthHint",
  answerLengthFieldWarning: "__ZENSTUDYTOOL_answerLengthFieldWarning",
};

/** DOM要素ID */
const ELEMENT_IDS = {
  copyButton: "__ZENSTUDYTOOL_copy_btn",
  downloadButtonGroup: "__ZENSTUDYTOOL_download_btn_group",
  downloadButton: "__ZENSTUDYTOOL_download_btn",
  slideDownloadButton: "__ZENSTUDYTOOL_slide_download_btn",
  proofreadButton: "__ZENSTUDYTOOL_proofread_btn",
};

/** ダウンロードボタン文言 */
const DOWNLOAD_BUTTON_TEXT = {
  ready: "動画保存",
  waiting: "URL取得中...",
  preparing: "準備中...",
  downloading: "ダウンロード中...",
  saving: "保存中...",
  success: "完了",
  failed: "失敗",
};

const SLIDE_DOWNLOAD_BUTTON_TEXT = {
  ready: "画像一括保存",
  preparing: "画像検出中...",
  downloading: "保存中...",
  success: "保存開始",
  failed: "失敗",
};

const PROOFREAD_BUTTON_TEXT = {
  ready: "まとめてAI校正",
  working: "まとめてAI校正中...",
  success: "校正完了",
  failed: "校正失敗",
};

const FIELD_PROOFREAD_BUTTON_TEXT = {
  ready: "AI校正",
  working: "AI校正中...",
  success: "校正完了",
  failed: "校正失敗",
};

/** DOM監視のデバウンス間隔 (ms) */
const DEBOUNCE_MS = 50;

/** フィルタボタンの連打防止間隔 (ms) */
const FILTER_CLICK_COOLDOWN_MS = 500;

/** フィルタ状態を定期チェックする間隔 (ms) */
const FILTER_POLL_INTERVAL_MS = 2000;

/** 自動スキップの遷移後に次の操作を待つ間隔 (ms) */
const AUTO_SKIP_DELAY_MS = 1500;

/** ボタンのaria-label */
const ARIA_LABELS = {
  essential: "必修教材のみ",
  nPlus: "Nプラス教材のみ",
};

/** API エンドポイント */
const API_BASE_URL = "https://api.nnn.ed.nico";

// ユーティリティ

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
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0秒";
  }

  const totalSeconds = Math.ceil(seconds);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

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

const getAccessibleIframeDocument = (iframe) => {
  if (!iframe) return null;

  try {
    return iframe.contentDocument || iframe.contentWindow?.document || null;
  } catch (err) {
    console.warn('[ZenstudyTool] iframe document access failed', err);
    return null;
  }
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


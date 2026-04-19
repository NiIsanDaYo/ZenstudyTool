/**
 * ZenstudyTool - Background Service Worker
 *
 * 機能:
 *   1. chrome.webRequest で .m3u8 / .mp4 URL を傍受し content.js に通知
 *   2. ダウンロードリクエスト受信時に offscreen document + ffmpeg.wasm で変換
 *   3. MP4/TS のダウンロード
 */

// タブごとに最新の動画URLを保持
const tabVideoUrls = new Map();
const CONVERSION_TIMEOUT_MS = 5 * 60 * 1000;
const DOWNLOAD_PROGRESS_THROTTLE_MS = 250;
const trackedDownloads = new Map();

function createRequestId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `zst-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function requestBlobRevoke(requestId, blobUrl) {
  if (!blobUrl) return;
  chrome.runtime.sendMessage({
    type: 'ZST_REVOKE_BLOB_URL',
    requestId,
    blobUrl,
  }).catch(() => {});
}

function cleanupTrackedDownload(downloadId) {
  const tracked = trackedDownloads.get(downloadId);
  if (!tracked) return null;

  trackedDownloads.delete(downloadId);

  if (tracked.blobUrl) {
    requestBlobRevoke(tracked.requestId, tracked.blobUrl);
  }

  return tracked;
}

function sendTrackedDownloadProgress(tracked, force = false) {
  if (!tracked) return;

  const now = Date.now();
  const total = Number.isFinite(tracked.totalBytes) && tracked.totalBytes > 0
    ? tracked.totalBytes
    : 0;
  const current = Number.isFinite(tracked.bytesReceived) && tracked.bytesReceived > 0
    ? tracked.bytesReceived
    : 0;
  const percentage = total > 0
    ? Math.floor((current / total) * 100)
    : -1;

  if (!force) {
    if (percentage >= 0 && percentage === tracked.lastSentPercentage && (now - tracked.lastSentAt) < DOWNLOAD_PROGRESS_THROTTLE_MS) {
      return;
    }
    if (percentage < 0 && (now - tracked.lastSentAt) < DOWNLOAD_PROGRESS_THROTTLE_MS) {
      return;
    }
  }

  tracked.lastSentAt = now;
  tracked.lastSentPercentage = percentage;

  sendConversionProgress({
    type: 'ZST_CONVERSION_PROGRESS',
    phase: 'save',
    current,
    total,
    requestId: tracked.requestId,
    outputType: tracked.outputType,
  }, tracked.sourceTabId);
}

async function trackBrowserDownload({ url, filename, sourceTabId, requestId, outputType, blobUrl = null }) {
  sendConversionProgress({
    type: 'ZST_CONVERSION_PROGRESS',
    phase: 'save',
    current: 0,
    total: 0,
    requestId,
    outputType,
  }, sourceTabId);

  const downloadId = await chrome.downloads.download({
    url,
    filename,
    saveAs: false,
  });

  const tracked = {
    requestId,
    sourceTabId,
    outputType,
    blobUrl,
    bytesReceived: 0,
    totalBytes: 0,
    lastSentAt: 0,
    lastSentPercentage: -1,
  };

  trackedDownloads.set(downloadId, tracked);

  try {
    const [downloadItem] = await chrome.downloads.search({ id: downloadId });
    if (downloadItem) {
      tracked.bytesReceived = downloadItem.bytesReceived || 0;
      tracked.totalBytes = downloadItem.totalBytes || 0;

      if (downloadItem.state === 'complete') {
        sendTrackedDownloadProgress(tracked, true);
        sendConversionProgress({
          type: 'ZST_CONVERSION_PROGRESS',
          phase: 'done',
          success: true,
          requestId,
          outputType,
        }, sourceTabId);
        cleanupTrackedDownload(downloadId);
        return downloadId;
      }

      if (downloadItem.state === 'interrupted') {
        sendConversionProgress({
          type: 'ZST_CONVERSION_PROGRESS',
          phase: 'error',
          success: false,
          requestId,
          error: downloadItem.error || 'ダウンロードが中断されました',
        }, sourceTabId);
        cleanupTrackedDownload(downloadId);
        return downloadId;
      }
    }
  } catch (err) {
    console.warn('[ZenstudyTool BG] ダウンロード状態の取得に失敗:', err);
  }

  sendTrackedDownloadProgress(tracked, true);
  return downloadId;
}

chrome.downloads.onChanged.addListener((delta) => {
  const tracked = trackedDownloads.get(delta.id);
  if (!tracked) return;

  if (delta.totalBytes && typeof delta.totalBytes.current === 'number') {
    tracked.totalBytes = delta.totalBytes.current;
  }

  if (delta.bytesReceived && typeof delta.bytesReceived.current === 'number') {
    tracked.bytesReceived = delta.bytesReceived.current;
  }

  if (delta.state?.current === 'complete') {
    if (tracked.totalBytes > 0) {
      tracked.bytesReceived = tracked.totalBytes;
    }
    sendTrackedDownloadProgress(tracked, true);
    sendConversionProgress({
      type: 'ZST_CONVERSION_PROGRESS',
      phase: 'done',
      success: true,
      requestId: tracked.requestId,
      outputType: tracked.outputType,
    }, tracked.sourceTabId);
    cleanupTrackedDownload(delta.id);
    return;
  }

  if (delta.state?.current === 'interrupted' || delta.error?.current) {
    sendConversionProgress({
      type: 'ZST_CONVERSION_PROGRESS',
      phase: 'error',
      success: false,
      requestId: tracked.requestId,
      error: delta.error?.current || 'ダウンロードが中断されました',
    }, tracked.sourceTabId);
    cleanupTrackedDownload(delta.id);
    return;
  }

  if (delta.bytesReceived || delta.totalBytes || delta.state?.current === 'in_progress') {
    sendTrackedDownloadProgress(tracked);
  }
});

// ============================================================
// ネットワーク傍受: .m3u8 / .mp4 URL を検出
// ============================================================

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;
    if (!url) return;

    // .m3u8 または .mp4 を含むURLを検出（クエリパラメータも考慮）
    const isM3U8 = /\.m3u8(\?|$)/i.test(url);
    const isMP4 = /\.mp4(\?|$)/i.test(url);

    if (!isM3U8 && !isMP4) return;

    const tabId = details.tabId;
    if (tabId < 0) return; // タブに紐づかないリクエストは無視

    const videoInfo = {
      url: url,
      type: isMP4 ? 'mp4' : 'm3u8',
      timestamp: Date.now(),
    };

    tabVideoUrls.set(tabId, videoInfo);
    console.log(`[ZenstudyTool BG] 動画URL検出 (${videoInfo.type}): ${url.substring(0, 80)}...`);

    // content.js に通知
    chrome.tabs.sendMessage(tabId, {
      type: 'ZST_VIDEO_URL_DETECTED',
      videoInfo: videoInfo,
    }).catch(() => {
      // content script がまだロードされていない場合は無視
    });
  },
  { urls: ['*://*.nnn.ed.nico/*', '*://*.nicovideo.jp/*', '*://*.dmc.nico/*', '*://*.cdn.nnn.ed.nico/*', '<all_urls>'] },
  []
);

// ============================================================
// メッセージハンドラ
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ZST_GET_VIDEO_URL') {
    // content.js から現在のタブの動画URLを問い合わせ
    const tabId = sender.tab?.id;
    if (tabId !== undefined) {
      const info = tabVideoUrls.get(tabId);
      sendResponse({ videoInfo: info || null });
    } else {
      sendResponse({ videoInfo: null });
    }
    return false;
  }

  if (message.type === 'ZST_DOWNLOAD_VIDEO') {
    // ダウンロードリクエスト
    handleDownload(message, sender.tab?.id).then(sendResponse);
    return true; // 非同期レスポンス
  }

  return false;
});

// タブが閉じられたらクリーンアップ
chrome.tabs.onRemoved.addListener((tabId) => {
  tabVideoUrls.delete(tabId);
});

// ============================================================
// ダウンロード処理
// ============================================================

async function handleDownload({ videoInfo, title, sectionTitle }, sourceTabId) {
  try {
    const requestId = createRequestId();
    const sanitizedTitle = (title || 'video').replace(/[\\/:*?"<>|]/g, '_').substring(0, 100);
    const sanitizedSection = (sectionTitle || '').replace(/[\\/:*?"<>|]/g, '_').substring(0, 100);

    if (videoInfo.type === 'mp4') {
      // MP4: 直接ダウンロード
      const filename = sanitizedSection
        ? `${sanitizedSection}/${sanitizedTitle}.mp4`
        : `${sanitizedTitle}.mp4`;

      await trackBrowserDownload({
        url: videoInfo.url,
        filename,
        sourceTabId,
        requestId,
        outputType: 'mp4',
      });
      return { success: true, message: 'MP4ダウンロード開始', requestId };
    }

    // M3U8: offscreen document で処理（可能なら MP4、難しい場合は TS）
    return await processM3U8Download(videoInfo.url, sanitizedTitle, sanitizedSection, sourceTabId, requestId);
  } catch (err) {
    console.error('[ZenstudyTool BG] ダウンロードエラー:', err);
    return { success: false, message: err.message };
  }
}

// ============================================================
// M3U8 ダウンロード処理 (Offscreen Document 経由)
// ============================================================

let offscreenCreated = false;

async function ensureOffscreenDocument() {
  if (offscreenCreated) return;

  try {
    // 既存のoffscreenがないか確認
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    if (existingContexts.length > 0) {
      offscreenCreated = true;
      return;
    }
  } catch (e) {
    // getContexts が使えない古いChromeバージョン
  }

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['WORKERS'],
    justification: 'M3U8 動画のチャンクをバックグラウンドでダウンロード・結合するため',
  });
  offscreenCreated = true;
}

function broadcastToStudyTabs(message) {
  chrome.tabs.query({ url: '*://*.nnn.ed.nico/*' }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  });
}

function sendConversionProgress(message, sourceTabId) {
  if (typeof sourceTabId === 'number' && sourceTabId >= 0) {
    chrome.tabs.sendMessage(sourceTabId, message).catch(() => {});
    return;
  }
  // 送信元タブを特定できない場合のみブロードキャスト
  broadcastToStudyTabs(message);
}

async function processM3U8Download(m3u8Url, title, section, sourceTabId, requestId) {
  await ensureOffscreenDocument();

  return new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(listener);
      if (timeoutId) clearTimeout(timeoutId);
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const timeoutId = setTimeout(() => {
      sendConversionProgress({
        type: 'ZST_CONVERSION_PROGRESS',
        phase: 'error',
        success: false,
        requestId,
        error: '変換がタイムアウトしました',
      }, sourceTabId);
      finish({ success: false, message: '変換がタイムアウトしました' });
    }, CONVERSION_TIMEOUT_MS);

    // offscreen からの完了通知を待つリスナー
    const listener = (message) => {
      if (message.requestId !== requestId) return;

      if (message.type === 'ZST_CONVERSION_COMPLETE') {
        if (message.success) {
          const outputType = message.outputType === 'mp4' ? 'mp4' : 'ts';
          const blobUrl = message.blobUrl;

          // Blob URL からダウンロード
          const filename = section
            ? `${section}/${title}.${outputType}`
            : `${title}.${outputType}`;

          trackBrowserDownload({
            url: blobUrl,
            filename,
            sourceTabId,
            requestId,
            outputType,
            blobUrl,
          }).then(() => {
            finish({ success: true, message: `${outputType.toUpperCase()}ダウンロード開始`, requestId });
          }).catch((err) => {
            sendConversionProgress({
              type: 'ZST_CONVERSION_PROGRESS',
              phase: 'error',
              success: false,
              requestId,
              error: err.message,
            }, sourceTabId);
            requestBlobRevoke(requestId, blobUrl);
            finish({ success: false, message: `ダウンロードエラー: ${err.message}` });
          });
        } else {
          sendConversionProgress({
            type: 'ZST_CONVERSION_PROGRESS',
            phase: 'error',
            success: false,
            requestId,
            error: message.error,
          }, sourceTabId);
          finish({ success: false, message: message.error });
        }
      }

      if (message.type === 'ZST_CONVERSION_PROGRESS') {
        // 進捗は要求元タブに転送
        sendConversionProgress(message, sourceTabId);
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    // offscreen に変換リクエストを送信
    chrome.runtime.sendMessage({
      type: 'ZST_CONVERT_M3U8',
      m3u8Url: m3u8Url,
      requestId,
    }).catch((err) => {
      finish({ success: false, message: `変換開始エラー: ${err.message}` });
    });
  });
}

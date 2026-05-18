(() => {
  const STORAGE_KEYS = Object.freeze({
    forceEssentialEnabled: "forceEssentialEnabled",
    showTotalTime: "showTotalTime",
    showDailyTarget: "showDailyTarget",
    autoSkipEnabled: "autoSkipEnabled",
    alwaysFocusEnabled: "alwaysFocusEnabled",
    copyTextEnabled: "copyTextEnabled",
    downloadEnabled: "downloadEnabled",
    slideDownloadEnabled: "slideDownloadEnabled",
    proofreadEnabled: "proofreadEnabled",
    geminiApiKey: "geminiApiKey",
    geminiModelMode: "geminiModelMode",
    geminiSelectedModel: "geminiSelectedModel",
  });

  const GEMINI_MODEL_MODES = Object.freeze({
    auto: "auto",
    manual: "manual",
  });

  const GEMINI_MODEL_FALLBACK_ORDER = Object.freeze([
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite",
    "gemini-3.1-flash-lite-preview",
    "gemma-4-31b",
    "gemma-4-26b-a4b",
    "gemma-3-27b",
    "gemma-3-12b",
    "gemma-3-4b",
    "gemma-3-2b",
    "gemma-3-1b",
  ]);

  const MESSAGE_TYPES = Object.freeze({
    videoUrlDetected: "ZST_VIDEO_URL_DETECTED",
    getVideoUrl: "ZST_GET_VIDEO_URL",
    downloadVideo: "ZST_DOWNLOAD_VIDEO",
    downloadSlideImages: "ZST_DOWNLOAD_SLIDE_IMAGES",
    proofreadText: "ZST_PROOFREAD_TEXT",
    conversionProgress: "ZST_CONVERSION_PROGRESS",
    conversionComplete: "ZST_CONVERSION_COMPLETE",
    convertM3u8: "ZST_CONVERT_M3U8",
    revokeBlobUrl: "ZST_REVOKE_BLOB_URL",
    slideDownloadProgress: "ZST_SLIDE_DOWNLOAD_PROGRESS",
  });

  globalThis.ZenstudyToolConstants = Object.freeze({
    STORAGE_KEYS,
    GEMINI_MODEL_MODES,
    GEMINI_MODEL_FALLBACK_ORDER,
    DEFAULT_GEMINI_MODEL: GEMINI_MODEL_FALLBACK_ORDER[0],
    MESSAGE_TYPES,
  });
})();

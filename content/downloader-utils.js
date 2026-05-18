const ZenstudyToolDownloaderUtils = Object.freeze({
  normalizeTitleText(text) {
    if (!text) return "";

    return String(text)
      .replace(/\s+/g, " ")
      .replace(/\s+\d{1,2}:\d{2}(?::\d{2})?\s*\/\s*\d{1,2}:\d{2}(?::\d{2})?[\s\S]*$/, "")
      .replace(/\s+-\s+ZEN Study$/, "")
      .replace(/\s+\|\s+N予備校$/, "")
      .replace(/\s+-\s+N予備校$/, "")
      .trim();
  },

  pickLargestSrcsetCandidate(srcset) {
    const candidates = String(srcset || "")
      .split(",")
      .map((entry) => entry.trim().split(/\s+/)[0])
      .filter(Boolean);

    return candidates.length > 0 ? candidates[candidates.length - 1] : "";
  },

  resolveAssetUrl(candidate, baseUrl) {
    if (!candidate) return "";

    try {
      return new URL(candidate, baseUrl || window.location.href).href;
    } catch (_) {
      return "";
    }
  },

  isDownloadableSlideUrl(url) {
    if (!url || /^data:/i.test(url) || /^blob:/i.test(url)) return false;

    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (_) {
      return false;
    }
  },

  isLikelySlideImageElement(image, url) {
    if (!ZenstudyToolDownloaderUtils.isDownloadableSlideUrl(url)) return false;

    const width = image.naturalWidth || Number.parseInt(image.getAttribute("width") || "", 10) || image.clientWidth || 0;
    const height = image.naturalHeight || Number.parseInt(image.getAttribute("height") || "", 10) || image.clientHeight || 0;

    let extension = "";
    try {
      const pathname = new URL(url).pathname;
      extension = pathname.split(".").pop()?.toLowerCase() || "";
    } catch (_) {
      extension = "";
    }

    if (extension === "svg" && (!width || width < 240) && (!height || height < 160)) {
      return false;
    }

    if (width && height && (width < 240 || height < 160)) {
      return false;
    }

    return true;
  },

  sanitizeSlideFileStem(text) {
    return String(text || "")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/g, "")
      .slice(0, 40)
      .replace(/[. ]+$/g, "");
  },

  buildSlideFileStem(index, rawLabel = "") {
    const prefix = `slide_${String(index + 1).padStart(3, "0")}`;
    const label = ZenstudyToolDownloaderUtils.sanitizeSlideFileStem(rawLabel);
    return label ? `${prefix}_${label}` : prefix;
  },
});

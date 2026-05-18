class ZenstudyToolAnswerAssist {
  constructor() {
    this.hintSequence = 0;
    this.boundIframes = new WeakSet();
    this.boundFields = new WeakSet();
    this.observer = createDebouncedObserver(() => this.checkIframe(), 500);

    this.checkIframe();
  }

  checkIframe() {
    const iframe = document.querySelector(ACTION_IFRAME_SELECTOR);
    if (!iframe) return;

    if (!this.boundIframes.has(iframe)) {
      this.boundIframes.add(iframe);
      iframe.addEventListener("load", () => this.refreshFields(iframe));
    }

    this.refreshFields(iframe);
  }

  getIframeDocument(iframe) {
    return getAccessibleIframeDocument(iframe);
  }

  refreshFields(iframe) {
    const iframeDoc = this.getIframeDocument(iframe);
    if (!iframeDoc) return;

    const fields = Array.from(iframeDoc.querySelectorAll(ANSWER_TEXTAREA_SELECTOR))
      .filter((field) => field.getClientRects().length > 0);

    fields.forEach((field) => {
      this.bindField(field);
      this.updateField(field);
    });
  }

  bindField(field) {
    if (this.boundFields.has(field)) return;

    this.boundFields.add(field);
    field.addEventListener("input", () => this.updateField(field));
    field.addEventListener("change", () => this.updateField(field));
  }

  updateField(field) {
    const rule = this.getLengthRule(field);
    if (!rule?.min && !rule?.max) {
      this.removeBadge(field);
      return;
    }

    const count = this.countCharacters(field.value);
    const nativeOverLimitWarning = this.syncNativeOverLimitWarning(field, rule, count);

    const maxExceeded = rule.max && count > rule.max;
    const minShortage = !maxExceeded && rule.min && count > 0 && count < rule.min;
    const shouldWarn = maxExceeded || minShortage;

    if (!shouldWarn) {
      this.hideBadge(field);
      return;
    }

    if (maxExceeded && nativeOverLimitWarning) {
      this.hideBadge(field);
    } else {
      const badge = this.ensureBadge(field);
      badge.hidden = false;
      badge.textContent = maxExceeded
        ? `${count - rule.max}文字オーバー`
        : `${rule.min - count}文字不足`;
      this.placeBadge(field, badge);
    }
  }

  ensureBadge(field) {
    const doc = field.ownerDocument;
    let badge = field.dataset.zstAnswerLengthBadgeId
      ? doc.getElementById(field.dataset.zstAnswerLengthBadgeId)
      : null;

    if (!badge) {
      badge = doc.createElement("span");
      badge.id = `__ZENSTUDYTOOL_answerLengthBadge_${++this.hintSequence}`;
      badge.className = CSS_CLASSES.answerLengthBadge;
      field.dataset.zstAnswerLengthBadgeId = badge.id;
    }

    return badge;
  }

  placeBadge(field, badge) {
    const counter = this.findCounterElement(field);
    if (counter?.parentNode) {
      counter.parentNode.insertBefore(badge, counter);
      return;
    }

    const anchor = this.getInsertAnchor(field);
    const parent = anchor.parentNode;
    if (parent && badge.previousElementSibling !== anchor) {
      parent.insertBefore(badge, anchor.nextSibling);
    }
  }

  getInsertAnchor(field) {
    return field.closest(`.${CSS_CLASSES.fieldProofreadRow}`) || field;
  }

  hideBadge(field) {
    const badge = this.getBadge(field);
    if (badge) {
      badge.hidden = true;
      badge.textContent = "";
    }
  }

  removeBadge(field) {
    const badge = this.getBadge(field);
    if (badge) badge.remove();
    delete field.dataset.zstAnswerLengthBadgeId;
  }

  getBadge(field) {
    return field.dataset.zstAnswerLengthBadgeId
      ? field.ownerDocument.getElementById(field.dataset.zstAnswerLengthBadgeId)
      : null;
  }

  getLengthRule(field) {
    const text = this.collectQuestionText(field);
    const rule = this.parseCharacterCountRule(text);
    return rule.min || rule.max ? rule : null;
  }

  collectQuestionText(field) {
    const item = field.closest("li.exercise-item, .exercise-item, .answer-area") || field.closest("section.exercise");
    const section = field.closest("section.exercise");
    const parts = [
      section?.querySelector(".statement")?.textContent || "",
      item?.querySelector(".question")?.textContent || "",
      item && !item.querySelector(".question") ? item.textContent || "" : "",
    ];

    return this.normalizeText(parts.join(" "));
  }

  normalizeText(text) {
    return String(text || "")
      .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0))
      .replace(/\u3000/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  parseCharacterCountRule(text) {
    const normalized = this.normalizeText(text);
    const rule = { min: null, max: null };

    const explicitMin = normalized.match(/(\d{1,5})\s*(?:字|文字)\s*以上/);
    if (explicitMin) rule.min = Number.parseInt(explicitMin[1], 10) || null;

    const explicitMax = normalized.match(/(\d{1,5})\s*(?:字|文字)\s*(?:以内|以下)/);
    if (explicitMax) rule.max = Number.parseInt(explicitMax[1], 10) || null;

    const range = normalized.match(/(\d{1,5})\s*[~〜～\-－]\s*\d{1,5}\s*(?:字|文字)/);
    if (range) {
      const rangeMax = normalized.match(/\d{1,5}\s*[~〜～\-－]\s*(\d{1,5})\s*(?:字|文字)/);
      rule.min = rule.min || Number.parseInt(range[1], 10) || null;
      rule.max = rule.max || Number.parseInt(rangeMax?.[1] || "", 10) || null;
    }

    if (rule.min && rule.max && rule.min > rule.max) {
      return { min: rule.max, max: rule.min };
    }

    return rule;
  }

  countCharacters(value) {
    return String(value || "").replace(/\r\n/g, "\n").length;
  }

  syncNativeOverLimitWarning(field, rule, count) {
    if (!rule?.max) return false;

    const expectedText = count > rule.max ? `${count - rule.max}文字オーバー` : "";
    const container = field.closest("li.exercise-item, .exercise-item, .answer-area") || field.closest("section.exercise");
    if (!container) return false;

    const candidates = Array.from(container.querySelectorAll("*"))
      .filter((el) => {
        const text = this.normalizeText(el.textContent || "");
        return /^\d{1,5}文字オーバー$/.test(text);
      });

    for (const candidate of candidates) {
      if (!expectedText) {
        candidate.textContent = "";
        candidate.hidden = true;
        candidate.style.display = "none";
        continue;
      }

      candidate.hidden = false;
      candidate.style.display = "";
      if (this.normalizeText(candidate.textContent || "") !== expectedText) {
        candidate.textContent = expectedText;
      }
    }

    if (expectedText) {
      window.setTimeout(() => {
        for (const candidate of candidates) {
          candidate.hidden = false;
          candidate.style.display = "";
          if (this.normalizeText(candidate.textContent || "") !== expectedText) {
            candidate.textContent = expectedText;
          }
        }
      }, 0);
    }

    return candidates.length > 0;
  }

  findCounterElement(field) {
    const container = field.closest("li.exercise-item, .exercise-item, .answer-area") || field.closest("section.exercise");
    if (!container) return null;

    const counters = Array.from(container.querySelectorAll(".counter, [class*='counter'], [class*='count']"))
      .filter((el) => /^\d{1,5}文字$/.test(this.normalizeText(el.textContent || "")));

    if (counters.length === 0) return null;

    const fieldPosition = field.compareDocumentPosition.bind(field);
    return counters.find((counter) => fieldPosition(counter) & Node.DOCUMENT_POSITION_FOLLOWING) || counters[counters.length - 1];
  }
}

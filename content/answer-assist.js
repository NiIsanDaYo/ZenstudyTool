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
    if (!rule?.min) {
      this.removeHint(field);
      return;
    }

    const count = this.countCharacters(field.value);
    const shouldWarn = count > 0 && count < rule.min;
    const hint = this.ensureHint(field);

    if (!shouldWarn) {
      hint.hidden = true;
      field.classList.remove(CSS_CLASSES.minLengthFieldWarning);
      return;
    }

    const remaining = rule.min - count;
    hint.hidden = false;
    hint.textContent = `最低${rule.min}文字まであと${remaining}文字`;
    field.classList.add(CSS_CLASSES.minLengthFieldWarning);
  }

  ensureHint(field) {
    const doc = field.ownerDocument;
    let hint = field.dataset.zstMinLengthHintId
      ? doc.getElementById(field.dataset.zstMinLengthHintId)
      : null;

    if (!hint) {
      hint = doc.createElement("div");
      hint.id = `__ZENSTUDYTOOL_minLengthHint_${++this.hintSequence}`;
      hint.className = CSS_CLASSES.minLengthHint;
      field.dataset.zstMinLengthHintId = hint.id;
    }

    const anchor = this.getInsertAnchor(field);
    const parent = anchor.parentNode;
    if (parent && hint.previousElementSibling !== anchor) {
      parent.insertBefore(hint, anchor.nextSibling);
    }

    return hint;
  }

  getInsertAnchor(field) {
    return field.closest(`.${CSS_CLASSES.fieldProofreadRow}`) || field;
  }

  removeHint(field) {
    field.classList.remove(CSS_CLASSES.minLengthFieldWarning);

    if (!field.dataset.zstMinLengthHintId) return;

    const hint = field.ownerDocument.getElementById(field.dataset.zstMinLengthHintId);
    if (hint) hint.remove();
    delete field.dataset.zstMinLengthHintId;
  }

  getLengthRule(field) {
    const text = this.collectQuestionText(field);
    const min = this.parseMinimumCharacterCount(text);
    if (!min) return null;
    return { min };
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

  parseMinimumCharacterCount(text) {
    const normalized = this.normalizeText(text);
    const explicitMin = normalized.match(/(\d{1,5})\s*(?:字|文字)\s*以上/);
    if (explicitMin) return Number.parseInt(explicitMin[1], 10) || null;

    const range = normalized.match(/(\d{1,5})\s*[~〜～\-－]\s*\d{1,5}\s*(?:字|文字)/);
    if (range) return Number.parseInt(range[1], 10) || null;

    return null;
  }

  countCharacters(value) {
    return String(value || "").replace(/\r\n/g, "\n").length;
  }
}

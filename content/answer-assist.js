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
      this.removeHint(field);
      return;
    }

    const count = this.countCharacters(field.value);
    this.syncNativeOverLimitWarning(field, rule, count);

    const maxExceeded = rule.max && count > rule.max;
    const minShortage = !maxExceeded && rule.min && count > 0 && count < rule.min;
    const shouldWarn = maxExceeded || minShortage;
    const hint = this.ensureHint(field);

    if (!shouldWarn) {
      hint.hidden = true;
      field.classList.remove(CSS_CLASSES.answerLengthFieldWarning);
      return;
    }

    hint.hidden = false;
    hint.textContent = maxExceeded
      ? `${count - rule.max}文字オーバー（上限${rule.max}文字）`
      : `最低${rule.min}文字まであと${rule.min - count}文字`;
    field.classList.add(CSS_CLASSES.answerLengthFieldWarning);
  }

  ensureHint(field) {
    const doc = field.ownerDocument;
    let hint = field.dataset.zstAnswerLengthHintId
      ? doc.getElementById(field.dataset.zstAnswerLengthHintId)
      : null;

    if (!hint) {
      hint = doc.createElement("div");
      hint.id = `__ZENSTUDYTOOL_answerLengthHint_${++this.hintSequence}`;
      hint.className = CSS_CLASSES.answerLengthHint;
      field.dataset.zstAnswerLengthHintId = hint.id;
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
    field.classList.remove(CSS_CLASSES.answerLengthFieldWarning);

    if (!field.dataset.zstAnswerLengthHintId) return;

    const hint = field.ownerDocument.getElementById(field.dataset.zstAnswerLengthHintId);
    if (hint) hint.remove();
    delete field.dataset.zstAnswerLengthHintId;
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
    if (!rule?.max) return;

    const expectedText = count > rule.max ? `${count - rule.max}文字オーバー` : "";
    const container = field.closest("li.exercise-item, .exercise-item, .answer-area") || field.closest("section.exercise");
    if (!container) return;

    const candidates = Array.from(container.querySelectorAll("*"))
      .filter((el) => {
        const text = this.normalizeText(el.textContent || "");
        return /^\d{1,5}文字オーバー$/.test(text);
      });

    for (const candidate of candidates) {
      if (!expectedText) {
        candidate.textContent = "";
        continue;
      }

      if (this.normalizeText(candidate.textContent || "") !== expectedText) {
        candidate.textContent = expectedText;
      }
    }

    if (expectedText) {
      window.setTimeout(() => {
        for (const candidate of candidates) {
          if (this.normalizeText(candidate.textContent || "") !== expectedText) {
            candidate.textContent = expectedText;
          }
        }
      }, 0);
    }
  }
}

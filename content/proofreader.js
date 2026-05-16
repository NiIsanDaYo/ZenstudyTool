class ZenstudyToolProofreader {
  constructor() {
    this.enabled = true;
    this.apiKeyConfigured = false;
    this.btn = null;
    this.isProcessing = false;
    this.observer = createDebouncedObserver(() => this.checkIframe(), 500);

    safeStorageGet({
      [STORAGE_KEYS.geminiApiKey]: "",
      [STORAGE_KEYS.proofreadEnabled]: true,
    }, (result) => {
      this.enabled = Boolean(result[STORAGE_KEYS.proofreadEnabled]);
      this.apiKeyConfigured = Boolean((result[STORAGE_KEYS.geminiApiKey] || "").trim());
      this.checkIframe();
    });

    addSafeStorageChangeListener((changes, area) => {
      if (area !== "local") return;
      const enabledChange = changes[STORAGE_KEYS.proofreadEnabled];
      const change = changes[STORAGE_KEYS.geminiApiKey];

      if (enabledChange !== undefined) {
        this.enabled = Boolean(enabledChange.newValue);
      }

      if (change !== undefined) {
        this.apiKeyConfigured = Boolean((change.newValue || "").trim());
      }

      this.checkIframe();
    });
  }

  checkIframe() {
    const iframe = document.querySelector(ACTION_IFRAME_SELECTOR);
    if (this.enabled && iframe) {
      if (!iframe.dataset.zstProofreaderBound) {
        iframe.dataset.zstProofreaderBound = 'true';
        iframe.addEventListener('load', () => {
          this.showButton(iframe);
        });
      }
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
    if (!this.enabled) return;

    const iframeDoc = this.getIframeDocument(iframe);
    if (!iframeDoc) return;

    const evaluateButtonWrapper = iframeDoc.querySelector('.evaluate-button');
    if (!evaluateButtonWrapper) return;

    evaluateButtonWrapper.classList.add(CSS_CLASSES.actionRow);

    let button = iframeDoc.getElementById(ELEMENT_IDS.proofreadButton);
    if (!button) {
      button = iframeDoc.createElement('button');
      button.id = ELEMENT_IDS.proofreadButton;
      button.type = 'button';
      button.className = `u-button type-primary-light ${CSS_CLASSES.footerActionButton}`;
      button.addEventListener('click', () => {
        this.handleProofreadClick(iframe);
      });
      evaluateButtonWrapper.appendChild(button);
    } else {
      button.classList.add(CSS_CLASSES.footerActionButton);
    }

    this.btn = button;
    this.ensureFieldProofreadButtons(iframe, iframeDoc);
    this.updateReadyButton(iframeDoc);
  }

  hideButton(iframe) {
    if (this.btn && this.btn.parentNode) {
      this.btn.parentNode.removeChild(this.btn);
    }
    this.btn = null;

    if (iframe) {
      const iframeDoc = this.getIframeDocument(iframe);
      if (iframeDoc) {
        const existingButton = iframeDoc.getElementById(ELEMENT_IDS.proofreadButton);
        if (existingButton) existingButton.remove();
        iframeDoc
          .querySelectorAll(`.${CSS_CLASSES.fieldProofreadRow}`)
          .forEach((row) => {
            const parent = row.parentNode;
            if (!parent) return;

            row
              .querySelectorAll(PROOFREAD_FIELD_SELECTOR)
              .forEach((field) => parent.insertBefore(field, row));

            row.remove();
          });
        iframeDoc
          .querySelectorAll(PROOFREAD_FIELD_SELECTOR)
          .forEach((field) => field.removeAttribute('data-zst-proofread-bound'));
      }
    }
  }

  getProofreadButtonTitle(isBatch = false) {
    if (!this.enabled) {
      return 'ポップアップでAI文章校正を有効にしてください';
    }

    if (!this.apiKeyConfigured) {
      return 'ポップアップでGemini APIキーを設定してください';
    }

    return isBatch
      ? '入力済みの欄をまとめてAIで校正します'
      : 'この入力欄だけをAIで校正します';
  }

  applyButtonTone(button, tone = 'default') {
    if (!button) return;

    if (tone === 'busy') {
      button.style.backgroundColor = '#6f7782';
      button.style.color = '#fff';
      button.style.borderColor = '#6f7782';
      return;
    }

    if (tone === 'success') {
      button.style.backgroundColor = '#00c541';
      button.style.color = '#fff';
      button.style.borderColor = '#00c541';
      return;
    }

    if (tone === 'error') {
      button.style.backgroundColor = '#d44c4c';
      button.style.color = '#fff';
      button.style.borderColor = '#d44c4c';
      return;
    }

    button.style.backgroundColor = '';
    button.style.color = '';
    button.style.borderColor = '';
  }

  setProofreadButtonState(button, label, tone = 'default', disabled = false, title = '') {
    if (!button) return;

    button.innerHTML = label;
    button.disabled = disabled;
    button.title = title;
    this.applyButtonTone(button, tone);
  }

  setButtonPresentation(label, tone = 'default', disabled = false) {
    this.setProofreadButtonState(
      this.btn,
      label,
      tone,
      disabled,
      this.getProofreadButtonTitle(true)
    );
  }

  updateReadyButton(iframeDoc = null) {
    if (this.isProcessing) return;
    this.setButtonPresentation(PROOFREAD_BUTTON_TEXT.ready, 'default', false);

    if (!iframeDoc) return;

    iframeDoc
      .querySelectorAll(`.${CSS_CLASSES.fieldProofreadButton}`)
      .forEach((button) => {
        this.setProofreadButtonState(
          button,
          FIELD_PROOFREAD_BUTTON_TEXT.ready,
          'default',
          false,
          this.getProofreadButtonTitle(false)
        );
      });
  }

  getPageContextLines() {
    const lines = [];
    const courseNameEl = document.querySelector('a[href^="/courses/"] span');
    let chapterNameEl = document.querySelector('h1 span');
    if (!chapterNameEl) chapterNameEl = document.querySelector('h2 span');
    if (!chapterNameEl) chapterNameEl = document.querySelector('h1, h2');

    const courseName = courseNameEl ? courseNameEl.textContent.trim() : '';
    const chapterName = chapterNameEl ? chapterNameEl.textContent.trim() : '';

    if (courseName) lines.push(`コース: ${courseName}`);
    if (chapterName) lines.push(`単元: ${chapterName}`);

    return lines;
  }

  normalizeContextText(text) {
    return (text || '')
      .replace(/\r/g, '\n')
      .replace(/\u3000/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  collectFieldContext(field) {
    const contextLines = this.getPageContextLines();
    const section = field.closest('section.exercise');
    const item = field.closest('li.exercise-item, .exercise-item, .answer-area');

    const statementText = this.normalizeContextText(section?.querySelector('.statement')?.textContent || '');
    const questionText = this.normalizeContextText(item?.querySelector('.question')?.textContent || '');

    if (statementText) contextLines.push(`大問: ${statementText}`);
    if (questionText) contextLines.push(`設問: ${questionText}`);

    return contextLines.join('\n');
  }

  getVisibleProofreadFields(iframeDoc) {
    return Array.from(iframeDoc.querySelectorAll(PROOFREAD_FIELD_SELECTOR))
      .filter((field) => field.getClientRects().length > 0);
  }

  createProofreadTarget(field) {
    const value = typeof field?.value === 'string' ? field.value.replace(/\r\n/g, '\n').trim() : '';
    if (!value) return null;

    return {
      element: field,
      value,
      context: this.collectFieldContext(field),
    };
  }

  ensureFieldProofreadButtons(iframe, iframeDoc) {
    this.getVisibleProofreadFields(iframeDoc).forEach((field) => {
      if (field.dataset.zstProofreadBound === 'true') return;

      const fieldParent = field.parentNode;
      if (!fieldParent) return;

      const row = iframeDoc.createElement('div');
      row.className = `${CSS_CLASSES.fieldProofreadRow} ${field.tagName === 'TEXTAREA' ? CSS_CLASSES.fieldProofreadRowTextarea : CSS_CLASSES.fieldProofreadRowSingleline}`;

      const actionRow = iframeDoc.createElement('div');
      actionRow.className = CSS_CLASSES.fieldProofreadActions;

      const button = iframeDoc.createElement('button');
      button.type = 'button';
      button.className = CSS_CLASSES.fieldProofreadButton;
      button.dataset.zstProofreadState = 'ready';
      button.addEventListener('click', () => {
        if (button.dataset.zstProofreadState === 'undo') {
          this.handleUndoClick(field, button);
        } else {
          this.handleSingleFieldProofreadClick(iframe, field, button);
        }
      });

      actionRow.appendChild(button);

      fieldParent.insertBefore(row, field);
      row.appendChild(field);
      row.appendChild(actionRow);

      field.dataset.zstProofreadBound = 'true';
    });
  }

  collectProofreadTargets(iframeDoc) {
    return this.getVisibleProofreadFields(iframeDoc)
      .map((field) => this.createProofreadTarget(field))
      .filter(Boolean);
  }

  requestProofread(payload) {
    return new Promise((resolve, reject) => {
      const requestId = Date.now().toString() + Math.random().toString(36).slice(2);
      
      const messageListener = (message) => {
        if (message.type === 'ZST_PROOFREAD_STREAM_CHUNK' && message.requestId === requestId) {
          if (payload.element) {
            this.applyFieldValue(payload.element, message.text);
          }
        }
      };
      chrome.runtime.onMessage.addListener(messageListener);
      safeRuntimeSendMessage(
        {
          type: 'ZST_PROOFREAD_TEXT',
          originalText: payload.value,
          promptContext: payload.context,
          requestId: requestId,
        },
        (response, lastError) => {
          chrome.runtime.onMessage.removeListener(messageListener);
          if (lastError) {
            reject(new Error(lastError.message || 'AI校正に失敗しました'));
            return;
          }

          if (!response?.success || typeof response.correctedText !== 'string') {
            reject(new Error(response?.message || 'AI校正に失敗しました'));
            return;
          }

          resolve(response.correctedText);
        }
      );
    });
  }

  applyFieldValue(field, value) {
    const view = field.ownerDocument?.defaultView || window;
    const EventCtor = view.Event || Event;
    const prototype = field.tagName === 'TEXTAREA'
      ? view.HTMLTextAreaElement?.prototype
      : view.HTMLInputElement?.prototype;
    const descriptor = prototype
      ? Object.getOwnPropertyDescriptor(prototype, 'value')
      : null;

    if (descriptor?.set) {
      descriptor.set.call(field, value);
    } else {
      field.value = value;
    }

    field.dispatchEvent(new EventCtor('input', { bubbles: true }));
    field.dispatchEvent(new EventCtor('change', { bubbles: true }));
  }

  validateCorrectedText(target, correctedText) {
    if (!correctedText.trim()) {
      throw new Error('校正結果が空でした');
    }

    if (target.element.maxLength > 0 && correctedText.length > target.element.maxLength) {
      throw new Error('校正結果が入力上限を超えたため反映できませんでした');
    }
  }

  setFieldButtonsDisabled(iframeDoc, disabled) {
    iframeDoc
      .querySelectorAll(`.${CSS_CLASSES.fieldProofreadButton}`)
      .forEach((button) => {
        if (button.dataset.zstProofreadState !== 'undo') {
          button.disabled = disabled;
        }
      });
  }

  handleUndoClick(field, button) {
    if (this.isProcessing) return;
    const originalText = field.dataset.zstOriginalText || '';
    this.applyFieldValue(field, originalText);
    this.removeDiff(field);
    
    delete field.dataset.zstOriginalText;
    button.dataset.zstProofreadState = 'ready';
    this.setProofreadButtonState(
      button,
      FIELD_PROOFREAD_BUTTON_TEXT.ready,
      'default',
      false,
      this.getProofreadButtonTitle(false)
    );
  }

  computeMyersDiff(a, b) {
    const n = a.length;
    const m = b.length;
    const max = n + m;
    const v = new Int32Array(2 * max + 1);
    const trace = [];

    v[max + 1] = 0;
    for (let d = 0; d <= max; d++) {
      const vLine = new Int32Array(v);
      trace.push(vLine);
      for (let k = -d; k <= d; k += 2) {
        let x;
        if (k === -d || (k !== d && v[max + k - 1] < v[max + k + 1])) {
          x = v[max + k + 1];
        } else {
          x = v[max + k - 1] + 1;
        }
        let y = x - k;
        while (x < n && y < m && a[x] === b[y]) {
          x++;
          y++;
        }
        v[max + k] = x;
        if (x >= n && y >= m) {
          const diff = [];
          let currX = n;
          let currY = m;
          for (let dStep = d; dStep > 0; dStep--) {
            const vStep = trace[dStep - 1];
            const kStep = currX - currY;
            let prevK;
            if (kStep === -dStep || (kStep !== dStep && vStep[max + kStep - 1] < vStep[max + kStep + 1])) {
              prevK = kStep + 1;
            } else {
              prevK = kStep - 1;
            }
            const prevX = vStep[max + prevK];
            const prevY = prevX - prevK;
            while (currX > prevX && currY > prevY) {
              diff.push({ type: 'equal', text: a[currX - 1] });
              currX--;
              currY--;
            }
            if (currX > prevX) {
              diff.push({ type: 'removed', text: a[currX - 1] });
              currX--;
            } else if (currY > prevY) {
              diff.push({ type: 'added', text: b[currY - 1] });
              currY--;
            }
          }
          while (currX > 0 && currY > 0) {
            diff.push({ type: 'equal', text: a[currX - 1] });
            currX--;
            currY--;
          }
          return diff.reverse();
        }
      }
    }
    return [];
  }

  showDiff(field, oldStr, newStr) {
    this.removeDiff(field);
    const diffView = document.createElement('div');
    diffView.className = 'zst-proofread-diff';
    diffView.style.marginTop = '8px';
    diffView.style.padding = '12px';
    diffView.style.border = '1px solid #e1e4e8';
    diffView.style.borderRadius = '6px';
    diffView.style.backgroundColor = '#f6f8fa';
    diffView.style.fontSize = '13px';
    diffView.style.lineHeight = '1.6';
    diffView.style.whiteSpace = 'pre-wrap';
    diffView.style.wordBreak = 'break-word';

    const diff = this.computeMyersDiff(oldStr, newStr);
    let html = '';
    let currentType = null;
    let currentText = '';
    const commit = () => {
      if (!currentType) return;
      const escaped = currentText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      if (currentType === 'equal') {
        html += `<span>${escaped}</span>`;
      } else if (currentType === 'added') {
        html += `<ins style="background-color:#e6ffed;text-decoration:none;color:#22863a;font-weight:bold;">${escaped}</ins>`;
      } else if (currentType === 'removed') {
        html += `<del style="background-color:#ffeef0;text-decoration:line-through;color:#cb2431;">${escaped}</del>`;
      }
      currentText = '';
    };
    for (const op of diff) {
      if (op.type !== currentType) {
        commit();
        currentType = op.type;
      }
      currentText += op.text;
    }
    commit();
    diffView.innerHTML = html;
    
    field.parentNode.insertBefore(diffView, field.nextSibling);
    field.dataset.zstHasDiff = 'true';
  }

  removeDiff(field) {
    if (field.dataset.zstHasDiff === 'true') {
      const diffView = field.parentNode.querySelector('.zst-proofread-diff');
      if (diffView) diffView.remove();
      delete field.dataset.zstHasDiff;
    }
  }

  async handleSingleFieldProofreadClick(iframe, field, button) {
    if (this.isProcessing) return;

    if (!this.enabled) {
      alert('ポップアップで AI文章校正 を有効にしてください。');
      return;
    }

    if (!this.apiKeyConfigured) {
      alert('ポップアップで Gemini API キーを設定してください。');
      return;
    }

    const iframeDoc = this.getIframeDocument(iframe);
    if (!iframeDoc) {
      alert('校正対象のページを開けませんでした。');
      return;
    }

    const target = this.createProofreadTarget(field);
    if (!target) {
      alert('この入力欄に校正できる入力内容がありませんでした。');
      return;
    }

    this.isProcessing = true;
    this.setButtonPresentation(PROOFREAD_BUTTON_TEXT.ready, 'default', true);
    this.setFieldButtonsDisabled(iframeDoc, true);
    this.setProofreadButtonState(
      button,
      FIELD_PROOFREAD_BUTTON_TEXT.working,
      'busy',
      true,
      this.getProofreadButtonTitle(false)
    );

    try {
      const originalText = target.value;
      const correctedText = await this.requestProofread(target);
      this.validateCorrectedText(target, correctedText);
      this.applyFieldValue(target.element, correctedText);
      
      this.showDiff(target.element, originalText, correctedText);
      target.element.dataset.zstOriginalText = originalText;
      button.dataset.zstProofreadState = 'undo';

      this.setProofreadButtonState(
        button,
        '元に戻す',
        'default',
        false,
        '元のテキストに戻します'
      );
    } catch (err) {
      console.error('[ZenstudyTool] Single field proofread failed', err);
      this.setProofreadButtonState(
        button,
        FIELD_PROOFREAD_BUTTON_TEXT.failed,
        'error',
        true,
        this.getProofreadButtonTitle(false)
      );
      alert(`AI校正に失敗しました（${err.message}）`);
      window.setTimeout(() => this.updateReadyButton(iframeDoc), 2000);
    } finally {
      this.isProcessing = false;
    }
  }

  async handleProofreadClick(iframe) {
    if (this.isProcessing) return;

    if (!this.enabled) {
      alert('ポップアップで AI文章校正 を有効にしてください。');
      return;
    }

    if (!this.apiKeyConfigured) {
      alert('ポップアップで Gemini API キーを設定してください。');
      return;
    }

    const iframeDoc = this.getIframeDocument(iframe);
    if (!iframeDoc) {
      alert('校正対象のページを開けませんでした。');
      return;
    }

    const targets = this.collectProofreadTargets(iframeDoc);
    if (targets.length === 0) {
      alert('校正できる入力済みの自由記述欄が見つかりませんでした。');
      return;
    }

    this.isProcessing = true;
    this.setFieldButtonsDisabled(iframeDoc, true);

    try {
      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        const progressLabel = targets.length > 1
          ? `${PROOFREAD_BUTTON_TEXT.working} ${index + 1}/${targets.length}`
          : PROOFREAD_BUTTON_TEXT.working;
        this.setButtonPresentation(progressLabel, 'busy', true);

        const originalText = target.value;
        const correctedText = await this.requestProofread(target);
        this.validateCorrectedText(target, correctedText);

        this.applyFieldValue(target.element, correctedText);
        
        this.showDiff(target.element, originalText, correctedText);
        target.element.dataset.zstOriginalText = originalText;
        
        const fieldRow = target.element.parentNode;
        if (fieldRow) {
          const fieldButton = fieldRow.querySelector(`.${CSS_CLASSES.fieldProofreadButton}`);
          if (fieldButton) {
            fieldButton.dataset.zstProofreadState = 'undo';
            this.setProofreadButtonState(
              fieldButton,
              '元に戻す',
              'default',
              false,
              '元のテキストに戻します'
            );
          }
        }
      }

      this.setButtonPresentation(PROOFREAD_BUTTON_TEXT.success, 'success', true);
    } catch (err) {
      console.error('[ZenstudyTool] Proofread failed', err);
      this.setButtonPresentation(PROOFREAD_BUTTON_TEXT.failed, 'error', true);
      alert(`AI校正に失敗しました（${err.message}）`);
    } finally {
      this.isProcessing = false;
      window.setTimeout(() => {
        if (!this.isProcessing) {
          this.setButtonPresentation(PROOFREAD_BUTTON_TEXT.ready, 'default', false);
        }
      }, 2000);
    }
  }
}

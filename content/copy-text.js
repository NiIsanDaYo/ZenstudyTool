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
    const iframe = document.querySelector(ACTION_IFRAME_SELECTOR);
    if (this.enabled && iframe) {
      if (!iframe.dataset.zstCopyTextBound) {
        iframe.dataset.zstCopyTextBound = 'true';
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
    return getAccessibleIframeDocument(iframe);
  }

  showButton(iframe) {
    const iframeDoc = this.getIframeDocument(iframe);
    if (!iframeDoc) return;

    // フッターのボタンラッパーを探す
    const evaluateButtonWrapper = iframeDoc.querySelector('.evaluate-button');
    if (!evaluateButtonWrapper) return;

    evaluateButtonWrapper.classList.add(CSS_CLASSES.actionRow);

    const existingButton = iframeDoc.getElementById(ELEMENT_IDS.copyButton);
    if (existingButton) {
      existingButton.classList.add(CSS_CLASSES.footerActionButton);
      this.btn = existingButton;
      return;
    }

    this.btn = iframeDoc.createElement('button');
    this.btn.id = ELEMENT_IDS.copyButton;
    this.btn.type = 'button';
    
    // ZEN Studyの既存の「答え合わせ」「再受講する」と同じボタンデザインを拝借する
    this.btn.className = `u-button type-primary-light ${CSS_CLASSES.footerActionButton}`;
    this.btn.innerHTML = '問題文をコピー';
    
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

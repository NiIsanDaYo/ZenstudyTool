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

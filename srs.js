/* 艾宾浩斯遗忘曲线复习调度（纯逻辑，浏览器与 Node 通用） */
(function (root) {
  'use strict';

  // 记忆阶段对应复习间隔（小时）：20分钟 → 1小时 → 9小时 → 1天 → 2天 → 6天 → 14天 → 30天 → 60天（毕业）
  var INTERVALS_H = [1 / 3, 1, 9, 24, 48, 144, 336, 720, 1440];
  var MAX_STAGE = INTERVALS_H.length; // 达到即为"已掌握"

  function nextDueHours(stage) {
    if (stage >= INTERVALS_H.length) return Infinity;
    return INTERVALS_H[Math.max(0, stage)];
  }

  /** 答对：阶段 +1，按旧阶段对应间隔安排下次复习 */
  function onCorrect(rec, now) {
    now = now || Date.now();
    var oldStage = rec.stage || 0;
    var stage = Math.min(oldStage + 1, MAX_STAGE);
    var hours = oldStage >= INTERVALS_H.length ? Infinity : INTERVALS_H[oldStage];
    return {
      stage: stage,
      correct: (rec.correct || 0) + 1,
      wrong: rec.wrong || 0,
      last: now,
      nextDue: now + hours * 3600 * 1000
    };
  }

  /** 答错：阶段回落（至少回到第 1 阶段），10 分钟后重学 */
  function onWrong(rec, now) {
    now = now || Date.now();
    var stage = Math.max(0, Math.floor((rec.stage || 0) / 2) - 1);
    return {
      stage: stage,
      correct: rec.correct || 0,
      wrong: (rec.wrong || 0) + 1,
      last: now,
      nextDue: now + 10 * 60 * 1000
    };
  }

  /** 是否到期需要复习 */
  function isDue(rec, now) {
    if (!rec || !rec.nextDue) return true; // 新词视为待学
    return rec.nextDue <= (now || Date.now());
  }

  /** 今日新词配额检查 */
  function newCountToday(records, now) {
    now = now || Date.now();
    var day = new Date(now); day.setHours(0, 0, 0, 0);
    var start = day.getTime(), n = 0;
    Object.keys(records).forEach(function (k) {
      var r = records[k];
      if (r.firstSeen && r.firstSeen >= start) n++;
    });
    return n;
  }

  var SRS = {
    INTERVALS_H: INTERVALS_H,
    MAX_STAGE: MAX_STAGE,
    nextDueHours: nextDueHours,
    onCorrect: onCorrect,
    onWrong: onWrong,
    isDue: isDue,
    newCountToday: newCountToday,
    stageLabel: function (stage) {
      if (stage >= MAX_STAGE) return '已掌握';
      if (stage === 0) return '新词';
      return '第' + stage + '轮复习';
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SRS;
  else root.SRS = SRS;
})(typeof window !== 'undefined' ? window : globalThis);

/* 词根背单词 · 高考高频词
 * 多用户 + 错题本 + 打分系统 + 艾宾浩斯复习调度
 * 纯前端零依赖，数据保存在本机浏览器 localStorage。
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var WORDS = window.WORDS || [];
  var SRS = window.SRS;
  var BYWORD = {};
  WORDS.forEach(function (w) { BYWORD[w.w] = w; });

  /* ---------------- 存储 ---------------- */
  var USERS_KEY = 'wordGame.users.v1';
  var DATA_KEY = 'wordGame.data.v1.';

  function loadJSON(key, def) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? def : v; }
    catch (e) { return def; }
  }
  function saveJSON(key, v) { localStorage.setItem(key, JSON.stringify(v)); }

  function usersIdx() {
    var idx = loadJSON(USERS_KEY, null);
    if (!idx || typeof idx !== 'object' || !idx.users) idx = { users: {}, current: null };
    return idx;
  }

  /** 加盐哈希（本地应用，同步实现，登录流程无需异步） */
  function hashPwd(pwd, salt) {
    var s = String(salt) + ':' + String(pwd);
    var h1 = 0x811c9dc5, h2 = 0x01000193, i, c, r;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = (Math.imul(h2, 31) + c) >>> 0;
    }
    for (r = 0; r < 50; r++) {
      h1 = Math.imul(h1 ^ h2, 2654435761) >>> 0;
      h2 = Math.imul(h2 ^ h1, 2246822519) >>> 0;
    }
    function pad(x) { return ('0000000' + x.toString(16)).slice(-8); }
    return pad(h1) + pad(h2);
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function defaultState() {
    return {
      records: {},   // word -> {stage, correct, wrong, last, nextDue, firstSeen}
      wrongBook: {}, // word -> {wrongInput, count, last, fixed}
      scores: { total: 0, best: 0 },
      today: { date: todayStr(), done: 0, right: 0, wrong: 0, score: 0 },
      settings: { daily: 30, round: 15, rate: 0.9, prefer: 'mix', nick: '', avatar: '📚' }
    };
  }

  /* ---------------- 全局状态 ---------------- */
  var USER = null;      // 当前登录用户名
  var state = null;     // 当前用户数据
  var game = null;      // 本轮游戏会话
  var AVATARS = ['📚', '🦊', '🐼', '🦁', '🐯', '🦉', '🐳'];

  function loadState(name) {
    var st = loadJSON(DATA_KEY + name, null);
    if (!st || typeof st !== 'object') st = defaultState();
    var d = defaultState();
    ['records', 'wrongBook', 'scores', 'today', 'settings'].forEach(function (k) {
      if (!st[k] || typeof st[k] !== 'object') st[k] = d[k];
    });
    state = st;
    touchToday();
  }
  function saveState() { if (USER) saveJSON(DATA_KEY + USER, state); }

  function touchToday() {
    if (!state.today || state.today.date !== todayStr()) {
      state.today = { date: todayStr(), done: 0, right: 0, wrong: 0, score: 0 };
    }
  }

  /* ---------------- 等级 ---------------- */
  var LEVELS = [
    [0, '学童'], [200, '秀才'], [500, '举人'], [1000, '进士'], [2000, '翰林'], [5000, '状元']
  ];
  function levelOf(total) {
    var name = LEVELS[0][1];
    for (var i = 0; i < LEVELS.length; i++) if (total >= LEVELS[i][0]) name = LEVELS[i][1];
    return name;
  }

  /* ---------------- 语音 ---------------- */
  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = parseFloat(state.settings.rate) || 0.9;
      window.speechSynthesis.speak(u);
    } catch (e) { /* 忽略 TTS 异常 */ }
  }

  /* ---------------- 页面切换 ---------------- */
  var PAGES = ['home', 'game', 'wrong', 'stats', 'set'];
  function show(page) {
    PAGES.forEach(function (p) {
      var el = $('page-' + p);
      if (el) el.classList.toggle('hidden', p !== page);
    });
    document.querySelectorAll('nav button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-nav') === page);
    });
    if (page === 'home') refreshHome();
    if (page === 'wrong') renderWrong();
    if (page === 'stats') renderStats();
    if (page === 'set') renderSet();
    window.scrollTo(0, 0);
  }

  /* ---------------- 头部 / 首页 ---------------- */
  function dueReviewWords() {
    var now = Date.now(), out = [];
    WORDS.forEach(function (w) {
      var rec = state.records[w.w];
      if (rec && SRS.isDue(rec, now)) out.push(w);
    });
    return out;
  }
  function newWordsLeft() {
    var learned = Object.keys(state.records).length;
    var quota = Math.max(0, state.settings.daily - SRS.newCountToday(state.records));
    return Math.min(quota, WORDS.length - learned);
  }
  function wrongCount() { return Object.keys(state.wrongBook).length; }

  function renderHeader() {
    $('hAvatar').textContent = state.settings.avatar || '📚';
    $('hName').textContent = state.settings.nick || USER;
    $('hLevel').textContent = levelOf(state.scores.total);
    $('hScore').textContent = state.scores.total;
    $('dueReview').textContent = dueReviewWords().length;
    $('dueNew').textContent = newWordsLeft();
    $('dueWrong').textContent = wrongCount();
    $('todayScore').textContent = state.today.score;
  }

  function refreshHome() {
    renderHeader();
    var due = dueReviewWords().length;
    $('cntListen').textContent = due;
    $('cntType').textContent = due;
    $('cntMixed').textContent = due;
    $('cntLearn').textContent = newWordsLeft();
    $('cntWrong').textContent = wrongCount();
  }

  /* ---------------- 错题本 ---------------- */
  function addWrong(word, wrongInput) {
    var e = state.wrongBook[word];
    if (e) { e.count++; e.wrongInput = wrongInput; e.last = Date.now(); }
    else state.wrongBook[word] = { wrongInput: wrongInput, count: 1, last: Date.now(), fixed: 0 };
  }
  function fixWrong(word) {
    var e = state.wrongBook[word];
    if (!e) return;
    e.fixed = (e.fixed || 0) + 1;
    if (e.fixed >= 2) delete state.wrongBook[word];
  }

  function renderWrong() {
    var keys = Object.keys(state.wrongBook).sort(function (a, b) {
      return (state.wrongBook[b].count - state.wrongBook[a].count);
    });
    $('wrongTotal').textContent = keys.length ? '共 ' + keys.length + ' 词 · 按错次数排序' : '';
    var box = $('wrongList');
    if (!keys.length) {
      box.innerHTML = '<div class="empty">🎉 错题本是空的<br>答错的单词会自动收录到这里</div>';
      return;
    }
    box.innerHTML = '';
    keys.forEach(function (word) {
      var e = state.wrongBook[word];
      var w = BYWORD[word] || { w: word, p: '', m: '' };
      var item = document.createElement('div');
      item.className = 'wrongitem';
      item.innerHTML =
        '<div class="winfo">' +
          '<div><span class="wword"></span><span class="wphon"></span></div>' +
          '<div class="wmean"></div>' +
          '<div class="winput">你曾错拼为：<b></b></div>' +
        '</div>' +
        '<span class="wcount">错 ' + e.count + ' 次</span>';
      item.querySelector('.wword').textContent = w.w;
      item.querySelector('.wphon').textContent = w.p;
      item.querySelector('.wmean').textContent = w.m;
      item.querySelector('.winput b').textContent = e.wrongInput || '—';
      var spk = document.createElement('button');
      spk.textContent = '🔊';
      spk.onclick = function () { speak(w.w); };
      var rm = document.createElement('button');
      rm.textContent = '移出';
      rm.onclick = function () { delete state.wrongBook[word]; saveState(); renderWrong(); renderHeader(); };
      item.appendChild(spk);
      item.appendChild(rm);
      box.appendChild(item);
    });
  }

  /* ---------------- 出题 ---------------- */
  function ensureRec(word) {
    var rec = state.records[word];
    if (!rec) {
      rec = { stage: 0, correct: 0, wrong: 0, last: Date.now(), nextDue: 0, firstSeen: Date.now() };
      state.records[word] = rec;
    }
    return rec;
  }

  function pickKind() {
    var p = state.settings.prefer, r = Math.random();
    if (p === 'listen') return r < 0.7 ? 'listen' : 'type';
    if (p === 'type') return r < 0.7 ? 'type' : 'listen';
    return r < 0.5 ? 'listen' : 'type';
  }

  function buildQueue(mode) {
    var q = [];
    if (mode === 'learn') {
      var n = Math.min(state.settings.round, newWordsLeft());
      for (var i = 0; i < WORDS.length && q.length < n; i++) {
        if (!state.records[WORDS[i].w]) q.push({ w: WORDS[i], kind: 'learn' });
      }
    } else if (mode === 'wrong') {
      Object.keys(state.wrongBook).forEach(function (word) {
        if (BYWORD[word]) q.push({ w: BYWORD[word], kind: pickKind() });
      });
    } else {
      var due = dueReviewWords();
      var m = Math.min(state.settings.round, due.length);
      for (var j = 0; j < m; j++) {
        var kind = mode === 'listen' ? 'listen' : mode === 'type' ? 'type' : pickKind();
        q.push({ w: due[j], kind: kind });
      }
    }
    // 简单洗牌
    for (var k = q.length - 1; k > 0; k--) {
      var t = Math.floor(Math.random() * (k + 1)), tmp = q[k]; q[k] = q[t]; q[t] = tmp;
    }
    return q;
  }

  function startGame(mode) {
    var queue = buildQueue(mode);
    if (!queue.length) {
      alert(mode === 'learn' ? '今日新词配额已用完，明天再来吧！' : '现在没有待复习的单词，先学几个新词吧！');
      return;
    }
    game = { mode: mode, queue: queue, idx: 0, right: 0, wrong: 0, score: 0, streak: 0, qStart: Date.now() };
    show('game');
    renderQuestion();
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderQuestion() {
    var body = $('gamebody');
    var item = game.queue[game.idx];
    var w = item.w;
    touchToday();
    game.qStart = Date.now();
    game.answered = false;
    $('streakBar').textContent = game.streak >= 2 ? '🔥 连对 ' + game.streak : '';
    $('prog').style.width = Math.round(game.idx / game.queue.length * 100) + '%';

    if (item.kind === 'learn') {
      body.innerHTML =
        '<div class="wordcard card">' +
          '<div class="word">' + esc(w.w) + '</div>' +
          '<div class="phon">' + esc(w.p) + '</div>' +
          '<button class="speakbtn" id="spkBtn">🔊 播放发音</button>' +
          '<div class="mean">' + esc(w.m) + '</div>' +
          '<div class="sent">' + esc(w.s) + '<br>' + esc(w.t) + '</div>' +
          '<span class="stagepill">新词 · 考频第 ' + (w.f || '-') + ' 位</span>' +
        '</div>' +
        '<div class="feedback" id="fb"></div>' +
        '<div class="btnrow">' +
          '<button class="btn ok" id="knowBtn">😀 认识 (+10 分)</button>' +
          '<button class="btn bad" id="unknowBtn">😅 不认识</button>' +
        '</div>';
      $('spkBtn').onclick = function () { speak(w.w); };
      speak(w.w);
      $('knowBtn').onclick = function () { answerLearn(w, true); };
      $('unknowBtn').onclick = function () { answerLearn(w, false); };
      return;
    }

    var promptHtml;
    if (item.kind === 'listen') {
      promptHtml =
        '<div class="prompt"><div class="lab">🔊 听发音，写出这个单词</div>' +
        '<button class="speakbtn" id="spkBtn">🔊 播放发音</button>' +
        '<div class="small">听不懂？多点几次，也可以先猜着写。</div></div>';
    } else {
      promptHtml =
        '<div class="prompt"><div class="lab">✍️ 根据中文释义写出英文单词</div>' +
        '<div class="big">' + esc(w.m) + '</div></div>';
    }
    body.innerHTML =
      promptHtml +
      '<div class="answer"><input id="ansInput" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="输入单词后回车">' +
      '<button id="ansBtn">确定</button></div>' +
      '<div class="feedback" id="fb"></div>';
    if (item.kind === 'listen') {
      $('spkBtn').onclick = function () { speak(w.w); };
      speak(w.w);
    }
    var input = $('ansInput');
    input.focus();
    function submit() { checkAnswer(w, input.value); }
    $('ansBtn').onclick = submit;
    input.onkeydown = function (e) { if (e.key === 'Enter') submit(); };
  }

  /* ---------------- 判题与打分 ---------------- */
  function norm(s) { return String(s || '').trim().toLowerCase(); }

  function award(base, quickBonus) {
    var pts = base, notes = [];
    if (quickBonus) { pts += 5; notes.push('⚡ 秒答 +5'); }
    game.streak++;
    if (game.streak > 0 && game.streak % 5 === 0) { pts += 20; notes.push('🔥 连对 ' + game.streak + ' 奖励 +20'); }
    game.score += pts;
    state.scores.total += pts;
    state.today.score += pts;
    return '+' + pts + ' 分' + (notes.length ? ' · ' + notes.join(' · ') : '');
  }

  function showFb(ok, w, scoreLine) {
    var fb = $('fb');
    fb.className = 'feedback show ' + (ok ? 'right' : 'wrong');
    fb.innerHTML =
      '<div class="head">' + (ok ? '✅ 回答正确！' : '❌ 回答错误') + '</div>' +
      '<div class="fbword">' + esc(w.w) + '</div>' +
      '<div class="fbphon">' + esc(w.p) + '</div>' +
      '<div class="fbmean">' + esc(w.m) + '</div>' +
      '<div class="fbsent">' + esc(w.s) + ' — ' + esc(w.t) + '</div>' +
      (scoreLine ? '<div class="fbscore">' + esc(scoreLine) + '</div>' : '') +
      '<div class="nextrow" style="margin-top:10px"><button class="btn ' + (ok ? 'ok' : 'plain') + '" id="nextBtn">' +
      (game.idx + 1 >= game.queue.length ? '查看本轮成绩 🏁' : '下一题 →') + '</button></div>';
    $('nextBtn').onclick = nextQuestion;
    fb.scrollIntoView({ block: 'nearest' });
  }

  function lockAnswerUI() {
    game.answered = true;
    ['knowBtn', 'unknowBtn', 'ansBtn'].forEach(function (id) {
      var el = $(id);
      if (el) { el.disabled = true; el.style.opacity = '.45'; }
    });
    var inp = $('ansInput');
    if (inp) inp.disabled = true;
  }

  function checkAnswer(w, rawInput) {
    if (game.answered) return;
    var input = norm(rawInput);
    if (!input) return;
    lockAnswerUI();
    var rec = state.records[w.w] || { stage: 0 };
    var now = Date.now();
    var quick = (now - game.qStart) < 5000;
    touchToday();
    state.today.done++;
    if (input === norm(w.w)) {
      game.right++; state.today.right++;
      state.records[w.w] = SRS.onCorrect(ensureRec(w.w), now);
      fixWrong(w.w);
      var base = 10 + (rec.stage || 0) * 2;
      var line = award(base, quick);
      saveState(); renderHeader();
      showFb(true, w, line);
    } else {
      game.wrong++; game.streak = 0; state.today.wrong++;
      state.records[w.w] = SRS.onWrong(ensureRec(w.w), now);
      addWrong(w.w, rawInput.trim());
      saveState(); renderHeader();
      showFb(false, w, '+0 分 · 已记入错题本 📕');
    }
  }

  function answerLearn(w, know) {
    if (game.answered) return;
    lockAnswerUI();
    var now = Date.now();
    touchToday();
    state.today.done++;
    ensureRec(w.w);
    if (know) {
      game.right++; state.today.right++;
      state.records[w.w] = SRS.onCorrect(state.records[w.w], now);
      state.records[w.w].firstSeen = state.records[w.w].firstSeen || now;
      game.score += 10; state.scores.total += 10; state.today.score += 10;
      saveState(); renderHeader();
      showFb(true, w, '+10 分');
    } else {
      game.wrong++; state.today.wrong++;
      state.records[w.w] = SRS.onWrong(state.records[w.w], now);
      addWrong(w.w, '（不认识）');
      saveState(); renderHeader();
      showFb(false, w, '+0 分 · 已记入错题本 📕');
    }
  }

  function nextQuestion() {
    game.idx++;
    if (game.idx >= game.queue.length) { endSession(); return; }
    renderQuestion();
  }

  function endSession() {
    $('prog').style.width = '100%';
    $('streakBar').textContent = '';
    if (game.score > state.scores.best) state.scores.best = game.score;
    saveState(); renderHeader();
    var emoji = game.wrong === 0 ? '🏆' : game.right >= game.wrong ? '💪' : '📚';
    $('gamebody').innerHTML =
      '<div class="card sessionend">' +
        '<div class="emoji">' + emoji + '</div>' +
        '<div class="bigscore">+' + game.score + ' 分</div>' +
        '<p>本轮答对 <b style="color:var(--ok)">' + game.right + '</b> 题 · 答错 <b style="color:var(--bad)">' + game.wrong + '</b> 题<br>' +
        '今日累计 ' + state.today.score + ' 分 · 历史最佳单轮 ' + state.scores.best + ' 分</p>' +
        '<div class="btnrow">' +
          '<button class="btn ok" id="againBtn">再来一轮</button>' +
          '<button class="btn plain" id="homeBtn">返回首页</button>' +
        '</div>' +
      '</div>';
    var mode = game.mode;
    $('againBtn').onclick = function () { startGame(mode); };
    $('homeBtn').onclick = function () { show('home'); };
  }

  /* ---------------- 统计页 ---------------- */
  function renderStats() {
    var recs = state.records;
    var keys = Object.keys(recs);
    var master = 0, stageCount = {};
    for (var i = 0; i <= SRS.MAX_STAGE; i++) stageCount[i] = 0;
    keys.forEach(function (k) {
      var s = Math.min(recs[k].stage || 0, SRS.MAX_STAGE);
      stageCount[s]++;
      if (s >= SRS.MAX_STAGE) master++;
    });
    $('stTotal').textContent = keys.length;
    $('stMaster').textContent = master;
    $('stToday').textContent = state.today.done;
    var colors = ['#5A6B8C', '#0E7C7B', '#14A0A0', '#2E86AB', '#4AA3C7', '#6C3483', '#8E44AD', '#B7950B', '#D4AC0D', '#1E8449'];
    var max = Math.max(1, keys.length);
    var html = '';
    for (var s2 = 0; s2 <= SRS.MAX_STAGE; s2++) {
      if (stageCount[s2] === 0 && s2 !== 0 && s2 !== SRS.MAX_STAGE) continue;
      html +=
        '<div class="stagerow"><span style="width:88px">' + SRS.stageLabel(s2) + '</span>' +
        '<div class="bar"><i style="width:' + Math.round(stageCount[s2] / max * 100) + '%;background:' + colors[s2] + '"></i></div>' +
        '<b style="width:30px;text-align:right">' + stageCount[s2] + '</b></div>';
    }
    $('stageBars').innerHTML = html || '<div class="empty">还没有学习记录</div>';
    $('todayLine').textContent = '今日（' + state.today.date + '）：完成 ' + state.today.done + ' 题，答对 ' + state.today.right + '，答错 ' + state.today.wrong + '，得分 ' + state.today.score;
    $('scoreLine').textContent = '总分 ' + state.scores.total + ' · 历史最佳单轮 ' + state.scores.best + ' · 等级「' + levelOf(state.scores.total) + '」';
  }

  /* ---------------- 设置页 ---------------- */
  function renderSet() {
    $('setNick').value = state.settings.nick || '';
    $('setDaily').value = state.settings.daily;
    $('setRound').value = state.settings.round;
    $('setRate').value = String(state.settings.rate);
    $('setPrefer').value = state.settings.prefer;
    var box = $('setAvatar');
    box.innerHTML = '';
    AVATARS.forEach(function (a) {
      var sp = document.createElement('span');
      sp.textContent = a;
      if (a === state.settings.avatar) sp.className = 'sel';
      sp.onclick = function () {
        state.settings.avatar = a; saveState(); renderSet(); renderHeader();
      };
      box.appendChild(sp);
    });
  }

  function bindSet() {
    $('setNick').oninput = function () { state.settings.nick = this.value.trim().slice(0, 10); saveState(); renderHeader(); };
    $('setDaily').onchange = function () { state.settings.daily = Math.min(100, Math.max(5, parseInt(this.value) || 30)); saveState(); renderHeader(); };
    $('setRound').onchange = function () { state.settings.round = Math.min(50, Math.max(5, parseInt(this.value) || 15)); saveState(); };
    $('setRate').onchange = function () { state.settings.rate = parseFloat(this.value); saveState(); };
    $('setPrefer').onchange = function () { state.settings.prefer = this.value; saveState(); };
    $('switchUserBtn').onclick = function () { showLogin(); };
    $('resetBtn').onclick = function () {
      if (!confirm('确定要清空当前用户的全部学习记录、错题本和积分吗？此操作不可恢复。')) return;
      state.records = {}; state.wrongBook = {}; state.scores = { total: 0, best: 0 };
      state.today = { date: todayStr(), done: 0, right: 0, wrong: 0, score: 0 };
      saveState(); renderHeader(); alert('已清空学习记录。');
    };
  }

  /* ---------------- 登录 / 注册 ---------------- */
  var authMode = 'login'; // 'login' | 'reg'

  function setAuthMode(mode) {
    authMode = mode;
    var isReg = mode === 'reg';
    $('tabLogin').classList.toggle('on', !isReg);
    $('tabReg').classList.toggle('on', isReg);
    $('loginPwd2').classList.toggle('hidden', !isReg);
    $('loginBtn').textContent = isReg ? '注 册' : '登 录';
    $('loginName').placeholder = isReg ? '设置用户名（2-12 个字符）' : '用户名（2-12 个字符）';
    $('loginPwd').placeholder = isReg ? '设置密码（至少 4 位）' : '密码（至少 4 位）';
    $('switchLink').textContent = isReg ? '已有账号？点上方「登录」' : '没有账号？点上方「注册」';
    $('loginErr').textContent = '';
    if (isReg) $('userList').classList.add('hidden');
    else renderUserList();
  }

  function showLogin() {
    $('appHeader').classList.add('hidden');
    $('appMain').classList.add('hidden');
    $('appNav').classList.add('hidden');
    $('login').classList.remove('hidden');
    $('loginPwd').value = '';
    $('loginPwd2').value = '';
    setAuthMode('login');
  }

  function showApp() {
    $('login').classList.add('hidden');
    $('appHeader').classList.remove('hidden');
    $('appMain').classList.remove('hidden');
    $('appNav').classList.remove('hidden');
  }

  function renderUserList() {
    var idx = usersIdx();
    var names = Object.keys(idx.users);
    var box = $('userList');
    if (!names.length || authMode === 'reg') { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.innerHTML = '';
    names.forEach(function (n) {
      var it = document.createElement('button');
      it.className = 'uitem';
      it.textContent = n;
      it.onclick = function () {
        setAuthMode('login');
        $('loginName').value = n;
        $('loginPwd').focus();
        box.querySelectorAll('.uitem').forEach(function (x) { x.classList.remove('sel'); });
        it.classList.add('sel');
      };
      box.appendChild(it);
    });
  }

  function loginError(msg) { $('loginErr').textContent = msg; }

  function validNamePwd(name, pwd) {
    if (name.length < 2 || name.length > 12) { loginError('用户名需 2-12 个字符'); return false; }
    if (pwd.length < 4) { loginError('密码至少 4 位'); return false; }
    return true;
  }

  function doLogin() {
    var name = $('loginName').value.trim();
    var pwd = $('loginPwd').value;
    var idx = usersIdx();
    if (!validNamePwd(name, pwd)) return;
    var u = idx.users[name];
    if (!u) return loginError('用户「' + name + '」不存在，请点上方「注册」');
    if (hashPwd(pwd, u.salt) !== u.hash) return loginError('密码不正确，请重试');
    idx.current = name;
    saveJSON(USERS_KEY, idx);
    enterApp(name);
  }

  function doRegister() {
    var name = $('loginName').value.trim();
    var pwd = $('loginPwd').value;
    var pwd2 = $('loginPwd2').value;
    var idx = usersIdx();
    if (!validNamePwd(name, pwd)) return;
    if (pwd !== pwd2) return loginError('两次输入的密码不一致');
    if (idx.users[name]) return loginError('用户名「' + name + '」已被注册，请直接登录');
    var salt = 's' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    idx.users[name] = { salt: salt, hash: hashPwd(pwd, salt), created: Date.now() };
    idx.current = name;
    saveJSON(USERS_KEY, idx);
    enterApp(name);
  }

  function doAuth() { if (authMode === 'reg') doRegister(); else doLogin(); }

  function enterApp(name) {
    USER = name;
    loadState(name);
    saveState();
    showApp();
    bindOnce();
    show('home');
  }

  var bound = false;
  function bindOnce() {
    if (bound) return;
    bound = true;
    document.querySelectorAll('[data-go]').forEach(function (b) {
      b.onclick = function () { startGame(b.getAttribute('data-go')); };
    });
    document.querySelectorAll('nav button').forEach(function (b) {
      b.onclick = function () { show(b.getAttribute('data-nav')); };
    });
    $('wrongStart').onclick = function () { startGame('wrong'); };
    bindSet();
  }

  // 登录页控件在启动时即绑定（首次使用可能停留在登录页）
  function bindLogin() {
    $('loginBtn').onclick = doAuth;
    $('tabLogin').onclick = function () { setAuthMode('login'); };
    $('tabReg').onclick = function () { setAuthMode('reg'); };
    $('loginPwd').onkeydown = function (e) { if (e.key === 'Enter') doAuth(); };
    $('loginPwd2').onkeydown = function (e) { if (e.key === 'Enter') doAuth(); };
    $('switchLink').onclick = function () {
      setAuthMode(authMode === 'reg' ? 'login' : 'reg');
      $('loginName').value = '';
      $('loginPwd').value = '';
      $('loginPwd2').value = '';
      $('loginName').focus();
    };
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    bindLogin();
    var idx = usersIdx();
    var cur = idx.current;
    if (cur && idx.users[cur]) enterApp(cur);
    else showLogin();
  }

  // 暴露少量句柄便于端到端测试
  window.__WG = {
    get state() { return state; },
    get user() { return USER; },
    get game() { return game; },
    show: show, startGame: startGame, checkAnswer: checkAnswer,
    levelOf: levelOf, hashPwd: hashPwd, doLogin: doLogin, doRegister: doRegister, setAuthMode: setAuthMode
  };

  boot();
})();

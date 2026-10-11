/* ============================================================
   墨卷 · 行测真题在线刷题
   原生 JS，零依赖；数据来自 data/（由 ERRRC/xingcezhenti 解析）
   ============================================================ */
'use strict';

/* ---------------- 工具 ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stripHtml = (h) => {
  const d = document.createElement('div');
  d.innerHTML = h || '';
  return (d.textContent || '').replace(/\s+/g, ' ').trim();
};
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtClock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const fmtDur = (s) => s >= 3600 ? `${Math.floor(s / 3600)}小时${Math.round((s % 3600) / 60)}分` : `${Math.round(s / 60)}分钟`;
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TYPE_NAME = { single: '单选题', multi: '多选题', judge: '判断题' };

/* ---------------- 本地存储 ---------------- */
const K = (k) => `xz1:${k}`;
const Store = {
  get(k, d) { try { const v = localStorage.getItem(K(k)); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(K(k), JSON.stringify(v)); } catch {} },
  get settings() { return this.get('settings', {}); },
  set settings(v) { this.set('settings', v); },
  get records() { return this.get('records', {}); },
  set records(v) { this.set('records', v); },
  get fav() { return this.get('fav', {}); },
  set fav(v) { this.set('fav', v); },
  get sessions() { return this.get('sessions', {}); },
  set sessions(v) { this.set('sessions', v); },
  get daily() { return this.get('daily', {}); },
  set daily(v) { this.set('daily', v); },
  get lastKey() { return this.get('lastKey', null); },
  set lastKey(v) { this.set('lastKey', v); },

  grade(qid, ok, m, tag, paper, txt, pid) {
    const r = this.records;
    const rec = r[qid] || { m, tag, n: 0, c: 0, last: 0, ts: 0, paper: '', txt: '', pid: '' };
    rec.m = m; rec.tag = tag;
    if (paper) rec.paper = paper;
    if (txt) rec.txt = txt;
    if (pid) rec.pid = pid;
    rec.n += 1; rec.c += ok ? 1 : 0; rec.last = ok ? 1 : 0; rec.ts = Date.now();
    r[qid] = rec; this.records = r;
    return rec;
  },
  dailyBump(done, correct) {
    const d = this.daily, k = dayKey();
    d[k] = d[k] || { d: 0, c: 0 };
    d[k].d += done; d[k].c += correct;
    this.daily = d;
  },
  toggleFav(on, q, ref) {
    const f = this.fav;
    if (on) f[q.qid] = { pid: ref.pid, n: ref.n, m: ref.m, paper: ref.paper, tag: q.tag, txt: stripHtml(q.stem).slice(0, 90) };
    else delete f[q.qid];
    this.fav = f;
  },
  wrongs() {
    return Object.entries(this.records).filter(([, r]) => r.last === 0).map(([qid, r]) => ({ qid, ...r }));
  },
  saveSession(s) {
    const all = this.sessions; all[s.key] = s; this.sessions = all; this.lastKey = s.key;
  },
  getSession(key) { return this.sessions[key] || null; },
  delSession(key) { const all = this.sessions; delete all[key]; this.sessions = all; },
};

/* ---------------- 数据加载 ---------------- */
const Data = {
  idx: null,
  pCache: new Map(),
  tCache: new Map(),
  async index() {
    if (!this.idx) this.idx = await fetch('data/index.json').then((r) => r.json());
    return this.idx;
  },
  async paper(id) {
    if (!this.pCache.has(id)) this.pCache.set(id, fetch(`data/papers/${id}.json`).then((r) => r.json()));
    return this.pCache.get(id);
  },
  async tags(m) {
    if (!this.tCache.has(m)) this.tCache.set(m, fetch(`data/tags/m${m}.json`).then((r) => r.json()));
    return this.tCache.get(m);
  },
  flat(p) {
    if (!p._flat) {
      p._flat = [];
      p.groups.forEach((g, gi) => g.qs.forEach((q) => p._flat.push({ ...q, gi })));
    }
    return p._flat;
  },
  findQ(p, n) { return this.flat(p).find((q) => q.n === n); },
};

/* ---------------- 会话 ---------------- */
const Sess = {
  async fromPaper(paper, mode, examMins) {
    const items = Data.flat(paper).map((q) => ({ pid: paper.id, n: q.n, gi: q.gi, qid: q.qid }));
    const s = {
      key: `paper:${paper.id}`, kind: 'paper', mode,
      title: paper.paper, pid: paper.id,
      items, answers: {}, pos: 0,
      startTs: Date.now(), submitted: false, examMins: mode === 'exam' ? examMins : 0,
    };
    return s;
  },
  async custom({ ms, tag, n, order, mode, onlyNew, kind = 'random' }) {
    const recs = Store.records;
    const pool = [];
    if (tag) {
      for (const m of ms) {
        const t = await Data.tags(m);
        for (const [pid, qn] of (t[tag] || [])) pool.push({ pid, n: qn });
      }
    } else {
      const idx = await Data.index();
      let papers = idx.papers.filter((p) => ms.includes(p.m));
      if (order === 'recent') papers.sort((a, b) => (b.year || 0) - (a.year || 0));
      else shuffle(papers);
      let loaded = 0;
      for (const meta of papers) {
        if (pool.length >= n * 3 && order === 'random') break;
        if (loaded >= 12) break;
        const p = await Data.paper(meta.id);
        for (const q of Data.flat(p)) {
          if (onlyNew && recs[q.qid]) continue;
          pool.push({ pid: p.id, n: q.n, gi: q.gi });
        }
        loaded++;
      }
    }
    if (order === 'random') shuffle(pool);
    const seen = new Set();
    const items = [];
    for (const it of pool) {
      const p = await Data.paper(it.pid);
      const q = Data.findQ(p, it.n);
      if (!q || seen.has(q.qid)) continue;
      if (onlyNew && recs[q.qid]) continue;
      seen.add(q.qid);
      items.push({ pid: it.pid, n: it.n, gi: q.gi, qid: q.qid });
      if (items.length >= n) break;
    }
    const key = `c:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    return {
      key, kind, mode, title: kind === 'wrong' ? '错题重练' : kind === 'fav' ? '收藏题练习' : '随机练习',
      pid: null, items, answers: {}, pos: 0,
      startTs: Date.now(), submitted: false, examMins: 0,
      cfg: { ms, tag, n, order, onlyNew },
    };
  },
  async fromRefs(refs, kind) {
    const items = [];
    const seen = new Set();
    for (const r of refs) {
      if (seen.has(r.qid)) continue;
      seen.add(r.qid);
      items.push({ pid: r.pid, n: r.n, qid: r.qid });
    }
    return {
      key: `c:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      kind, mode: 'practice', title: kind === 'wrong' ? '错题重练' : '收藏题练习',
      pid: null, items, answers: {}, pos: 0,
      startTs: Date.now(), submitted: false, examMins: 0,
    };
  },
};

/* ---------------- 通用 UI ---------------- */
const view = $('#view');
let rerender = () => {};
const toastEl = $('#toast');
let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}
function loading() { view.innerHTML = '<div class="loading"><div class="spinner"></div></div>'; }

function modalConfirm({ title, body, ok = '确认', danger = false }) {
  return new Promise((resolve) => {
    const root = $('#overlayRoot');
    const el = document.createElement('div');
    el.innerHTML = `
      <div class="sheet-mask open"></div>
      <div class="sheet open" style="right:auto;left:50%;transform:translate(-50%,0);top:50%;bottom:auto;width:min(380px,92vw);border-radius:16px;">
        <div class="sheet-head"><h3>${esc(title)}</h3></div>
        <div class="sheet-body" style="overflow:visible;">
          <p style="margin:0 0 20px;color:var(--ink-2);font-size:14px;line-height:1.8;">${body}</p>
          <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button class="btn btn-sm" data-act="cancel">取消</button>
            <button class="btn btn-sm ${danger ? 'btn-accent' : 'btn-primary'}" data-act="ok">${esc(ok)}</button>
          </div>
        </div>
      </div>`;
    const close = (v) => { el.remove(); resolve(v); };
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="ok"]')) close(true);
      if (e.target.closest('[data-act="cancel"]') || e.target.classList.contains('sheet-mask')) close(false);
    });
    root.appendChild(el);
  });
}

function enhanceImages() {
  $$('img', view).forEach((img) => {
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => { img.style.visibility = 'hidden'; }, { once: true });
    img.addEventListener('click', () => {
      if (!img.src) return;
      const m = document.createElement('div');
      m.className = 'img-modal open';
      m.innerHTML = `<img src="${esc(img.src)}" alt="题目图片">`;
      m.addEventListener('click', () => m.remove());
      $('#overlayRoot').appendChild(m);
    });
  });
}

/* ---------------- 路由 ---------------- */
const routes = {};
async function router() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, queryStr] = hash.split('?');
  const parts = path.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryStr || ''));
  $$('.nav a').forEach((a) => {
    const n = a.dataset.nav;
    a.classList.toggle('active',
      (!parts[0] && n === 'home') || parts[0] === n || (parts[0] === 'paper' && n === 'browse'));
  });
  const name = parts[0] || 'home';
  const fn = routes[name] || routes.notfound;
  Run.stopTimer();
  window.scrollTo(0, 0);
  loading();
  try {
    await Data.index(); // 所有视图都依赖题库索引，路由层统一预加载
    await fn(parts.slice(1), query);
  }
  catch (e) {
    console.error(e);
    view.innerHTML = `<div class="empty"><div class="big">⚠️</div><div class="t">页面加载失败</div>
      <div class="d">${esc(e.message || e)}</div>
      <a class="btn btn-primary" href="#/">返回首页</a></div>`;
  }
  updateNavBadge();
}
window.addEventListener('hashchange', router);

/* ---------------- 首页 ---------------- */
routes.home = async () => {
  rerender = () => routes.home();
  const idx = await Data.index();
  const recs = Store.records, fav = Store.fav, daily = Store.daily;
  const doneQ = Object.keys(recs).length;
  let attempts = 0, correctCnt = 0;
  const modStat = Array.from({ length: 6 }, () => ({ n: 0, c: 0, t: 0 }));
  for (const r of Object.values(recs)) { attempts += r.n; correctCnt += r.c; if (modStat[r.m - 1]) { modStat[r.m - 1].n++; modStat[r.m - 1].c += r.c; modStat[r.m - 1].t += r.n; } }
  const acc = attempts ? Math.round(correctCnt / attempts * 100) : 0;
  const wrongN = Store.wrongs().length;

  // 连续打卡
  let streak = 0;
  for (let i = 0; i < 400; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    if ((daily[dayKey(d)]?.d || 0) > 0) streak++;
    else if (i === 0) continue;
    else break;
  }

  const last = Store.lastKey ? Store.getSession(Store.lastKey) : null;
  const lastAns = last ? Object.keys(last.answers).length : 0;
  const canContinue = last && (!last.submitted || lastAns > 0);

  view.innerHTML = `
  <div class="hero q-enter">
    <div class="eyebrow">2016 — 2026 · 国考 / 省考 / 联考</div>
    <h1>十年行测真题，<br>安安静静刷完它。</h1>
    <p class="lead">${idx.total.toLocaleString()} 道真题、515 套整卷（按六大模块拆为 ${idx.papers.length.toLocaleString()} 份练习卷），题干、选项、官方解析齐全。即时判分、错题自动归集，所有记录只存在你的浏览器里。</p>
  </div>

  <div class="stat-row">
    <div class="stat" title="按题目去重（同一题多次作答只计一次）"><div class="v tnum">${doneQ.toLocaleString()}</div><div class="l">已练题数</div></div>
    <div class="stat" title="总答对次数 ÷ 总作答次数"><div class="v tnum">${acc}%</div><div class="l">累计正确率</div></div>
    <div class="stat" title="最近一次作答错误的题"><div class="v tnum">${wrongN}</div><div class="l">错题本</div></div>
    <div class="stat" title="连续有做题记录的天数"><div class="v tnum">${streak} 天</div><div class="l">连续打卡</div></div>
  </div>

  ${canContinue ? `
  <a class="card continue-card q-enter" href="#/s/${encodeURIComponent(last.key)}">
    <div class="continue-info">
      <div class="t">${esc(last.title)}</div>
      <div class="s"><span class="chip">${last.mode === 'exam' ? '模考' : last.mode === 'read' ? '背题' : '练习'}</span>
      <span>${lastAns}/${last.items.length} 题 · ${last.submitted ? '已交卷，可回顾解析' : '进度已自动保存'}</span></div>
      <div class="progress"><i style="width:${Math.round(lastAns / last.items.length * 100)}%"></i></div>
    </div>
    <span class="chev">继续 →</span>
  </a>` : ''}

  <div class="section-title">快速开始</div>
  <div class="quick-row">
    <button class="card quick-card" data-act="go-practice">
      <span class="ico">✦</span>
      <span><span class="t">随机练习</span><span class="d">按模块 / 考点抽题，即时判分看解析</span></span>
    </button>
    <a class="card quick-card" href="#/browse">
      <span class="ico">卷</span>
      <span><span class="t">套卷刷题</span><span class="d">515 套整卷，按地区、年份筛选</span></span>
    </a>
  </div>

  <div class="section-title">六大模块</div>
  <div class="module-grid">
    ${idx.modules.map((m) => {
      const st = modStat[m.id - 1];
      const pct = Math.round(st.n / m.qs * 100);
      const macc = st.t ? Math.round(st.c / st.t * 100) : null;
      return `
      <button class="card module-card" data-act="module-practice" data-m="${m.id}">
        <span class="idx">${String(m.id).padStart(2, '0')}</span>
        <span class="name">${esc(m.name)}</span>
        <span class="meta">${m.papers} 套 · ${m.qs.toLocaleString()} 题${macc !== null ? ` · 正确率 ${macc}%` : ''}</span>
        <span class="pct"><span>${pct ? `已练 ${pct}%` : '未开始'}</span><span></span></span>
        <span class="progress"><i style="width:${pct}%"></i></span>
      </button>`;
    }).join('')}
  </div>`;

  enhanceImages();
};

/* ---------------- 套卷浏览 ---------------- */
const Br = { m: 0, y: 0, r: '', q: '', shown: 60 };
routes.browse = async () => {
  rerender = () => routes.browse();
  const idx = await Data.index();
  const years = [...new Set(idx.papers.map((p) => p.year).filter(Boolean))].sort((a, b) => b - a);
  const regions = [...new Set(idx.papers.map((p) => p.region))].sort();
  const sessions = Store.sessions;

  const list = idx.papers.filter((p) => {
    if (Br.m && p.m !== Br.m) return false;
    if (Br.y && p.year !== Br.y) return false;
    if (Br.r && p.region !== Br.r) return false;
    if (Br.q && !p.paper.includes(Br.q)) return false;
    return true;
  }).sort((a, b) => (b.year || 0) - (a.year || 0) || a.m - b.m);

  const shown = list.slice(0, Br.shown);

  view.innerHTML = `
  <div class="section-title" style="margin-top:0;">真题套卷 <span class="muted" style="font-weight:500;" title="源仓库按 515 套整卷收录，每套卷的六个模块各为一份练习文件，故共 2,956 份">共 ${list.length} 份模块卷 · 源自 515 套整卷</span></div>
  <div class="card filterbar">
    <div class="seg" role="tablist">
      <button data-act="bf" data-k="m" data-v="0" class="${Br.m === 0 ? 'on' : ''}">全部</button>
      ${idx.modules.map((m) => `<button data-act="bf" data-k="m" data-v="${m.id}" class="${Br.m === m.id ? 'on' : ''}">${esc(m.short)}</button>`).join('')}
    </div>
    <select class="select" data-act="bfy" aria-label="年份">
      <option value="0">全部年份</option>
      ${years.map((y) => `<option value="${y}" ${Br.y === y ? 'selected' : ''}>${y} 年</option>`).join('')}
    </select>
    <select class="select" data-act="bfr" aria-label="地区">
      <option value="">全部地区</option>
      ${regions.map((r) => `<option value="${esc(r)}" ${Br.r === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}
    </select>
    <div class="spacer"></div>
    <input class="input" id="brSearch" type="search" placeholder="搜索试卷名称…" value="${esc(Br.q)}" aria-label="搜索试卷">
  </div>

  <div class="paper-list">
    ${shown.map((p) => {
      const s = sessions[`paper:${p.id}`];
      const done = s ? Object.keys(s.answers).length : 0;
      const mod = idx.modules[p.m - 1];
      return `
      <a class="card paper-row" href="#/paper/${p.id}">
        <div class="paper-main">
          <div class="paper-title">${esc(p.paper)}</div>
          <div class="paper-meta">
            <span class="chip chip-accent">${esc(mod.short)}</span>
            <span class="chip">${p.year || '—'}</span>
            <span class="chip">${esc(p.region)}</span>
            <span class="muted" style="font-size:12.5px;">${p.q} 题${p.multi ? ` · 含 ${p.multi} 道多选` : ''}</span>
          </div>
        </div>
        ${done ? `<div class="paper-progress"><div class="pp">${done}/${p.q}</div><div class="progress"><i style="width:${Math.round(done / p.q * 100)}%"></i></div></div>` : ''}
        <span class="chev">›</span>
      </a>`;
    }).join('')}
  </div>
  ${list.length === 0 ? `<div class="empty"><div class="t">没有符合条件的试卷</div><div class="d">换个筛选条件试试</div></div>` : ''}
  ${list.length > Br.shown ? `<div style="text-align:center;margin-top:18px;"><button class="btn" data-act="br-more">加载更多（剩余 ${list.length - Br.shown} 套）</button></div>` : ''}`;

  $$('#brSearch').forEach((el) => {
    let timer;
    el.addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        Br.q = e.target.value.trim();
        Br.shown = 60;
        rerender();
        const ne = $('#brSearch');
        if (ne) { ne.focus(); ne.setSelectionRange(ne.value.length, ne.value.length); }
      }, 220);
    });
  });
};

/* ---------------- 试卷开始页 ---------------- */
const Pm = { mode: 'practice', mins: 120 };
routes.paper = async ([id]) => {
  rerender = () => routes.paper([id]);
  const idx = await Data.index();
  const p = await Data.paper(id);
  const meta = idx.papers.find((x) => x.id === id);
  const mod = idx.modules[p.m - 1];
  const existing = Store.getSession(`paper:${id}`);
  const done = existing ? Object.keys(existing.answers).length : 0;
  if (Pm._pid !== id) {
    Pm._pid = id; Pm.mode = 'practice';
    Pm.mins = p.q >= 100 ? 120 : p.q >= 30 ? 90 : 60;
  }

  view.innerHTML = `
  <div class="card paper-head q-enter">
    <div class="pm">
      <span class="chip chip-accent">${esc(mod.name)}</span>
      <span class="chip">${p.year || '—'} 年</span>
      <span class="chip">${esc(p.region)}</span>
      ${p.multi ? '<span class="chip">含多选题</span>' : ''}
    </div>
    <h1>${esc(p.paper)}</h1>
    <div class="muted" style="margin-top:10px;font-size:14px;">共 <b>${p.q}</b> 题 · ${p.groups.filter((g) => g.material).length} 组材料题 · 数据来源 ${esc(idx.source)}</div>

    ${existing ? `
    <div style="margin-top:18px;padding:14px 16px;border:1px solid var(--line);border-radius:11px;background:var(--surface-2);">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:700;font-size:14.5px;">${existing.submitted ? '已交卷' : `上次做到第 ${existing.pos + 1} 题`}</div>
          <div class="muted" style="font-size:12.5px;margin-top:2px;">已作答 ${done}/${p.q} 题</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-primary btn-sm" data-act="continue-paper">${existing.submitted ? '查看解析' : '继续刷题'}</button>
          <button class="btn btn-sm" data-act="reset-paper">重新开始</button>
        </div>
      </div>
      <div class="progress" style="margin-top:12px;"><i style="width:${Math.round(done / p.q * 100)}%"></i></div>
    </div>` : ''}

    <div class="section-title">选择模式</div>
    <div class="mode-grid">
      <button class="card mode-opt ${Pm.mode === 'practice' ? 'on' : ''}" data-act="pm" data-v="practice">
        <span class="mt">✓ 练习模式</span>
        <span class="md">选完立即判分，查看官方解析，适合日常刷题</span>
      </button>
      <button class="card mode-opt ${Pm.mode === 'exam' ? 'on' : ''}" data-act="pm" data-v="exam">
        <span class="mt">⏱ 模考模式</span>
        <span class="md">计时作答、交卷后统一判分，模拟考场节奏</span>
      </button>
      <button class="card mode-opt ${Pm.mode === 'read' ? 'on' : ''}" data-act="pm" data-v="read">
        <span class="mt">背题模式</span>
        <span class="md">答案与解析直接展示，快速过题、以看代练</span>
      </button>
    </div>
    ${Pm.mode === 'exam' ? `
    <div style="margin-top:14px;display:flex;align-items:center;gap:10px;font-size:13.5px;color:var(--ink-2);flex-wrap:wrap;">
      考试时长
      <div class="seg">
        ${[60, 90, 120, 150].map((m) => `<button class="${Pm.mins === m ? 'on' : ''}" data-act="pm-mins" data-v="${m}">${m} 分钟</button>`).join('')}
        <button class="${Pm.mins === 0 ? 'on' : ''}" data-act="pm-mins" data-v="0">不限时</button>
      </div>
    </div>` : ''}

    <div style="margin-top:22px;display:flex;gap:10px;">
      <button class="btn btn-accent btn-lg" style="flex:1;" data-act="start-paper">${existing && !existing.submitted && Pm.mode === existing.mode ? '继续这套卷' : '开始刷题'}</button>
    </div>
  </div>`;
};

/* ---------------- 练习配置 ---------------- */
const Cfg = { ms: new Set([1, 2, 3, 4, 5, 6]), tag: '', n: 20, order: 'random', mode: 'practice', onlyNew: false };
routes.practice = async (_, query) => {
  rerender = () => routes.practice(_, query);
  const idx = await Data.index();
  if (query.m) { Cfg.ms = new Set([+query.m]); }
  // 考点列表
  const tagCount = new Map();
  for (const m of Cfg.ms) {
    const t = await Data.tags(m);
    for (const [name, locs] of Object.entries(t)) tagCount.set(name, (tagCount.get(name) || 0) + locs.length);
  }
  const tags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]);
  if (Cfg.tag && !tagCount.has(Cfg.tag)) Cfg.tag = '';

  view.innerHTML = `
  <div class="section-title" style="margin-top:0;">配置练习</div>
  <div class="card config-card q-enter">
    <div class="field">
      <label class="fl">模块（可多选）</label>
      <div class="opt-grid">
        ${idx.modules.map((m) => `<button class="opt ${Cfg.ms.has(m.id) ? 'on' : ''}" data-act="cfg-m" data-v="${m.id}">${esc(m.short)} <span class="muted">${m.qs.toLocaleString()}</span></button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label class="fl">考点大类</label>
      <div class="opt-grid">
        <button class="opt ${!Cfg.tag ? 'on' : ''}" data-act="cfg-tag" data-v="">不限考点</button>
        ${tags.slice(0, 20).map(([t, c]) => `<button class="opt ${Cfg.tag === t ? 'on' : ''}" data-act="cfg-tag" data-v="${esc(t)}">${esc(t)} <span class="muted">${c}</span></button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label class="fl">题量</label>
      <div class="seg">
        ${[10, 20, 30, 50].map((n) => `<button class="${Cfg.n === n ? 'on' : ''}" data-act="cfg-n" data-v="${n}">${n} 题</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label class="fl">顺序</label>
      <div class="seg">
        <button class="${Cfg.order === 'random' ? 'on' : ''}" data-act="cfg-order" data-v="random">随机抽题</button>
        <button class="${Cfg.order === 'recent' ? 'on' : ''}" data-act="cfg-order" data-v="recent">近年优先</button>
      </div>
    </div>
    <div class="field">
      <label class="fl">模式</label>
      <div class="seg">
        <button class="${Cfg.mode === 'practice' ? 'on' : ''}" data-act="cfg-mode" data-v="practice">练习（即时判分）</button>
        <button class="${Cfg.mode === 'read' ? 'on' : ''}" data-act="cfg-mode" data-v="read">背题（直接看答案）</button>
      </div>
    </div>
    <div class="field" style="margin-bottom:6px;">
      <label class="check-row"><input type="checkbox" id="cfgOnlyNew" ${Cfg.onlyNew ? 'checked' : ''}> 只练未做过的题</label>
    </div>
  </div>
  <button class="btn btn-accent btn-lg btn-block" data-act="build-practice">开始练习 →</button>`;

  $('#cfgOnlyNew').addEventListener('change', (e) => { Cfg.onlyNew = e.target.checked; });
};

/* ---------------- 做题引擎 ---------------- */
const Run = {
  sess: null, papers: new Map(), pending: [], timerId: null, sheetOpen: false,

  async load(key, seekQid) {
    const s = Store.getSession(key);
    if (!s) { location.hash = '#/'; return null; }
    this.sess = s;
    this.papers = new Map();
    await Promise.all([...new Set(s.items.map((i) => i.pid))].map(async (pid) => {
      this.papers.set(pid, await Data.paper(pid));
    }));
    // 回填 gi / qid（兼容旧会话）
    for (const it of s.items) {
      if (it.gi === undefined || it.qid === undefined) {
        const p = this.papers.get(it.pid);
        const q = Data.findQ(p, it.n);
        if (q) { it.gi = q.gi; it.qid = q.qid; }
        else it.gi = 0;
      }
    }
    if (seekQid !== undefined) {
      const idx = s.items.findIndex((i) => String(i.qid) === String(seekQid));
      if (idx >= 0) s.pos = idx;
    }
    return s;
  },
  item(i = this.sess.pos) { return this.sess.items[i]; },
  question(i = this.sess.pos) {
    const it = this.item(i);
    return Data.findQ(this.papers.get(it.pid), it.n);
  },
  revealed(i = this.sess.pos) {
    const s = this.sess;
    if (s.mode === 'read') return true;
    if (s.submitted) return true;
    return !!s.answers[i] && s.mode === 'practice';
  },
  answeredCount() { return Object.keys(this.sess.answers).length; },

  grade(i, chosen) {
    const s = this.sess, q = this.question(i);
    const p = this.papers.get(this.item(i).pid);
    const ok = chosen.length === q.ans.length && chosen.every((k) => q.ans.includes(k));
    s.answers[i] = { a: chosen, ok, t: Date.now() };
    Store.grade(q.qid, ok, p.m, q.tag, p.paper, stripHtml(q.stem).slice(0, 90), this.item(i).pid);
    Store.dailyBump(1, ok ? 1 : 0);
    Store.saveSession(s);
    updateNavBadge();
    return ok;
  },
  // 模考只记录选择，不判分
  setExamPick(i, chosen) {
    const s = this.sess;
    s.answers[i] = { a: chosen, ok: null, t: Date.now() };
    Store.saveSession(s);
  },
  async submitExam() {
    const s = this.sess;
    let correct = 0;
    for (let i = 0; i < s.items.length; i++) {
      const a = s.answers[i];
      if (!a) continue;
      const q = this.question(i);
      const p = this.papers.get(this.item(i).pid);
      const ok = a.a.length === q.ans.length && a.a.every((k) => q.ans.includes(k));
      a.ok = ok;
      if (ok) correct++;
      Store.grade(q.qid, ok, p.m, q.tag, p.paper, stripHtml(q.stem).slice(0, 90), s.items[i].pid);
    }
    const done = Object.keys(s.answers).length;
    Store.dailyBump(done, correct);
    s.submitted = true;
    s.endTs = Date.now();
    Store.saveSession(s);
  },

  startTimer() {
    this.stopTimer();
    const el = $('#runTimer');
    const tick = () => {
      if (!el || !this.sess) return;
      const elapsed = Math.floor((Date.now() - this.sess.startTs) / 1000);
      if (this.sess.mode === 'exam' && this.sess.examMins > 0) {
        const left = this.sess.examMins * 60 - elapsed;
        if (left <= 0) {
          el.textContent = '00:00';
          el.classList.add('danger');
          this.stopTimer();
          this.timeUp();
          return;
        }
        el.textContent = fmtClock(left);
        el.classList.toggle('danger', left < 300);
      } else {
        el.textContent = fmtClock(elapsed);
      }
    };
    tick();
    this.timerId = setInterval(tick, 1000);
  },
  stopTimer() { if (this.timerId) { clearInterval(this.timerId); this.timerId = null; } },
  async timeUp() {
    toast('考试时间到，自动交卷');
    await this.submitExam();
    location.hash = `#/result/${encodeURIComponent(this.sess.key)}`;
  },
};

routes.s = async ([key], query) => {
  rerender = () => routes.s([key], query);
  const s = await Run.load(decodeURIComponent(key), query.qid);
  if (!s) return;
  Run.pending = (s.answers[s.pos]?.a || []).slice();
  renderRun();
};

function renderRun() {
  const s = Run.sess;
  const i = s.pos;
  const item = Run.item();
  const paper = Run.papers.get(item.pid);
  const q = Run.question();
  const ans = s.answers[i];
  const revealed = Run.revealed();
  const isFav = !!Store.fav[q.qid];
  const prevItem = s.items[i - 1];
  const showMaterial = q.gi >= 0 && paper.groups[q.gi]?.material;
  const firstInGroup = !prevItem || prevItem.pid !== item.pid || prevItem.gi !== item.gi;
  const modeLabel = { practice: '练习', exam: '模考', read: '背题' }[s.mode];
  const picked = revealed ? (ans?.a || []) : (s.mode === 'exam' ? (ans?.a || []) : Run.pending);

  view.innerHTML = `
  <div class="runbar">
    <button class="btn-text exit" data-act="run-exit" title="返回">←</button>
    <div class="rt">
      <div class="t">${esc(s.title)}</div>
      <div class="s">${modeLabel}模式 · 第 ${i + 1} / ${s.items.length} 题${s.submitted ? ' · 已交卷回顾' : ''}</div>
    </div>
    <div class="timer" id="runTimer" title="${s.submitted ? '本次用时' : '已用时间'}">${s.submitted ? fmtClock(Math.max(1, Math.floor(((s.endTs || Date.now()) - s.startTs) / 1000))) : '00:00'}</div>
    <button class="btn btn-sm" data-act="toggle-sheet">题号 ${Run.answeredCount()}/${s.items.length}</button>
    ${s.mode === 'exam' && !s.submitted ? '<button class="btn btn-accent btn-sm" data-act="want-submit">交卷</button>' : ''}
  </div>

  <div class="q-enter" key="${i}">
    ${showMaterial ? `
    <div class="material ${firstInGroup ? 'is-first' : 'is-collapsed'}">
      <div class="material-head" data-act="toggle-mat">
        <span>材料 ${q.gi + 1} · 本组 ${paper.groups[q.gi].qs.length} 题</span>
        <span class="chev2">▾</span>
      </div>
      <div class="material-body rich">${paper.groups[q.gi].material}</div>
    </div>` : ''}

    <div class="q-meta">
      <span class="q-no">${i + 1}<small>${TYPE_NAME[q.type]}${q.tag ? ` · ${esc(q.tag)}` : ''}</small></span>
      ${q.type === 'multi' && !revealed ? '<span class="chip">选择全部正确项后确认</span>' : ''}
      ${q.inferred ? '<span class="chip" title="原题答案缺失，依据官方解析结论推断">答案为推断</span>' : ''}
    </div>

    <div class="q-stem rich">${q.stem || '<span class="muted">（题干缺失）</span>'}</div>

    <div class="options" role="group" aria-label="选项">
      ${q.opts.map((o) => {
        const isPicked = picked.includes(o.k);
        const isAns = q.ans.includes(o.k);
        let cls = 'option';
        if (revealed) {
          cls += ' locked';
          if (isAns) cls += ' is-correct';
          else if (isPicked) cls += ' is-wrong';
        } else if (isPicked) cls += ' picked';
        const mark = revealed ? (isAns ? '<span class="mark">✓</span>' : isPicked ? '<span class="mark">✕</span>' : '') : '';
        return `<button class="${cls}" data-act="pick" data-k="${o.k}" ${revealed ? 'tabindex="-1"' : ''}>
          <span class="key">${o.k}</span><span class="ot rich">${o.t}</span>${mark}</button>`;
      }).join('')}
    </div>

    ${q.type === 'multi' && !revealed && s.mode === 'practice' ? `
    <div class="q-actions">
      <span class="sp"></span>
      <button class="btn btn-accent" data-act="confirm-multi" ${Run.pending.length ? '' : 'disabled'}>确认提交（${Run.pending.length} 项）</button>
    </div>` : ''}

    ${revealed ? renderFeedback(q, ans, s) : `
    <div class="answer-strip idle"><span>作答后显示${s.mode === 'exam' ? '（交卷后统一判分）' : '答案与官方解析'}</span></div>`}
  </div>

  <div class="run-dock">
    <button class="btn" data-act="run-prev" ${i === 0 ? 'disabled' : ''}>← 上一题</button>
    <button class="btn btn-ghost fav-btn ${isFav ? 'on' : ''}" data-act="toggle-fav">${isFav ? '★ 已收藏' : '☆ 收藏'}</button>
    <span class="sp"></span>
    ${i === s.items.length - 1 && s.mode === 'exam' && !s.submitted
      ? '<button class="btn btn-accent" data-act="want-submit">交卷</button>'
      : `<button class="btn btn-primary" data-act="run-next">${i === s.items.length - 1 ? '已是最后一题' : '下一题 →'}</button>`}
  </div>`;

  if (!s.submitted) Run.startTimer(); else Run.stopTimer();
  enhanceImages();
  renderSheet();
}

function renderFeedback(q, ans, s) {
  const ok = ans?.ok;
  const stripCls = ok === true ? 'ok' : ok === false ? 'no' : 'idle';
  const label = ok === true ? '回答正确' : ok === false ? '回答错误' : '未作答';
  const yourAns = ans?.a?.length ? ans.a.join('') : '—';
  return `
  <div class="answer-strip ${stripCls}">
    <span>${label}</span>
    <span class="sp"></span>
    <span>你选 <span class="ans-keys">${yourAns}</span></span>
    <span style="opacity:.5">|</span>
    <span>正确答案 <span class="ans-keys">${q.ans.join('')}</span></span>
  </div>
  <div class="analysis">
    <div class="analysis-head">官方解析</div>
    <div class="analysis-body rich">${q.analysis || '（暂无解析）'}</div>
  </div>`;
}

function renderSheet() {
  const root = $('#overlayRoot');
  $('#runSheetWrap')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'runSheetWrap';
  const s = Run.sess;
  const fav = Store.fav;
  wrap.innerHTML = `
  <div class="sheet-mask ${Run.sheetOpen ? 'open' : ''}" data-act="toggle-sheet"></div>
  <div class="sheet ${Run.sheetOpen ? 'open' : ''}" role="dialog" aria-label="题号面板">
    <div class="sheet-head">
      <h3>全部题目</h3>
      <div class="sub">${Run.answeredCount()} 已答 · ${s.items.length} 题 · 点击题号跳转</div>
    </div>
    <div class="sheet-body">
      <div class="qgrid">
        ${s.items.map((it, idx) => {
          const a = s.answers[idx];
          const q = Data.findQ(Run.papers.get(it.pid), it.n);
          let cls = 'qg';
          if (Run.revealed(idx) && a) cls += a.ok ? ' ok' : ' no';
          if (idx === s.pos) cls += ' cur';
          if (q && fav[q.qid]) cls += ' fav';
          return `<button class="${cls}" data-act="jump" data-i="${idx}" title="第 ${idx + 1} 题">${idx + 1}</button>`;
        }).join('')}
      </div>
      <div class="legend">
        <span><i class="lg-ok"></i>答对</span>
        <span><i class="lg-no"></i>答错</span>
        <span><i class="lg-none"></i>未答</span>
        <span><i style="background:var(--accent);border-radius:50%;width:7px;height:7px;"></i>收藏</span>
      </div>
      ${s.mode === 'exam' && !s.submitted ? `<button class="btn btn-accent btn-block" style="margin-top:18px;" data-act="want-submit">交卷并查看结果</button>` : ''}
    </div>
  </div>`;
  root.appendChild(wrap);
}

/* ---------------- 结果页 ---------------- */
routes.result = async ([key]) => {
  rerender = () => routes.result([key]);
  const s = await Run.load(decodeURIComponent(key));
  if (!s) return;
  let correct = 0, answered = 0;
  const tagStat = {};
  for (let i = 0; i < s.items.length; i++) {
    const a = s.answers[i];
    const q = Run.question(i);
    if (!q) continue;
    if (a) { answered++; if (a.ok) correct++; }
    const tg = q.tag || '其他';
    tagStat[tg] = tagStat[tg] || { n: 0, c: 0 };
    tagStat[tg].n++; if (a?.ok) tagStat[tg].c++;
  }
  const acc = answered ? Math.round(correct / answered * 100) : 0;
  const blank = s.items.length - answered;
  const elapsed = Math.max(1, Math.floor(((s.endTs || Date.now()) - s.startTs) / 1000));
  const R = 2 * Math.PI * 62;
  const wrongItems = s.items.map((it, i) => ({ it, i, a: s.answers[i] })).filter((x) => x.a && !x.a.ok);

  view.innerHTML = `
  <div class="card result-hero q-enter">
    <div class="result-ring">
      <svg width="148" height="148" viewBox="0 0 148 148">
        <circle class="ring-bg" cx="74" cy="74" r="62" fill="none" stroke-width="9"/>
        <circle class="ring-fg" cx="74" cy="74" r="62" fill="none" stroke-width="9" stroke-linecap="round"
          stroke-dasharray="${R}" stroke-dashoffset="${R * (1 - acc / 100)}"/>
      </svg>
      <div class="rv">${acc}<small>%</small></div>
    </div>
    <div class="rt2">${acc >= 80 ? '发挥出色' : acc >= 60 ? '稳扎稳打' : '继续加油'}</div>
    <div class="rs">${esc(s.title)}</div>
    <div class="result-stats">
      <div class="rs2"><div class="v">${correct}</div><div class="l">答对</div></div>
      <div class="rs2"><div class="v" style="color:var(--bad)">${answered - correct}</div><div class="l">答错</div></div>
      <div class="rs2"><div class="v" style="color:var(--ink-3)">${blank}</div><div class="l">未答</div></div>
      <div class="rs2"><div class="v">${fmtDur(elapsed)}</div><div class="l">用时</div></div>
    </div>
    <div style="display:flex;gap:10px;margin-top:22px;">
      <a class="btn btn-primary" style="flex:1;" href="#/s/${encodeURIComponent(s.key)}">${s.submitted ? '查看全部解析' : '回顾试卷'}</a>
      ${wrongItems.length ? '<button class="btn btn-accent" style="flex:1;" data-act="retry-wrong">错题重练</button>' : ''}
    </div>
  </div>

  <div class="section-title">考点表现</div>
  <div class="card" style="padding:20px 22px;">
    <div class="bars">
      ${Object.entries(tagStat).sort((a, b) => a[1].c / a[1].n - b[1].c / b[1].n).map(([t, v]) => {
        const p = Math.round(v.c / v.n * 100);
        return `<div class="bar-row">
          <span>${esc(t)}</span>
          <span class="track"><i class="${p < 60 ? 'weak' : ''}" style="width:${p}%"></i></span>
          <span class="bp">${v.c}/${v.n} · ${p}%</span>
        </div>`;
      }).join('')}
    </div>
  </div>`;
  Run.stopTimer();
  enhanceImages();
};

/* ---------------- 错题本 / 收藏 ---------------- */
routes.wrong = async () => {
  rerender = () => routes.wrong();
  const idx = await Data.index();
  const all = Store.wrongs().sort((a, b) => b.ts - a.ts);
  view.innerHTML = listPage({
    title: '错题本', emptyT: '还没有错题', emptyD: '练习中答错的题会自动收集到这里',
    list: all, total: all.length, practiceAct: 'practice-wrong',
  });
  enhanceImages();
};

routes.fav = async () => {
  rerender = () => routes.fav();
  await Data.index();
  const all = Object.entries(Store.fav).map(([qid, v]) => ({ qid, ...v, last: 1 }));
  view.innerHTML = listPage({
    title: '我的收藏', emptyT: '还没有收藏题目', emptyD: '做题时点星标，重点题随时回来',
    list: all, total: all.length, practiceAct: 'practice-fav',
  });
  enhanceImages();
};

function listPage({ title, emptyT, emptyD, list, total, practiceAct }) {
  const idx = Data.idx;
  const byM = new Map();
  for (const r of list) { if (!byM.has(r.m)) byM.set(r.m, []); byM.get(r.m).push(r); }
  const head = `
  <div class="section-title" style="margin-top:0;justify-content:space-between;">
    <span>${title} <span class="muted" style="font-weight:500;">${total} 题</span></span>
    ${total ? `<button class="btn btn-sm btn-accent" data-act="${practiceAct}">开始${title.includes('错') ? '错题' : '收藏'}重练</button>` : ''}
  </div>`;
  if (!total) return `${head}<div class="card empty"><div class="big">${title.includes('错') ? '✓' : '☆'}</div><div class="t">${emptyT}</div><div class="d">${emptyD}</div><a class="btn btn-primary" href="#/practice">去刷题</a></div>`;
  return head + [...byM.entries()].sort((a, b) => a[0] - b[0]).map(([m, rs]) => `
    <div class="group-head">${esc(idx.modules[m - 1].name)} · ${rs.length} 题</div>
    ${rs.slice(0, 200).map((r) => `
    <div class="card qitem">
      <div class="qitem-top">
        <span class="chip">${esc(r.tag || '')}</span>
        <span class="chip">${esc(r.paper || '随机练习')}</span>
      </div>
      <div class="qitem-stem rich">${esc(r.txt || '（题干含图片，请打开查看）')}</div>
      <div class="qitem-act">
        ${r.pid ? `<button class="btn btn-sm btn-primary" data-act="locate" data-pid="${esc(r.pid)}" data-qid="${r.qid}">定位到原题</button>`
                 : `<button class="btn btn-sm" disabled title="旧版记录缺少来源信息，无法定位">无法定位</button>`}
        ${title.includes('错') ? `<button class="btn btn-sm" data-act="remove-wrong" data-qid="${r.qid}">移出错题本</button>`
                              : `<button class="btn btn-sm" data-act="remove-fav" data-qid="${r.qid}">取消收藏</button>`}
      </div>
    </div>`).join('')}
    ${rs.length > 200 ? `<div class="muted" style="font-size:12.5px;padding:6px 2px;">仅显示前 200 题</div>` : ''}
  `).join('');
}

/* ---------------- 统计 ---------------- */
routes.stats = async () => {
  rerender = () => routes.stats();
  const idx = await Data.index();
  const recs = Store.records, daily = Store.daily, fav = Store.fav;
  let attempts = 0, correct = 0;
  const ms = Array.from({ length: 6 }, () => ({ u: 0, n: 0, c: 0 }));
  const tags = {};
  for (const [qid, r] of Object.entries(recs)) {
    attempts += r.n; correct += r.c;
    if (ms[r.m - 1]) { ms[r.m - 1].u++; ms[r.m - 1].n += r.n; ms[r.m - 1].c += r.c; }
    const t = r.tag || '其他';
    tags[t] = tags[t] || { n: 0, c: 0 }; tags[t].n += r.n; tags[t].c += r.c;
  }
  const acc = attempts ? Math.round(correct / attempts * 100) : 0;
  const days = Object.entries(daily).filter(([, v]) => v.d > 0).length;

  const days14 = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days14.push({ k: dayKey(d), v: daily[dayKey(d)]?.d || 0 }); }
  const maxV = Math.max(10, ...days14.map((d) => d.v));
  const weak = Object.entries(tags).filter(([, v]) => v.n >= 5).sort((a, b) => a[1].c / a[1].n - b[1].c / b[1].n).slice(0, 8);

  view.innerHTML = `
  <div class="section-title" style="margin-top:0;">学习统计</div>
  <div class="stat-row" style="grid-template-columns:repeat(4,1fr);">
    <div class="stat"><div class="v">${Object.keys(recs).length.toLocaleString()}</div><div class="l">做过的题</div></div>
    <div class="stat"><div class="v">${acc}%</div><div class="l">总正确率</div></div>
    <div class="stat"><div class="v">${days}</div><div class="l">打卡天数</div></div>
    <div class="stat"><div class="v">${Object.keys(fav).length}</div><div class="l">收藏</div></div>
  </div>

  <div class="section-title">近 14 天做题量</div>
  <div class="card" style="padding:18px 20px 12px;">
    <div class="heat">${days14.map((d) => {
      const lvl = d.v === 0 ? '' : d.v < maxV * 0.25 ? 'l1' : d.v < maxV * 0.5 ? 'l2' : d.v < maxV * 0.75 ? 'l3' : 'l4';
      return `<div class="d ${lvl}" title="${d.k}：${d.v} 题" style="height:${Math.max(3, d.v / maxV * 100)}%"></div>`;
    }).join('')}</div>
    <div class="heat-labels"><span>${days14[0].k.slice(5)}</span><span>今天</span></div>
  </div>

  <div class="section-title">模块掌握度</div>
  <div class="card" style="padding:20px 22px;">
    <div class="bars">
      ${idx.modules.map((m) => {
        const st = ms[m.id - 1];
        const p = st.n ? Math.round(st.c / st.n * 100) : 0;
        const cov = Math.round(st.u / m.qs * 100);
        return `<div class="bar-row" title="覆盖 ${cov}%">
          <span>${esc(m.short)}</span>
          <span class="track"><i class="${p < 60 ? 'weak' : ''}" style="width:${st.n ? p : 0}%"></i></span>
          <span class="bp">${st.n ? `${p}%` : '—'} · ${st.u}题</span>
        </div>`;
      }).join('')}
    </div>
  </div>

  ${weak.length ? `
  <div class="section-title">薄弱考点（正确率最低）</div>
  <div class="card" style="padding:20px 22px;">
    <div class="bars">
      ${weak.map(([t, v]) => {
        const p = Math.round(v.c / v.n * 100);
        return `<div class="bar-row">
          <span>${esc(t)}</span>
          <span class="track"><i class="weak" style="width:${p}%"></i></span>
          <span class="bp">${p}% · ${v.n}次</span>
        </div>`;
      }).join('')}
    </div>
  </div>` : ''}

  <div style="margin-top:26px;text-align:center;">
    <button class="btn btn-sm" data-act="clear-data">清空全部学习记录</button>
  </div>`;
};

/* ---------------- 全局动作分发 ---------------- */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;

  switch (act) {
    case 'go-practice': location.hash = '#/practice'; break;
    case 'module-practice': location.hash = `#/practice?m=${el.dataset.m}`; break;

    case 'bf': Br[el.dataset.k] = +el.dataset.v; Br.shown = 60; rerender(); break;
    case 'bfy': Br.y = +el.value; Br.shown = 60; rerender(); break;
    case 'bfr': Br.r = el.value; Br.shown = 60; rerender(); break;
    case 'br-more': Br.shown += 60; rerender(); break;

    case 'pm': Pm.mode = el.dataset.v; rerender(); break;
    case 'pm-mins': Pm.mins = +el.dataset.v; rerender(); break;
    case 'start-paper': {
      const pid = decodeURIComponent(location.hash.split('/')[2] || '');
      const paper = await Data.paper(pid);
      const existing = Store.getSession(`paper:${pid}`);
      let s;
      if (existing && Pm.mode === existing.mode && !existing.submitted && el.textContent.includes('继续')) {
        s = existing;
      } else {
        s = await Sess.fromPaper(paper, Pm.mode, Pm.mins);
        Store.saveSession(s);
      }
      location.hash = `#/s/${encodeURIComponent(s.key)}`;
      break;
    }
    case 'continue-paper': {
      const pid = location.hash.split('/')[2];
      location.hash = `#/s/${encodeURIComponent(`paper:${pid}`)}`;
      break;
    }
    case 'reset-paper': {
      const pid = location.hash.split('/')[2];
      const ok = await modalConfirm({ title: '重新开始这套卷？', body: '当前的作答记录将被清除，错题统计中已记录的对错次数不会删除。', ok: '重新开始', danger: true });
      if (!ok) break;
      Store.delSession(`paper:${pid}`);
      rerender();
      break;
    }

    case 'cfg-m': { const v = +el.dataset.v; Cfg.ms.has(v) ? (Cfg.ms.size > 1 && Cfg.ms.delete(v)) : Cfg.ms.add(v); rerender(); break; }
    case 'cfg-tag': Cfg.tag = el.dataset.v; rerender(); break;
    case 'cfg-n': Cfg.n = +el.dataset.v; rerender(); break;
    case 'cfg-order': Cfg.order = el.dataset.v; rerender(); break;
    case 'cfg-mode': Cfg.mode = el.dataset.v; rerender(); break;
    case 'build-practice': {
      if (!Cfg.ms.size) { toast('请至少选择一个模块'); break; }
      el.disabled = true; el.textContent = '正在抽题…';
      try {
        const s = await Sess.custom({ ms: [...Cfg.ms], tag: Cfg.tag, n: Cfg.n, order: Cfg.order, mode: Cfg.mode, onlyNew: Cfg.onlyNew });
        if (!s.items.length) { toast('没有符合条件的题目，试试放开“只练未做题”或换个考点'); el.disabled = false; el.textContent = '开始练习 →'; break; }
        Store.saveSession(s);
        location.hash = `#/s/${encodeURIComponent(s.key)}`;
      } catch (err) { console.error(err); toast('抽题失败：' + err.message); el.disabled = false; el.textContent = '开始练习 →'; }
      break;
    }

    case 'pick': {
      if (!Run.sess) break;
      const i = Run.sess.pos, q = Run.question(), s = Run.sess;
      if (Run.revealed() || s.mode === 'read') break;
      const k = el.dataset.k;
      if (s.mode === 'exam') {
        const cur = (s.answers[i]?.a || []);
        let next;
        if (q.type === 'multi') next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k].sort();
        else next = [k];
        Run.setExamPick(i, next);
        renderRun();
      } else if (q.type === 'multi') {
        Run.pending = Run.pending.includes(k) ? Run.pending.filter((x) => x !== k) : [...Run.pending, k].sort();
        renderRun();
      } else {
        const ok = Run.grade(i, [k]);
        renderRun();
        toast(ok ? '回答正确' : '回答错误');
      }
      break;
    }
    case 'confirm-multi': {
      if (Run.sess.mode !== 'practice' || !Run.pending.length) break;
      const ok = Run.grade(Run.sess.pos, Run.pending);
      Run.pending = [];
      renderRun();
      toast(ok ? '回答正确' : '回答错误');
      break;
    }
    case 'run-prev': move(-1); break;
    case 'run-next': move(1); break;
    case 'jump': Run.sess.pos = +el.dataset.i; Run.pending = (Run.sess.answers[Run.sess.pos]?.a || []).slice(); Run.sheetOpen = false; Store.saveSession(Run.sess); renderRun(); window.scrollTo(0, 0); break;
    case 'toggle-sheet': Run.sheetOpen = !Run.sheetOpen; renderSheet(); break;
    case 'toggle-mat': {
      const mat = $('.material', view);
      if (mat) mat.classList.toggle('is-collapsed');
      break;
    }
    case 'toggle-fav': {
      const q = Run.question(); const on = !Store.fav[q.qid];
      Store.toggleFav(on, q, { pid: Run.item().pid, n: Run.item().n, m: Run.papers.get(Run.item().pid).m, paper: Run.sess.title });
      renderRun();
      toast(on ? '已加入收藏' : '已取消收藏');
      break;
    }
    case 'run-exit': {
      const s = Run.sess;
      location.hash = s.pid ? `#/paper/${s.pid}` : s.kind === 'wrong' ? '#/wrong' : s.kind === 'fav' ? '#/fav' : '#/practice';
      break;
    }
    case 'want-submit': {
      const s = Run.sess;
      const blank = s.items.length - Run.answeredCount();
      const ok = await modalConfirm({
        title: '确认交卷？',
        body: blank > 0 ? `还有 <b style="color:var(--bad)">${blank}</b> 道题未作答，交卷后将统一判分。` : '全部题目已作答，交卷后查看成绩与解析。',
        ok: '交卷',
      });
      if (!ok) break;
      Run.sheetOpen = false;
      await Run.submitExam();
      location.hash = `#/result/${encodeURIComponent(s.key)}`;
      break;
    }
    case 'retry-wrong': {
      const s = Run.sess;
      const refs = s.items.map((it, i) => ({ it, a: s.answers[i] }))
        .filter((x) => x.a && !x.a.ok)
        .map((x) => {
          const p = Run.papers.get(x.it.pid);
          return { qid: Data.findQ(p, x.it.n).qid, pid: x.it.pid, n: x.it.n, m: p.m, tag: Data.findQ(p, x.it.n).tag, paper: s.title };
        });
      const ns = await Sess.fromRefs(refs, 'wrong');
      Store.saveSession(ns);
      location.hash = `#/s/${encodeURIComponent(ns.key)}`;
      break;
    }

    case 'practice-wrong':
    case 'practice-fav': {
      const isWrong = act === 'practice-wrong';
      const refs = isWrong
        ? Store.wrongs().sort((a, b) => b.ts - a.ts).slice(0, 50)
        : Object.entries(Store.fav).map(([qid, v]) => ({ qid, ...v }));
      if (!refs.length) { toast(isWrong ? '错题本是空的' : '还没有收藏'); break; }
      const ns = await Sess.fromRefs(refs, isWrong ? 'wrong' : 'fav');
      if (!ns.items.length) { toast('题目加载失败'); break; }
      Store.saveSession(ns);
      location.hash = `#/s/${encodeURIComponent(ns.key)}`;
      break;
    }
    case 'locate': {
      const { pid, qid } = el.dataset;
      let s = Store.getSession(`paper:${pid}`);
      if (!s) { const paper = await Data.paper(pid); s = await Sess.fromPaper(paper, 'practice', 0); Store.saveSession(s); }
      location.hash = `#/s/${encodeURIComponent(s.key)}?qid=${encodeURIComponent(qid)}`;
      break;
    }
    case 'remove-wrong': {
      const r = Store.records; delete r[el.dataset.qid]; Store.records = r; rerender(); updateNavBadge(); toast('已移出错题本'); break;
    }
    case 'remove-fav': {
      const r = Store.fav; delete r[el.dataset.qid]; Store.fav = r; rerender(); updateNavBadge(); toast('已取消收藏'); break;
    }
    case 'clear-data': {
      const ok = await modalConfirm({ title: '清空全部学习记录？', body: '将删除做题记录、错题本、收藏、打卡与所有试卷进度，且无法恢复。', ok: '全部清空', danger: true });
      if (!ok) break;
      ['records', 'fav', 'sessions', 'daily', 'lastKey'].forEach((k) => localStorage.removeItem(K(k)));
      toast('已清空'); location.hash = '#/';
      break;
    }
  }
});

function move(d) {
  const s = Run.sess;
  const n = clamp(s.pos + d, 0, s.items.length - 1);
  if (n === s.pos) return;
  s.pos = n;
  Run.pending = (s.answers[n]?.a || []).slice();
  Store.saveSession(s);
  renderRun();
  window.scrollTo(0, 0);
}

/* ---------------- 键盘 ---------------- */
document.addEventListener('keydown', (e) => {
  if (!Run.sess || /input|textarea|select/i.test(e.target.tagName)) return;
  if ($('.sheet.open') && e.key === 'Escape') { Run.sheetOpen = false; renderSheet(); return; }
  if ($('.img-modal')) { if (e.key === 'Escape') $('.img-modal').remove(); return; }
  const s = Run.sess;
  if (!location.hash.startsWith('#/s/')) return;
  const q = Run.question();
  if (!q) return;

  if (/^[A-H]$/.test(e.key.toUpperCase()) && q.opts.some((o) => o.k === e.key.toUpperCase()) && !Run.revealed() && s.mode !== 'read') {
    e.preventDefault();
    document.querySelector(`[data-act="pick"][data-k="${e.key.toUpperCase()}"]`)?.click();
    return;
  }
  if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
  else if (e.key === 'ArrowRight' || e.key === 'Enter') {
    e.preventDefault();
    if (q.type === 'multi' && !Run.revealed() && s.mode === 'practice') {
      if (Run.pending.length) document.querySelector('[data-act="confirm-multi"]')?.click();
    } else move(1);
  }
  else if (e.key.toLowerCase() === 'f') { document.querySelector('[data-act="toggle-fav"]')?.click(); }
});

/* ---------------- 主题 ---------------- */
$('#themeToggle').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme;
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  const s = Store.settings; s.theme = next; Store.settings = s;
});

function updateNavBadge() {
  const n = Store.wrongs().length;
  const dot = $('#navWrongCount');
  dot.hidden = n === 0;
  dot.textContent = n > 99 ? '99+' : n;
}

/* ---------------- 启动 ---------------- */
routes.notfound = async () => {
  view.innerHTML = `<div class="empty"><div class="big">🔍</div><div class="t">页面不存在</div><a class="btn btn-primary" href="#/">回首页</a></div>`;
};
if (!location.hash) history.replaceState(null, '', '#/');
router();
updateNavBadge();

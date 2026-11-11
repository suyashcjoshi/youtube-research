const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const num = (n) => compact.format(Math.round(n));
const pct = (x) => (x * 100).toFixed(x < 0.1 ? 1 : 0) + '%';
const times = (x) => (x >= 10 ? Math.round(x) : x.toFixed(1)) + 'x';
const fmtDate = (d) => new Date(d).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });
const fmtDur = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const loading = '<p class="muted">Loading…</p>';
const errorHtml = (e) => `<p class="error">${esc(e.message)}</p>`;
const isShort = (v) => v.seconds > 0 && v.seconds <= 60;
// Lots of views with next to no likes or comments usually means the views were bought as ads.
const likelyAds = (v) => v.views >= 5000 && v.engagement < 0.003;

async function api(path, params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
  const res = await fetch(`${path}?${u}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function filters() {
  const period = $('period').value;
  let after = '', before = '';
  if (period === 'custom') {
    if ($('from').value) after = new Date($('from').value).toISOString();
    if ($('to').value) before = new Date($('to').value + 'T23:59:59').toISOString();
  } else if (period) {
    after = new Date(Date.now() - period * 864e5).toISOString();
  }
  return {
    q: $('q').value.trim(), after, before,
    sort: $('sort').value, format: $('format').value, lang: $('lang').value,
    strict: $('strict').checked ? '1' : '', minViews: $('minViews').value, maxSubs: $('maxSubs').value,
    max: $('max').value,
  };
}

const keyNotice = (q) => `<div class="notice">
  <strong>YouTube API key needed for videos and comments.</strong>
  Paste it into the <code>.env</code> file as <code>YOUTUBE_API_KEY=your-key</code>, then search again.
  ${q ? `Meanwhile: <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(q)}" target="_blank" rel="noopener">open this search on YouTube</a>.` : ''}
</div>`;

// ---------- Video cards (shared by both views) ----------
const sets = { topic: [], channel: [] };

function outlierBadge(v) {
  if (v.outlier == null) return '';
  const cls = v.outlier >= 5 ? 'hot' : v.outlier >= 2 ? 'warm' : 'cold';
  return `<span class="pill ${cls}" title="Outlier score: views compared with this channel's typical video">${times(v.outlier)} outlier</span>`;
}

function cards(videos, set) {
  return '<div class="grid">' + videos.map((v, i) => `
    <div class="video">
      <a class="thumb" href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener">
        <img src="${esc(v.thumbnail)}" alt="" loading="lazy">
        <span class="dur">${fmtDur(v.seconds)}</span>
      </a>
      <div class="body">
        <div class="tags"><span class="rank">#${i + 1}</span>${outlierBadge(v)}${likelyAds(v) ? '<span class="pill ads" title="Many views, almost no likes or comments">likely ads</span>' : ''}</div>
        <a class="title" href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener">${esc(v.title)}</a>
        <div class="meta"><a href="https://www.youtube.com/channel/${esc(v.channelId)}" target="_blank" rel="noopener">${esc(v.channel)}</a>${v.subs != null ? ` · ${num(v.subs)} subs` : ''}</div>
        <div class="meta"><span class="strong">${num(v.views)} views</span> · ${fmtDate(v.publishedAt)}</div>
        <div class="meta small">${num(v.viewsPerDay)} views/day · ${pct(v.engagement)} engagement</div>
        <div class="why-wrap"><div><button type="button" class="why" data-set="${set}" data-id="${esc(v.id)}">Why did it perform?</button></div></div>
      </div>
    </div>`).join('') + '</div>';
}

// ---------- "Why did it perform?" ----------
function titleSignals(title) {
  const found = [];
  if (/\d/.test(title.replace(/20\d\d/g, ''))) found.push('a number');
  if (/\b20\d\d\b/.test(title)) found.push('the year (signals freshness)');
  if (/\?|^(how|why|what)\b/i.test(title)) found.push('a question or how-to framing');
  if (/[(\[].+[)\]]/.test(title)) found.push('a bracketed extra');
  if (/\b(vs\.?|versus)\b/i.test(title)) found.push('a comparison');
  if (/\b(crash course|full course|tutorial|explained|for beginners|in \d+ (minutes|mins|seconds|hours))\b/i.test(title)) found.push('a clear learning promise');
  if (/\b[A-Z]{4,}\b/.test(title)) found.push('an all-caps word');
  return found;
}

function explain(v, peers) {
  const medVpd = median(peers.map((p) => p.viewsPerDay));
  const medEng = median(peers.map((p) => p.engagement));
  const medSec = median(peers.map((p) => p.seconds));
  const ageDays = Math.round((Date.now() - new Date(v.publishedAt)) / 864e5);
  let verdict, tone = '';
  if (v.outlier == null) verdict = 'No channel baseline available, so this is judged against the other results only.';
  else if (v.outlier >= 5) { verdict = `Breakout hit: ${times(v.outlier)} this channel's normal views.`; tone = 'hot'; }
  else if (v.outlier >= 2) verdict = `Strong performer: ${times(v.outlier)} this channel's normal views.`;
  else if (v.outlier >= 0.75) { verdict = `About normal for this channel (${times(v.outlier)}).`; tone = 'cold'; }
  else { verdict = `Underperformed for this channel (${times(v.outlier)} its normal views).`; tone = 'cold'; }
  if (likelyAds(v)) { verdict = `Probably paid promotion, not a real hit: ${num(v.views)} views but almost no likes or comments. Treat its outlier score with caution.`; tone = 'cold'; }

  const points = [];
  if (v.outlier != null) {
    const base = `<b>Against its own channel:</b> ${num(v.views)} views, where a typical recent video gets ${num(v.channelMedian)}. `;
    points.push(base + (v.outlier >= 2
      ? 'The regular audience cannot explain that gap, so the topic, title or thumbnail pulled in new viewers.'
      : v.outlier >= 0.75
        ? 'That matches what this channel usually gets, so its existing audience explains most of the views.'
        : 'Even the channel\'s own audience mostly skipped it, which points at the topic or the packaging.'));
  }
  if (v.viewsPerSub != null) {
    points.push(`<b>Reach beyond subscribers:</b> views are ${times(v.viewsPerSub)} the subscriber count (${num(v.subs)}). ` + (v.viewsPerSub >= 1
      ? 'Most viewers were not subscribers; they came from search or recommendations. A topic that does this for a small channel is a good one to cover.'
      : v.viewsPerSub < 0.1 ? 'It reached only a small slice of the channel\'s own subscribers.' : 'Roughly what a subscribed audience alone can deliver.'));
  }
  if (medVpd) {
    const r = v.viewsPerDay / medVpd;
    points.push(`<b>Speed:</b> ${num(v.viewsPerDay)} views a day over ${ageDays} days, ${times(r)} the middle of this list. ` + (ageDays > 180 && r >= 1
      ? 'Still pulling views months later, which suggests steady search demand rather than a one-week spike.'
      : ageDays < 30 ? 'It is new, so this number is still settling.' : ''));
  }
  if (medEng) {
    const r = v.engagement / medEng;
    points.push(`<b>Engagement:</b> ${pct(v.engagement)} of viewers liked or commented (list middle: ${pct(medEng)}). ` + (r >= 1.3
      ? 'Viewers valued it, not just clicked it.'
      : r <= 0.6 ? 'Many clicks but a weak reaction: the packaging may have promised more than the video gave.' : 'In line with similar videos.'));
  }
  const sig = titleSignals(v.title);
  points.push(`<b>Title:</b> ${v.title.length} characters` + (v.title.length > 70 ? ' (long; it gets cut off in search results)' : '') + (sig.length ? `, and it uses ${sig.join(', ')}.` : ', with no common hook pattern (number, question, comparison, learning promise).'));
  if (medSec && v.seconds) {
    points.push(`<b>Length:</b> ${fmtDur(v.seconds)}, against a list middle of ${fmtDur(Math.round(medSec))}.`);
  }
  if (v.tags.length) points.push(`<b>Tags:</b> ${esc(v.tags.join(', '))}`);
  return { verdict, tone, points };
}

async function openWhy(set, id) {
  const peers = sets[set];
  const v = peers.find((x) => x.id === id);
  if (!v) return;
  const { verdict, tone, points } = explain(v, peers);
  $('whyBody').innerHTML = `
    <button class="close" type="button" aria-label="Close">×</button>
    <h3>${esc(v.title)}</h3>
    <div class="muted">${esc(v.channel)} · ${fmtDate(v.publishedAt)} · <a href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener">Watch</a></div>
    <div class="verdict ${tone}">${esc(verdict)}</div>
    <ul>${points.map((p) => `<li>${p}</li>`).join('')}</ul>
    <h4>What viewers said</h4>
    <div id="whyComments" class="list">${loading}</div>
    <p class="muted" style="margin:14px 0 0">This reads public numbers and comments only. It cannot watch the video, so it does not judge the hook, the pacing, or whether the video delivers on its title.</p>`;
  $('why').showModal();
  try {
    const c = await api('/api/comments', { ids: v.id });
    const picks = [...c.top.slice(0, 3), ...c.questions.filter((q) => !c.top.slice(0, 3).some((t) => t.id === q.id)).slice(0, 3)];
    if ($('whyComments')) $('whyComments').innerHTML = picks.length ? picks.map((x) => `
      <div class="item"><p>${esc(x.text.slice(0, 400))}${x.text.length > 400 ? '…' : ''}</p><div class="meta">${num(x.likes)} likes · ${x.replies} replies</div></div>`).join('')
      : '<p class="muted">No comments available for this video.</p>';
  } catch (e) { if ($('whyComments')) $('whyComments').innerHTML = errorHtml(e); }
}

// ---------- Thumbnail analysis ----------
const shown = { topic: [], channel: [] }; // the videos currently on screen in each view

async function analyseThumbnails(set) {
  const box = $(`thumbs-${set}`);
  const videos = shown[set].slice(0, 12);
  if (videos.length < 2) { box.innerHTML = '<p class="muted">Load at least two videos first.</p>'; return; }
  box.innerHTML = `<div class="panel thumbs"><p class="muted" style="margin:0">Claude is looking at ${videos.length} thumbnails. This can take up to a minute…</p></div>`;
  try {
    const res = await fetch('/api/thumbnails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videos: videos.map((v) => ({ id: v.id, title: v.title, channel: v.channel, views: v.views, outlier: v.outlier, likelyAds: likelyAds(v) })) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    if (data.needsKey || data.needsInstall) {
      box.innerHTML = `<div class="notice"><strong>Thumbnail analysis uses Claude.</strong> ${data.needsKey
        ? 'Add <code>ANTHROPIC_API_KEY=your-key</code> to the <code>.env</code> file, then click again.'
        : 'Run <code>npm install</code> in the project folder, restart the app, then click again.'}</div>`;
      return;
    }
    const a = data.analysis;
    box.innerHTML = `<div class="panel thumbs">
      <h2>Thumbnail analysis</h2>
      <p style="margin:8px 0 0">${esc(a.summary)}</p>
      <h4>Patterns</h4>
      <ul>${a.patterns.map((p) => `<li><b>${esc(p.pattern)}</b> ${esc(p.evidence)}</li>`).join('')}</ul>
      <h4>What to try</h4>
      <ul>${a.advice.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <h4>Each thumbnail</h4>
      ${a.videos.map((t) => { const v = videos[t.number - 1]; return v ? `<div class="t-row">
        <img src="${esc(v.thumbnail)}" alt="">
        <div><b>${t.number}. ${esc(v.title)}</b>${v.outlier != null ? ` <span class="muted">(${times(v.outlier)})</span>` : ''}<br>${esc(t.shows)} ${esc(t.verdict)}</div></div>` : ''; }).join('')}
      <p class="muted" style="margin:12px 0 0">Written by Claude from the thumbnails, titles and numbers above. It is an opinion on a small sample, not a measurement.</p>
    </div>`;
  } catch (e) { box.innerHTML = errorHtml(e); }
}

document.addEventListener('click', (e) => {
  const thumbsBtn = e.target.closest('.thumbs-btn');
  if (thumbsBtn) analyseThumbnails(thumbsBtn.dataset.set);
  const why = e.target.closest('.why');
  if (why) openWhy(why.dataset.set, why.dataset.id);
  if (e.target.closest('.close') || e.target === $('why')) $('why').close();
});

// ---------- Topic research ----------
let commentData = null, videoTitles = {}, tab = 'questions';

async function loadVideos(f) {
  $('videos').innerHTML = loading;
  $('videoInfo').textContent = '';
  $('comments').innerHTML = '';
  $('commentInfo').textContent = '';
  commentData = null;
  try {
    const { videos, needsKey, candidates } = await api('/api/youtube', f);
    if (needsKey) {
      $('videos').innerHTML = keyNotice(f.q);
      $('comments').innerHTML = '<p class="muted">Comments appear here once the API key is added.</p>';
      return;
    }
    sets.topic = shown.topic = videos;
    $('thumbs-topic').innerHTML = '';
    if (!videos.length) { $('videos').innerHTML = '<p class="muted">No videos matched these filters. Try loosening them.</p>'; return; }
    $('videoInfo').textContent = `${videos.length} shown of ${candidates} that matched · ${num(videos.reduce((n, v) => n + v.views, 0))} total views · pill = outlier score`;
    videoTitles = Object.fromEntries(videos.map((v) => [v.id, v.title]));
    $('videos').innerHTML = cards(videos, 'topic');
    loadComments(videos.slice(0, 10).map((v) => v.id));
  } catch (e) { $('videos').innerHTML = errorHtml(e); }
}

async function loadComments(ids) {
  $('comments').innerHTML = loading;
  try {
    commentData = await api('/api/comments', { ids: ids.join(',') });
    $('commentInfo').textContent = `${commentData.questions.length} questions and ${commentData.insights.length} longer comments, from ${commentData.total} top comments`;
    renderComments();
  } catch (e) { $('comments').innerHTML = errorHtml(e); }
}

function renderComments() {
  if (!commentData) return;
  const items = commentData[tab];
  $('comments').innerHTML = items.length ? items.map((c) => `
    <div class="item">
      <p>${esc(c.text)}</p>
      <div class="meta">${num(c.likes)} likes · ${c.replies} replies · ${esc(c.author)} ·
        on <a href="https://www.youtube.com/watch?v=${esc(c.videoId)}&lc=${esc(c.id)}" target="_blank" rel="noopener">${esc(videoTitles[c.videoId] || 'video')}</a></div>
    </div>`).join('') : '<p class="muted">Nothing found in this group.</p>';
}

async function loadForum(f) {
  $('forum').innerHTML = loading;
  try {
    const { topics } = await api('/api/forum', { q: f.q, after: f.after, before: f.before, order: $('forumOrder').value });
    $('forum').innerHTML = topics.length ? topics.map((t) => `
      <div class="item">
        <a class="t" href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.title)}</a>
        <p class="muted">${esc(t.blurb.slice(0, 220))}</p>
        <div class="meta">${t.posts - 1} replies · ${fmtDate(t.createdAt)}${t.solved ? ' · <span class="solved">Solved</span>' : ''}${t.tags.length ? ' · ' + esc(t.tags.join(', ')) : ''}</div>
      </div>`).join('') : '<p class="muted">No forum topics matched.</p>';
  } catch (e) { $('forum').innerHTML = errorHtml(e); }
}

async function loadSuggest(f) {
  $('suggest').innerHTML = loading;
  try {
    const { groups } = await api('/api/suggest', { q: f.q });
    $('suggest').innerHTML = groups.length ? groups.map((g) => `
      <div class="group-label">${esc(g.label)}</div>
      <div class="chips">${g.items.map((s) => `<a class="chip" href="https://www.google.com/search?q=${encodeURIComponent(s)}" target="_blank" rel="noopener">${esc(s)}</a>`).join('')}</div>`).join('')
      : '<p class="muted">No suggestions found.</p>';
  } catch (e) { $('suggest').innerHTML = errorHtml(e); }
}

$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = filters();
  if (!f.q) return;
  $('results').classList.remove('hidden');
  loadVideos(f); loadForum(f); loadSuggest(f);
});
$('period').addEventListener('change', () => {
  document.querySelectorAll('.custom').forEach((el) => el.classList.toggle('hidden', $('period').value !== 'custom'));
});
$('forumOrder').addEventListener('change', () => { const f = filters(); if (f.q) loadForum(f); });
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  tab = b.dataset.tab;
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  renderComments();
}));

// ---------- Channel analysis ----------
let channelData = null, channelRequest = 0;
// Rounded to the day so repeat requests hit the server's cache.
const chAfter = () => ($('chPeriod').value ? new Date(Date.now() - $('chPeriod').value * 864e5).toISOString().slice(0, 10) + 'T00:00:00.000Z' : '');
const CH_SORTS = {
  outlier: (v) => v.outlier ?? -1, viewCount: (v) => v.views, velocity: (v) => v.viewsPerDay,
  engagement: (v) => v.engagement, date: (v) => +new Date(v.publishedAt),
};

function renderChannel() {
  if (!channelData) return;
  const c = channelData.channel;
  const topic = $('q').value.trim();
  const topicMedian = sets.topic.length ? median(sets.topic.map((v) => v.views)) : null;
  $('channelSummary').innerHTML = `
    <div class="chan">${c.thumbnail ? `<img src="${esc(c.thumbnail)}" alt="">` : ''}
      <div><a href="${esc(c.url)}" target="_blank" rel="noopener"><b>${esc(c.title)}</b></a>
      <div class="muted">${num(c.videoCount)} videos in total · numbers below cover the latest ${c.analysed}</div></div></div>
    <div class="tiles">
      <div class="tile"><b>${c.subs == null ? 'Hidden' : num(c.subs)}</b><span>Subscribers</span></div>
      <div class="tile"><b>${num(c.medianLongViews)}</b><span>Typical views, regular video</span></div>
      <div class="tile"><b>${num(c.medianShortViews)}</b><span>Typical views, Short</span></div>
      <div class="tile"><b>${num(c.medianViewsPerDay)}</b><span>Typical views per day</span></div>
      <div class="tile"><b>${pct(c.medianEngagement)}</b><span>Typical engagement</span></div>
      <div class="tile"><b>${c.uploads90d}</b><span>Uploads in last 90 days</span></div>
    </div>
    ${topicMedian != null ? `<p class="muted" style="margin:12px 0 0">For comparison: the top videos for "${esc(topic)}" in your last topic search have a middle value of <b>${num(topicMedian)}</b> views, against <b>${num(c.medianViews)}</b> for this channel's typical video.</p>` : ''}`;

  let videos = channelData.videos;
  const after = chAfter();
  if (after) videos = videos.filter((v) => v.publishedAt >= after);
  if ($('chMinViews').value) videos = videos.filter((v) => v.views >= +$('chMinViews').value);
  const fmt = $('chFormat').value;
  if (fmt === 'shorts') videos = videos.filter(isShort);
  if (fmt === 'long') videos = videos.filter((v) => v.seconds > 180);
  if ($('chTopic').checked && topic) {
    const words = topic.toLowerCase().split(/\s+/);
    videos = videos.filter((v) => { const hay = (v.title + ' ' + v.tags.join(' ')).toLowerCase(); return words.every((w) => hay.includes(w)); });
  }
  const by = CH_SORTS[$('chSort').value];
  const matched = videos.length;
  videos = [...videos].sort((a, b) => by(b) - by(a)).slice(0, +$('chMax').value);
  sets.channel = channelData.videos;
  shown.channel = videos;
  $('thumbs-channel').innerHTML = '';
  $('channelInfo').textContent = `${videos.length} shown of ${matched} that matched · outlier = views against this channel's typical video of the same kind`;
  $('channelVideos').innerHTML = videos.length ? cards(videos, 'channel')
    : `<p class="muted">No videos matched${$('chTopic').checked && topic ? ` "${esc(topic)}" in the title or tags` : ''}.</p>`;
}

async function loadChannel() {
  $('channelSummary').innerHTML = '';
  $('channelVideos').innerHTML = loading;
  $('channelInfo').textContent = '';
  const current = $('handle').value.trim().toLowerCase();
  document.querySelectorAll('#presets .chip').forEach((b) => b.classList.toggle('on', b.dataset.handle.toLowerCase() === current));
  try {
    const request = ++channelRequest;
    const data = await api('/api/channel', { handle: $('handle').value.trim(), after: chAfter() });
    if (request !== channelRequest) return; // a newer request replaced this one
    if (data.needsKey) { $('channelVideos').innerHTML = keyNotice(''); return; }
    channelData = data;
    renderChannel();
  } catch (e) { $('channelVideos').innerHTML = errorHtml(e); }
}

// ---------- Competitor comparison ----------
// Edit this list to add or remove channels. Use the handle from the channel's YouTube URL.
const CHANNELS = [
  { group: 'Elastic', handles: ['@OfficialElasticCommunity', '@elastic'] },
  { group: 'Observability', handles: ['@DatadogHQ', '@Grafana', '@splunkofficial', '@dynatrace', '@NewRelicInc', '@honeycombio', '@SigNoz'] },
  { group: 'Search and data', handles: ['@OpenSearchProject', '@MongoDB', '@ClickHouseDB', '@Algolia', '@pinecone-io', '@Weaviate', '@qdrant'] },
];
const ELASTIC = new Set(CHANNELS[0].handles.map((h) => h.toLowerCase()));
const COLUMNS = [
  ['Channel', (c) => c.title.toLowerCase(), (c) => `<a href="#" data-handle="${esc(c.handle)}">${esc(c.title)}</a>`],
  ['Subscribers', (c) => c.subs ?? 0, (c) => (c.subs == null ? 'Hidden' : num(c.subs))],
  ['Typical views', (c) => c.medianLongViews, (c) => num(c.medianLongViews)],
  ['Typical Short', (c) => c.medianShortViews, (c) => (c.medianShortViews ? num(c.medianShortViews) : '–')],
  ['Views per 1K subs', (c) => (c.subs ? c.medianLongViews / c.subs : 0), (c) => (c.subs ? Math.round((c.medianLongViews / c.subs) * 1000) : '–')],
  ['Engagement', (c) => c.medianEngagement, (c) => pct(c.medianEngagement)],
  ['Uploads, 90 days', (c) => c.uploads90d, (c) => c.uploads90d],
  ['Most viewed recent video', (c) => c.best?.views ?? 0, (c) => (c.best ? `<a href="https://www.youtube.com/watch?v=${esc(c.best.id)}" target="_blank" rel="noopener">${esc(c.best.title)}</a> <span class="muted">(${num(c.best.views)})</span>` : '')],
];
let compareRows = [], compareSort = 2;

$('presets').innerHTML = CHANNELS.map((g) => `<span class="chip-group">${esc(g.group)}</span>` +
  g.handles.map((h) => `<button type="button" class="chip" data-handle="${esc(h)}">${esc(h.slice(1))}</button>`).join('')).join('');

function renderCompare() {
  const ok = compareRows.filter((c) => !c.error), failed = compareRows.filter((c) => c.error);
  const key = COLUMNS[compareSort][1];
  ok.sort((a, b) => (compareSort === 0 ? String(key(a)).localeCompare(key(b)) : key(b) - key(a)));
  const bestOf = COLUMNS.map(([, k], i) => (i > 0 && i < 7 ? Math.max(...ok.map(k)) : null));
  $('compare').innerHTML = `<div class="table-wrap"><table>
    <thead><tr>${COLUMNS.map(([label], i) => `<th data-col="${i}" class="${i === compareSort ? 'sorted' : ''}">${label}</th>`).join('')}</tr></thead>
    <tbody>${ok.map((c) => `<tr class="${ELASTIC.has(c.handle.toLowerCase()) ? 'elastic' : ''}">${COLUMNS.map(([, k, cell], i) =>
      `<td>${bestOf[i] != null && k(c) === bestOf[i] ? `<span class="best">${cell(c)}</span>` : cell(c)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>
  <p class="muted" style="margin:10px 0 0">"Typical" is the middle value, so one viral video does not skew it. Typical views covers regular videos; Shorts are counted apart. Pink marks the best in each column; Elastic rows are tinted. Click a column to sort.</p>
  ${failed.length ? `<p class="error">Could not load: ${esc(failed.map((c) => c.handle).join(', '))}</p>` : ''}`;
}

$('compareBtn').addEventListener('click', async () => {
  $('compare').innerHTML = loading;
  try {
    const data = await api('/api/compare', { handles: CHANNELS.flatMap((g) => g.handles).join(',') });
    if (data.needsKey) { $('compare').innerHTML = keyNotice(''); return; }
    compareRows = data.channels;
    renderCompare();
  } catch (e) { $('compare').innerHTML = errorHtml(e); }
});
$('view-channel').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-col]');
  if (th) { compareSort = +th.dataset.col; renderCompare(); return; }
  const pick = e.target.closest('[data-handle]');
  if (!pick) return;
  e.preventDefault();
  $('handle').value = pick.dataset.handle;
  loadChannel();
  $('channelForm').scrollIntoView({ behavior: 'smooth' });
});

$('channelForm').addEventListener('submit', (e) => { e.preventDefault(); loadChannel(); });
['chSort', 'chFormat', 'chTopic', 'chMax'].forEach((id) => $(id).addEventListener('change', renderChannel));
$('chMinViews').addEventListener('input', renderChannel);
$('chPeriod').addEventListener('change', loadChannel); // older videos may need fetching

document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x === b));
  $('view-topic').classList.toggle('hidden', b.dataset.view !== 'topic');
  $('view-channel').classList.toggle('hidden', b.dataset.view !== 'channel');
  if (b.dataset.view === 'channel') { if (channelData) renderChannel(); else loadChannel(); }
}));

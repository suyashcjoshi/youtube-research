// Topic Scout server: zero dependencies, needs Node 18+.
// Run: node server.js   then open http://localhost:3456
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3456;
const YT = 'https://www.googleapis.com/youtube/v3';
const CACHE_TTL_MS = 60 * 60 * 1000;
const BASELINE_VIDEOS = 20; // recent uploads used to work out a channel's "normal" views
const cache = new Map();

// Read the key on every request so it can be added to .env without a restart.
function envValue(name) {
  if (process.env[name]) return process.env[name];
  try {
    const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    // [ \t] rather than \s, so an empty value never reads on into the next line
    const m = env.match(new RegExp(`^[ \\t]*${name}[ \\t]*=[ \\t]*["']?([^"'\\s#]+)`, 'm'));
    return m ? m[1] : '';
  } catch {
    return '';
  }
}
const youtubeKey = () => envValue('YOUTUBE_API_KEY');

async function getJson(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Bad response (${res.status}) from ${new URL(url).host}`);
  }
  if (!res.ok) {
    const err = new Error(data?.error?.message || data?.errors?.[0] || `HTTP ${res.status}`);
    err.reason = data?.error?.errors?.[0]?.reason;
    throw err;
  }
  cache.set(url, { at: Date.now(), data });
  return data;
}

function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.set(k, v);
  return u.toString();
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ISO 8601 duration (PT1H2M3S) to seconds
function durationSeconds(iso = '') {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || [];
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
}

function mapVideo(v) {
  const views = +v.statistics.viewCount || 0;
  const likes = +v.statistics.likeCount || 0;
  const comments = +v.statistics.commentCount || 0;
  const days = Math.max(1, (Date.now() - new Date(v.snippet.publishedAt)) / 864e5);
  return {
    id: v.id,
    title: v.snippet.title,
    channel: v.snippet.channelTitle,
    channelId: v.snippet.channelId,
    publishedAt: v.snippet.publishedAt,
    thumbnail: (v.snippet.thumbnails.medium || v.snippet.thumbnails.default).url,
    language: (v.snippet.defaultAudioLanguage || v.snippet.defaultLanguage || '').toLowerCase(),
    tags: (v.snippet.tags || []).slice(0, 12),
    views,
    likes,
    comments,
    seconds: durationSeconds(v.contentDetails.duration),
    viewsPerDay: views / days,
    engagement: views ? (likes + comments) / views : 0,
    subs: null,
    viewsPerSub: null,
    outlier: null,
    channelMedian: null,
  };
}

async function fetchVideos(ids, key) {
  const pages = await Promise.all(
    chunk(ids, 50).map((batch) =>
      getJson(`${YT}/videos?` + qs({ key, part: 'snippet,statistics,contentDetails', id: batch.join(',') }))
    )
  );
  return pages.flatMap((p) => p.items).map(mapVideo);
}

async function fetchChannels(ids, key) {
  const out = new Map();
  const pages = await Promise.all(
    chunk([...new Set(ids)], 50).map((batch) =>
      getJson(`${YT}/channels?` + qs({ key, part: 'statistics,contentDetails', id: batch.join(',') }))
    )
  );
  for (const c of pages.flatMap((p) => p.items || [])) {
    out.set(c.id, {
      subs: c.statistics.hiddenSubscriberCount ? null : +c.statistics.subscriberCount || 0,
      uploads: c.contentDetails?.relatedPlaylists?.uploads,
    });
  }
  return out;
}

// Uploads come newest first. With `after`, stop paging once videos are older than that date.
async function uploadIds(playlistId, key, pages = 1, after = '') {
  const ids = [];
  let pageToken = '';
  for (let i = 0; i < pages; i++) {
    const data = await getJson(
      `${YT}/playlistItems?` + qs({ key, part: 'contentDetails', playlistId, maxResults: 50, pageToken })
    );
    ids.push(...data.items.map((it) => it.contentDetails.videoId));
    pageToken = data.nextPageToken;
    const oldest = data.items.at(-1)?.contentDetails.videoPublishedAt;
    if (!pageToken || (after && oldest && oldest < after)) break;
  }
  return ids;
}

// Outlier score = this video's views divided by the median views of the channel's other recent uploads.
async function attachOutliers(videos, channels, key) {
  const channelIds = [...new Set(videos.map((v) => v.channelId))];
  const recent = new Map();
  await Promise.all(
    channelIds.map(async (id) => {
      try {
        const uploads = channels.get(id)?.uploads;
        if (uploads) recent.set(id, (await uploadIds(uploads, key)).slice(0, BASELINE_VIDEOS));
      } catch {
        /* channel without a public uploads list */
      }
    })
  );
  const allIds = [...new Set([...recent.values()].flat())];
  const views = new Map();
  const pages = await Promise.all(
    chunk(allIds, 50).map((batch) => getJson(`${YT}/videos?` + qs({ key, part: 'statistics', id: batch.join(',') })))
  );
  for (const v of pages.flatMap((p) => p.items)) views.set(v.id, +v.statistics.viewCount || 0);
  for (const v of videos) {
    const others = (recent.get(v.channelId) || []).filter((id) => id !== v.id && views.has(id)).map((id) => views.get(id));
    if (others.length < 3) continue;
    v.channelMedian = median(others);
    v.outlier = v.views / Math.max(v.channelMedian, 1);
  }
}

const SORTS = {
  viewCount: (v) => v.views,
  outlier: (v) => v.outlier ?? -1,
  velocity: (v) => v.viewsPerDay,
  viewsPerSub: (v) => v.viewsPerSub ?? -1,
  engagement: (v) => v.engagement,
};

async function searchVideos(p) {
  const key = youtubeKey();
  if (!key) return { needsKey: true, videos: [] };
  const max = Math.min(+p.max || 10, 50);
  const sort = p.sort || 'viewCount';
  const format = p.format || '';
  const apiDuration = { shorts: 'short', medium: 'medium', verylong: 'long' }[format];
  const search = await getJson(
    `${YT}/search?` +
      qs({
        key,
        part: 'snippet',
        type: 'video',
        q: format === 'shorts' ? `${p.q} #shorts` : p.q,
        order: sort === 'date' || sort === 'relevance' ? sort : 'viewCount',
        maxResults: 50,
        publishedAfter: p.after,
        publishedBefore: p.before,
        videoDuration: apiDuration,
        relevanceLanguage: p.lang,
      })
  );
  const ids = search.items.map((i) => i.id.videoId).filter(Boolean);
  if (!ids.length) return { videos: [], candidates: 0 };
  const fetched = await fetchVideos(ids, key);
  const order = new Map(ids.map((id, i) => [id, i]));
  let videos = fetched.sort((a, b) => order.get(a.id) - order.get(b.id));

  const channels = await fetchChannels(videos.map((v) => v.channelId), key);
  for (const v of videos) {
    v.subs = channels.get(v.channelId)?.subs ?? null;
    v.viewsPerSub = v.subs ? v.views / v.subs : null;
  }

  if (format === 'shorts') videos = videos.filter((v) => v.seconds > 0 && v.seconds <= 60);
  if (format === 'long') videos = videos.filter((v) => v.seconds > 180);
  if (p.strict && p.lang) videos = videos.filter((v) => v.language.startsWith(p.lang));
  if (p.minViews) videos = videos.filter((v) => v.views >= +p.minViews);
  if (p.maxSubs) videos = videos.filter((v) => v.subs !== null && v.subs <= +p.maxSubs);
  const candidates = videos.length;

  const by = SORTS[sort];
  if (sort === 'outlier') {
    await attachOutliers(videos, channels, key);
    videos.sort((a, b) => by(b) - by(a));
    videos = videos.slice(0, max);
  } else {
    if (by) videos.sort((a, b) => by(b) - by(a));
    videos = videos.slice(0, max);
    await attachOutliers(videos, channels, key);
  }
  return { videos, candidates };
}

async function channelReport(p) {
  const key = youtubeKey();
  if (!key) return { needsKey: true, videos: [] };
  const handle = (p.handle || '').trim().replace(/^.*youtube\.com\//, '').replace(/^@?/, '@');
  const data = await getJson(
    `${YT}/channels?` + qs({ key, part: 'snippet,statistics,contentDetails', forHandle: handle })
  );
  const c = data.items?.[0];
  if (!c) throw new Error(`No channel found for ${handle}`);
  const subs = c.statistics.hiddenSubscriberCount ? null : +c.statistics.subscriberCount || 0;
  // Default: latest 100 videos. With a date filter: go back to that date, up to 500 videos.
  const ids = await uploadIds(c.contentDetails.relatedPlaylists.uploads, key, p.after ? 10 : 2, p.after);
  const videos = await fetchVideos(ids, key);
  videos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  // Shorts and long videos behave differently, so each is compared with its own kind.
  const isShort = (v) => v.seconds > 0 && v.seconds <= 60;
  const medians = { short: median(videos.filter(isShort).map((v) => v.views)), long: median(videos.filter((v) => !isShort(v)).map((v) => v.views)) };
  for (const v of videos) {
    v.subs = subs;
    v.viewsPerSub = subs ? v.views / subs : null;
    v.channelMedian = medians[isShort(v) ? 'short' : 'long'];
    v.outlier = v.views / Math.max(v.channelMedian, 1);
  }
  const cutoff = Date.now() - 90 * 864e5;
  return {
    channel: {
      title: c.snippet.title,
      handle,
      url: `https://www.youtube.com/${handle}`,
      thumbnail: c.snippet.thumbnails?.default?.url,
      subs,
      totalViews: +c.statistics.viewCount || 0,
      videoCount: +c.statistics.videoCount || 0,
      analysed: videos.length,
      medianViews: median(videos.map((v) => v.views)),
      medianLongViews: medians.long,
      medianShortViews: medians.short,
      medianEngagement: median(videos.map((v) => v.engagement)),
      medianViewsPerDay: median(videos.map((v) => v.viewsPerDay)),
      uploads90d: videos.filter((v) => new Date(v.publishedAt) > cutoff).length,
    },
    videos,
  };
}

// One summary row per channel, for the side-by-side table.
async function compareChannels(p) {
  if (!youtubeKey()) return { needsKey: true, channels: [] };
  const handles = (p.handles || '').split(',').map((h) => h.trim()).filter(Boolean).slice(0, 20);
  const channels = await Promise.all(
    handles.map(async (handle) => {
      try {
        const { channel, videos } = await channelReport({ handle });
        const best = [...videos].sort((a, b) => b.views - a.views)[0];
        return { ...channel, best: best && { id: best.id, title: best.title, views: best.views } };
      } catch (err) {
        return { handle, error: err.message };
      }
    })
  );
  return { channels };
}

// ---------- Thumbnail analysis (optional: needs ANTHROPIC_API_KEY and `npm install`) ----------
const THUMBNAIL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'patterns', 'videos', 'advice'],
  properties: {
    summary: { type: 'string' },
    patterns: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pattern', 'evidence'],
        properties: { pattern: { type: 'string' }, evidence: { type: 'string' } },
      },
    },
    videos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['number', 'shows', 'verdict'],
        properties: { number: { type: 'integer' }, shows: { type: 'string' }, verdict: { type: 'string' } },
      },
    },
    advice: { type: 'array', items: { type: 'string' } },
  },
};

const THUMBNAIL_PROMPT = `You are helping a developer advocate at Elastic decide how to design YouTube thumbnails for technical videos.

Below are thumbnails from a set of videos, each with its title, channel, views and outlier score. The outlier score is the video's views divided by that channel's typical views: 2x or more is a strong result, 5x or more is a breakout, under 0.75x underperformed. Videos marked "likely ads" got their views from paid promotion, so do not treat them as successes.

Compare what the stronger performers do visually with what the weaker ones do. Look at text (amount, size, wording), faces and expressions, colours and contrast, logos, diagrams or screenshots, and how the thumbnail works together with the title.

Return:
- summary: two or three sentences on the main finding.
- patterns: visual patterns you see, each with the evidence (which numbered thumbnails, and how they performed). Say so when the set is too small or mixed to support a pattern.
- videos: for every thumbnail, its number, one sentence on what it shows, and one sentence on whether the thumbnail likely helped or hurt.
- advice: three to five concrete things to try in the next thumbnail on this topic.

Write in plain, simple English. Describe people by what is visible (for example "a man looking surprised") and do not name anyone from their face.`;

const thumbnailCache = new Map();

async function analyseThumbnails(_params, body) {
  const key = envValue('ANTHROPIC_API_KEY');
  if (!key) return { needsKey: true };
  let Anthropic;
  try {
    const mod = require('@anthropic-ai/sdk');
    Anthropic = mod.default || mod;
  } catch {
    return { needsInstall: true };
  }
  const videos = (body?.videos || []).filter((v) => /^[\w-]{11}$/.test(v.id)).slice(0, 12);
  if (videos.length < 2) throw new Error('Need at least two videos to compare thumbnails.');
  const cacheKey = videos.map((v) => v.id).join(',');
  if (thumbnailCache.has(cacheKey)) return thumbnailCache.get(cacheKey);

  const content = [{ type: 'text', text: THUMBNAIL_PROMPT }];
  videos.forEach((v, i) => {
    const outlier = typeof v.outlier === 'number' ? `${v.outlier.toFixed(1)}x` : 'unknown';
    content.push({
      type: 'text',
      text: `Thumbnail ${i + 1}: "${v.title}" by ${v.channel}. ${v.views} views, outlier score ${outlier}${v.likelyAds ? ', likely ads' : ''}.`,
    });
    content.push({ type: 'image', source: { type: 'url', url: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` } });
  });

  const client = new Anthropic({ apiKey: key });
  let response;
  try {
    response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      // If the model declines, the API retries on a fallback model in the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: THUMBNAIL_SCHEMA } },
      messages: [{ role: 'user', content }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.');
    if (err instanceof Anthropic.RateLimitError) throw new Error('Anthropic rate limit reached. Wait a minute and try again.');
    if (err instanceof Anthropic.APIError) throw new Error(`Claude API error: ${err.message}`);
    throw err;
  }
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to analyse these thumbnails.');
  if (response.stop_reason === 'max_tokens') throw new Error('The analysis was cut off. Try fewer videos.');
  const text = response.content.find((b) => b.type === 'text')?.text || '';
  let analysis;
  try {
    analysis = JSON.parse(text);
  } catch {
    throw new Error('Claude returned an answer the app could not read. Try again.');
  }
  const result = { analysis, ids: videos.map((v) => v.id) };
  thumbnailCache.set(cacheKey, result);
  return result;
}

const QUESTION_START =
  /^(how|why|what|when|where|which|who|can|could|does|do|did|is|are|should|would|will|has|have|any(one|body)?)\b/i;

async function mineComments(p) {
  const key = youtubeKey();
  if (!key) return { needsKey: true, questions: [], insights: [], top: [] };
  const ids = (p.ids || '').split(',').filter(Boolean).slice(0, 10);
  const perVideo = await Promise.all(
    ids.map(async (videoId) => {
      try {
        const data = await getJson(
          `${YT}/commentThreads?` +
            qs({ key, part: 'snippet', videoId, order: 'relevance', maxResults: 100, textFormat: 'plainText' })
        );
        return data.items.map((t) => {
          const c = t.snippet.topLevelComment.snippet;
          return {
            id: t.snippet.topLevelComment.id,
            videoId,
            text: c.textDisplay,
            author: c.authorDisplayName,
            likes: c.likeCount || 0,
            replies: t.snippet.totalReplyCount || 0,
            publishedAt: c.publishedAt,
          };
        });
      } catch {
        return []; // comments disabled or unavailable for this video
      }
    })
  );
  const all = perVideo.flat();
  const isQuestion = (c) => c.text.includes('?') || QUESTION_START.test(c.text.trim());
  const score = (c) => c.likes + c.replies * 2;
  const ranked = [...all].sort((a, b) => score(b) - score(a));
  return {
    total: all.length,
    top: ranked.slice(0, 5),
    questions: ranked.filter((c) => isQuestion(c) && c.text.length >= 25).slice(0, 40),
    insights: ranked.filter((c) => !isQuestion(c) && c.text.length >= 180).slice(0, 40),
  };
}

const decodeEntities = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

async function searchForum(p) {
  let q = p.q;
  if (p.order && p.order !== 'relevance') q += ` order:${p.order}`;
  if (p.after) q += ` after:${p.after.slice(0, 10)}`;
  if (p.before) q += ` before:${p.before.slice(0, 10)}`;
  const data = await getJson(`https://discuss.elastic.co/search.json?${qs({ q })}`);
  const firstPost = new Map();
  for (const post of data.posts || []) if (!firstPost.has(post.topic_id)) firstPost.set(post.topic_id, post);
  const topics = (data.topics || []).map((t) => ({
    id: t.id,
    title: t.title,
    url: `https://discuss.elastic.co/t/${t.slug}/${t.id}`,
    posts: t.posts_count,
    createdAt: t.created_at,
    solved: !!t.has_accepted_answer,
    tags: (t.tags || []).map((tag) => (typeof tag === 'string' ? tag : tag.name)).filter(Boolean),
    blurb: decodeEntities(firstPost.get(t.id)?.blurb || ''),
  }));
  return { topics: topics.slice(0, 20) };
}

async function suggestQuestions(p) {
  const q = p.q;
  const patterns = [
    ['How to', `how to ${q}`],
    ['Why', `why ${q}`],
    ['What', `what is ${q}`],
    ['Versus', `${q} vs`],
    ['With / for', `${q} with`],
    ['Problems', `${q} not`],
    ['Best', `best ${q}`],
    ['Elastic', `elastic ${q}`],
  ];
  const groups = await Promise.all(
    patterns.map(async ([label, query]) => {
      try {
        const data = await getJson(
          `https://suggestqueries.google.com/complete/search?${qs({ client: 'firefox', hl: 'en', q: query })}`
        );
        return { label, items: (data[1] || []).filter((s) => s.toLowerCase() !== query.toLowerCase()) };
      } catch {
        return { label, items: [] };
      }
    })
  );
  return { groups: groups.filter((g) => g.items.length) };
}

const routes = {
  '/api/status': async () => ({ hasKey: !!youtubeKey() }),
  '/api/thumbnails': analyseThumbnails,
  '/api/youtube': searchVideos,
  '/api/channel': channelReport,
  '/api/compare': compareChannels,
  '/api/comments': mineComments,
  '/api/forum': searchForum,
  '/api/suggest': suggestQuestions,
};
const NEEDS_TOPIC = new Set(['/api/youtube', '/api/forum', '/api/suggest']);
const STATIC = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (code, body, type = 'application/json') => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    // The front end: three fixed files in public/, read from disk each time so edits show on refresh.
    const page = STATIC[url.pathname];
    if (page) return send(200, fs.readFileSync(path.join(__dirname, 'public', page.file), 'utf8'), page.type);
    const handler = routes[url.pathname];
    if (!handler) return send(404, { error: 'Not found' });
    const params = Object.fromEntries(url.searchParams);
    if (NEEDS_TOPIC.has(url.pathname) && !params.q?.trim()) return send(400, { error: 'Missing topic' });
    try {
      let body;
      if (req.method === 'POST') {
        let raw = '';
        for await (const part of req) raw += part;
        body = raw ? JSON.parse(raw) : {};
      }
      send(200, await handler(params, body));
    } catch (err) {
      const quota = err.reason === 'quotaExceeded' ? ' (daily YouTube quota used up; resets at midnight Pacific)' : '';
      send(502, { error: err.message + quota });
    }
  })
  .listen(PORT, () => {
    console.log(`Topic Scout running at http://localhost:${PORT}`);
    console.log(youtubeKey() ? 'YouTube API key found.' : 'No YouTube API key yet: add YOUTUBE_API_KEY to .env');
  });

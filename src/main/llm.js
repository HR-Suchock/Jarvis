'use strict';
/** Port of Llm.java: Gemini, OpenAI-compatible and Anthropic chat, model lists, Google/Tavily search, OpenWeather. */

class ApiError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

const trimSlash = (s) => String(s || '').replace(/\/+$/, '');
const enc = encodeURIComponent;

function friendly(code, body) {
  let detail = '';
  try {
    const o = JSON.parse(body);
    const e = o.error;
    if (e && typeof e === 'object') detail = e.message || '';
    else if (typeof e === 'string') detail = e;
    if (!detail) detail = o.message || '';
  } catch (e) { /* not json */ }
  if (/^\s*<(?:!doctype|html)/i.test(String(body || ''))) {
    detail = (code === 403 || code === 401 || code === 407)
      ? 'a firewall, VPN, antivirus or network filter on this PC is blocking the request (the service itself did not answer). Try another network, switch the VPN off, or allow Jarvis in the firewall.'
      : 'the connection was answered by a web page instead of the service (check VPN, proxy or captive Wi-Fi login).';
  }
  if (!detail && body) detail = String(body).slice(0, 160);
  let head;
  if (code === 401) head = 'API key rejected (HTTP 401)';
  else if (code === 403) head = 'Access denied (HTTP 403)';
  else if (code === 404) head = 'Model or endpoint not found (HTTP 404)';
  else if (code === 429) head = 'Rate limit or quota reached (HTTP 429)';
  else if (code >= 500) head = 'The AI service is having trouble (HTTP ' + code + ')';
  else head = 'Request failed (HTTP ' + code + ')';
  return detail ? head + ': ' + detail : head;
}


/* The app's own browser network stack (Chromium) is used first: it follows the Windows proxy/VPN settings and looks like a normal browser to
   firewalls and CDNs. Plain Node fetch is the fallback (and what the unit tests use). */
let electronNet = null;
try { const el = require('electron'); if (el && el.net && typeof el.net.fetch === 'function') electronNet = el.net; } catch (e) { /* not inside Electron */ }
async function doFetch(url, init, alt) {
  if (electronNet && !alt) {
    try { return await electronNet.fetch(url, init); } catch (e) { if (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) throw e; /* fall through to Node */ }
  }
  return fetch(url, init);
}

async function http(method, url, headers, body, timeoutMs) {
  let res;
  try {
    const init = {
      method, signal: AbortSignal.timeout(timeoutMs),
      headers: Object.assign(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}, headers || {}),
      body: body ? JSON.stringify(body) : undefined,
    };
    res = await doFetch(url, init);
    // Some networks/CDNs answer Node's plain client with an HTML "403 Forbidden"; try the other network stack once.
    if (res.status === 403) {
      const ct = String(res.headers.get('content-type') || '');
      if (/html/i.test(ct)) {
        try { const r2 = await doFetch(url, init, true); if (r2.status !== 403) res = r2; } catch (e2) { /* keep first answer */ }
      }
    }
  } catch (e) {
    throw netError(e);
  }
  const text = await res.text();
  if (res.status >= 400) throw new ApiError(res.status, friendly(res.status, text));
  return text;
}

function netError(e) {
  const code = (e && (e.cause && e.cause.code || e.code)) || '';
  if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) return new Error('The AI took too long to respond.');
  if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|ECONNRESET|UND_ERR_CONNECT/.test(code) || (e && e.message === 'fetch failed')) return new Error('No internet connection.');
  return e;
}

async function chat(type, baseUrl, key, model, messages, system) {
  if (!key || !String(key).trim()) throw new ApiError(0, 'No API key set for this provider.');
  if (!model || !String(model).trim()) throw new ApiError(0, 'No model name set for this provider.');
  key = String(key).trim(); model = String(model).trim();
  if (type === 'gemini') return gemini(baseUrl, key, model, messages, system);
  if (type === 'anthropic') return anthropic(baseUrl, key, model, messages, system);
  return openai(baseUrl, key, model, messages, system);
}

async function gemini(base, key, model, msgs, system) {
  base = base || 'https://generativelanguage.googleapis.com';
  const body = {
    contents: msgs.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig: { maxOutputTokens: 8192, temperature: 0.8 },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const mdl = model.startsWith('models/') ? model.slice(7) : model;
  const url = trimSlash(base) + '/v1beta/models/' + mdl + ':generateContent';
  let out;
  try {
    out = await http('POST', url, { 'x-goog-api-key': key }, body, 45000);
  } catch (first) {
    if (!(first instanceof ApiError) || (first.code !== 401 && first.code !== 403)) throw first;
    try { out = await http('POST', url + '?key=' + enc(key), {}, body, 45000); }
    catch (second) {
      throw new ApiError(first.code, first.message + ' (also tried the key as a URL parameter). In Google AI Studio, check that this key is allowed to use the Gemini API.');
    }
  }
  const r = JSON.parse(out);
  const cands = r.candidates;
  if (!cands || !cands.length) {
    if (r.promptFeedback && r.promptFeedback.blockReason) throw new ApiError(0, 'The request was blocked: ' + r.promptFeedback.blockReason);
    throw new ApiError(0, 'The model returned no answer.');
  }
  const parts = (cands[0].content && cands[0].content.parts) || [];
  const t = parts.map((p) => p.text || '').join('').trim();
  if (!t) throw new ApiError(0, 'The model returned an empty answer.');
  return t;
}

async function openai(base, key, model, msgs, system) {
  if (!base || !String(base).trim()) throw new ApiError(0, 'No base URL set for this provider.');
  const all = [];
  if (system) all.push({ role: 'system', content: system });
  for (const m of msgs) all.push(m);
  const body = { model, messages: all };
  if (base.includes('api.openai.com')) body.max_completion_tokens = 1024;
  else { body.temperature = 0.8; body.max_tokens = 4096; }
  const out = await http('POST', trimSlash(base.trim()) + '/chat/completions',
    { Authorization: 'Bearer ' + key, 'HTTP-Referer': 'https://jarvis.local', 'X-Title': 'Jarvis' }, body, 60000);
  const r = JSON.parse(out);
  if (!r.choices || !r.choices.length) throw new ApiError(0, 'The model returned no answer.');
  let t = (r.choices[0].message && r.choices[0].message.content) || '';
  t = String(t).trim();
  if (!t) throw new ApiError(0, 'The model returned an empty answer.');
  return t;
}

async function anthropic(base, key, model, msgs, system) {
  base = base || 'https://api.anthropic.com';
  const body = { model, max_tokens: 4096, messages: msgs };
  if (system) body.system = system;
  const out = await http('POST', trimSlash(base) + '/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body, 60000);
  const r = JSON.parse(out);
  const t = (r.content || []).filter((p) => p.type === 'text').map((p) => p.text || '').join('').trim();
  if (!t) throw new ApiError(0, 'The model returned an empty answer.');
  return t;
}

async function listModels(type, baseUrl, key) {
  if (!key || !String(key).trim()) throw new ApiError(0, 'Enter an API key first.');
  key = String(key).trim();
  let ids = [];
  if (type === 'gemini') {
    const base = baseUrl || 'https://generativelanguage.googleapis.com';
    const o = JSON.parse(await http('GET', trimSlash(base) + '/v1beta/models?pageSize=200', { 'x-goog-api-key': key }, null, 20000));
    for (const m of o.models || []) {
      const ok = !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent');
      if (!ok) continue;
      let n = m.name || ''; if (n.startsWith('models/')) n = n.slice(7);
      if (n) ids.push(n);
    }
  } else if (type === 'anthropic') {
    const base = baseUrl || 'https://api.anthropic.com';
    const o = JSON.parse(await http('GET', trimSlash(base) + '/v1/models?limit=100', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, null, 20000));
    for (const m of o.data || []) ids.push(m.id);
  } else {
    if (!baseUrl || !String(baseUrl).trim()) throw new ApiError(0, 'Enter the base URL first.');
    const o = JSON.parse(await http('GET', trimSlash(baseUrl.trim()) + '/models', { Authorization: 'Bearer ' + key }, null, 20000));
    const arr = o.data || o.models || [];
    for (const it of arr) ids.push(typeof it === 'string' ? it : (it.id || it.name || ''));
  }
  return ids.filter(Boolean).sort();
}

async function googleSearch(key, cx, query) {
  if (!key || !String(key).trim() || !cx || !String(cx).trim()) throw new ApiError(0, 'Add your Google Search API key and Search Engine ID in Settings > Services.');
  if (!query || !String(query).trim()) throw new ApiError(0, 'What should I search for?');
  const url = 'https://www.googleapis.com/customsearch/v1?key=' + enc(key.trim()) + '&cx=' + enc(cx.trim()) + '&num=5&q=' + enc(query.trim());
  const o = JSON.parse(await http('GET', url, {}, null, 20000));
  return (o.items || []).slice(0, 5).map((it) => ({ title: it.title || '', snippet: String(it.snippet || '').replace(/\n/g, ' '), link: it.link || '' }));
}

async function tavily(key, query) {
  if (!key || !String(key).trim()) throw new ApiError(0, 'Add your Tavily API key in Settings > Services.');
  if (!query || !String(query).trim()) throw new ApiError(0, 'What should I search for?');
  const o = JSON.parse(await http('POST', 'https://api.tavily.com/search', { Authorization: 'Bearer ' + key.trim() },
    Object.assign({ query: query.trim(), max_results: 5, include_answer: true, search_depth: 'basic' }, looksFresh(query) ? { topic: 'news', days: 7 } : { time_range: 'year' }), 30000));
  const res = [];
  if (o.answer && o.answer !== 'null') res.push({ title: 'Summary', snippet: o.answer, link: '' });
  for (const it of (o.results || []).slice(0, 5)) {
    let c = String(it.content || '').replace(/\n/g, ' ');
    if (c.length > 320) c = c.slice(0, 320) + '...';
    res.push({ title: it.title || '', snippet: c, link: it.url || '' });
  }
  return res;
}

// ---- keyless / extra web search (v1.37)
const FRESH = /\b(news|latest|today|tonight|yesterday|now|current|currently|recent|recently|breaking|scores?|results?|prices?|rate|stock|weather|updates?|this week|this month|2026|2027)\b/i;
function looksFresh(q) { return FRESH.test(String(q || '')); }
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const htmlText = (s) => String(s).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const xmlTag = (x, n) => { const m = new RegExp('<' + n + '>([\\s\\S]*?)</' + n + '>').exec(x); return m ? htmlText(m[1].replace('<![CDATA[', '').replace(']]>', '')) : ''; };
async function newsRss(res, query, max) {
  const xml = await http('GET', 'https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q=' + enc(query.trim()), { 'User-Agent': UA }, null, 20000);
  let n = 0;
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    if (n >= max) break;
    const t = xmlTag(m[1], 'title'), l = xmlTag(m[1], 'link'), d = xmlTag(m[1], 'pubDate').replace(/ \d\d:\d\d:\d\d.*$/, '');
    if (t) { res.push({ title: t, snippet: (d ? d + ' \u2014 ' : '') + 'news headline', link: l }); n++; }
  }
}
async function ddg(res, query, max) {
  const html = await http('GET', 'https://html.duckduckgo.com/html/?q=' + enc(query.trim()), { 'User-Agent': UA }, null, 20000);
  const links = [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)], snips = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
  let n = 0;
  for (let i = 0; i < links.length && n < max; i++) {
    let link = links[i][1]; const title = htmlText(links[i][2]); let snip = snips[i] ? htmlText(snips[i][1]) : '';
    const u = /uddg=([^&]+)/.exec(link); if (u) { try { link = decodeURIComponent(u[1]); } catch (e) { /* keep */ } }
    if (link.startsWith('//')) link = 'https:' + link;
    if (!title || link.includes('duckduckgo.com/y.js')) continue;
    if (snip.length > 320) snip = snip.slice(0, 320) + '...';
    res.push({ title, snippet: snip, link }); n++;
  }
}
async function freeSearch(query) {
  if (!query || !String(query).trim()) throw new ApiError(0, 'What should I search for?');
  const res = []; let err = null; const fresh = looksFresh(query);
  if (fresh) { try { await newsRss(res, query, 4); } catch (e) { err = e; } }
  try { await ddg(res, query, fresh ? 3 : 5); } catch (e) { err = e; }
  if (!res.length && !fresh) { try { await newsRss(res, query, 5); } catch (e) { err = e; } }
  if (!res.length) throw err || new ApiError(0, 'No results found.');
  return res;
}
async function serper(key, query) {
  if (!key || !String(key).trim()) throw new ApiError(0, 'Add your Serper API key in Settings > Services.');
  if (!query || !String(query).trim()) throw new ApiError(0, 'What should I search for?');
  const body = { q: query.trim(), num: 5 }; if (looksFresh(query)) body.tbs = 'qdr:w';
  const o = JSON.parse(await http('POST', 'https://google.serper.dev/search', { 'X-API-KEY': key.trim() }, body, 25000));
  const res = [];
  const ab = o.answerBox; if (ab) { const a = ab.answer || ab.snippet || ''; if (a) res.push({ title: 'Summary', snippet: String(a), link: '' }); }
  for (const it of (o.organic || []).slice(0, 5)) res.push({ title: it.title || '', snippet: String(it.snippet || '').replace(/\n/g, ' '), link: it.link || '' });
  return res;
}

async function weather(key, place, units) {
  if (!key || !String(key).trim()) throw new ApiError(0, 'Add your OpenWeather API key in Settings > Services.');
  if (!place || !String(place).trim()) throw new ApiError(0, 'Which city?');
  const b = 'https://api.openweathermap.org';
  const u = units === 'imperial' ? 'imperial' : 'metric';
  const g = JSON.parse(await http('GET', b + '/geo/1.0/direct?limit=1&q=' + enc(place.trim()) + '&appid=' + enc(key.trim()), {}, null, 20000));
  if (!g.length) throw new ApiError(0, "I couldn't find a place called " + place + '.');
  const loc = g[0];
  const w = JSON.parse(await http('GET', b + '/data/2.5/weather?units=' + u + '&lat=' + loc.lat + '&lon=' + loc.lon + '&appid=' + enc(key.trim()), {}, null, 20000));
  const wa = (w.weather && w.weather[0]) || {};
  const nz = (v) => (v === undefined ? null : v);
  return {
    place: loc.name || place, country: loc.country || '', units: u,
    temp: nz(w.main && w.main.temp), feels: nz(w.main && w.main.feels_like), humidity: nz(w.main && w.main.humidity),
    desc: wa.description || '', wind: nz(w.wind && w.wind.speed), wid: wa.id || 0, icon: wa.icon || '',
  };
}

module.exports = { __http: http, doFetch,  chat, listModels, googleSearch, tavily, freeSearch, serper, weather, ApiError, netError };

'use strict';
/** Speech-to-text for the PC (Chromium's built-in recogniser is not available in Electron), using the keys you already added. */
const { netError } = require('./llm');

const LANG = { 'en-GB': 'en', 'bn-BD': 'bn', 'hi-IN': 'hi' };

function pickProvider(settings) {
  const p = (settings && settings.providers) || {};
  const has = (id) => p[id] && p[id].key && String(p[id].key).trim();
  if (has('groq')) return { id: 'groq', key: p.groq.key.trim() };
  if (has('openai')) return { id: 'openai', key: p.openai.key.trim() };
  if (has('gemini')) return { id: 'gemini', key: p.gemini.key.trim(), model: p.gemini.model || 'gemini-2.5-flash' };
  return null;
}

async function whisper(url, key, model, wav, lang) {
  const fd = new FormData();
  fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
  fd.append('model', model);
  fd.append('response_format', 'json');
  fd.append('temperature', '0');
  if (lang) fd.append('language', lang);
  let res;
  try { res = await fetchRetry(url, { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd, signal: AbortSignal.timeout(30000) }); }
  catch (e) { throw netError(e); }
  const text = await res.text();
  if (!res.ok) { const e = new Error('HTTP ' + res.status + ': ' + text.slice(0, 200)); e.status = res.status; throw e; }
  return String(JSON.parse(text).text || '').trim();
}

/* Browser network stack first (follows Windows proxy/VPN, accepted by firewalls), plain Node as the fallback. */
async function fetchRetry(url, init) { return require('./llm').doFetch(url, init); }

async function geminiStt(key, model, wav, lang) {
  const body = {
    contents: [{ role: 'user', parts: [
      { text: 'Transcribe this audio exactly as spoken (' + (lang || 'any language') + '). Output only the transcription in the original language and script. If there is no intelligible speech, output nothing.' },
      { inline_data: { mime_type: 'audio/wav', data: Buffer.from(wav).toString('base64') } }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 512 },
  };
  let res;
  try {
    res = await fetchRetry('https://generativelanguage.googleapis.com/v1beta/models/' + model.replace(/^models\//, '') + ':generateContent',
      { method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  } catch (e) { throw netError(e); }
  const text = await res.text();
  if (!res.ok) { const e = new Error('HTTP ' + res.status + ': ' + text.slice(0, 200)); e.status = res.status; throw e; }
  const r = JSON.parse(text);
  const parts = (r.candidates && r.candidates[0] && r.candidates[0].content && r.candidates[0].content.parts) || [];
  return parts.map((p) => p.text || '').join('').trim();
}

/** @returns {{ok:true,text:string}|{ok:false,code:string,error:string}} */
async function transcribe(settings, wav, appLang) {
  const prov = pickProvider(settings);
  if (!prov) return { ok: false, code: 'nokey', error: 'Voice input needs a Groq, OpenAI or Gemini key. Add one in Settings → Neural Link.' };
  const lang = LANG[appLang] || 'en';
  try {
    let text;
    if (prov.id === 'groq') text = await whisper('https://api.groq.com/openai/v1/audio/transcriptions', prov.key, 'whisper-large-v3-turbo', wav, lang);
    else if (prov.id === 'openai') {
      try { text = await whisper('https://api.openai.com/v1/audio/transcriptions', prov.key, 'gpt-4o-mini-transcribe', wav, lang); }
      catch (e) { if (e.status !== 400 && e.status !== 404) throw e; text = await whisper('https://api.openai.com/v1/audio/transcriptions', prov.key, 'whisper-1', wav, lang); }
    } else text = await geminiStt(prov.key, prov.model, wav, appLang);
    // Whisper sometimes "hears" a stock phrase in silence
    if (/^(thanks for watching|thank you for watching|you)[.! ]*$/i.test(text)) text = '';
    return { ok: true, text };
  } catch (e) {
    return { ok: false, code: 'net', error: 'Speech recognition failed: ' + (e && e.message ? e.message : e) };
  }
}

module.exports = { transcribe, pickProvider };

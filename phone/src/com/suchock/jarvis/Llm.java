package com.suchock.jarvis;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Minimal HTTP clients for Gemini, OpenAI-compatible APIs (OpenAI, Groq, OpenRouter, Mistral...) and Anthropic. */
final class Llm {
    private Llm() {
    }

    static final class ApiException extends Exception {
        final int code;

        ApiException(int code, String msg) {
            super(msg);
            this.code = code;
        }
    }

    private static String trimSlash(String s) {
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }

    private static String readAll(InputStream in) throws IOException {
        if (in == null) return "";
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        in.close();
        return bo.toString("UTF-8");
    }

    private static String friendlyError(int code, String body) {
        String detail = "";
        String t = body == null ? "" : body.trim();
        boolean page = t.startsWith("<") || t.toLowerCase().contains("<html");
        try {
            JSONObject o = new JSONObject(t);
            Object err = o.opt("error");
            if (err instanceof JSONObject) detail = ((JSONObject) err).optString("message", "");
            else if (err instanceof String) detail = (String) err;
            if (detail.length() == 0) detail = o.optString("message", "");
        } catch (Exception ignored) {
        }
        detail = detail.replaceAll("\\s+", " ").trim();
        if (detail.length() > 140) detail = detail.substring(0, 140) + "…";
        String head;
        if (code == 401) head = "The API key was rejected. Check that it is copied completely and belongs to this provider.";
        else if (code == 403) head = "Access was denied. The key has no permission for this, or the provider blocks this network or country.";
        else if (code == 404 || code == 405 || code == 415) head = page
                ? "That address is a website, not an AI service. Check the Base URL (OpenAI-style providers usually end with /v1)."
                : "The model or the address was not found. Check the model name and the Base URL.";
        else if (code == 408 || code == 504) head = "The service took too long to answer. Try again in a moment.";
        else if (code == 429) head = "The rate limit or free quota is used up. Wait a little, or use another provider.";
        else if (code >= 500) head = "The service is having trouble right now. Try again later or use another provider.";
        else head = page ? "The server sent back a web page instead of an answer. Check the Base URL." : "The request was refused.";
        if (page) detail = "";
        return detail.length() > 0 ? head + " (" + detail + ")" : head;
    }

    private static String http(String method, String url, String[][] headers, String body, int readTimeoutMs)
            throws IOException, ApiException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(15000);
        c.setReadTimeout(readTimeoutMs);
        for (String[] h : headers) c.setRequestProperty(h[0], h[1]);
        if (body != null) {
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            OutputStream os = c.getOutputStream();
            os.write(body.getBytes("UTF-8"));
            os.close();
        }
        int code = c.getResponseCode();
        String text = readAll(code >= 400 ? c.getErrorStream() : c.getInputStream());
        c.disconnect();
        if (code >= 400) throw new ApiException(code, friendlyError(code, text));
        return text;
    }

    // ------------------------------------------------------------------ chat

    static String chat(String type, String baseUrl, String key, String model, JSONArray messages, String system)
            throws Exception {
        if (key == null || key.trim().length() == 0) throw new ApiException(0, "No API key set for this provider.");
        if (model == null || model.trim().length() == 0) throw new ApiException(0, "No model name set for this provider.");
        key = key.trim();
        model = model.trim();
        if ("gemini".equals(type)) return gemini(baseUrl, key, model, messages, system);
        if ("anthropic".equals(type)) return anthropic(baseUrl, key, model, messages, system);
        return openai(baseUrl, key, model, messages, system);
    }

    private static String gemini(String base, String key, String model, JSONArray msgs, String system) throws Exception {
        if (base == null || base.length() == 0) base = "https://generativelanguage.googleapis.com";
        JSONObject body = new JSONObject();
        JSONArray contents = new JSONArray();
        for (int i = 0; i < msgs.length(); i++) {
            JSONObject m = msgs.getJSONObject(i);
            JSONObject c = new JSONObject();
            c.put("role", "assistant".equals(m.getString("role")) ? "model" : "user");
            c.put("parts", new JSONArray().put(new JSONObject().put("text", m.getString("content"))));
            contents.put(c);
        }
        body.put("contents", contents);
        if (system != null && system.length() > 0) {
            body.put("systemInstruction", new JSONObject().put("parts", new JSONArray().put(new JSONObject().put("text", system))));
        }
        body.put("generationConfig", new JSONObject().put("maxOutputTokens", 8192).put("temperature", 0.8));
        String mdl = model.startsWith("models/") ? model.substring(7) : model;
        String url = trimSlash(base) + "/v1beta/models/" + mdl + ":generateContent";
        String out;
        try {
            out = http("POST", url, new String[][]{{"x-goog-api-key", key}}, body.toString(), 45000);
        } catch (ApiException first) {
            if (first.code != 401 && first.code != 403) throw first;
            try {
                // some key types are only accepted as a query parameter
                out = http("POST", url + "?key=" + enc(key), new String[][]{}, body.toString(), 45000);
            } catch (ApiException second) {
                throw new ApiException(first.code, first.getMessage()
                        + " (also tried the key as a URL parameter). In Google AI Studio, check that this key is allowed to use the Gemini API.");
            }
        }
        JSONObject r = new JSONObject(out);
        JSONArray cands = r.optJSONArray("candidates");
        if (cands == null || cands.length() == 0) {
            JSONObject pf = r.optJSONObject("promptFeedback");
            if (pf != null && pf.has("blockReason")) throw new ApiException(0, "The request was blocked: " + pf.optString("blockReason"));
            throw new ApiException(0, "The model returned no answer.");
        }
        JSONObject content = cands.getJSONObject(0).optJSONObject("content");
        StringBuilder sb = new StringBuilder();
        if (content != null) {
            JSONArray parts = content.optJSONArray("parts");
            if (parts != null) {
                for (int i = 0; i < parts.length(); i++) sb.append(parts.getJSONObject(i).optString("text", ""));
            }
        }
        String t = sb.toString().trim();
        if (t.length() == 0) throw new ApiException(0, "The model returned an empty answer.");
        return t;
    }

    private static String openai(String base, String key, String model, JSONArray msgs, String system) throws Exception {
        if (base == null || base.trim().length() == 0) throw new ApiException(0, "No base URL set for this provider.");
        JSONArray all = new JSONArray();
        if (system != null && system.length() > 0) all.put(new JSONObject().put("role", "system").put("content", system));
        for (int i = 0; i < msgs.length(); i++) all.put(msgs.getJSONObject(i));
        JSONObject body = new JSONObject();
        body.put("model", model);
        body.put("messages", all);
        if (base.contains("api.openai.com")) {
            // newer OpenAI models reject max_tokens / custom temperature
            body.put("max_completion_tokens", 1024);
        } else {
            body.put("temperature", 0.8);
            body.put("max_tokens", 4096);
        }
        String url = trimSlash(base.trim()) + "/chat/completions";
        String out = http("POST", url, new String[][]{
                {"Authorization", "Bearer " + key},
                {"HTTP-Referer", "https://jarvis.local"},
                {"X-Title", "Jarvis"}}, body.toString(), 60000);
        JSONObject r = new JSONObject(out);
        JSONArray ch = r.optJSONArray("choices");
        if (ch == null || ch.length() == 0) throw new ApiException(0, "The model returned no answer.");
        JSONObject msg = ch.getJSONObject(0).optJSONObject("message");
        String t = msg == null ? "" : msg.optString("content", "");
        if ("null".equals(t)) t = "";
        t = t.trim();
        if (t.length() == 0) throw new ApiException(0, "The model returned an empty answer.");
        return t;
    }

    private static String anthropic(String base, String key, String model, JSONArray msgs, String system) throws Exception {
        if (base == null || base.length() == 0) base = "https://api.anthropic.com";
        JSONObject body = new JSONObject();
        body.put("model", model);
        body.put("max_tokens", 4096);
        if (system != null && system.length() > 0) body.put("system", system);
        body.put("messages", msgs);
        String out = http("POST", trimSlash(base) + "/v1/messages", new String[][]{
                {"x-api-key", key}, {"anthropic-version", "2023-06-01"}}, body.toString(), 60000);
        JSONObject r = new JSONObject(out);
        JSONArray content = r.optJSONArray("content");
        StringBuilder sb = new StringBuilder();
        if (content != null) {
            for (int i = 0; i < content.length(); i++) {
                JSONObject part = content.getJSONObject(i);
                if ("text".equals(part.optString("type"))) sb.append(part.optString("text", ""));
            }
        }
        String t = sb.toString().trim();
        if (t.length() == 0) throw new ApiException(0, "The model returned an empty answer.");
        return t;
    }

    // ------------------------------------------------------------ list models

    static JSONArray listModels(String type, String baseUrl, String key) throws Exception {
        if (key == null || key.trim().length() == 0) throw new ApiException(0, "Enter an API key first.");
        key = key.trim();
        List<String> ids = new ArrayList<String>();
        if ("gemini".equals(type)) {
            String base = (baseUrl == null || baseUrl.length() == 0) ? "https://generativelanguage.googleapis.com" : baseUrl;
            String out = http("GET", trimSlash(base) + "/v1beta/models?pageSize=200", new String[][]{{"x-goog-api-key", key}}, null, 20000);
            JSONArray arr = new JSONObject(out).optJSONArray("models");
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject m = arr.getJSONObject(i);
                    JSONArray methods = m.optJSONArray("supportedGenerationMethods");
                    boolean ok = methods == null;
                    if (methods != null) {
                        for (int j = 0; j < methods.length(); j++) if ("generateContent".equals(methods.getString(j))) ok = true;
                    }
                    if (!ok) continue;
                    String n = m.optString("name", "");
                    if (n.startsWith("models/")) n = n.substring(7);
                    if (n.length() > 0) ids.add(n);
                }
            }
        } else if ("anthropic".equals(type)) {
            String base = (baseUrl == null || baseUrl.length() == 0) ? "https://api.anthropic.com" : baseUrl;
            String out = http("GET", trimSlash(base) + "/v1/models?limit=100", new String[][]{
                    {"x-api-key", key}, {"anthropic-version", "2023-06-01"}}, null, 20000);
            JSONArray arr = new JSONObject(out).optJSONArray("data");
            if (arr != null) for (int i = 0; i < arr.length(); i++) ids.add(arr.getJSONObject(i).optString("id"));
        } else {
            if (baseUrl == null || baseUrl.trim().length() == 0) throw new ApiException(0, "Enter the base URL first.");
            String out = http("GET", trimSlash(baseUrl.trim()) + "/models", new String[][]{{"Authorization", "Bearer " + key}}, null, 20000);
            JSONObject o = new JSONObject(out);
            JSONArray arr = o.optJSONArray("data");
            if (arr == null) arr = o.optJSONArray("models");
            if (arr != null) for (int i = 0; i < arr.length(); i++) {
                Object it = arr.get(i);
                if (it instanceof JSONObject) ids.add(((JSONObject) it).optString("id", ((JSONObject) it).optString("name", "")));
                else if (it instanceof String) ids.add((String) it);
            }
        }
        Collections.sort(ids);
        JSONArray res = new JSONArray();
        for (String s : ids) if (s != null && s.length() > 0) res.put(s);
        return res;
    }

    private static String enc(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }

    // ------------------------------------------------------------ OpenWeather

    static JSONObject weather(String base, String key, String place, String units) throws Exception {
        if (key == null || key.trim().length() == 0)
            throw new ApiException(0, "Add your OpenWeather API key in Settings > Services.");
        if (place == null || place.trim().length() == 0) throw new ApiException(0, "Which city?");
        String b = (base == null || base.length() == 0) ? "https://api.openweathermap.org" : trimSlash(base);
        String u = "imperial".equals(units) ? "imperial" : "metric";
        String geo = http("GET", b + "/geo/1.0/direct?limit=1&q=" + enc(place.trim()) + "&appid=" + enc(key.trim()),
                new String[][]{}, null, 20000);
        JSONArray g = new JSONArray(geo);
        if (g.length() == 0) throw new ApiException(0, "I couldn't find a place called " + place + ".");
        JSONObject loc = g.getJSONObject(0);
        String out = http("GET", b + "/data/2.5/weather?units=" + u + "&lat=" + loc.getDouble("lat") + "&lon=" + loc.getDouble("lon")
                + "&appid=" + enc(key.trim()), new String[][]{}, null, 20000);
        JSONObject w = new JSONObject(out);
        JSONObject main = w.optJSONObject("main");
        JSONArray wa = w.optJSONArray("weather");
        JSONObject wind = w.optJSONObject("wind");
        JSONObject res = new JSONObject();
        res.put("place", loc.optString("name", place));
        res.put("country", loc.optString("country", ""));
        res.put("units", u);
        res.put("temp", main == null ? JSONObject.NULL : main.opt("temp"));
        res.put("feels", main == null ? JSONObject.NULL : main.opt("feels_like"));
        res.put("humidity", main == null ? JSONObject.NULL : main.opt("humidity"));
        res.put("desc", wa != null && wa.length() > 0 ? wa.getJSONObject(0).optString("description", "") : "");
        res.put("wind", wind == null ? JSONObject.NULL : wind.opt("speed"));
        res.put("wid", wa != null && wa.length() > 0 ? wa.getJSONObject(0).optInt("id", 0) : 0);
        res.put("icon", wa != null && wa.length() > 0 ? wa.getJSONObject(0).optString("icon", "") : "");
        return res;
    }


    // ------------------------------------------------------------ keyless / extra web search (v1.37)

    /** True when the question is about something that changes (news, scores, prices, "today", "latest"). */
    static boolean looksFresh(String q) {
        return q != null && q.toLowerCase(java.util.Locale.ROOT).matches(".*\\b(news|latest|today|tonight|yesterday|now|current|currently|recent|recently|breaking|score|scores|result|results|price|prices|rate|stock|weather|update|updates|this week|this month|2026|2027)\\b.*");
    }

    private static String htmlText(String s) {
        return s.replaceAll("<[^>]*>", "").replace("&amp;", "&").replace("&quot;", "\"").replace("&#x27;", "'").replace("&#39;", "'")
                .replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ").replaceAll("\\s+", " ").trim();
    }

    private static final String UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

    /** Google News RSS: no key, always fresh. */
    private static void newsRss(JSONArray res, String query, int max) throws Exception {
        String xml = http("GET", "https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q=" + enc(query.trim()), new String[][]{{"User-Agent", UA}}, null, 20000);
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("<item>(.*?)</item>", java.util.regex.Pattern.DOTALL).matcher(xml);
        int n = 0;
        while (m.find() && n < max) {
            String it = m.group(1);
            String t = tag(it, "title"), l = tag(it, "link"), d = tag(it, "pubDate");
            if (t.length() == 0) continue;
            res.put(new JSONObject().put("title", t).put("snippet", (d.length() > 0 ? d.replaceAll(" \\d\\d:\\d\\d:\\d\\d.*$", "") + " \u2014 " : "") + "news headline").put("link", l));
            n++;
        }
    }

    private static String tag(String x, String name) {
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("<" + name + ">(.*?)</" + name + ">", java.util.regex.Pattern.DOTALL).matcher(x);
        return m.find() ? htmlText(m.group(1).replace("<![CDATA[", "").replace("]]>", "")) : "";
    }

    /** DuckDuckGo HTML results: no key, no card, no limit. */
    private static void ddg(JSONArray res, String query, int max) throws Exception {
        String html = http("GET", "https://html.duckduckgo.com/html/?q=" + enc(query.trim()), new String[][]{{"User-Agent", UA}}, null, 20000);
        java.util.regex.Matcher a = java.util.regex.Pattern.compile("class=\"result__a\"[^>]*href=\"([^\"]+)\"[^>]*>(.*?)</a>", java.util.regex.Pattern.DOTALL).matcher(html);
        java.util.regex.Matcher sn = java.util.regex.Pattern.compile("class=\"result__snippet\"[^>]*>(.*?)</a>", java.util.regex.Pattern.DOTALL).matcher(html);
        int n = 0;
        while (a.find() && n < max) {
            String link = a.group(1), title = htmlText(a.group(2)), snip = sn.find() ? htmlText(sn.group(1)) : "";
            int u = link.indexOf("uddg=");
            if (u >= 0) { String r = link.substring(u + 5); int amp = r.indexOf('&'); if (amp > 0) r = r.substring(0, amp); try { link = java.net.URLDecoder.decode(r, "UTF-8"); } catch (Exception ignored) { } }
            if (link.startsWith("//")) link = "https:" + link;
            if (title.length() == 0 || link.contains("duckduckgo.com/y.js")) continue;
            if (snip.length() > 320) snip = snip.substring(0, 320) + "...";
            res.put(new JSONObject().put("title", title).put("snippet", snip).put("link", link));
            n++;
        }
    }

    /** No-key search: news headlines for "fresh" questions, DuckDuckGo for everything else (each one backs up the other). */
    static JSONArray freeSearch(String query) throws Exception {
        if (query == null || query.trim().length() == 0) throw new ApiException(0, "What should I search for?");
        JSONArray res = new JSONArray();
        Exception err = null;
        boolean fresh = looksFresh(query);
        try { if (fresh) newsRss(res, query, 4); } catch (Exception e) { err = e; }
        try { ddg(res, query, fresh ? 3 : 5); } catch (Exception e) { err = e; }
        if (res.length() == 0 && !fresh) { try { newsRss(res, query, 5); } catch (Exception e) { err = e; } }
        if (res.length() == 0) throw err != null ? err : new ApiException(0, "No results found.");
        return res;
    }

    /** SerpApi (Google results, 250 free searches a month, no card). */
    static JSONArray serpapi(String key, String query) throws Exception {
        if (key == null || key.trim().length() == 0) throw new ApiException(0, "Add your SerpApi key in Settings > Services.");
        if (query == null || query.trim().length() == 0) throw new ApiException(0, "What should I search for?");
        boolean fresh = looksFresh(query);
        String url = "https://serpapi.com/search.json?engine=google&num=5&q=" + URLEncoder.encode(query.trim(), "UTF-8")
                + (fresh ? "&tbs=qdr:w" : "") + "&api_key=" + URLEncoder.encode(key.trim(), "UTF-8");
        JSONObject r = new JSONObject(http("GET", url, new String[][]{}, null, 25000));
        if (r.has("error")) throw new ApiException(0, r.optString("error").toLowerCase().contains("run out") ? "SerpApi: this month's free searches are used up." : "SerpApi: " + r.optString("error"));
        JSONArray res = new JSONArray();
        JSONObject ab = r.optJSONObject("answer_box");
        if (ab != null) { String a = ab.optString("answer", ab.optString("snippet", ab.optString("result", ""))); if (a.length() > 0) res.put(new JSONObject().put("title", "Summary").put("snippet", a).put("link", "")); }
        JSONArray news = fresh ? r.optJSONArray("news_results") : null;
        for (int i = 0; news != null && i < news.length() && i < 3; i++) {
            JSONObject it = news.getJSONObject(i);
            res.put(new JSONObject().put("title", it.optString("title", "")).put("snippet", it.optString("snippet", it.optString("source", ""))).put("link", it.optString("link", "")));
        }
        JSONArray items = r.optJSONArray("organic_results");
        for (int i = 0; items != null && i < items.length() && res.length() < 6; i++) {
            JSONObject it = items.getJSONObject(i);
            res.put(new JSONObject().put("title", it.optString("title", "")).put("snippet", it.optString("snippet", "").replace("\n", " ")).put("link", it.optString("link", "")));
        }
        if (res.length() == 0) throw new ApiException(0, "No results found.");
        return res;
    }

    // ------------------------------------------------------------ Tavily web search

    static JSONArray tavily(String base, String key, String query) throws Exception {
        if (key == null || key.trim().length() == 0)
            throw new ApiException(0, "Add your Tavily API key in Settings > Services.");
        if (query == null || query.trim().length() == 0) throw new ApiException(0, "What should I search for?");
        String b = (base == null || base.length() == 0) ? "https://api.tavily.com" : trimSlash(base);
        JSONObject body = new JSONObject();
        body.put("query", query.trim());
        body.put("max_results", 5);
        body.put("include_answer", true);
        body.put("search_depth", "basic");
        if (looksFresh(query)) { body.put("topic", "news"); body.put("days", 7); } else body.put("time_range", "year");      // recent results first
        String out = http("POST", b + "/search", new String[][]{{"Authorization", "Bearer " + key.trim()}}, body.toString(), 30000);
        JSONObject r = new JSONObject(out);
        JSONArray res = new JSONArray();
        String answer = r.optString("answer", "");
        if (answer.length() > 0 && !"null".equals(answer)) {
            res.put(new JSONObject().put("title", "Summary").put("snippet", answer).put("link", ""));
        }
        JSONArray items = r.optJSONArray("results");
        if (items != null) {
            for (int i = 0; i < items.length() && i < 5; i++) {
                JSONObject it = items.getJSONObject(i);
                String c = it.optString("content", "").replace("\n", " ");
                if (c.length() > 320) c = c.substring(0, 320) + "...";
                res.put(new JSONObject()
                        .put("title", it.optString("title", ""))
                        .put("snippet", c)
                        .put("link", it.optString("url", "")));
            }
        }
        return res;
    }
}
// CRB-MARK a822ccf18ea0

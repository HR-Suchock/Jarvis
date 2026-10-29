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
        try {
            JSONObject o = new JSONObject(body);
            Object err = o.opt("error");
            if (err instanceof JSONObject) detail = ((JSONObject) err).optString("message", "");
            else if (err instanceof String) detail = (String) err;
            if (detail.length() == 0) detail = o.optString("message", "");
        } catch (Exception ignored) {
        }
        if (detail.length() == 0 && body != null) {
            detail = body.length() > 160 ? body.substring(0, 160) : body;
        }
        String head;
        if (code == 401) head = "API key rejected (HTTP 401)";
        else if (code == 403) head = "Access denied (HTTP 403)";
        else if (code == 404) head = "Model or endpoint not found (HTTP 404)";
        else if (code == 429) head = "Rate limit or quota reached (HTTP 429)";
        else if (code >= 500) head = "The AI service is having trouble (HTTP " + code + ")";
        else head = "Request failed (HTTP " + code + ")";
        return detail.length() > 0 ? head + ": " + detail : head;
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

    // ------------------------------------------------------------ Google Custom Search

    static JSONArray googleSearch(String base, String key, String cx, String query) throws Exception {
        if (key == null || key.trim().length() == 0 || cx == null || cx.trim().length() == 0)
            throw new ApiException(0, "Add your Google Search API key and Search Engine ID in Settings > Services.");
        if (query == null || query.trim().length() == 0) throw new ApiException(0, "What should I search for?");
        String b = (base == null || base.length() == 0) ? "https://www.googleapis.com" : trimSlash(base);
        String url = b + "/customsearch/v1?key=" + enc(key.trim()) + "&cx=" + enc(cx.trim()) + "&num=5&q=" + enc(query.trim());
        String out = http("GET", url, new String[][]{}, null, 20000);
        JSONArray items = new JSONObject(out).optJSONArray("items");
        JSONArray res = new JSONArray();
        if (items != null) {
            for (int i = 0; i < items.length() && i < 5; i++) {
                JSONObject it = items.getJSONObject(i);
                res.put(new JSONObject()
                        .put("title", it.optString("title", ""))
                        .put("snippet", it.optString("snippet", "").replace("\n", " "))
                        .put("link", it.optString("link", "")));
            }
        }
        return res;
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

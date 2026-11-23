package com.suchock.jarvis;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Small network helpers for the Tools panel. Only a fixed list of hosts can be reached (the page itself cannot make requests).
 * ping/down/up use Cloudflare's public speed-test endpoints; hibp = password-leak check (only the first 5 characters of a hash are sent);
 * rates = currency rates. No AI keys and no tokens are involved.
 */
final class NetTools {
    private NetTools() { }

    static JSONObject call(String kind, String arg) throws Exception {
        JSONObject o = new JSONObject();
        if ("ping".equals(kind)) {
            long t = System.nanoTime();
            drain(open("https://speed.cloudflare.com/__down?bytes=0", "GET", 8000));
            o.put("ms", (System.nanoTime() - t) / 1000000.0);
        } else if ("down".equals(kind)) {
            long bytes = clamp(arg, 100000, 60000000);
            long t = System.nanoTime();
            long got = drain(open("https://speed.cloudflare.com/__down?bytes=" + bytes, "GET", 30000));
            o.put("bytes", got).put("ms", (System.nanoTime() - t) / 1000000.0);
        } else if ("up".equals(kind)) {
            long bytes = clamp(arg, 50000, 30000000);
            HttpURLConnection c = open("https://speed.cloudflare.com/__up", "POST", 30000);
            c.setDoOutput(true);
            c.setFixedLengthStreamingMode(bytes);
            c.setRequestProperty("Content-Type", "application/octet-stream");
            byte[] buf = new byte[65536];
            long t = System.nanoTime();
            OutputStream os = c.getOutputStream();
            long left = bytes;
            while (left > 0) { int n = (int) Math.min(buf.length, left); os.write(buf, 0, n); left -= n; }
            os.flush();
            os.close();
            drain(c);
            o.put("bytes", bytes).put("ms", (System.nanoTime() - t) / 1000000.0);
        } else if ("hibp".equals(kind)) {
            if (arg == null || !arg.matches("[0-9A-Fa-f]{5}")) throw new Exception("Bad request.");
            HttpURLConnection c = open("https://api.pwnedpasswords.com/range/" + arg.toUpperCase(), "GET", 15000);
            c.setRequestProperty("Add-Padding", "true");
            o.put("text", read(c, 400000));
        } else if ("rates".equals(kind)) {
            o.put("text", read(open("https://open.er-api.com/v6/latest/USD", "GET", 15000), 200000));
        } else {
            throw new Exception("Unknown tool request.");
        }
        return o;
    }

    private static long clamp(String s, long lo, long hi) {
        long v;
        try { v = Long.parseLong(s.trim()); } catch (Exception e) { v = lo; }
        return Math.max(lo, Math.min(hi, v));
    }

    private static HttpURLConnection open(String url, String method, int timeout) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(8000);
        c.setReadTimeout(timeout);
        c.setUseCaches(false);
        c.setRequestProperty("Cache-Control", "no-cache");
        c.setRequestProperty("User-Agent", "Jarvis");
        return c;
    }

    private static long drain(HttpURLConnection c) throws Exception {
        int code = c.getResponseCode();
        if (code >= 400) throw new Exception("The test server answered with an error. Try again in a moment.");
        InputStream in = c.getInputStream();
        byte[] buf = new byte[65536];
        long n = 0;
        int r;
        while ((r = in.read(buf)) > 0) n += r;
        in.close();
        return n;
    }

    private static String read(HttpURLConnection c, int max) throws Exception {
        int code = c.getResponseCode();
        if (code >= 400) throw new Exception("The service did not answer. Try again later.");
        InputStream in = c.getInputStream();
        java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int r;
        while ((r = in.read(buf)) > 0) { bo.write(buf, 0, r); if (bo.size() > max) break; }
        in.close();
        return bo.toString("UTF-8");
    }
}
// CRB-MARK 6e3c85be999c

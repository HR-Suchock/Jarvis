package com.suchock.jarvis;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * Device-link client: Firebase Realtime Database over plain REST + server-sent events (same layout as pc/src/main/relay.js).
 * No Android classes, no SDK. Messages are AES-GCM sealed by {@link LinkCore}; the database only stores ciphertext.
 */
final class LinkClient {
    interface Handler {
        /** Runs a command that arrived from the other device. Must return quickly-ish (it runs on a worker thread). */
        Result onCommand(String type, String arg, String arg2);

        void onStatus(boolean connected);
    }

    static final class Result {
        final boolean ok;
        final String msg;

        Result(boolean ok, String msg) {
            this.ok = ok;
            this.msg = msg == null ? "" : msg;
        }
    }

    private final String me, peer;
    private final Handler handler;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Map<String, LinkedBlockingQueue<Result>> waiters = new ConcurrentHashMap<String, LinkedBlockingQueue<Result>>();
    private final Set<String> seen = new HashSet<String>();
    private volatile int run = 0;
    private volatile HttpURLConnection current;
    private volatile boolean connected = false;
    private String base;
    private LinkCore.Keys keys;

    LinkClient(String me, String peer, Handler handler) {
        this.me = me;
        this.peer = peer;
        this.handler = handler;
    }

    boolean isConnected() {
        return connected;
    }

    synchronized void start(String dbUrl, String secret) throws Exception {
        stop();
        keys = LinkCore.derive(secret);
        base = dbUrl + "/jarvis/" + keys.room + "/inbox";
        final int my = ++run;
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                loop(my);
            }
        }, "jarvis-link");
        t.setDaemon(true);
        t.start();
    }

    synchronized void stop() {
        run++;
        HttpURLConnection c = current;
        if (c != null) {
            try {
                c.disconnect();
            } catch (Exception ignored) {
            }
        }
        setConnected(false);
    }

    private void setConnected(boolean v) {
        if (connected != v) {
            connected = v;
            try {
                handler.onStatus(v);
            } catch (Exception ignored) {
            }
        }
    }

    private void loop(int my) {
        long delay = 1000;
        while (my == run) {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(base + "/" + me + ".json").openConnection();
                current = c;
                c.setRequestProperty("Accept", "text/event-stream");
                c.setConnectTimeout(15000);
                c.setReadTimeout(75000);                       // keep-alives arrive about every 30 s; silence means the link is dead
                int code = c.getResponseCode();
                if (code != 200) throw new Exception("HTTP " + code);
                setConnected(true);
                delay = 1000;
                BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"));
                String ev = "";
                StringBuilder data = new StringBuilder();
                String line;
                while (my == run && (line = r.readLine()) != null) {
                    if (line.length() == 0) {
                        dispatch(ev, data.toString());
                        ev = "";
                        data.setLength(0);
                    } else if (line.startsWith("event:")) ev = line.substring(6).trim();
                    else if (line.startsWith("data:")) data.append(line.substring(5).trim());
                }
                try {
                    r.close();
                } catch (Exception ignored) {
                }
            } catch (Exception e) {
                // fall through to retry
            }
            if (my != run) return;
            setConnected(false);
            try {
                Thread.sleep(delay);
            } catch (InterruptedException ie) {
                return;
            }
            delay = Math.min(delay * 2, 30000);
        }
    }

    @SuppressWarnings("unchecked")
    private void dispatch(String ev, String data) {
        if (!ev.equals("put") && !ev.equals("patch")) return;
        Object o;
        try {
            o = LinkJson.parse(data);
        } catch (Exception e) {
            return;
        }
        String path = LinkJson.str(o, "path");
        Object d = LinkJson.obj(o) == null ? null : LinkJson.obj(o).get("data");
        if (path.equals("/")) {
            Map<String, Object> map = LinkJson.obj(d);
            if (map != null) for (Map.Entry<String, Object> e : new LinkedHashMap<String, Object>(map).entrySet()) incoming(e.getKey(), e.getValue());
        } else if (path.length() > 1 && path.indexOf('/', 1) < 0 && d != null) {
            incoming(path.substring(1), d);
        }
    }

    private void incoming(final String key, final Object env) {
        synchronized (seen) {
            if (!seen.add(key)) return;
            if (seen.size() > 1000) seen.clear();
        }
        final int my = run;
        pool.execute(new Runnable() {
            @Override
            public void run() {
                request("DELETE", me + "/" + enc(key), null);        // consumed (or garbage) either way
                Map<String, Object> m = LinkCore.open(keys.key, env, me, System.currentTimeMillis());
                if (m == null || my != run) return;
                handle(m);
            }
        });
    }

    private void handle(Map<String, Object> m) {
        String k = LinkJson.str(m, "k"), id = LinkJson.str(m, "id");
        try {
            if (k.equals("res") || k.equals("pong")) {
                LinkedBlockingQueue<Result> q = waiters.get(LinkJson.str(m, "re"));
                if (q != null) q.offer(new Result(!Boolean.FALSE.equals(m.get("ok")), LinkJson.str(m, "msg")));
            } else if (k.equals("ping")) {
                Map<String, Object> b = new LinkedHashMap<String, Object>();
                b.put("k", "pong");
                b.put("re", id);
                b.put("ok", Boolean.TRUE);
                b.put("msg", "Online.");
                post(peer, b);
            } else if (k.equals("cmd")) {
                Result r;
                try {
                    r = handler.onCommand(LinkJson.str(m, "type"), LinkJson.str(m, "arg"), LinkJson.str(m, "arg2"));
                } catch (Exception e) {
                    r = new Result(false, "That failed: " + e.getMessage());
                }
                Map<String, Object> b = new LinkedHashMap<String, Object>();
                b.put("k", "res");
                b.put("re", id);
                b.put("ok", Boolean.valueOf(r.ok));
                b.put("msg", r.msg.length() > 500 ? r.msg.substring(0, 500) : r.msg);
                post(peer, b);
            }
        } catch (Exception ignored) {
        }
    }

    private static String enc(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }

    private String request(String method, String path, String body) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(base + "/" + path + ".json").openConnection();
            c.setRequestMethod(method);
            c.setConnectTimeout(15000);
            c.setReadTimeout(15000);
            if (body != null) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                OutputStream os = c.getOutputStream();
                os.write(body.getBytes("UTF-8"));
                os.close();
            }
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in != null) {
                while (in.read() >= 0) { /* drain */ }
                in.close();
            }
            c.disconnect();
            return code >= 400 ? null : "ok";
        } catch (Exception e) {
            return null;
        }
    }

    private String post(String to, Map<String, Object> body) throws Exception {
        byte[] rnd = new byte[9];
        new java.security.SecureRandom().nextBytes(rnd);
        String id = LinkCore.b64uEnc(rnd);
        Map<String, Object> msg = new LinkedHashMap<String, Object>();
        msg.put("id", id);
        msg.put("ts", Long.valueOf(System.currentTimeMillis()));
        msg.put("from", me);
        msg.putAll(body);
        String ok = request("POST", to, LinkJson.write(LinkCore.seal(keys.key, msg, to)));
        if (ok == null) throw new Exception("Database write failed.");
        return id;
    }

    /** Blocking: sends a command to the other device and waits for its answer. Call from a worker thread. */
    Result send(String type, String arg, String arg2, long timeoutMs) {
        if (keys == null) return new Result(false, "Device link is not set up. Open Settings → Device Link.");
        try {
            // register the waiter before posting so a very fast answer cannot be missed
            Map<String, Object> b = new LinkedHashMap<String, Object>();
            b.put("k", "cmd");
            b.put("type", type);
            b.put("arg", arg == null ? "" : arg);
            b.put("arg2", arg2 == null ? "" : arg2);
            return awaitPosted(b, timeoutMs);
        } catch (Exception e) {
            return new Result(false, "Could not reach the link database: " + e.getMessage());
        }
    }

    Result ping() {
        if (keys == null) return new Result(false, "Device link is not set up.");
        try {
            Map<String, Object> b = new LinkedHashMap<String, Object>();
            b.put("k", "ping");
            return awaitPosted(b, 12000);
        } catch (Exception e) {
            return new Result(false, "Could not reach the link database: " + e.getMessage());
        }
    }

    private Result awaitPosted(Map<String, Object> body, long ms) throws Exception {
        final LinkedBlockingQueue<Result> q = new LinkedBlockingQueue<Result>();
        String id = postRegistering(peer, body, q);
        try {
            Result r = q.poll(ms, TimeUnit.MILLISECONDS);
            return r != null ? r : new Result(false, "No answer — the other device may be offline, asleep, or has the link switched off.");
        } finally {
            waiters.remove(id);
        }
    }

    private String postRegistering(String to, Map<String, Object> body, LinkedBlockingQueue<Result> q) throws Exception {
        byte[] rnd = new byte[9];
        new java.security.SecureRandom().nextBytes(rnd);
        String id = LinkCore.b64uEnc(rnd);
        waiters.put(id, q);
        Map<String, Object> msg = new LinkedHashMap<String, Object>();
        msg.put("id", id);
        msg.put("ts", Long.valueOf(System.currentTimeMillis()));
        msg.put("from", me);
        msg.putAll(body);
        if (request("POST", to, LinkJson.write(LinkCore.seal(keys.key, msg, to))) == null) {
            waiters.remove(id);
            throw new Exception("Database write failed.");
        }
        return id;
    }
}

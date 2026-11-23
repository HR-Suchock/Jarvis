package com.suchock.jarvis;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;
import android.view.HapticFeedbackConstants;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** The object exposed to the web UI as window.AndroidBridge. */
public final class Bridge implements Voice.Emitter {
    static final int REQ_PERMS = 41;

    private final MainActivity act;
    private final WebView web;
    private final SharedPreferences prefs;
    private final Voice voice;
    private final Actions actions;
    private final ExecutorService net = Executors.newCachedThreadPool();
    static volatile Bridge current;
    String launchFlag = "";
    /** Set by the owning MainActivity when its WebView shows our own page. Per instance, so an old activity closing can never switch this one off. */
    volatile boolean trusted = false;

    Bridge(MainActivity a, WebView w) {
        act = a;
        web = w;
        prefs = a.getSharedPreferences("jarvis", Context.MODE_PRIVATE);
        voice = new Voice(a, this);
        actions = new Actions(a);
        actions.owner = this;
        current = this;
        RelayService.sync(a);                    // (re)start the PC link service if the link is switched on
    }

    // ----------------------------------------------------------- native -> JS

    @Override
    public void emit(final String event, final JSONObject data) {
        if (MainActivity.locked) return;
        final String js = "window.JarvisNative&&window.JarvisNative.emit(" + JSONObject.quote(event) + "," + data.toString() + ")";
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                web.evaluateJavascript(js, null);
            }
        });
    }

    private void emit(String event, String k, Object v) {
        JSONObject o = new JSONObject();
        try {
            o.put(k, v);
        } catch (Exception ignored) {
        }
        emit(event, o);
    }

    void onPermissionsResult() {
        emit("permissions", new JSONObject());
    }

    void destroy() {
        if (current == this) current = null;
        voice.destroy();
        net.shutdownNow();
    }

    void pause() {
        voice.stopListening();
    }

    // ----------------------------------------------------------- JS -> native

    @JavascriptInterface
    public String getPref(String key) {
        if (!ok()) return "";
        String v = prefs.getString(key, "");
        if (v.length() > 0 && !Secure.isSealed(v)) {
            if (Secure.available()) {                // migrate old plaintext to encrypted storage, but only after proving it round-trips
                String sealed = Secure.seal(v);
                if (sealed != null && v.equals(Secure.open(sealed))) prefs.edit().putString(key, sealed).apply();
            }
            return v;
        }
        return Secure.open(v);
    }

    String prefInternal(String key) {
        return Secure.open(prefs.getString(key, ""));
    }

    /** The notes list for the home-screen notes widget (JSON array of strings). */
    @JavascriptInterface
    public void notesSync(String json) {
        JarvisNotesWidget.save(act, json);
    }

    @JavascriptInterface
    public void wipeAll() {
        if (!ok()) return;
        prefs.edit().clear().commit();
        JarvisNotesWidget.save(act, "[]");
        Secure.deleteKey();
        web.post(new Runnable() {
            @Override
            public void run() {
                web.clearCache(true);
            }
        });
    }

    /** Only our own bundled page, shown while the app is unlocked, may use the bridge. */
    private boolean ok() {
        return trusted && !MainActivity.locked;
    }

    @JavascriptInterface
    public void setPref(String key, String value) {
        if (!ok() || key == null || key.length() > 64 || value == null) return;
        String stored = value;
        if (value.length() > 0 && Secure.available()) {
            String sealed = Secure.seal(value);
            if (sealed != null) stored = sealed;     // if this phone's Keystore is broken we keep the app-private copy so nothing is lost
        }
        prefs.edit().putString(key, stored).commit();
        if ("settings".equals(key)) {
            final Context app = act.getApplicationContext();
            net.execute(new Runnable() {
                @Override
                public void run() {
                    JarvisWidget.refresh(app);        // picks up a changed city / key / units
                }
            });
        }
    }

    @JavascriptInterface
    public void speak(String text, String lang, double rate, double pitch) {
        if (!ok()) return;
        voice.speak(text, lang, rate, pitch);
    }

    @JavascriptInterface
    public void stopSpeaking() {
        if (!ok()) return;
        voice.stopSpeaking();
    }

    @JavascriptInterface
    public void listen(String lang) {
        if (!ok()) return;
        voice.listen(lang);
    }

    @JavascriptInterface
    public void stopListening() {
        voice.stopListening();
    }

    @JavascriptInterface
    public void chat(final String id, final String type, final String baseUrl, final String key, final String model,
                     final String messagesJson, final String system) {
        if (!ok()) return;
        net.execute(new Runnable() {
            @Override
            public void run() {
                JSONObject out = new JSONObject();
                try {
                    out.put("id", id);
                    String text = Llm.chat(type, baseUrl, key, model, new JSONArray(messagesJson), system);
                    out.put("ok", true);
                    out.put("text", text);
                } catch (Exception e) {
                    try {
                        out.put("ok", false);
                        String m = e.getMessage();
                        if (e instanceof java.net.UnknownHostException || e instanceof java.net.ConnectException)
                            m = "No internet connection.";
                        else if (e instanceof java.net.SocketTimeoutException) m = "The AI took too long to respond.";
                        out.put("error", m == null ? e.toString() : m);
                    } catch (Exception ignored) {
                    }
                }
                emit("chat", out);
            }
        });
    }

    @JavascriptInterface
    public void listModels(final String id, final String type, final String baseUrl, final String key) {
        if (!ok()) return;
        net.execute(new Runnable() {
            @Override
            public void run() {
                JSONObject out = new JSONObject();
                try {
                    out.put("id", id);
                    out.put("models", Llm.listModels(type, baseUrl, key));
                    out.put("ok", true);
                } catch (Exception e) {
                    try {
                        out.put("ok", false);
                        String m = e.getMessage();
                        if (e instanceof java.net.UnknownHostException || e instanceof java.net.ConnectException)
                            m = "No internet connection.";
                        out.put("error", m == null ? e.toString() : m);
                    } catch (Exception ignored) {
                    }
                }
                emit("models", out);
            }
        });
    }


    @JavascriptInterface
    public void tavily(final String id, final String key, final String query) {
        if (!ok()) return;
        net.execute(new Runnable() {
            @Override
            public void run() {
                JSONObject out = new JSONObject();
                try {
                    out.put("id", id);
                    out.put("data", Llm.tavily("", key, query));
                    out.put("ok", true);
                } catch (Exception e) {
                    fail(out, e);
                }
                emit("tool", out);
            }
        });
    }

    /** Tools panel: ping / down / up (speed test), hibp (password leak check), rates (currency). Answer arrives as a "tool" event. */
    @JavascriptInterface
    public void netcall(final String id, final String kind, final String arg) {
        if (!ok()) return;
        net.execute(new Runnable() {
            @Override
            public void run() {
                JSONObject out = new JSONObject();
                try {
                    out.put("id", id);
                    out.put("data", NetTools.call(kind, arg));
                    out.put("ok", true);
                } catch (Exception e) {
                    fail(out, e);
                }
                emit("tool", out);
            }
        });
    }

    /** provider "free" = no key; "serpapi" = SerpApi key. */
    @JavascriptInterface
    public void lsearch(final String id, final String provider, final String key, final String query) {
        if (!ok()) return;
        net.execute(new Runnable() {
            @Override
            public void run() {
                JSONObject out = new JSONObject();
                try {
                    out.put("id", id);
                    out.put("data", "serpapi".equals(provider) ? Llm.serpapi(key, query) : Llm.freeSearch(query));
                    out.put("ok", true);
                } catch (Exception e) {
                    fail(out, e);
                }
                emit("tool", out);
            }
        });
    }

    @JavascriptInterface
    public void weather(final String id, final String key, final String place, final String units) {
        if (!ok()) return;
        net.execute(new Runnable() {
            @Override
            public void run() {
                JSONObject out = new JSONObject();
                try {
                    out.put("id", id);
                    out.put("data", Llm.weather("", key, place, units));
                    out.put("ok", true);
                } catch (Exception e) {
                    fail(out, e);
                }
                emit("tool", out);
            }
        });
    }

    private static void fail(JSONObject out, Exception e) {
        try {
            out.put("ok", false);
            String m = e.getMessage();
            if (e instanceof java.net.UnknownHostException || e instanceof java.net.ConnectException) m = "No internet connection.";
            else if (e instanceof java.net.SocketTimeoutException) m = "The service took too long to respond.";
            out.put("error", m == null ? e.toString() : m);
        } catch (Exception ignored) {
        }
    }

    @JavascriptInterface
    public String action(String type, String arg, String arg2) {
        if (!ok()) return "";
        return actions.run(type, arg, arg2);
    }

    @JavascriptInterface
    public boolean ready() {
        return ok();
    }

    @JavascriptInterface
    public String permissions() {
        if (!ok()) return "";
        JSONObject o = new JSONObject();
        try {
            o.put("mic", granted(Manifest.permission.RECORD_AUDIO));
            o.put("call", granted(Manifest.permission.CALL_PHONE));
            o.put("loc", granted(Manifest.permission.ACCESS_FINE_LOCATION));
            o.put("contacts", granted(Manifest.permission.READ_CONTACTS));
            boolean running = JarvisAccess.isRunning(), enabled = JarvisAccess.enabledInSettings(act);
            o.put("access", running || enabled);
            o.put("accessStalled", enabled && !running);
            o.put("ball", OverlayService.running());
            o.put("accessWas", "1".equals(prefs.getString("access_was", "")));
            android.os.PowerManager pm = (android.os.PowerManager) act.getSystemService(Context.POWER_SERVICE);
            o.put("battery", pm != null && pm.isIgnoringBatteryOptimizations(act.getPackageName()));
            o.put("overlay", Settings.canDrawOverlays(act));
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    private boolean granted(String p) {
        return act.checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED;
    }

    @JavascriptInterface
    public void requestPermissions() {
        if (!ok()) return;
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                act.requestPermissions(new String[]{
                        Manifest.permission.RECORD_AUDIO,
                        Manifest.permission.CALL_PHONE,
                        Manifest.permission.READ_CONTACTS,
                        "android.permission.POST_NOTIFICATIONS"}, REQ_PERMS);
            }
        });
    }

    /** Calendar (read-only). Returns {"perm":bool,"events":[...]} */
    @JavascriptInterface
    public String calendarEvents(int days) {
        if (!ok()) return "{\"perm\":false,\"events\":[]}";
        String q = CalendarHelper.query(act.getApplicationContext(), days);
        if (q == null) return "{\"perm\":false,\"events\":[]}";
        return "{\"perm\":true,\"events\":" + q + "}";
    }

    @JavascriptInterface
    public String saveImage(String name, String b64) {
        try {
            if (b64 == null || b64.length() < 20 || b64.length() > 8000000) return "That picture could not be saved.";
            String nm = (name == null ? "jarvis.png" : name).replaceAll("[^A-Za-z0-9._-]", "_");
            if (!nm.toLowerCase(java.util.Locale.ROOT).endsWith(".png")) nm += ".png";
            byte[] data = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
            if (android.os.Build.VERSION.SDK_INT >= 29) {
                android.content.ContentValues v = new android.content.ContentValues();
                v.put(android.provider.MediaStore.Images.Media.DISPLAY_NAME, nm);
                v.put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/png");
                v.put(android.provider.MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Jarvis");
                Uri u = act.getContentResolver().insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                if (u == null) return "That picture could not be saved.";
                java.io.OutputStream o = act.getContentResolver().openOutputStream(u);
                try { o.write(data); } finally { o.close(); }
                return "Saved in Pictures/Jarvis";
            }
            java.io.File dir = act.getExternalFilesDir(android.os.Environment.DIRECTORY_PICTURES);
            if (dir == null) return "That picture could not be saved.";
            dir.mkdirs();
            java.io.FileOutputStream fo = new java.io.FileOutputStream(new java.io.File(dir, nm));
            try { fo.write(data); } finally { fo.close(); }
            return "Saved in the Jarvis app pictures folder";
        } catch (Exception e) {
            return "That picture could not be saved.";
        }
    }

    @JavascriptInterface
    public void requestLocation() {
        if (!ok()) return;
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                act.requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_PERMS);
            }
        });
    }

    @JavascriptInterface
    public void requestCalendar() {
        if (!ok()) return;
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                act.requestPermissions(new String[]{"android.permission.READ_CALENDAR"}, REQ_PERMS);
            }
        });
    }

    /** Turns the floating ball on/off. Returns "ok", "overlay" (needs Display-over-apps), or "mic". */
    @JavascriptInterface
    public String setBall(boolean on) {
        if (!ok()) return "";
        if (!on) {
            act.stopService(new Intent(act, OverlayService.class));
            prefs.edit().putString("ball_on", "0").apply();
            return "ok";
        }
        if (!Settings.canDrawOverlays(act)) {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + act.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
            return "overlay";
        }
        if (!granted(Manifest.permission.RECORD_AUDIO)) {
            requestPermissions();
            return "mic";
        }
        Intent s = new Intent(act, OverlayService.class);
        if (android.os.Build.VERSION.SDK_INT >= 26) act.startForegroundService(s);
        else act.startService(s);
        prefs.edit().putString("ball_on", "1").apply();
        return "ok";
    }

    @JavascriptInterface
    public void speakEx(String text, String optsJson) {
        if (!ok()) return;
        voice.speakEx(text, optsJson);
    }

    @JavascriptInterface
    public String voices() {
        if (!ok()) return "";
        return voice.voicesJson();
    }

    /** Opens Android's "install voice data" screen (falls back to the text-to-speech settings). */
    @JavascriptInterface
    public void installVoices() {
        if (!ok()) return;
        try {
            Intent i = new Intent(android.speech.tts.TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
        } catch (Exception e) {
            try {
                Intent i = new Intent("com.android.settings.TTS_SETTINGS");
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                act.startActivity(i);
            } catch (Exception e2) {
                Intent i = new Intent(Settings.ACTION_SETTINGS);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                act.startActivity(i);
            }
        }
    }

    /** Asks the page to start listening again after a delay (runs on the native timer, which is not throttled in the background). */
    @JavascriptInterface
    public void relisten(int ms) {
        if (!ok()) return;
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override
            public void run() {
                emit("ballKick", new JSONObject());
            }
        }, Math.max(0, ms));
    }

    @JavascriptInterface
    public void ballCall(boolean on) {
        if (!ok()) return;
        OverlayService.call(on);
    }

    @JavascriptInterface
    public void requestBattery() {
        if (!ok()) return;
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + act.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
        } catch (Exception e) {
            Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
        }
    }

    @JavascriptInterface
    public void ballState(String st) {
        if (!ok()) return;
        OverlayService.state(st);
    }

    @JavascriptInterface
    public void ballText(String t) {
        if (!ok()) return;
        OverlayService.say(t);
    }

    @JavascriptInterface
    public void openUrl(String url) {
        if (!ok()) return;
        try {
            if (url == null || !url.matches("(?i)^https?://[^\\s]+$")) return;
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
        } catch (Exception ignored) {
        }
    }

    @JavascriptInterface
    public void openAppSettings() {
        if (!ok()) return;
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + act.getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        act.startActivity(i);
    }

    /** Switches "call help" on/off; turning it on asks for the phone permissions it needs. */
    @JavascriptInterface
    public void setCallHelp(final boolean on) {
        if (!ok()) return;
        CallHelper.setEnabled(act.getApplicationContext(), on);
        if (!on) return;
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                java.util.ArrayList<String> need = new java.util.ArrayList<String>();
                String[] want = {"android.permission.READ_PHONE_STATE", "android.permission.ANSWER_PHONE_CALLS", "android.permission.READ_CALL_LOG",
                        Manifest.permission.RECORD_AUDIO, Manifest.permission.READ_CONTACTS};
                for (String w : want) if (act.checkSelfPermission(w) != PackageManager.PERMISSION_GRANTED) need.add(w);
                if (!need.isEmpty()) act.requestPermissions(need.toArray(new String[0]), REQ_PERMS);
            }
        });
    }

    @JavascriptInterface
    public String callHelpState() {
        if (!ok()) return "{}";
        Context c = act.getApplicationContext();
        try {
            JSONObject o = new JSONObject();
            o.put("on", CallHelper.enabled(c));
            o.put("phone", granted("android.permission.READ_PHONE_STATE"));
            o.put("answer", granted("android.permission.ANSWER_PHONE_CALLS"));
            o.put("log", granted("android.permission.READ_CALL_LOG"));
            o.put("voice", OverlayService.running());
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    @JavascriptInterface
    public void minimize() {
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                act.moveTaskToBack(true);
            }
        });
    }

    @JavascriptInterface
    public void haptic() {
        if (!ok()) return;
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                web.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
            }
        });
    }

    @JavascriptInterface
    public String consumeLaunchFlag() {
        String f = launchFlag;
        launchFlag = "";
        return f;
    }

    @JavascriptInterface
    public boolean canLock() {
        if (!ok()) return false;
        android.app.KeyguardManager km = (android.app.KeyguardManager) act.getSystemService(Context.KEYGUARD_SERVICE);
        return km != null && km.isDeviceSecure();
    }

    @JavascriptInterface
    public void setPrivacy(final boolean on) {
        if (!ok()) return;
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                act.applyPrivacy(on);
            }
        });
    }

    @JavascriptInterface
    public void copyText(String t) {
        if (!ok() || t == null) return;
        android.content.ClipboardManager cm = (android.content.ClipboardManager) act.getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm != null) cm.setPrimaryClip(android.content.ClipData.newPlainText("Jarvis", t.length() > 20000 ? t.substring(0, 20000) : t));
    }

    @JavascriptInterface
    public String batteryInfo() {
        if (!ok()) return "";
        Intent b = act.registerReceiver(null, new android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (b == null) return "";
        int lvl = b.getIntExtra("level", -1), sc = b.getIntExtra("scale", 100), st = b.getIntExtra("status", 0);
        boolean ch = st == android.os.BatteryManager.BATTERY_STATUS_CHARGING || st == android.os.BatteryManager.BATTERY_STATUS_FULL;
        return "{\"pct\":" + (sc > 0 ? lvl * 100 / sc : lvl) + ",\"charging\":" + ch + "}";
    }

    @JavascriptInterface
    public String sysInfo() {
        if (!ok()) return "";
        try {
            org.json.JSONObject o = new org.json.JSONObject();
            Intent b = act.registerReceiver(null, new android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (b != null) {
                int lvl = b.getIntExtra("level", -1), sc = b.getIntExtra("scale", 100), st = b.getIntExtra("status", 0);
                o.put("batt", sc > 0 ? lvl * 100 / sc : lvl);
                o.put("charging", st == android.os.BatteryManager.BATTERY_STATUS_CHARGING || st == android.os.BatteryManager.BATTERY_STATUS_FULL);
                o.put("temp", b.getIntExtra("temperature", 0) / 10.0);
            }
            android.app.ActivityManager.MemoryInfo mi = new android.app.ActivityManager.MemoryInfo();
            ((android.app.ActivityManager) act.getSystemService(Context.ACTIVITY_SERVICE)).getMemoryInfo(mi);
            if (mi.totalMem > 0) {
                o.put("ramPct", (int) (100 - mi.availMem * 100 / mi.totalMem));
                o.put("ramUsedMB", (mi.totalMem - mi.availMem) / 1048576L);
                o.put("ramTotalMB", mi.totalMem / 1048576L);
            }
            android.os.StatFs fs = new android.os.StatFs(android.os.Environment.getDataDirectory().getPath());
            long tot = fs.getBlockCountLong() * fs.getBlockSizeLong(), fr = fs.getAvailableBlocksLong() * fs.getBlockSizeLong();
            if (tot > 0) {
                o.put("stoPct", (int) (100 - fr * 100 / tot));
                o.put("stoFreeGB", Math.round(fr / 1.0737418E8) / 10.0);
                o.put("stoTotalGB", Math.round(tot / 1.0737418E8) / 10.0);
            }
            String net = "offline";
            try {
                android.net.NetworkInfo ni = ((android.net.ConnectivityManager) act.getSystemService(Context.CONNECTIVITY_SERVICE)).getActiveNetworkInfo();
                if (ni != null && ni.isConnected()) net = ni.getType() == android.net.ConnectivityManager.TYPE_WIFI ? "wifi" : "mobile";
            } catch (Throwable ignored) {
            }
            o.put("net", net);
            o.put("uptimeMin", android.os.SystemClock.elapsedRealtime() / 60000L);
            return o.toString();
        } catch (Throwable t) {
            return "";
        }
    }

    @JavascriptInterface
    public void setWidgetTheme(String name) {
        if (!ok()) return;
        if (!"amber".equals(name) && !"red".equals(name) && !"green".equals(name) && !"purple".equals(name) && !"mark".equals(name) && !"friday".equals(name)) name = "cyan";
        act.getSharedPreferences("jarvis_ui", Context.MODE_PRIVATE).edit().putString("theme", name).apply();
        JarvisWidget.refresh(act);
    }

    // ----------------------------------------------------------- device link (phone <-> PC)

    private JSONObject linkStateJson() {
        RelayService.Cfg g = RelayService.load(act);
        JSONObject o = new JSONObject();
        try {
            LinkClient c = RelayService.client;
            o.put("role", "phone");
            o.put("enabled", g.enabled);
            o.put("paired", g.dbUrl.length() > 0 && g.secret.length() > 0);
            o.put("connected", c != null && c.isConnected());
            o.put("dbUrl", g.dbUrl);
            o.put("ctl", g.ctl);
            o.put("input", g.input);
            o.put("danger", g.danger);
            o.put("autostart", true);
            o.put("peer", "pc");
        } catch (Exception ignored) {
        }
        return o;
    }

    private static String linkErr(String msg) {
        try {
            return new JSONObject().put("ok", false).put("msg", msg).toString();
        } catch (Exception e) {
            return "{\"ok\":false}";
        }
    }

    @JavascriptInterface
    public String linkState() {
        if (!ok()) return "{}";
        return linkStateJson().toString();
    }

    @JavascriptInterface
    public String linkSet(String json) {
        if (!ok()) return "{}";
        try {
            JSONObject o = new JSONObject(json);
            RelayService.Cfg g = RelayService.load(act);
            if (o.has("enabled")) g.enabled = o.getBoolean("enabled");
            if (o.has("ctl")) g.ctl = o.getBoolean("ctl");
            if (o.has("input")) g.input = o.getBoolean("input");
            if (o.has("danger")) g.danger = o.getBoolean("danger");
            if (g.dbUrl.length() == 0 || g.secret.length() == 0) g.enabled = false;
            RelayService.save(act, g);
            RelayService.sync(act);
        } catch (Exception ignored) {
        }
        return linkStateJson().toString();
    }

    @JavascriptInterface
    public String linkCreate(String dbUrl) {
        if (!ok()) return "{}";
        String u = LinkCore.normalizeDbUrl(dbUrl);
        if (u.length() == 0) return linkErr("Paste your Firebase Realtime Database address, e.g. https://your-project-default-rtdb.firebaseio.com");
        RelayService.Cfg g = RelayService.load(act);
        g.dbUrl = u;
        g.secret = LinkCore.newSecret();
        g.enabled = true;
        RelayService.save(act, g);
        if (!RelayService.load(act).secret.equals(g.secret)) return linkErr("This phone could not store the key securely, so the link was not created.");
        RelayService.sync(act);
        try {
            return new JSONObject().put("ok", true).put("code", LinkCore.makeCode(g.dbUrl, g.secret)).put("state", linkStateJson()).toString();
        } catch (Exception e) {
            return linkErr("Could not create the pairing code.");
        }
    }

    @JavascriptInterface
    public String linkPair(String code) {
        if (!ok()) return "{}";
        try {
            String[] p = LinkCore.parseCode(code);
            RelayService.Cfg g = RelayService.load(act);
            g.dbUrl = p[0];
            g.secret = p[1];
            g.enabled = true;
            RelayService.save(act, g);
            if (!RelayService.load(act).secret.equals(g.secret)) return linkErr("This phone could not store the key securely, so it was not paired.");
            RelayService.sync(act);
            return new JSONObject().put("ok", true).put("state", linkStateJson()).toString();
        } catch (Exception e) {
            return linkErr(e.getMessage() == null ? "Pairing failed." : e.getMessage());
        }
    }

    @JavascriptInterface
    public String linkCode() {
        if (!ok()) return "{}";
        RelayService.Cfg g = RelayService.load(act);
        if (g.dbUrl.length() == 0 || g.secret.length() == 0) return linkErr("Not paired yet.");
        try {
            return new JSONObject().put("ok", true).put("code", LinkCore.makeCode(g.dbUrl, g.secret)).toString();
        } catch (Exception e) {
            return linkErr("Could not build the code.");
        }
    }

    @JavascriptInterface
    public String linkUnpair() {
        if (!ok()) return "{}";
        RelayService.Cfg g = RelayService.load(act);
        g.enabled = false;
        g.dbUrl = "";
        g.secret = "";
        RelayService.save(act, g);
        RelayService.sync(act);
        return linkStateJson().toString();
    }

    private final java.util.concurrent.atomic.AtomicInteger linkSeq = new java.util.concurrent.atomic.AtomicInteger();

    /** Commands that start programs, search the web or drive other windows can legitimately take a while on an older PC. */
    private static boolean slowType(String t) {
        return "ytplay".equals(t) || "ytkey".equals(t) || "clickname".equals(t) || "focusapp".equals(t) || "playany".equals(t) || "playfile".equals(t)
                || "playrandom".equals(t) || "search".equals(t) || "open".equals(t) || "pckey".equals(t) || "mouse".equals(t) || "media".equals(t)
                || "volume".equals(t) || "backup".equals(t) || "shell".equals(t) || "screenshot".equals(t);
    }

    private String linkAsync(final boolean ping, final String type, final String arg, final String arg2) {
        final String id = "L" + linkSeq.incrementAndGet();
        net.execute(new Runnable() {
            @Override
            public void run() {
                LinkClient c = RelayService.client;
                LinkClient.Result r = c == null ? new LinkClient.Result(false, "The device link is not running. Switch it on in Settings > Device Link.")
                        : (ping ? c.ping() : c.send(type, arg, arg2, slowType(type) ? 60000 : 35000));
                JSONObject o = new JSONObject();
                try {
                    o.put("id", id);
                    o.put("ok", r.ok);
                    o.put("msg", r.msg);
                } catch (Exception ignored) {
                }
                emit("linkResult", o);
            }
        });
        return id;
    }

    @JavascriptInterface
    public String linkSend(String type, String arg, String arg2) {
        if (!ok()) return "";
        return linkAsync(false, type, arg, arg2);
    }

    @JavascriptInterface
    public String linkPing() {
        if (!ok()) return "";
        return linkAsync(true, "", "", "");
    }


    // ---------------------------------------------------------------- phone -> PC: send a photo or file
    static final int REQ_PICKFILE = 79;
    private static final long SEND_MAX = 3L * 1000 * 1000;      // pictures bigger than this are shrunk
    private static final long FB_LIMIT = 5L * 1000 * 1000;        // through Firebase

    @JavascriptInterface
    public boolean linkPickFile() {
        if (!ok()) return false;
        try {
            Intent i = new Intent(Intent.ACTION_GET_CONTENT);
            i.setType("*/*");
            i.addCategory(Intent.CATEGORY_OPENABLE);
            act.startActivityForResult(Intent.createChooser(i, "Send to your PC"), REQ_PICKFILE);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void fileProgress(String name, int pct, boolean done, boolean ok, String msg) {
        JSONObject o = new JSONObject();
        try {
            o.put("name", name).put("pct", pct).put("done", done).put("ok", ok).put("msg", msg);
        } catch (Exception ignored) {
        }
        emit("fileProgress", o);
    }

    /** Called by MainActivity with the file the person picked. Runs in the background; progress goes to the page. */
    void sendPickedFile(final android.net.Uri uri) {
        net.execute(new Runnable() {
            @Override
            public void run() {
                String name = "file";
                if (!fileBusy.compareAndSet(false, true)) { fileProgress(name, 0, true, false, "Another file is still being sent. Wait for it to finish."); return; }
                try {
                    android.content.ContentResolver cr = act.getContentResolver();
                    String mime = cr.getType(uri);
                    if (mime == null) mime = "application/octet-stream";
                    android.database.Cursor cu = cr.query(uri, new String[]{android.provider.OpenableColumns.DISPLAY_NAME, android.provider.OpenableColumns.SIZE}, null, null, null);
                    long declared = -1;
                    if (cu != null) {
                        try { if (cu.moveToFirst()) { if (cu.getString(0) != null) name = cu.getString(0); if (!cu.isNull(1)) declared = cu.getLong(1); } } finally { cu.close(); }
                    }
                    boolean isImg = mime.startsWith("image/");
                    LinkClient c = RelayService.client;
                    if (c == null) { fileProgress(name, 0, true, false, "The device link is not running. Switch it on in Settings > Device Link."); return; }
                    fileProgress(name, 0, false, true, "Reading the file\u2026");
                    java.io.InputStream in = cr.openInputStream(uri);
                    if (in == null) { fileProgress(name, 0, true, false, "Could not open that file."); return; }
                    long total = declared;
                    byte[] mem = null;
                    // files whose size the phone does not report are read into memory (at most 25 MB); everything else is streamed
                    if (declared <= 0) {
                        java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                        try {
                            byte[] buf = new byte[16384];
                            int r;
                            while ((r = in.read(buf)) > 0) {
                                bo.write(buf, 0, r);
                                if (bo.size() > 25L * 1000 * 1000) { fileProgress(name, 0, true, false, "I cannot tell how big that file is and it is over 25 MB. Send it from a file manager instead."); return; }
                            }
                        } finally {
                            in.close();
                        }
                        byte[] data = bo.toByteArray();
                        if (isImg && data.length > SEND_MAX) {
                            data = shrinkImage(data);
                            if (data == null) { fileProgress(name, 0, true, false, "Could not shrink that picture to 3 MB."); return; }
                            mime = "image/jpeg";
                            int dot = name.lastIndexOf('.');
                            name = (dot > 0 ? name.substring(0, dot) : name) + ".jpg";
                        }
                        if (data.length == 0) { fileProgress(name, 0, true, false, "That file is empty."); return; }
                        mem = data;
                        in = new java.io.ByteArrayInputStream(data);
                        total = data.length;
                    }
                    final int CH = 36000;
                    // up to 5 MB: encrypted pieces through Firebase. Over 5 MB: straight to the PC over the same Wi-Fi (any size).
                    String lan = null;
                    if (total > FB_LIMIT) {                                     // small files never look for Wi-Fi: they go straight through Firebase
                        fileProgress(name, 0, false, true, "Looking for your PC on this Wi-Fi\u2026");
                        try {
                            LinkClient.Result o = c.send("lanoffer", "", "", 15000);
                            if (o != null && o.ok && o.msg != null) lan = Lan.send(in, total, name, mime, o.msg);
                        } catch (Throwable ignored) { }
                    }
                    if (lan != null && lan.startsWith("OK")) { fileProgress(name, 100, true, true, lan.length() > 3 ? lan.substring(3) : "Sent to your PC over Wi-Fi."); return; }
                    boolean broken = lan != null;
                    try { in.close(); } catch (Exception ignored) { }
                    if (total > FB_LIMIT && isImg && !broken && total <= 25L * 1000 * 1000) {      // no Wi-Fi: a big picture is shrunk so it fits through Firebase
                        java.io.InputStream pin = cr.openInputStream(uri);
                        byte[] data = null;
                        if (pin != null) {
                            try {
                                java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                                byte[] buf = new byte[16384];
                                int r;
                                while ((r = pin.read(buf)) > 0) bo.write(buf, 0, r);
                                data = shrinkImage(bo.toByteArray());
                            } finally { pin.close(); }
                        }
                        if (data != null && data.length <= FB_LIMIT) {
                            mem = data; total = data.length; mime = "image/jpeg";
                            int dot = name.lastIndexOf('.');
                            name = (dot > 0 ? name.substring(0, dot) : name) + ".jpg";
                        }
                    }
                    if (total > FB_LIMIT) {
                        fileProgress(name, 0, true, false, broken ? "The Wi-Fi transfer failed: " + lan.replaceFirst("^ERR ?", "") : "Files over 5 MB go by Wi-Fi only. Put this phone and your PC on the same Wi-Fi, keep Jarvis open on both, and try again.");
                        return;
                    }
                    in = mem != null ? new java.io.ByteArrayInputStream(mem) : cr.openInputStream(uri);
                    if (in == null) { fileProgress(name, 0, true, false, "Could not open that file."); return; }
                    int n = (int) ((total + CH - 1) / CH);
                    if (n < 1) { fileProgress(name, 0, true, false, "That file is empty."); return; }
                    String id = Long.toString(System.nanoTime(), 36) + Integer.toString((int) (Math.random() * 1000), 36);
                    LinkClient.Result last = null;
                    int lastPct = -1;
                    try {
                        byte[] part = new byte[CH];
                        for (int i = 0; i < n; i++) {
                            int want = (int) Math.min(CH, total - (long) i * CH), got = 0;
                            while (got < want) { int k = in.read(part, got, want - got); if (k < 0) break; got += k; }
                            if (got != want) { fileProgress(name, 0, true, false, "The file changed while it was being sent. Please send it again."); return; }
                            JSONObject meta = new JSONObject();
                            meta.put("id", id).put("i", i).put("n", n).put("size", total).put("name", name).put("mime", mime);
                            String b64 = android.util.Base64.encodeToString(part, 0, want, android.util.Base64.NO_WRAP), ms = meta.toString();
                            last = null;
                            for (int attempt = 0; attempt < 3; attempt++) {          // a lost answer is retried; the PC ignores a repeated piece
                                last = c.send("filepart", ms, b64, 30000);
                                if (last.ok) break;
                                try { Thread.sleep(1500L * (attempt + 1)); } catch (InterruptedException ie) { break; }
                            }
                            if (last == null || !last.ok) { fileProgress(name, (i * 100) / n, true, false, (last == null ? "No answer" : last.msg) + (i == 0 ? " (If this keeps failing, publish the new Firebase rule: Settings > Device Link shows it.)" : "")); return; }
                            int pct = ((i + 1) * 100) / n;
                            if (pct != lastPct && (pct % 5 == 0 || n < 40)) { lastPct = pct; fileProgress(name, pct, false, true, "Sending"); }
                        }
                    } finally {
                        try { in.close(); } catch (Exception ignored) { }
                    }
                    fileProgress(name, 100, true, true, last != null && last.msg != null && last.msg.length() > 0 ? last.msg : "Sent to your PC.");
                } catch (Throwable t) {
                    fileProgress(name, 0, true, false, "Could not send the file: " + t.getMessage());
                } finally {
                    fileBusy.set(false);
                }
            }
        });
    }

    /** Pictures over 3 MB become a JPEG that fits (longest side 2200 px, quality lowered until small enough). */
    private static byte[] shrinkImage(byte[] src) {
        try {
            android.graphics.BitmapFactory.Options o = new android.graphics.BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            android.graphics.BitmapFactory.decodeByteArray(src, 0, src.length, o);
            int side = Math.max(o.outWidth, o.outHeight), sample = 1;
            while (side / sample > 2200) sample *= 2;
            o.inJustDecodeBounds = false;
            o.inSampleSize = sample;
            android.graphics.Bitmap b = android.graphics.BitmapFactory.decodeByteArray(src, 0, src.length, o);
            if (b == null) return null;
            for (int q = 85; q >= 40; q -= 15) {
                java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                b.compress(android.graphics.Bitmap.CompressFormat.JPEG, q, bo);
                if (bo.size() <= SEND_MAX) { b.recycle(); return bo.toByteArray(); }
            }
            b.recycle();
        } catch (Throwable ignored) {
        }
        return null;
    }

    private final java.util.concurrent.atomic.AtomicBoolean fileBusy = new java.util.concurrent.atomic.AtomicBoolean(false);

    volatile String pendingShare = "";

    @JavascriptInterface
    public String consumeShare() {
        String t = pendingShare;
        pendingShare = "";
        return t == null ? "" : t;
    }

    /** Health snapshot of the link for the self-test and diagnostics (never contains the key). */
    @JavascriptInterface
    public String linkDiag() {
        if (!ok()) return "{}";
        LinkClient c = RelayService.client;
        return c == null ? "{\"connected\":false,\"noClient\":true}" : c.diag();
    }

    /** Fire-and-forget command (used for live mouse moves). */
    @JavascriptInterface
    public boolean linkFire(final String type, final String arg, final String arg2) {
        if (!ok()) return false;
        net.execute(new Runnable() {
            @Override
            public void run() {
                LinkClient c = RelayService.client;
                if (c != null) c.fire(type, arg, arg2);
            }
        });
        return true;
    }

    /** Text currently on the phone clipboard (for "send my clipboard to the PC"). */
    @JavascriptInterface
    public String clipboardText() {
        if (!ok()) return "";
        try {
            android.content.ClipboardManager cm = (android.content.ClipboardManager) act.getSystemService(Context.CLIPBOARD_SERVICE);
            android.content.ClipData d = cm.getPrimaryClip();
            if (d == null || d.getItemCount() == 0) return "";
            CharSequence t = d.getItemAt(0).coerceToText(act);
            return t == null ? "" : t.toString();
        } catch (Exception e) {
            return "";
        }
    }

    /** Wake-on-LAN: broadcasts the magic packet on the Wi-Fi network (works only when the phone is on the PC's network). */
    @JavascriptInterface
    public String wakePc(final String mac) {
        if (!ok()) return "{}";
        byte[] m = parseMac(mac);
        if (m == null) return linkErr("That is not a valid MAC address. Expected like AA:BB:CC:DD:EE:FF.");
        final byte[] pkt = new byte[102];
        for (int i = 0; i < 6; i++) pkt[i] = (byte) 0xFF;
        for (int i = 1; i <= 16; i++) System.arraycopy(m, 0, pkt, i * 6, 6);
        net.execute(new Runnable() {
            @Override
            public void run() {
                String msg;
                boolean good = false;
                java.net.DatagramSocket s = null;
                try {
                    s = new java.net.DatagramSocket();
                    s.setBroadcast(true);
                    java.util.ArrayList<java.net.InetAddress> to = new java.util.ArrayList<java.net.InetAddress>();
                    to.add(java.net.InetAddress.getByName("255.255.255.255"));
                    try {
                        android.net.wifi.WifiManager wm = (android.net.wifi.WifiManager) act.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                        android.net.DhcpInfo d = wm.getDhcpInfo();
                        if (d != null && d.ipAddress != 0) {
                            int b = (d.ipAddress & d.netmask) | ~d.netmask;
                            to.add(java.net.InetAddress.getByAddress(new byte[]{(byte) (b & 0xff), (byte) ((b >> 8) & 0xff), (byte) ((b >> 16) & 0xff), (byte) ((b >> 24) & 0xff)}));
                        }
                    } catch (Exception ignored) {
                    }
                    for (java.net.InetAddress a : to) {
                        for (int port : new int[]{9, 7}) {
                            try {
                                s.send(new java.net.DatagramPacket(pkt, pkt.length, a, port));
                                good = true;
                            } catch (Exception ignored) {
                            }
                        }
                    }
                    msg = good ? "Wake signal sent. If the PC is on the same Wi-Fi and Wake-on-LAN is enabled, it should start within a few seconds."
                            : "I could not send the wake signal. Is the phone on Wi-Fi?";
                } catch (Exception e) {
                    msg = "I could not send the wake signal: " + e.getMessage();
                } finally {
                    if (s != null) s.close();
                }
                JSONObject o = new JSONObject();
                try {
                    o.put("ok", good);
                    o.put("msg", msg);
                } catch (Exception ignored) {
                }
                emit("wakeResult", o);
            }
        });
        return "{\"ok\":true}";
    }

    private static byte[] parseMac(String s) {
        if (s == null) return null;
        String h = s.replaceAll("[^0-9A-Fa-f]", "");
        if (h.length() != 12) return null;
        byte[] r = new byte[6];
        for (int i = 0; i < 6; i++) r[i] = (byte) Integer.parseInt(h.substring(i * 2, i * 2 + 2), 16);
        return r;
    }

    @JavascriptInterface
    public String appInfo() {
        return "{\"version\":\"1.40.2\",\"sdk\":" + android.os.Build.VERSION.SDK_INT + "}";
    }
}
// CRB-MARK 6e321f954dcd

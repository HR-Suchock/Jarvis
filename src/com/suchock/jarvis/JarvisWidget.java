package com.suchock.jarvis;

import android.app.ActivityManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Shader;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.Environment;
import android.os.StatFs;
import android.widget.RemoteViews;

/** Home-screen widget: a small Jarvis HUD (rings = battery / memory / storage). Tap it to open Jarvis. */
public class JarvisWidget extends AppWidgetProvider {

    static void refresh(Context c) {
        try {
            JarvisWidgetSmall.refresh(c);
        } catch (Throwable ignored) {
        }
        try {
            Context app = c.getApplicationContext();
            AppWidgetManager mgr = AppWidgetManager.getInstance(app);
            int[] ids = mgr.getAppWidgetIds(new ComponentName(app, JarvisWidget.class));
            if (ids != null && ids.length > 0) new JarvisWidget().onUpdate(app, mgr, ids);
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        schedule(ctx);
        try {
            build(ctx, mgr, ids);
        } catch (Throwable ignored) {
        }
    }

    static int id(Context c, String n) {
        return c.getResources().getIdentifier(n, "id", c.getPackageName());
    }

    static int accent(String theme) {
        if ("amber".equals(theme)) return 0xFFFFB040;
        if ("red".equals(theme)) return 0xFFFF5A6A;
        if ("green".equals(theme)) return 0xFF3DEB8C;
        if ("purple".equals(theme)) return 0xFFB06CFF;
        if ("mark".equals(theme)) return 0xFFFF5240;
        if ("friday".equals(theme)) return 0xFFE8F4FF;
        return 0xFF19E3FF;
    }

    static int alpha(int c, int a) {
        return Color.argb(a, Color.red(c), Color.green(c), Color.blue(c));
    }

    private static void build(Context ctx, AppWidgetManager mgr, int[] ids) {
        int layout = ctx.getResources().getIdentifier("widget", "layout", ctx.getPackageName());
        if (layout == 0) return;
        String theme = ctx.getSharedPreferences("jarvis_ui", Context.MODE_PRIVATE).getString("theme", "cyan");
        int ac = accent(theme);

        int pct = 0;
        boolean chg = false;
        Intent b = ctx.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (b != null) {
            int lvl = b.getIntExtra("level", 0), sc = b.getIntExtra("scale", 100), st = b.getIntExtra("status", 0);
            pct = sc > 0 ? lvl * 100 / sc : lvl;
            chg = st == android.os.BatteryManager.BATTERY_STATUS_CHARGING || st == android.os.BatteryManager.BATTERY_STATUS_FULL;
        }
        int ram = 0, sto = 0;
        try {
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            ((ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE)).getMemoryInfo(mi);
            if (mi.totalMem > 0) ram = (int) (100 - mi.availMem * 100 / mi.totalMem);
        } catch (Throwable ignored) {
        }
        try {
            StatFs fs = new StatFs(Environment.getDataDirectory().getPath());
            long tot = fs.getBlockCountLong() * fs.getBlockSizeLong(), fr = fs.getAvailableBlocksLong() * fs.getBlockSizeLong();
            if (tot > 0) sto = (int) (100 - fr * 100 / tot);
        } catch (Throwable ignored) {
        }
        String net = "OFFLINE";
        try {
            NetworkInfo ni = ((ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE)).getActiveNetworkInfo();
            if (ni != null && ni.isConnected()) net = ni.getType() == ConnectivityManager.TYPE_WIFI ? "WI-FI" : "MOBILE";
        } catch (Throwable ignored) {
        }

        String[] wx = weatherLine(ctx);
        long[][] hist = history(ctx, pct, ram);
        Bitmap ring = drawRing(pct, ram, sto, chg, ac);
        Bitmap hud = drawHud(ac);
        Bitmap graph = drawGraph(hist, pct, ram, sto, net, chg, ac);
        Intent i = new Intent(ctx, MainActivity.class);
        i.setAction("com.suchock.jarvis.MONITOR");
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 7, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        for (int wid : ids) {
            RemoteViews rv = new RemoteViews(ctx.getPackageName(), layout);
            rv.setImageViewBitmap(id(ctx, "widget_hud"), hud);
            rv.setImageViewBitmap(id(ctx, "widget_ring"), ring);
            rv.setImageViewBitmap(id(ctx, "widget_graph"), graph);
            rv.setTextViewText(id(ctx, "w_temp"), wx[0]);
            if (wx.length > 3 && wx[2].length() > 0) {
                rv.setImageViewBitmap(id(ctx, "w_icon"), weatherIcon(Integer.parseInt(wx[2]), "1".equals(wx[3])));
                rv.setViewVisibility(id(ctx, "w_icon"), android.view.View.VISIBLE);
            } else {
                rv.setViewVisibility(id(ctx, "w_icon"), android.view.View.GONE);
            }
            rv.setTextColor(id(ctx, "w_ampm"), ac);
            rv.setTextViewText(id(ctx, "w_wx"), wx[1]);
            rv.setTextColor(id(ctx, "w_brand"), ac);
            rv.setTextColor(id(ctx, "w_temp"), ac);
            rv.setOnClickPendingIntent(id(ctx, "widget_root"), pi);
            mgr.updateAppWidget(wid, rv);
        }
    }

    /** Time-stamped battery / memory samples (kept for 24 h). A sample is stored whenever the battery level changes or 10 minutes passed. */
    private static long[][] history(Context ctx, int batt, int ram) {
        android.content.SharedPreferences ui = ctx.getSharedPreferences("jarvis_ui", Context.MODE_PRIVATE);
        String raw = ui.getString("hist2", "");
        java.util.ArrayList<long[]> list = new java.util.ArrayList<long[]>();
        long now = System.currentTimeMillis();
        try {
            for (String row : raw.split(";")) {
                if (row.length() == 0) continue;
                String[] f = row.split(":");
                long t = Long.parseLong(f[0]);
                if (now - t < 24L * 3600 * 1000 && t <= now + 60000) list.add(new long[]{t, Long.parseLong(f[1]), Long.parseLong(f[2])});
            }
        } catch (Throwable ignored) {
            list.clear();
        }
        long[] lastS = list.isEmpty() ? null : list.get(list.size() - 1);
        if (lastS == null || lastS[1] != batt || now - lastS[0] > 10 * 60 * 1000L) {
            list.add(new long[]{now, batt, ram});
            while (list.size() > 150) list.remove(0);
            StringBuilder sb = new StringBuilder();
            for (long[] v : list) sb.append(v[0]).append(':').append(v[1]).append(':').append(v[2]).append(';');
            ui.edit().putString("hist2", sb.toString()).apply();
        }
        long[][] out = new long[3][list.size()];
        for (int k = 0; k < list.size(); k++) {
            out[0][k] = list.get(k)[0];
            out[1][k] = list.get(k)[1];
            out[2][k] = list.get(k)[2];
        }
        return out;
    }

    static final String TICK = "com.suchock.jarvis.WIDGET_TICK";

    /** Wakes the widget every ~10 minutes so the battery graph keeps following the real battery level. */
    static void schedule(Context ctx) {
        try {
            android.app.AlarmManager am = (android.app.AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            Intent i = new Intent(ctx, JarvisWidget.class).setAction(TICK);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, 11, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            am.setInexactRepeating(android.app.AlarmManager.RTC, System.currentTimeMillis() + 10 * 60 * 1000L, 10 * 60 * 1000L, pi);
        } catch (Throwable ignored) {
        }
    }

    private static void unschedule(Context ctx) {
        try {
            android.app.AlarmManager am = (android.app.AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            Intent i = new Intent(ctx, JarvisWidget.class).setAction(TICK);
            am.cancel(PendingIntent.getBroadcast(ctx, 11, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent != null && TICK.equals(intent.getAction())) {
            refresh(ctx);
            return;
        }
        super.onReceive(ctx, intent);
    }

    @Override
    public void onEnabled(Context ctx) {
        schedule(ctx);
    }

    @Override
    public void onDisabled(Context ctx) {
        unschedule(ctx);
    }

    private static volatile long wxBusy = 0;

    /** Cached weather text ("22° clear sky · London"); starts a background refresh when it is older than 25 minutes. */
    private static String[] weatherLine(final Context ctx) {
        final android.content.SharedPreferences ui = ctx.getSharedPreferences("jarvis_ui", Context.MODE_PRIVATE);
        String key = "", city = "", units = "metric";
        try {
            String raw = Secure.open(ctx.getSharedPreferences("jarvis", Context.MODE_PRIVATE).getString("settings", ""));
            if (raw != null && raw.length() > 0) {
                org.json.JSONObject sv = new org.json.JSONObject(raw).optJSONObject("services");
                if (sv != null) {
                    key = sv.optString("owKey", "").trim();
                    city = sv.optString("city", "").trim();
                    units = sv.optString("units", "metric");
                }
            }
        } catch (Throwable ignored) {
        }
        if (key.length() == 0) return new String[]{"WEATHER", "set key in the app"};
        if (city.length() == 0) return new String[]{"WEATHER", "set city in the app"};
        final String fkey = key, fcity = city, funits = units;
        final String sig = city.toLowerCase() + "|" + units;
        boolean same = sig.equals(ui.getString("wxSig", ""));
        String t = same ? ui.getString("wxT", "") : "";
        String d = same ? ui.getString("wxD", "") : "";
        long now = System.currentTimeMillis();
        boolean stale = !same || now - ui.getLong("wxAt", 0) > 25 * 60 * 1000L;
        if (stale && now - wxBusy > 15 * 1000L) {
            wxBusy = now;
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        org.json.JSONObject w = Llm.weather("", fkey, fcity, funits);
                        boolean imp = "imperial".equals(w.optString("units"));
                        String u = imp ? "\u00B0F" : "\u00B0C";
                        double tt = w.optDouble("temp", Double.NaN), fl = w.optDouble("feels", Double.NaN);
                        double hu = w.optDouble("humidity", Double.NaN);
                        String desc = w.optString("desc", "");
                        if (desc.length() > 0) desc = Character.toUpperCase(desc.charAt(0)) + desc.substring(1);
                        String line2 = desc + " \u00B7 " + w.optString("place", fcity);
                        if (!Double.isNaN(fl) && !Double.isNaN(hu)) line2 += "\nFeels " + Math.round(fl) + "\u00B0 \u00B7 " + Math.round(hu) + "% hum";
                        ui.edit().putInt("wxI", w.optInt("wid", 0)).putBoolean("wxN", w.optString("icon", "").endsWith("n")).putString("wxT", Double.isNaN(tt) ? "--" : Math.round(tt) + u).putString("wxD", line2)
                                .putString("wxSig", sig).putLong("wxAt", System.currentTimeMillis()).apply();
                        refresh(ctx);
                    } catch (Throwable ignored) {
                    }
                }
            }).start();
        }
        if (t.length() == 0) return new String[]{"\u2026", "loading " + city};
        int wid = ui.getInt("wxI", 0);
        return new String[]{t, d, wid > 0 ? String.valueOf(wid) : "", ui.getBoolean("wxN", false) ? "1" : "0"};
    }

    static void gauge(Canvas c, float cx, float cy, float r, float w, int pct, int color, Paint p) {
        RectF box = new RectF(cx - r, cy - r, cx + r, cy + r);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(w);
        p.setStrokeCap(Paint.Cap.BUTT);
        p.setColor(alpha(color, 46));
        c.drawArc(box, 0, 360, false, p);
        p.setStrokeCap(Paint.Cap.ROUND);
        p.setColor(color);
        c.drawArc(box, -90, Math.max(3, Math.min(100, pct)) * 3.6f, false, p);
    }

    /** Decorative HUD frame: dot grid, scan lines, corner brackets and a tick scale. Stretches to the widget size. */
    static Bitmap drawHud(int ac) {
        int W = 960, H = 330;
        Bitmap bm = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bm);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setStyle(Paint.Style.FILL);
        p.setColor(alpha(ac, 22));
        for (int y = 26; y < H; y += 28) for (int x = 26; x < W; x += 28) c.drawCircle(x, y, 1.6f, p);
        p.setColor(alpha(ac, 9));
        for (int y = 0; y < H; y += 6) c.drawRect(0, y, W, y + 1, p);
        // soft accent glow from the top-left corner
        p.setShader(new RadialGradient(0, 0, 420, new int[]{alpha(ac, 46), 0}, new float[]{0f, 1f}, Shader.TileMode.CLAMP));
        c.drawRect(0, 0, W, H, p);
        p.setShader(null);
        // corner brackets
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(4);
        p.setStrokeCap(Paint.Cap.SQUARE);
        p.setColor(alpha(ac, 215));
        float m = 10, L = 46;
        c.drawLine(m, m + L, m, m, p); c.drawLine(m, m, m + L, m, p);
        c.drawLine(W - m - L, m, W - m, m, p); c.drawLine(W - m, m, W - m, m + L, p);
        c.drawLine(m, H - m - L, m, H - m, p); c.drawLine(m, H - m, m + L, H - m, p);
        c.drawLine(W - m - L, H - m, W - m, H - m, p); c.drawLine(W - m, H - m, W - m, H - m - L, p);
        // thin frame line + gaps, tick scale along the bottom
        p.setStrokeWidth(1.5f);
        p.setColor(alpha(ac, 60));
        c.drawLine(m + L + 14, m, W - m - L - 14, m, p);
        c.drawLine(m + L + 14, H - m, W - m - L - 14, H - m, p);
        for (int x = 120; x < W - 120; x += 12) {
            p.setColor(alpha(ac, (x / 12) % 5 == 0 ? 130 : 55));
            c.drawLine(x, H - m - 2, x, H - m - ((x / 12) % 5 == 0 ? 12 : 6), p);
        }
        // little data pips top-right
        p.setStyle(Paint.Style.FILL);
        for (int k = 0; k < 4; k++) {
            p.setColor(alpha(ac, k == 0 ? 230 : 70 + k * 10));
            c.drawRect(W - 62 - k * 16, 26, W - 54 - k * 16, 34, p);
        }
        return bm;
    }

    // ---------------------------------------------------------------- weather icons (drawn, so no image files needed)
    private static void cloud(Canvas c, Paint p, float dx, float dy, float sc, int col) {
        c.save();
        c.translate(dx, dy);
        c.scale(sc, sc);
        p.setStyle(Paint.Style.FILL);
        p.setColor(col);
        c.drawCircle(38, 66, 18, p);
        c.drawCircle(60, 54, 25, p);
        c.drawCircle(84, 64, 19, p);
        c.drawRoundRect(new RectF(26, 62, 102, 86), 12, 12, p);
        c.restore();
    }

    private static void sun(Canvas c, Paint p, float cx, float cy, float r) {
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(r * 0.22f);
        p.setStrokeCap(Paint.Cap.ROUND);
        p.setColor(0xFFFFA23A);
        for (int k = 0; k < 8; k++) {
            double a = Math.toRadians(k * 45);
            c.drawLine(cx + (float) Math.cos(a) * r * 1.35f, cy + (float) Math.sin(a) * r * 1.35f,
                    cx + (float) Math.cos(a) * r * 1.8f, cy + (float) Math.sin(a) * r * 1.8f, p);
        }
        p.setStyle(Paint.Style.FILL);
        p.setShader(new RadialGradient(cx - r * 0.3f, cy - r * 0.3f, r * 1.4f, 0xFFFFC15A, 0xFFFF6A1F, Shader.TileMode.CLAMP));
        c.drawCircle(cx, cy, r, p);
        p.setShader(null);
    }

    private static void moon(Canvas c, Paint p, float cx, float cy, float r) {
        p.setStyle(Paint.Style.FILL);
        p.setColor(0xFFE9EEF8);
        c.drawCircle(cx, cy, r, p);
        p.setXfermode(new android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.CLEAR));
        c.drawCircle(cx + r * 0.55f, cy - r * 0.35f, r * 0.85f, p);
        p.setXfermode(null);
    }

    static Bitmap weatherIcon(int id, boolean night) {
        int n = 120;
        Bitmap bm = Bitmap.createBitmap(n, n, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bm);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        int white = 0xFFEAF6FB, grey = 0xFFB9CAD3;
        int rainCol = 0xFF19E3FF;
        boolean storm = id >= 200 && id < 300, drizzle = id >= 300 && id < 400, rain = id >= 500 && id < 600;
        boolean snow = id >= 600 && id < 700, mist = id >= 700 && id < 800;
        if (id == 800) {
            if (night) moon(c, p, 60, 60, 30); else sun(c, p, 60, 60, 28);
        } else if (id == 801 || id == 802) {
            if (night) moon(c, p, 40, 40, 22); else sun(c, p, 40, 40, 20);
            cloud(c, p, 14, 14, 0.9f, white);
        } else if (id == 803 || id == 804) {
            cloud(c, p, -8, -4, 0.7f, grey);
            cloud(c, p, 8, 10, 0.9f, white);
        } else if (mist) {
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(8);
            p.setStrokeCap(Paint.Cap.ROUND);
            p.setColor(grey);
            for (int k = 0; k < 4; k++) c.drawLine(24 + (k % 2) * 8, 34 + k * 18, 96 - (k % 2) * 8, 34 + k * 18, p);
        } else {
            cloud(c, p, 0, -12, 1f, (storm || rain || drizzle) ? grey : white);
            p.setStrokeCap(Paint.Cap.ROUND);
            if (snow) {
                p.setStyle(Paint.Style.FILL);
                p.setColor(0xFFFFFFFF);
                for (int k = 0; k < 3; k++) { c.drawCircle(42 + k * 20, 84 + (k % 2) * 10, 5.5f, p); }
            } else {
                p.setStyle(Paint.Style.STROKE);
                p.setStrokeWidth(6);
                p.setColor(rainCol);
                for (int k = 0; k < 3; k++) {
                    if (storm && k == 1) continue;
                    c.drawLine(42 + k * 20 + 5, 80, 42 + k * 20 - 3, 100, p);
                }
                if (storm) {
                    Path b = new Path();
                    b.moveTo(66, 72); b.lineTo(50, 96); b.lineTo(62, 96); b.lineTo(54, 116); b.lineTo(78, 88); b.lineTo(65, 88); b.close();
                    p.setStyle(Paint.Style.FILL);
                    p.setColor(0xFFFFB040);
                    c.drawPath(b, p);
                }
            }
        }
        return bm;
    }

    /** Battery curve over the last 12 hours, x = real time, so it moves exactly like the phone's battery. */
    private static void spark(Canvas c, float x, float y, float w, float h, long[] ts, long[] v, int color, Paint p) {
        long now = System.currentTimeMillis(), span = 12L * 3600 * 1000, t0 = now - span;
        java.util.ArrayList<float[]> pts = new java.util.ArrayList<float[]>();
        int before = -1;
        for (int k = 0; k < ts.length; k++) if (ts[k] < t0) before = k;
        if (before >= 0) pts.add(new float[]{0, v[before]});
        for (int k = 0; k < ts.length; k++) if (ts[k] >= t0) pts.add(new float[]{(ts[k] - t0) / (float) span, v[k]});
        if (pts.isEmpty()) pts.add(new float[]{1f, 0});
        float lastV = pts.get(pts.size() - 1)[1];
        pts.add(new float[]{1f, lastV});
        Path line = new Path(), fill = new Path();
        float firstX = x + w * pts.get(0)[0];
        for (int k = 0; k < pts.size(); k++) {
            float px = x + w * pts.get(k)[0], py = y + h - h * Math.max(0, Math.min(100, pts.get(k)[1])) / 100f;
            if (k == 0) { line.moveTo(px, py); fill.moveTo(px, y + h); fill.lineTo(px, py); } else { line.lineTo(px, py); fill.lineTo(px, py); }
        }
        fill.lineTo(x + w, y + h);
        fill.lineTo(firstX, y + h);
        fill.close();
        p.setStyle(Paint.Style.FILL);
        p.setShader(new android.graphics.LinearGradient(0, y, 0, y + h, alpha(color, 120), alpha(color, 0), Shader.TileMode.CLAMP));
        c.drawPath(fill, p);
        p.setShader(null);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(1.2f);
        p.setColor(alpha(color, 40));
        for (int g = 1; g < 4; g++) c.drawLine(x, y + h * g / 4f, x + w, y + h * g / 4f, p);
        p.setStrokeWidth(3.5f);
        p.setStrokeJoin(Paint.Join.ROUND);
        p.setStrokeCap(Paint.Cap.ROUND);
        p.setColor(color);
        c.drawPath(line, p);
        float ey = y + h - h * Math.max(0, Math.min(100, lastV)) / 100f;
        p.setStyle(Paint.Style.FILL);
        c.drawCircle(x + w, ey, 5, p);
    }

    private static int[] lastN(long[] v, int n) {
        int m = Math.min(n, v.length);
        int[] o = new int[m];
        for (int k = 0; k < m; k++) o[k] = (int) v[v.length - m + k];
        return o;
    }

    private static void bars(Canvas c, float x, float y, float w, float h, int[] v, int color, Paint p) {
        int n = Math.max(1, v.length);
        float gap = 3, bw = Math.max(4, Math.min(16, (w - gap * (n - 1)) / n));
        float total = n * bw + (n - 1) * gap;
        float x0 = x + w - total;
        p.setStyle(Paint.Style.FILL);
        for (int k = 0; k < n; k++) {
            int val = v.length == 0 ? 0 : Math.max(0, Math.min(100, v[k]));
            float bh = Math.max(4, h * val / 100f);
            p.setColor(alpha(color, k == n - 1 ? 255 : 90 + 80 * k / n));
            c.drawRect(x0 + k * (bw + gap), y + h - bh, x0 + k * (bw + gap) + bw, y + h, p);
        }
    }

    /** Three mini panels: battery history, memory history, storage bar + network. */
    static Bitmap drawGraph(long[][] hist, int batt, int ram, int sto, String net, boolean chg, int ac) {
        int W = 432, H = 312;
        Bitmap bm = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bm);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setTypeface(android.graphics.Typeface.create(android.graphics.Typeface.MONOSPACE, android.graphics.Typeface.BOLD));
        int soft = Color.rgb(Math.min(255, Color.red(ac) + 70), Math.min(255, Color.green(ac) + 50), Math.min(255, Color.blue(ac) + 50));
        int amber = (ac == 0xFFFFB040) ? 0xFF19E3FF : 0xFFFFB040;
        int bcol = (batt <= 15 && !chg) ? 0xFFFF5A6A : ac;
        float rowH = 92;

        // row 1: battery
        p.setStyle(Paint.Style.FILL);
        p.setTextSize(27);
        p.setColor(0xFFD4F6FF);
        c.drawText("BATT", 0, 26, p);
        p.setColor(bcol);
        p.setTextAlign(Paint.Align.RIGHT);
        c.drawText(batt + "%" + (chg ? "+" : ""), W, 26, p);
        p.setTextAlign(Paint.Align.LEFT);
        spark(c, 0, 36, W - 8, rowH - 46, hist[0], hist[1], bcol, p);

        // row 2: memory
        float y2 = rowH + 10;
        p.setStyle(Paint.Style.FILL);
        p.setTextSize(27);
        p.setColor(0xFFD4F6FF);
        c.drawText("RAM", 0, y2 + 26, p);
        p.setColor(soft);
        p.setTextAlign(Paint.Align.RIGHT);
        c.drawText(ram + "%", W, y2 + 26, p);
        p.setTextAlign(Paint.Align.LEFT);
        bars(c, 0, y2 + 36, W - 8, rowH - 46, lastN(hist[2], 16), soft, p);

        // row 3: storage bar + network
        float y3 = 2 * rowH + 20;
        p.setStyle(Paint.Style.FILL);
        p.setTextSize(27);
        p.setColor(0xFFD4F6FF);
        c.drawText("STO", 0, y3 + 26, p);
        p.setColor(amber);
        p.setTextAlign(Paint.Align.RIGHT);
        c.drawText(sto + "%", W, y3 + 26, p);
        p.setTextAlign(Paint.Align.LEFT);
        int segs = 24;
        float sw = (W - 8) / (float) segs;
        int lit = Math.round(segs * sto / 100f);
        for (int k = 0; k < segs; k++) {
            p.setColor(k < lit ? amber : alpha(amber, 45));
            c.drawRect(k * sw + 1.5f, y3 + 38, (k + 1) * sw - 1.5f, y3 + 52, p);
        }
        p.setTextSize(22);
        p.setColor(net.equals("OFFLINE") ? 0xFFFF5A6A : soft);
        c.drawText("\u25CF " + net, 0, y3 + 82, p);
        return bm;
    }

    static Bitmap drawRing(int batt, int ram, int sto, boolean chg, int ac) {
        int n = 280;
        Bitmap bm = Bitmap.createBitmap(n, n, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bm);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        float cx = n / 2f, cy = n / 2f;

        // glow behind the core
        p.setStyle(Paint.Style.FILL);
        p.setShader(new RadialGradient(cx, cy, 70, new int[]{alpha(ac, 190), alpha(ac, 50), 0}, new float[]{0f, 0.55f, 1f}, Shader.TileMode.CLAMP));
        c.drawCircle(cx, cy, 70, p);
        p.setShader(null);

        // tick ring
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(3);
        for (int k = 0; k < 60; k++) {
            double a = Math.toRadians(k * 6);
            float r1 = (k % 5 == 0) ? 118 : 124, r2 = 132;
            p.setColor(alpha(ac, k % 5 == 0 ? 170 : 90));
            c.drawLine(cx + (float) Math.cos(a) * r1, cy + (float) Math.sin(a) * r1, cx + (float) Math.cos(a) * r2, cy + (float) Math.sin(a) * r2, p);
        }

        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(3);
        p.setStrokeCap(Paint.Cap.ROUND);
        p.setColor(alpha(ac, 200));
        RectF outer = new RectF(cx - 138, cy - 138, cx + 138, cy + 138);
        c.drawArc(outer, -70, 40, false, p);
        c.drawArc(outer, 50, 40, false, p);
        c.drawArc(outer, 170, 40, false, p);
        p.setColor(alpha(ac, 90));
        c.drawArc(outer, -20, 12, false, p);
        c.drawArc(outer, 100, 12, false, p);
        c.drawArc(outer, 220, 12, false, p);
        int bcol = (batt <= 15 && !chg) ? 0xFFFF5A6A : ac;
        int rcol = Color.rgb(Math.min(255, Color.red(ac) + 70), Math.min(255, Color.green(ac) + 40), Math.min(255, Color.blue(ac) + 40));
        int scol = (ac == 0xFFFFB040) ? 0xFF19E3FF : 0xFFFFB040;
        gauge(c, cx, cy, 104, 12, batt, bcol, p);
        gauge(c, cx, cy, 84, 10, ram, rcol, p);
        gauge(c, cx, cy, 66, 10, sto, scol, p);

        // arc-reactor triangle + core
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(4);
        p.setStrokeCap(Paint.Cap.ROUND);
        p.setStrokeJoin(Paint.Join.ROUND);
        p.setColor(ac);
        Path t = new Path();
        float tr = 34;
        for (int k = 0; k < 3; k++) {
            double a = Math.toRadians(-90 + k * 120);
            float x = cx + (float) Math.cos(a) * tr, y = cy + (float) Math.sin(a) * tr;
            if (k == 0) t.moveTo(x, y); else t.lineTo(x, y);
        }
        t.close();
        c.drawPath(t, p);
        p.setStyle(Paint.Style.FILL);
        p.setColor(0xFFFFFFFF);
        c.drawCircle(cx, cy + 2, 8, p);
        return bm;
    }
}

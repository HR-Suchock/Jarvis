package com.suchock.jarvis;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.widget.RemoteViews;

/** Small home-screen widget: battery ring + clock + date. Tap to open Jarvis. */
public class JarvisWidgetSmall extends AppWidgetProvider {

    static void refresh(Context c) {
        try {
            Context app = c.getApplicationContext();
            AppWidgetManager mgr = AppWidgetManager.getInstance(app);
            int[] ids = mgr.getAppWidgetIds(new ComponentName(app, JarvisWidgetSmall.class));
            if (ids != null && ids.length > 0) build(app, mgr, ids);
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        try {
            build(ctx, mgr, ids);
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onEnabled(Context ctx) {
        JarvisWidget.schedule(ctx);
    }

    private static void build(Context ctx, AppWidgetManager mgr, int[] ids) {
        int layout = ctx.getResources().getIdentifier("widget_small", "layout", ctx.getPackageName());
        if (layout == 0) return;
        String theme = ctx.getSharedPreferences("jarvis_ui", Context.MODE_PRIVATE).getString("theme", "cyan");
        int ac = JarvisWidget.accent(theme);
        int pct = 0;
        boolean chg = false;
        Intent b = ctx.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (b != null) {
            int lvl = b.getIntExtra("level", 0), sc = b.getIntExtra("scale", 100), st = b.getIntExtra("status", 0);
            pct = sc > 0 ? lvl * 100 / sc : lvl;
            chg = st == android.os.BatteryManager.BATTERY_STATUS_CHARGING || st == android.os.BatteryManager.BATTERY_STATUS_FULL;
        }
        Bitmap ring = drawBatt(pct, chg, ac);
        Bitmap hud = JarvisWidget.drawHud(ac);
        Intent i = new Intent(ctx, MainActivity.class);
        i.setAction("com.suchock.jarvis.MONITOR");
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 8, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        for (int wid : ids) {
            RemoteViews rv = new RemoteViews(ctx.getPackageName(), layout);
            rv.setImageViewBitmap(JarvisWidget.id(ctx, "ws_hud"), hud);
            rv.setImageViewBitmap(JarvisWidget.id(ctx, "ws_ring"), ring);
            rv.setTextColor(JarvisWidget.id(ctx, "ws_brand"), ac);
            rv.setTextColor(JarvisWidget.id(ctx, "ws_ampm"), ac);
            rv.setOnClickPendingIntent(JarvisWidget.id(ctx, "ws_root"), pi);
            mgr.updateAppWidget(wid, rv);
        }
    }

    static Bitmap drawBatt(int pct, boolean chg, int ac) {
        int n = 240;
        Bitmap bm = Bitmap.createBitmap(n, n, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bm);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        float cx = n / 2f, cy = n / 2f;
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(3);
        for (int k = 0; k < 60; k++) {
            double a = Math.toRadians(k * 6);
            float r1 = (k % 5 == 0) ? 100 : 106, r2 = 114;
            p.setColor(JarvisWidget.alpha(ac, k % 5 == 0 ? 170 : 90));
            c.drawLine(cx + (float) Math.cos(a) * r1, cy + (float) Math.sin(a) * r1, cx + (float) Math.cos(a) * r2, cy + (float) Math.sin(a) * r2, p);
        }
        int col = (pct <= 15 && !chg) ? 0xFFFF5A6A : ac;
        JarvisWidget.gauge(c, cx, cy, 84, 16, pct, col, p);
        p.setStyle(Paint.Style.FILL);
        p.setTextAlign(Paint.Align.CENTER);
        p.setColor(0xFFFFFFFF);
        p.setFakeBoldText(true);
        p.setTextSize(pct >= 100 ? 52 : 62);
        c.drawText(String.valueOf(pct), cx, cy + 14, p);
        p.setFakeBoldText(false);
        p.setTextSize(24);
        p.setColor(JarvisWidget.alpha(col, 230));
        c.drawText(chg ? "CHARGING" : "BATT", cx, cy + 46, p);
        return bm;
    }
}

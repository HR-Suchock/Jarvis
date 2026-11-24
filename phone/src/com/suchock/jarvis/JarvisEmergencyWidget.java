package com.suchock.jarvis;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.BatteryManager;
import android.widget.RemoteViews;

/** Home-screen emergency panel: live status (siren, light, tracking, last fix, battery, a survival tip) and toggle buttons. Tap to start, tap again to stop. */
public class JarvisEmergencyWidget extends AppWidgetProvider {
    static final String TOGGLE = "com.suchock.jarvis.EM_TOGGLE";
    private static final String[] TIPS = {
        "Tip: stay calm, breathe slowly, then act on the most urgent danger first.",
        "Tip: heavy bleeding? Press hard with a clean cloth and do not remove it.",
        "Tip: lost? Stay put, make noise in threes and keep warm and dry.",
        "Tip: earthquake? Drop, cover, hold on. Stay away from windows.",
        "Tip: flood water is dangerous. Move to higher ground, never walk or drive through it.",
        "Tip: save battery. Lower brightness, close apps and use airplane mode when waiting.",
        "Tip: three of anything (whistle, flashes, fires) is the signal for help.",
        "Tip: no clean water? Boil it for one minute if you can before drinking."
    };

    static void refresh(Context c) {
        try {
            Context app = c.getApplicationContext();
            AppWidgetManager mgr = AppWidgetManager.getInstance(app);
            int[] ids = mgr.getAppWidgetIds(new ComponentName(app, JarvisEmergencyWidget.class));
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
    public void onReceive(Context ctx, Intent in) {
        if (in != null && TOGGLE.equals(in.getAction())) {
            try {
                String w = in.getStringExtra("what");
                Context app = ctx.getApplicationContext();
                Emergency.remember(app);
                if ("siren".equals(w) || "whistle".equals(w)) {
                    if (w.equals(Emergency.soundKind())) Emergency.soundStop();
                    else Emergency.soundStart(app, w);
                } else if ("sos".equals(w)) {
                    if (Emergency.morsePlaying()) Emergency.morseStop();
                    else Emergency.morseStart(app, "... --- ...", true);
                } else if ("track".equals(w)) {
                    if (Emergency.tracking()) Emergency.trackStop();
                    else if (Emergency.hasLocationPermission(app)) Emergency.trackStart(app);
                    else {
                        Intent o = new Intent(app, MainActivity.class);
                        o.setAction("com.suchock.jarvis.EMERGENCY");
                        o.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                        app.startActivity(o);
                    }
                }
                refresh(app);
            } catch (Throwable ignored) {
            }
            return;
        }
        super.onReceive(ctx, in);
    }

    private static PendingIntent toggle(Context ctx, String what, int code) {
        Intent i = new Intent(ctx, JarvisEmergencyWidget.class);
        i.setAction(TOGGLE);
        i.putExtra("what", what);
        return PendingIntent.getBroadcast(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static String battery(Context ctx) {
        try {
            Intent b = ctx.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (b == null) return "";
            int lv = b.getIntExtra(BatteryManager.EXTRA_LEVEL, -1), sc = b.getIntExtra(BatteryManager.EXTRA_SCALE, 100), st = b.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            boolean ch = st == BatteryManager.BATTERY_STATUS_CHARGING || st == BatteryManager.BATTERY_STATUS_FULL;
            return "BATTERY " + (lv * 100 / Math.max(1, sc)) + "%" + (ch ? " CHARGING" : "");
        } catch (Throwable t) {
            return "";
        }
    }

    private static void build(Context ctx, AppWidgetManager mgr, int[] ids) {
        int layout = ctx.getResources().getIdentifier("widget_emergency", "layout", ctx.getPackageName());
        if (layout == 0) return;
        Intent o = new Intent(ctx, MainActivity.class);
        o.setAction("com.suchock.jarvis.EMERGENCY");
        o.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent open = PendingIntent.getActivity(ctx, 21, o, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent d = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:999"));
        d.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent dial = PendingIntent.getActivity(ctx, 24, d, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String kind = Emergency.soundKind();
        boolean siren = "siren".equals(kind), whistle = "whistle".equals(kind), sos = Emergency.morsePlaying(), trk = Emergency.tracking();
        String fix = Emergency.lastFix();
        String fixTxt = "LOCATION: not tracking";
        if (fix != null) {
            String[] p = fix.split("\\|");
            fixTxt = "LAST FIX " + p[0] + "  (" + p[1] + " m)";
        } else if (trk) {
            fixTxt = "LOCATION: searching for a fix...";
        }
        int on = 0;
        if (siren || whistle) on++;
        if (sos) on++;
        if (trk) on++;
        String status = on == 0 ? "READY  " + battery(ctx) : (siren ? "SIREN ON  " : whistle ? "WHISTLE ON  " : "") + (sos ? "SOS FLASHING  " : "") + (trk ? "TRACKING" : "");
        String tip = TIPS[(int) ((System.currentTimeMillis() / 600000L) % TIPS.length)];
        for (int wid : ids) {
            RemoteViews rv = new RemoteViews(ctx.getPackageName(), layout);
            rv.setTextViewText(JarvisWidget.id(ctx, "we_status"), status.trim());
            rv.setTextViewText(JarvisWidget.id(ctx, "we_fix"), fixTxt);
            rv.setTextViewText(JarvisWidget.id(ctx, "we_tip"), tip);
            String[][] t = { { "we_siren", siren ? "SIREN ON" : "SIREN", siren ? "1" : "0" }, { "we_whistle", whistle ? "WHISTLE ON" : "WHISTLE", whistle ? "1" : "0" },
                { "we_sos", sos ? "SOS ON" : "SOS LIGHT", sos ? "1" : "0" }, { "we_track", trk ? "LOCATING" : "LOCATE", trk ? "1" : "0" } };
            for (String[] x : t) {
                int id = JarvisWidget.id(ctx, x[0]);
                rv.setTextViewText(id, x[1]);
                rv.setTextColor(id, "1".equals(x[2]) ? 0xFFFF5A5A : 0xFFFFFFFF);
            }
            rv.setOnClickPendingIntent(JarvisWidget.id(ctx, "we_siren"), toggle(ctx, "siren", 22));
            rv.setOnClickPendingIntent(JarvisWidget.id(ctx, "we_whistle"), toggle(ctx, "whistle", 25));
            rv.setOnClickPendingIntent(JarvisWidget.id(ctx, "we_sos"), toggle(ctx, "sos", 23));
            rv.setOnClickPendingIntent(JarvisWidget.id(ctx, "we_track"), toggle(ctx, "track", 26));
            rv.setOnClickPendingIntent(JarvisWidget.id(ctx, "we_call"), dial);
            rv.setOnClickPendingIntent(JarvisWidget.id(ctx, "we_open"), open);
            rv.setOnClickPendingIntent(JarvisWidget.id(ctx, "we_title"), open);
            mgr.updateAppWidget(wid, rv);
        }
    }
}
// CRB-MARK c9251327de53

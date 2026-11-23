package com.suchock.jarvis;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/** Home-screen emergency widget: SIREN and SOS LIGHT toggle (tap to start, tap again to stop), OPEN shows the emergency screen. */
public class JarvisEmergencyWidget extends AppWidgetProvider {
    static final String TOGGLE = "com.suchock.jarvis.EM_TOGGLE";

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
                if ("siren".equals(w)) {
                    if (Emergency.soundPlaying()) Emergency.soundStop();
                    else Emergency.soundStart(app, "siren");
                } else if ("sos".equals(w)) {
                    if (Emergency.morsePlaying()) Emergency.morseStop();
                    else Emergency.morseStart(app, "... --- ...", true);
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

    private static void build(Context ctx, AppWidgetManager mgr, int[] ids) {
        int layout = ctx.getResources().getIdentifier("widget_emergency", "layout", ctx.getPackageName());
        if (layout == 0) return;
        Intent o = new Intent(ctx, MainActivity.class);
        o.setAction("com.suchock.jarvis.EMERGENCY");
        o.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent open = PendingIntent.getActivity(ctx, 21, o, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        boolean siren = Emergency.soundPlaying(), sos = Emergency.morsePlaying();
        for (int wid : ids) {
            RemoteViews rv = new RemoteViews(ctx.getPackageName(), layout);
            rv.setTextViewText(JarvisWidget.id(ctx, "we_siren"), siren ? "SIREN ON" : "SIREN");
            rv.setTextViewText(JarvisWidget.id(ctx, "we_sos"), sos ? "SOS ON" : "SOS LIGHT");
            rv.setTextColor(JarvisWidget.id(ctx, "we_siren"), siren ? 0xFFFF5A5A : 0xFFFFFFFF);
            rv.setTextColor(JarvisWidget.id(ctx, "we_sos"), sos ? 0xFFFF5A5A : 0xFFFFFFFF);
            rv.setOnClickPendingIntent(JarvisWidget.id(ctx, "we_siren"), toggle(ctx, "siren", 22));
            rv.setOnClickPendingIntent(JarvisWidget.id(ctx, "we_sos"), toggle(ctx, "sos", 23));
            rv.setOnClickPendingIntent(JarvisWidget.id(ctx, "we_open"), open);
            rv.setOnClickPendingIntent(JarvisWidget.id(ctx, "we_title"), open);
            mgr.updateAppWidget(wid, rv);
        }
    }
}
// CRB-MARK c9251327de53

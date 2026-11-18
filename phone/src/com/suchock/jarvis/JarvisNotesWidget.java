package com.suchock.jarvis;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;

/** Home-screen notes widget: the newest notes at a glance. Tap the list to open the notes, "+ ADD" to write a new one. */
public class JarvisNotesWidget extends AppWidgetProvider {
    static final String PREF = "jarvis_ui", KEY = "notes";
    private static final int[] LINES = {0, 0, 0, 0, 0, 0};

    /** Called by the app whenever the notes change. */
    static void save(Context c, String json) {
        try {
            if (json == null || json.length() > 60000) return;
            c.getApplicationContext().getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putString(KEY, json).apply();
            refresh(c);
        } catch (Throwable ignored) {
        }
    }

    static void refresh(Context c) {
        try {
            Context app = c.getApplicationContext();
            AppWidgetManager mgr = AppWidgetManager.getInstance(app);
            int[] ids = mgr.getAppWidgetIds(new ComponentName(app, JarvisNotesWidget.class));
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

    private static PendingIntent open(Context ctx, String action, int code) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setAction(action);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void build(Context ctx, AppWidgetManager mgr, int[] ids) {
        int layout = ctx.getResources().getIdentifier("widget_notes", "layout", ctx.getPackageName());
        if (layout == 0) return;
        android.content.SharedPreferences sp = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE);
        int ac = JarvisWidget.accent(sp.getString("theme", "cyan"));
        JSONArray notes;
        try {
            notes = new JSONArray(sp.getString(KEY, "[]"));
        } catch (Exception e) {
            notes = new JSONArray();
        }
        int n = notes.length();
        for (int wid : ids) {
            RemoteViews rv = new RemoteViews(ctx.getPackageName(), layout);
            rv.setTextColor(JarvisWidget.id(ctx, "wn_title"), ac);
            rv.setTextColor(JarvisWidget.id(ctx, "wn_add"), ac);
            rv.setTextViewText(JarvisWidget.id(ctx, "wn_title"), n > 0 ? "NOTES  ·  " + n : "NOTES");
            for (int k = 0; k < LINES.length; k++) {
                int tid = JarvisWidget.id(ctx, "wn_" + (k + 1));
                int idx = n - 1 - k;                                  // newest first
                String t = idx >= 0 ? notes.optString(idx, "").trim() : "";
                if (k == 0 && n == 0) t = "No notes yet. Tap + ADD, or say “take a note…” to Jarvis.";
                if (t.length() == 0) { rv.setViewVisibility(tid, View.GONE); continue; }
                rv.setViewVisibility(tid, View.VISIBLE);
                rv.setTextViewText(tid, (n == 0 ? "" : "• ") + t);
            }
            PendingIntent list = open(ctx, "com.suchock.jarvis.NOTES", 21);
            rv.setOnClickPendingIntent(JarvisWidget.id(ctx, "wn_root"), list);
            rv.setOnClickPendingIntent(JarvisWidget.id(ctx, "wn_list"), list);
            rv.setOnClickPendingIntent(JarvisWidget.id(ctx, "wn_add"), open(ctx, "com.suchock.jarvis.NOTES_ADD", 22));
            mgr.updateAppWidget(wid, rv);
        }
    }
}

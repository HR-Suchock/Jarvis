package com.suchock.jarvis;

import android.app.NotificationManager;
import android.content.Context;

/** The notification status card was removed; this only clears the card left behind by an earlier version. */
final class StatusCard {
    static void cancel(Context c) {
        try {
            c.getSharedPreferences("jarvis_ui", Context.MODE_PRIVATE).edit().remove("card").apply();
            ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(78);
        } catch (Throwable ignored) {
        }
    }
}

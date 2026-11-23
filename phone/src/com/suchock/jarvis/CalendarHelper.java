package com.suchock.jarvis;

import android.content.ContentUris;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;

/** Read-only look at the phone calendar: title, time, place only. Nothing is written, nothing leaves the phone except through the encrypted Device Link. */
final class CalendarHelper {
    private CalendarHelper() { }

    static boolean allowed(Context c) {
        return c.checkSelfPermission("android.permission.READ_CALENDAR") == PackageManager.PERMISSION_GRANTED;
    }

    private static String esc(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < s.length() && i < 120; i++) {
            char ch = s.charAt(i);
            if (ch == '"' || ch == '\\') b.append('\\').append(ch);
            else if (ch < 32) b.append(' ');
            else b.append(ch);
        }
        return b.toString();
    }

    /** JSON array text of the events from now (or the start of today) until `days` days ahead, at most 40; null when there is no permission. */
    static String query(Context c, int days) {
        if (!allowed(c)) return null;
        if (days < 1) days = 1;
        if (days > 31) days = 31;
        java.util.Calendar cal = java.util.Calendar.getInstance();
        cal.set(java.util.Calendar.HOUR_OF_DAY, 0);
        cal.set(java.util.Calendar.MINUTE, 0);
        cal.set(java.util.Calendar.SECOND, 0);
        cal.set(java.util.Calendar.MILLISECOND, 0);
        long from = cal.getTimeInMillis();
        long to = from + days * 86400000L;
        Uri.Builder ub = CalendarContract.Instances.CONTENT_URI.buildUpon();
        ContentUris.appendId(ub, from);
        ContentUris.appendId(ub, to);
        StringBuilder out = new StringBuilder("[");
        Cursor cur = null;
        try {
            cur = c.getContentResolver().query(ub.build(),
                    new String[]{CalendarContract.Instances.TITLE, CalendarContract.Instances.BEGIN, CalendarContract.Instances.END,
                            CalendarContract.Instances.ALL_DAY, CalendarContract.Instances.EVENT_LOCATION},
                    null, null, CalendarContract.Instances.BEGIN + " ASC");
            int n = 0;
            long now = System.currentTimeMillis();
            while (cur != null && cur.moveToNext() && n < 40) {
                long end = cur.getLong(2);
                if (cur.getInt(3) == 0 && end < now) continue;   // already finished today
                if (n > 0) out.append(',');
                out.append("{\"t\":\"").append(esc(cur.getString(0))).append("\",\"s\":").append(cur.getLong(1))
                        .append(",\"e\":").append(end).append(",\"a\":").append(cur.getInt(3) == 1 ? "true" : "false")
                        .append(",\"l\":\"").append(esc(cur.getString(4))).append("\"}");
                n++;
            }
        } catch (Exception e) {
            return "[]";
        } finally {
            if (cur != null) cur.close();
        }
        return out.append(']').toString();
    }
}
// CRB-MARK 01445dd7bbee

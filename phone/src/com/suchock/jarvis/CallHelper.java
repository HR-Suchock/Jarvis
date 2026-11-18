package com.suchock.jarvis;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.ContactsContract;
import android.telecom.TelecomManager;

/** Shared bits for "call help": answer / reject the ringing call and look up who is calling. */
final class CallHelper {
    static boolean enabled(Context c) {
        return c.getSharedPreferences("jarvis_ui", Context.MODE_PRIVATE).getBoolean("callhelp", false);
    }

    static void setEnabled(Context c, boolean on) {
        c.getSharedPreferences("jarvis_ui", Context.MODE_PRIVATE).edit().putBoolean("callhelp", on).apply();
    }

    static boolean has(Context c, String perm) {
        return c.checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED;
    }

    static boolean canAnswer(Context c) {
        return Build.VERSION.SDK_INT >= 26 && has(c, Manifest.permission.ANSWER_PHONE_CALLS);
    }

    /** Answers the ringing call. Returns a short message for the user. */
    static String answer(Context c) {
        try {
            if (!canAnswer(c)) return Build.VERSION.SDK_INT < 26 ? "This Android version cannot answer calls for me." : "I need the Answer phone calls permission. Turn on Call help in Settings.";
            ((TelecomManager) c.getSystemService(Context.TELECOM_SERVICE)).acceptRingingCall();
            return "Answering the call.";
        } catch (SecurityException e) {
            return "Android did not allow me to answer. Turn on Call help in Settings.";
        } catch (Throwable e) {
            return "I could not answer the call.";
        }
    }

    /** Rejects the ringing call (or ends the current one). */
    static String reject(Context c) {
        try {
            if (Build.VERSION.SDK_INT < 28 || !has(c, Manifest.permission.ANSWER_PHONE_CALLS))
                return Build.VERSION.SDK_INT < 28 ? "This Android version cannot reject calls for me." : "I need the Answer phone calls permission. Turn on Call help in Settings.";
            boolean ok = ((TelecomManager) c.getSystemService(Context.TELECOM_SERVICE)).endCall();
            return ok ? "Call rejected." : "There is no call to reject.";
        } catch (SecurityException e) {
            return "Android did not allow me to end the call. Turn on Call help in Settings.";
        } catch (Throwable e) {
            return "I could not reject the call.";
        }
    }

    /** Contact name for a number, or "" if it is not in the contacts / no permission. */
    static String nameFor(Context c, String number) {
        if (number == null || number.length() == 0 || !has(c, Manifest.permission.READ_CONTACTS)) return "";
        Cursor cur = null;
        try {
            Uri u = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number));
            cur = c.getContentResolver().query(u, new String[]{ContactsContract.PhoneLookup.DISPLAY_NAME}, null, null, null);
            if (cur != null && cur.moveToFirst()) return cur.getString(0);
        } catch (Throwable ignored) {
        } finally {
            if (cur != null) cur.close();
        }
        return "";
    }
}

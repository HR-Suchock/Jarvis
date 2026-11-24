package com.suchock.jarvis;

import android.app.SearchManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.media.AudioManager;
import android.net.Uri;
import android.os.BatteryManager;
import android.provider.AlarmClock;
import android.provider.ContactsContract;
import android.provider.Settings;
import android.view.KeyEvent;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Everything Jarvis can physically do on the phone. All methods return a JSON string {ok, msg}. */
final class Actions {
    private final Context ctx;
    private boolean torchOn = false;
    private static final Map<String, String> ALIASES = new HashMap<String, String>();

    static {
        ALIASES.put("yt", "youtube");
        ALIASES.put("you tube", "youtube");
        ALIASES.put("fb", "facebook");
        ALIASES.put("insta", "instagram");
        ALIASES.put("whats app", "whatsapp");
        ALIASES.put("play store", "play store");
        ALIASES.put("google maps", "maps");
        ALIASES.put("map", "maps");
        ALIASES.put("mail", "gmail");
        ALIASES.put("email", "gmail");
        ALIASES.put("photos", "photos");
        ALIASES.put("gallery", "gallery");
        ALIASES.put("dialer", "phone");
        ALIASES.put("messages", "messages");
        ALIASES.put("messenger", "messenger");
        ALIASES.put("tiktok", "tiktok");
    }

    volatile Bridge owner;

    private void tell(String why) {
        Bridge b = owner;
        if (b == null) return;
        try {
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("msg", why);
            b.emit("typefail", o);
        } catch (Exception ignored) {
        }
    }

    Actions(Context c) {
        this.ctx = c.getApplicationContext();
    }

    private static String res(boolean ok, String msg) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", ok);
            o.put("msg", msg);
            return o.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"msg\":\"error\"}";
        }
    }

    private boolean has(String perm) {
        return ctx.checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED;
    }

    private void start(Intent i) {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(i);
    }

    String run(String type, String arg, String arg2) {
        if (type == null) return res(false, "No action given.");
        if (arg == null) arg = "";
        if (arg2 == null) arg2 = "";
        String rawArg = arg;
        arg = arg.trim();
        try {
            switch (type) {
                case "call": return call(arg);
                case "callanswer": { String m = CallHelper.answer(ctx); return res(m.startsWith("Answering"), m); }
                case "callreject": { String m = CallHelper.reject(ctx); return res(m.startsWith("Call rejected"), m); }
                case "sms": return sms(arg, arg2);
                case "open": return openApp(arg);
                case "youtube": return youtube(arg, arg2);
                case "search": return search(arg);
                case "navigate": return navigate(arg);
                case "map": return map(arg);
                case "url": return url(arg);
                case "torch": return torch(arg);
                case "timer": return timer(arg);
                case "alarm": return alarm(arg);
                case "volume": return volume(arg);
                case "media": return media(arg);
                case "battery": return battery();
                case "settings": return settings(arg);
                case "type": return type(stripBlank(rawArg), arg2);
                case "align": return align(arg);
                case "playnth": return playNth(arg);
                case "swipe": return swipe(arg, arg2);
                case "key": return key(arg);
                case "tap": return tap(arg);
                case "scroll": return scroll(arg, arg2);
                case "findphone": { String m = FindPhone.start(ctx); return res(m.startsWith("Ringing") || m.startsWith("Already"), m); }
                case "stopring": return res(true, FindPhone.stop(ctx));
                case "emsound": {
                    if ("off".equals(arg)) { Emergency.soundStop(); return res(true, "Alarm stopped."); }
                    String k = "whistle".equals(arg) ? "whistle" : "siren";
                    return Emergency.soundStart(ctx, k) ? res(true, "Loud " + k + " is on. It stops by itself after 5 minutes.") : res(false, "I could not start the alarm sound.");
                }
                case "morse": {
                    if ("stop".equals(arg)) { Emergency.morseStop(); return res(true, "Flashlight signal stopped."); }
                    String m = "sos".equals(arg) ? "... --- ..." : arg;
                    String er = Emergency.morseStart(ctx, m, "loop".equals(arg2) || "sos".equals(arg));
                    return er == null ? res(true, "Signalling with the flashlight.") : res(false, er);
                }
                case "emstop": Radio.stop(); { Emergency.soundStop(); Emergency.morseStop(); Emergency.trackStop(); FindPhone.stop(ctx); return res(true, "All emergency signals are off."); }
                case "emstate": return res(true, Emergency.soundKind() + "|" + (Emergency.morsePlaying() ? 1 : 0) + "|" + (Emergency.tracking() ? 1 : 0) + "|" + Radio.status() + "|" + Radio.url());
                case "radio": {
                    if ("off".equals(arg) || arg == null || arg.length() == 0) { Radio.stop(); return res(true, "Radio off."); }
                    String m = Radio.start(ctx, arg);
                    return res(Radio.status().length() > 0, m);
                }
                case "emtrack": {
                    Emergency.remember(ctx);
                    if ("off".equals(arg)) { Emergency.trackStop(); return res(true, "Location tracking is off."); }
                    if (!Emergency.hasLocationPermission(ctx)) return res(false, "Location permission is off. Allow it in Android settings for Jarvis.");
                    return Emergency.trackStart(ctx) ? res(true, "Tracking your location. It stops by itself after 30 minutes.") : res(false, "I could not start location tracking.");
                }
                case "where": return where();
                case "notify": return notifyMsg(arg);
                case "setclip": return setClip(arg);
                case "calendar": return calendarJson(arg);
                case "clock": return res(true, "epoch " + (System.currentTimeMillis() / 1000));
                case "filepart": return filePart(arg, arg2);
                case "lanoffer": return lanOffer();
                case "brightness": return brightness(arg);
                case "dnd": return dnd(arg);
                case "ringer": return ringer();
                case "camera": return camera(arg);
                case "clockui": return clockUi(arg);
                case "calins": return calIns(arg, arg2);
                case "spotify": return spotify(arg);
                case "mailto": return mailto(arg, arg2);
                case "whatsapp": return whatsapp(arg, arg2);
                case "redial": return redial();
                case "screentext": return screenText();
                case "screenlater": { JarvisAccess v = JarvisAccess.get(); if (v == null) return res(false, needAccess()); v.screenLater(7000); return res(true, "started"); }
                case "screenresult": { String t = JarvisAccess.laterText; if (t == null) return res(true, JarvisAccess.laterBusy ? "@WAIT" : "@NONE"); return res(true, t.length() == 0 ? "@EMPTY" : t); }
                default: return res(false, "I don't know how to do '" + type + "'.");
            }
        } catch (SecurityException se) {
            return res(false, "I need permission for that. Grant it in Settings, then ask again.");
        } catch (ActivityNotFoundException nf) {
            return res(false, "No app on this phone can handle that.");
        } catch (Exception e) {
            return res(false, "That didn't work: " + e.getMessage());
        }
    }

    /** A note pushed from the PC: shows as a normal notification. */
    private String calendarJson(String days) {
        int d = 7;
        try { d = Integer.parseInt(days.trim()); } catch (Exception e) { /* default */ }
        String q = CalendarHelper.query(ctx, d);
        if (q == null) return res(false, "The phone calendar is not allowed yet. On the phone open Settings, Device Link, Calendar and allow it.");
        return res(true, q);
    }

    private String notifyMsg(String text) {
        if (text.length() == 0) return res(false, "Nothing to show.");
        if (text.length() > 300) text = text.substring(0, 300);
        try {
            android.app.NotificationManager nm = (android.app.NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (android.os.Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(new android.app.NotificationChannel("jarvis_pc", "Messages from your PC", android.app.NotificationManager.IMPORTANCE_HIGH));
            android.app.PendingIntent pi = android.app.PendingIntent.getActivity(ctx, 83, new Intent(ctx, MainActivity.class), android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
            android.app.Notification.Builder b = android.os.Build.VERSION.SDK_INT >= 26 ? new android.app.Notification.Builder(ctx, "jarvis_pc") : new android.app.Notification.Builder(ctx);
            b.setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("From your PC").setContentText(text)
                    .setStyle(new android.app.Notification.BigTextStyle().bigText(text)).setContentIntent(pi).setAutoCancel(true);
            nm.notify(84, b.build());
            return res(true, "Shown on the phone.");
        } catch (Exception e) {
            return res(false, "Could not show it: " + e.getMessage());
        }
    }


    /** Text sent from the PC goes straight into the phone's clipboard (paste it anywhere) and a quiet notification confirms it. */
    private String setClip(String text) {
        if (text == null || text.length() == 0) return res(false, "Nothing to copy.");
        if (text.length() > 4000) text = text.substring(0, 4000);
        try {
            android.content.ClipboardManager cm = (android.content.ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
            cm.setPrimaryClip(android.content.ClipData.newPlainText("From your PC", text));
        } catch (Exception e) {
            return res(false, "Could not use the phone clipboard: " + e.getMessage());
        }
        String shown = text.length() > 120 ? text.substring(0, 120) + "…" : text;
        notifyQuiet("Copied from your PC", shown + "\nPaste it anywhere.", null);
        return res(true, "Copied to the phone clipboard.");
    }

    private void notifyQuiet(String title, String body, Uri open) {
        try {
            android.app.NotificationManager nm = (android.app.NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (android.os.Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(new android.app.NotificationChannel("jarvis_pc_quiet", "Files and copies from your PC", android.app.NotificationManager.IMPORTANCE_DEFAULT));
            Intent in;
            if (open != null) in = new Intent(Intent.ACTION_VIEW).setDataAndType(open, ctx.getContentResolver().getType(open)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            else in = new Intent(ctx, MainActivity.class);
            android.app.PendingIntent pi = android.app.PendingIntent.getActivity(ctx, 85, in, android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
            android.app.Notification.Builder b = android.os.Build.VERSION.SDK_INT >= 26 ? new android.app.Notification.Builder(ctx, "jarvis_pc_quiet") : new android.app.Notification.Builder(ctx);
            b.setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(title).setContentText(body)
                    .setStyle(new android.app.Notification.BigTextStyle().bigText(body)).setContentIntent(pi).setAutoCancel(true);
            nm.notify(85, b.build());
        } catch (Exception ignored) {
        }
    }

    // ---------------------------------------------------------------- files from the PC (photos, screenshots, small files)
    private static final java.util.HashMap<String, Integer> FILE_NEXT = new java.util.HashMap<>();
    private static final long FB_FILE_MAX = 5L * 1000 * 1000;      // over the internet link; bigger files go by Wi-Fi (Lan.java)

    private static String safeName(String n) {
        n = n == null ? "" : n.replace('\\', '/');
        n = n.substring(n.lastIndexOf('/') + 1).replaceAll("[^A-Za-z0-9._ ()\\-]", "_").trim();
        while (n.startsWith(".")) n = n.substring(1);
        if (n.length() > 80) n = n.substring(n.length() - 80);
        return n.length() == 0 ? "from-pc" : n;
    }

    private static boolean blockedName(String n) {
        String x = n.toLowerCase(Locale.ROOT);
        String[] bad = {".bat", ".cmd", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh", ".ps1", ".psm1", ".scr", ".pif", ".lnk", ".hta", ".reg", ".cpl", ".inf", ".url", ".application", ".msc", ".gadget"};
        for (String b : bad) if (x.endsWith(b)) return true;
        return false;
    }

    private static String guessMime(String name, String given) {
        if (given != null && given.matches("^[a-z]+/[a-z0-9.+\\-]{1,60}$")) return given;
        String x = name.toLowerCase(Locale.ROOT);
        if (x.endsWith(".png")) return "image/png";
        if (x.endsWith(".jpg") || x.endsWith(".jpeg")) return "image/jpeg";
        if (x.endsWith(".gif")) return "image/gif";
        if (x.endsWith(".webp")) return "image/webp";
        if (x.endsWith(".pdf")) return "application/pdf";
        if (x.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    /** One numbered piece of a file; the last piece completes it and saves it into Gallery (images) or Downloads. */
    private String filePart(String metaJson, String b64) {
        try {
            JSONObject m = new JSONObject(metaJson);
            String id = m.optString("id", "").replaceAll("[^A-Za-z0-9_\\-]", "");
            int i = m.optInt("i", -1), n = m.optInt("n", 0);
            long size = m.optLong("size", 0);
            String name = safeName(m.optString("name", "file")), mime = guessMime(name, m.optString("mime", ""));
            if (id.length() < 4 || id.length() > 40 || n < 1 || n > 160 || i < 0 || i >= n || size <= 0 || size > FB_FILE_MAX) return res(false, "That file transfer was not valid.");
            if (blockedName(name)) return res(false, "I do not accept that type of file on the phone.");
            byte[] data = android.util.Base64.decode(b64, android.util.Base64.NO_WRAP);
            if (data.length == 0 || data.length > 300000) return res(false, "That piece of the file was not valid.");
            java.io.File dir = new java.io.File(ctx.getCacheDir(), "incoming");
            dir.mkdirs();
            java.io.File part = new java.io.File(dir, id + ".part");
            synchronized (FILE_NEXT) {
                if (i == 0) {
                    java.io.File[] old = dir.listFiles();
                    if (old != null) for (java.io.File f : old) if (System.currentTimeMillis() - f.lastModified() > 3600000L) f.delete();
                    part.delete();
                    FILE_NEXT.put(id, 0);
                }
                Integer next = FILE_NEXT.get(id);
                if (next != null && i == next - 1 && i < n - 1) return res(true, "Piece " + (i + 1) + " of " + n + " received.");      // a repeated piece (the answer was lost): ignore it
                if (next == null || next != i) return res(false, "File pieces arrived out of order. Please send it again.");
                java.io.FileOutputStream fo = new java.io.FileOutputStream(part, true);
                try { fo.write(data); } finally { fo.close(); }
                if (part.length() > size) { part.delete(); FILE_NEXT.remove(id); return res(false, "The file was larger than announced."); }
                FILE_NEXT.put(id, i + 1);
                if (i < n - 1) return res(true, "Piece " + (i + 1) + " of " + n + " received.");
                FILE_NEXT.remove(id);
                if (part.length() != size) { part.delete(); return res(false, "The file arrived incomplete. Please send it again."); }
            }
            String done = finishIncoming(part, name, mime);
            part.delete();
            return res(true, done);
        } catch (Exception e) {
            return res(false, "Could not save the file: " + e.getMessage());
        }
    }

    /** Puts a finished incoming file into Gallery/Downloads, shows ONE notification, returns the reply text. */
    private String finishIncoming(java.io.File part, String name, String mime) throws java.io.IOException {
        Uri saved = saveIncoming(part, name, mime);
        boolean img = mime.startsWith("image/");
        String where = img ? "Gallery (Pictures/Jarvis)" : "Downloads/Jarvis";
        notifyQuiet(img ? "Picture from your PC" : "File from your PC", name + " saved to " + where + ". Tap to open.", saved);
        return "Saved on the phone: " + name + " (" + where + ").";
    }

    /** Same-Wi-Fi receive: opens a one-shot receiver and tells the PC where to connect (see Lan.java). */
    private String lanOffer() {
        final java.util.ArrayList<String> ips = Lan.ips();
        if (ips.isEmpty()) return res(false, "The phone is not on a Wi-Fi network.");
        try {
            final java.net.ServerSocket ss = new java.net.ServerSocket(0);
            final String token = Lan.token();
            new Thread(new Runnable() {
                public void run() {
                    Lan.receiveOnce(ss, token, new java.io.File(ctx.getCacheDir(), "incoming"), new Lan.Sink() {
                        public String done(java.io.File f, String name, String mime) throws Exception {
                            String n = safeName(name);
                            if (blockedName(n)) throw new java.io.IOException("that file type starts by itself on a PC, so it is not accepted");
                            return finishIncoming(f, n, guessMime(n, mime));
                        }
                    });
                }
            }, "jarvis-lan").start();
            StringBuilder sb = new StringBuilder();
            for (String ip : ips) sb.append(sb.length() > 0 ? "," : "").append(ip);
            return res(true, "LAN " + sb + " " + ss.getLocalPort() + " " + token);
        } catch (Exception e) {
            return res(false, "Could not open a Wi-Fi receiver on the phone.");
        }
    }

    private Uri saveIncoming(java.io.File src, String name, String mime) throws java.io.IOException {
        boolean img = mime.startsWith("image/");
        if (android.os.Build.VERSION.SDK_INT >= 29) {
            android.content.ContentResolver cr = ctx.getContentResolver();
            android.content.ContentValues v = new android.content.ContentValues();
            v.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name);
            v.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mime);
            v.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, (img ? android.os.Environment.DIRECTORY_PICTURES : android.os.Environment.DIRECTORY_DOWNLOADS) + "/Jarvis");
            v.put(android.provider.MediaStore.MediaColumns.IS_PENDING, 1);
            Uri col = img ? android.provider.MediaStore.Images.Media.getContentUri(android.provider.MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    : android.provider.MediaStore.Downloads.getContentUri(android.provider.MediaStore.VOLUME_EXTERNAL_PRIMARY);
            Uri u = cr.insert(col, v);
            if (u == null) throw new java.io.IOException("storage refused the file");
            java.io.OutputStream os = cr.openOutputStream(u);
            java.io.FileInputStream in = new java.io.FileInputStream(src);
            try {
                byte[] buf = new byte[16384];
                int r;
                while ((r = in.read(buf)) > 0) os.write(buf, 0, r);
            } finally {
                in.close();
                if (os != null) os.close();
            }
            v.clear();
            v.put(android.provider.MediaStore.MediaColumns.IS_PENDING, 0);
            cr.update(u, v, null, null);
            return u;
        }
        java.io.File dir = ctx.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) throw new java.io.IOException("no storage");
        java.io.File dst = new java.io.File(dir, name);
        java.io.FileInputStream in = new java.io.FileInputStream(src);
        java.io.FileOutputStream os = new java.io.FileOutputStream(dst);
        try {
            byte[] buf = new byte[16384];
            int r;
            while ((r = in.read(buf)) > 0) os.write(buf, 0, r);
        } finally {
            in.close();
            os.close();
        }
        return null;
    }

    // ---------------------------------------------------------------- contacts

    private static String digitsOnly(String s) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if ((c >= '0' && c <= '9') || (c == '+' && b.length() == 0)) b.append(c);
        }
        return b.toString();
    }

    private static boolean looksLikeNumber(String s) {
        String t = s.replaceAll("[\\s\\-().]", "");
        if (t.length() < 3) return false;
        return t.matches("\\+?[0-9]+");
    }

    private static String norm(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N} ]", " ").replaceAll("\\s+", " ").trim();
    }

    private static int lev(String a, String b) {
        int[] prev = new int[b.length() + 1];
        int[] cur = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) prev[j] = j;
        for (int i = 1; i <= a.length(); i++) {
            cur[0] = i;
            for (int j = 1; j <= b.length(); j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                cur[j] = Math.min(Math.min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost);
            }
            int[] t = prev;
            prev = cur;
            cur = t;
        }
        return prev[b.length()];
    }

    /** Returns {displayName, number} or null. Tolerates speech-recognition misspellings. */
    private String[] findContact(String spoken) {
        String q = norm(spoken);
        if (q.length() == 0) return null;
        Cursor c = null;
        String bestName = null, bestNum = null;
        int bestScore = Integer.MAX_VALUE;
        try {
            c = ctx.getContentResolver().query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                    new String[]{ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER},
                    null, null, null);
            if (c == null) return null;
            while (c.moveToNext()) {
                String name = c.getString(0);
                String num = c.getString(1);
                if (name == null || num == null) continue;
                String n = norm(name);
                int score;
                if (n.equals(q)) score = 0;
                else if (n.startsWith(q + " ") || n.endsWith(" " + q)) score = 1;
                else if (n.contains(q)) score = 2;
                else {
                    // word level fuzzy match
                    int best = Integer.MAX_VALUE;
                    String[] qw = q.split(" ");
                    String[] nw = n.split(" ");
                    for (String x : qw) {
                        for (String y : nw) {
                            if (x.length() < 3 || y.length() < 3) continue;
                            int d = lev(x, y);
                            int limit = x.length() <= 4 ? 1 : 2;
                            if (d <= limit && d < best) best = d;
                        }
                    }
                    if (best == Integer.MAX_VALUE) continue;
                    score = 10 + best;
                }
                if (score < bestScore) {
                    bestScore = score;
                    bestName = name;
                    bestNum = num;
                }
            }
        } finally {
            if (c != null) c.close();
        }
        if (bestName == null) return null;
        return new String[]{bestName, bestNum};
    }

    // ---------------------------------------------------------------- actions

    private String call(String who) {
        if (who.length() == 0) return res(false, "Who should I call?");
        String number;
        String label;
        if (looksLikeNumber(who)) {
            number = digitsOnly(who);
            label = who;
        } else {
            if (!has("android.permission.READ_CONTACTS"))
                return res(false, "I need contacts permission to look up " + who + ". Open Settings and grant phone access.");
            String[] f = findContact(who);
            if (f == null) return res(false, "I couldn't find " + who + " in your contacts.");
            number = f[1];
            label = f[0];
        }
        Intent i;
        if (has("android.permission.CALL_PHONE")) {
            i = new Intent(Intent.ACTION_CALL, Uri.fromParts("tel", number, null));
            start(i);
            return res(true, "Calling " + label + ".");
        }
        i = new Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", number, null));
        start(i);
        return res(true, "Dialer ready for " + label + ". Grant call permission in Settings for hands-free calling.");
    }

    private String sms(String who, String body) {
        String number = null;
        String label = who;
        if (who.length() > 0) {
            if (looksLikeNumber(who)) {
                number = digitsOnly(who);
            } else if (has("android.permission.READ_CONTACTS")) {
                String[] f = findContact(who);
                if (f == null) return res(false, "I couldn't find " + who + " in your contacts.");
                number = f[1];
                label = f[0];
            } else {
                return res(false, "I need contacts permission to find " + who + ".");
            }
        }
        Intent i = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + (number == null ? "" : Uri.encode(number))));
        if (body.length() > 0) i.putExtra("sms_body", body);
        start(i);
        return res(true, "Message to " + label + " is ready. Tap send to confirm.");
    }

    private String openApp(String name) {
        if (name.length() == 0) return res(false, "Which app?");
        String q = norm(name);
        if (ALIASES.containsKey(q)) q = ALIASES.get(q);
        PackageManager pm = ctx.getPackageManager();
        Intent main = new Intent(Intent.ACTION_MAIN);
        main.addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> apps = pm.queryIntentActivities(main, 0);
        ResolveInfo best = null;
        int bestScore = Integer.MAX_VALUE;
        String bestLabel = "";
        for (ResolveInfo ri : apps) {
            CharSequence cs = ri.loadLabel(pm);
            if (cs == null) continue;
            String label = norm(cs.toString());
            String compactLabel = label.replace(" ", "");
            String compactQ = q.replace(" ", "");
            int score;
            if (label.equals(q) || compactLabel.equals(compactQ)) score = 0;
            else if (label.startsWith(q) || compactLabel.startsWith(compactQ)) score = 1;
            else if (label.contains(q) || compactLabel.contains(compactQ)) score = 2;
            else if (label.length() >= 3 && q.contains(label)) score = 3;
            else {
                int d = lev(compactLabel, compactQ);
                if (compactQ.length() >= 5 && d <= 1) score = 4;
                else continue;
            }
            if (score < bestScore) {
                bestScore = score;
                best = ri;
                bestLabel = cs.toString();
            }
        }
        if (best == null) return res(false, "I couldn't find an app called " + name + ".");
        Intent launch = pm.getLaunchIntentForPackage(best.activityInfo.packageName);
        if (launch == null) return res(false, "I found " + bestLabel + " but can't launch it.");
        start(launch);
        return res(true, "Opening " + bestLabel + ".");
    }

    private String youtube(String query, String mode) {
        if (query.length() == 0) {
            try {
                Intent i = ctx.getPackageManager().getLaunchIntentForPackage("com.google.android.youtube");
                if (i != null) {
                    start(i);
                    return res(true, "Opening YouTube.");
                }
            } catch (Exception ignored) {
            }
            start(new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com")));
            return res(true, "Opening YouTube.");
        }
        try {
            Intent i = new Intent(Intent.ACTION_SEARCH);
            i.setPackage("com.google.android.youtube");
            i.putExtra("query", query);
            start(i);
        } catch (Exception e) {
            start(new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/results?search_query=" + Uri.encode(query))));
        }
        if (mode.equals("play")) {
            if (JarvisAccess.get() == null) return res(true, "Searching YouTube for " + query + ". Turn on typing and screen control in Settings and I can start the video for you.");
            autoPlay(1);
            return res(true, "Playing " + query + " on YouTube.");
        }
        return res(true, "Searching YouTube for " + query + ".");
    }

    private String search(String q) {
        if (q.length() == 0) return res(false, "What should I search for?");
        try {
            Intent i = new Intent(Intent.ACTION_WEB_SEARCH);
            i.putExtra(SearchManager.QUERY, q);
            start(i);
        } catch (Exception e) {
            start(new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/search?q=" + Uri.encode(q))));
        }
        return res(true, "Searching the web for " + q + ".");
    }

    private String navigate(String place) {
        if (place.length() == 0) return res(false, "Where to?");
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=" + Uri.encode(place)));
            i.setPackage("com.google.android.apps.maps");
            start(i);
        } catch (Exception e) {
            start(new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(place))));
        }
        return res(true, "Starting navigation to " + place + ".");
    }

    private String map(String place) {
        if (place.length() == 0) return res(false, "Which place?");
        start(new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(place))));
        return res(true, "Showing " + place + " on the map.");
    }

    private String url(String u) {
        if (u.length() == 0) return res(false, "No address given.");
        if (!u.matches("^[a-zA-Z][a-zA-Z0-9+.-]*:.*")) u = "https://" + u;
        if (!u.matches("(?i)^https?://[^\\s]+$")) return res(false, "I only open web links (http or https).");
        start(new Intent(Intent.ACTION_VIEW, Uri.parse(u)));
        return res(true, "Opening " + u + ".");
    }

    private String where() {
        Emergency.remember(ctx);
        if (!Emergency.hasLocationPermission(ctx)) return res(false, "Location permission is off. Allow it in Jarvis Settings, Emergency.");
        Emergency.trackStart(ctx);
        String f = Emergency.lastFix();
        String bat = "";
        try {
            android.content.Intent b = ctx.registerReceiver(null, new android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED));
            if (b != null) {
                int lv = b.getIntExtra("level", -1), sc = b.getIntExtra("scale", 100);
                bat = " Battery " + (lv * 100 / Math.max(1, sc)) + "%" + (b.getIntExtra("plugged", 0) != 0 ? " (charging)." : ".");
            }
        } catch (Exception ignored) {
        }
        if (f == null) return res(true, "No location fix yet. Make sure location is switched on; I am searching now, ask again in a few seconds." + bat);
        String[] a = f.split("\\|");
        return res(true, "Phone location: " + a[0] + " (accuracy " + a[1] + " m, " + a[2] + " s ago). Map: https://maps.google.com/?q=" + a[0] + "." + bat);
    }

    private String torch(String state) {
        try {
            CameraManager cm = (CameraManager) ctx.getSystemService(Context.CAMERA_SERVICE);
            String id = null;
            for (String cid : cm.getCameraIdList()) {
                CameraCharacteristics cc = cm.getCameraCharacteristics(cid);
                Boolean flash = cc.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                Integer facing = cc.get(CameraCharacteristics.LENS_FACING);
                if (flash != null && flash && facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                    id = cid;
                    break;
                }
            }
            if (id == null) return res(false, "This phone has no flashlight I can reach.");
            boolean on;
            if ("on".equals(state)) on = true;
            else if ("off".equals(state)) on = false;
            else on = !torchOn;
            cm.setTorchMode(id, on);
            torchOn = on;
            return res(true, on ? "Flashlight on." : "Flashlight off.");
        } catch (Exception e) {
            return res(false, "I couldn't control the flashlight.");
        }
    }

    private String timer(String arg) {
        String seconds = arg, label = "";
        int bar = arg.indexOf('|');
        if (bar >= 0) {
            seconds = arg.substring(0, bar);
            label = arg.substring(bar + 1).replaceAll("\\s+", " ").trim();
            if (label.length() > 60) label = label.substring(0, 60);
        }
        int s;
        try {
            s = (int) Math.round(Double.parseDouble(seconds));
        } catch (Exception e) {
            return res(false, "How long should the timer run?");
        }
        if (s <= 0) return res(false, "That isn't a valid duration.");
        Intent i = new Intent(AlarmClock.ACTION_SET_TIMER);
        i.putExtra(AlarmClock.EXTRA_LENGTH, s);
        i.putExtra(AlarmClock.EXTRA_MESSAGE, label.length() > 0 ? "Jarvis timer: " + label : "Jarvis timer");
        i.putExtra(AlarmClock.EXTRA_SKIP_UI, true);
        start(i);
        String pretty;
        if (s % 3600 == 0) pretty = (s / 3600) + (s / 3600 == 1 ? " hour" : " hours");
        else if (s % 60 == 0) pretty = (s / 60) + (s / 60 == 1 ? " minute" : " minutes");
        else pretty = s + " seconds";
        return res(true, "Timer set for " + pretty + (label.length() > 0 ? " — " + label : "") + ".");
    }

    private String alarm(String arg) {
        String task = "";
        String daysCsv = "";
        String[] parts = arg.split("\\|", 3);
        arg = parts[0];
        if (parts.length > 1) {
            task = parts[1].replaceAll("\\s+", " ").trim();
            if (task.length() > 60) task = task.substring(0, 60);
        }
        if (parts.length > 2) daysCsv = parts[2].trim();
        String hhmm = arg;
        String[] p = hhmm.split(":");
        int h, m = 0;
        try {
            h = Integer.parseInt(p[0].trim());
            if (p.length > 1) m = Integer.parseInt(p[1].trim());
        } catch (Exception e) {
            return res(false, "What time should the alarm ring?");
        }
        if (h < 0 || h > 23 || m < 0 || m > 59) return res(false, "That isn't a valid time.");
        java.util.ArrayList<Integer> days = new java.util.ArrayList<Integer>();
        for (String d : daysCsv.split(",")) {
            try {
                int v = Integer.parseInt(d.trim());
                if (v >= 1 && v <= 7 && !days.contains(v)) days.add(v);
            } catch (Exception ignored) {
            }
        }
        Intent i = new Intent(AlarmClock.ACTION_SET_ALARM);
        i.putExtra(AlarmClock.EXTRA_HOUR, h);
        i.putExtra(AlarmClock.EXTRA_MINUTES, m);
        i.putExtra(AlarmClock.EXTRA_MESSAGE, task.length() > 0 ? "Jarvis alarm: " + task : "Jarvis alarm");
        if (!days.isEmpty()) i.putIntegerArrayListExtra(AlarmClock.EXTRA_DAYS, days);
        i.putExtra(AlarmClock.EXTRA_SKIP_UI, true);
        start(i);
        String when = "";
        if (!days.isEmpty()) {
            String[] names = {"", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"};
            if (days.size() == 7) when = " every day";
            else if (days.size() == 5 && !days.contains(1) && !days.contains(7)) when = " on weekdays";
            else if (days.size() == 2 && days.contains(1) && days.contains(7)) when = " on weekends";
            else {
                java.util.Collections.sort(days);
                StringBuilder sb = new StringBuilder(" every ");
                for (int k = 0; k < days.size(); k++) sb.append(k > 0 ? (k == days.size() - 1 ? " and " : ", ") : "").append(names[days.get(k)]);
                when = sb.toString();
            }
        }
        return res(true, String.format(Locale.US, (days.isEmpty() ? "Alarm set for %02d:%02d" : "Repeating alarm set for %02d:%02d"), h, m) + when + (task.length() > 0 ? " — " + task + "." : "."));
    }

    private String volume(String what) {
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int flags = AudioManager.FLAG_SHOW_UI;
        if ("up".equals(what)) {
            am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, flags);
            return res(true, "Volume up.");
        } else if ("down".equals(what)) {
            am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, flags);
            return res(true, "Volume down.");
        } else if ("mute".equals(what)) {
            am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE, flags);
            return res(true, "Muted.");
        } else if ("unmute".equals(what)) {
            am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, flags);
            return res(true, "Unmuted.");
        } else if ("max".equals(what)) {
            am.setStreamVolume(AudioManager.STREAM_MUSIC, max, flags);
            return res(true, "Volume at maximum.");
        }
        try {
            int pct = Math.max(0, Math.min(100, Integer.parseInt(what.replace("%", "").trim())));
            am.setStreamVolume(AudioManager.STREAM_MUSIC, Math.round(max * pct / 100f), flags);
            return res(true, "Volume set to " + pct + " percent.");
        } catch (NumberFormatException e) {
            return res(false, "Say up, down, mute, or a percentage.");
        }
    }

    private String media(String cmd) {
        int key;
        if ("play".equals(cmd) || "pause".equals(cmd) || "toggle".equals(cmd)) key = KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;
        else if ("next".equals(cmd)) key = KeyEvent.KEYCODE_MEDIA_NEXT;
        else if ("previous".equals(cmd) || "prev".equals(cmd)) key = KeyEvent.KEYCODE_MEDIA_PREVIOUS;
        else if ("stop".equals(cmd)) key = KeyEvent.KEYCODE_MEDIA_STOP;
        else if ("forward".equals(cmd) || "ff".equals(cmd)) key = KeyEvent.KEYCODE_MEDIA_FAST_FORWARD;
        else if ("rewind".equals(cmd)) key = KeyEvent.KEYCODE_MEDIA_REWIND;
        else return res(false, "Unknown media command.");
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, key));
        am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, key));
        return res(true, "Done.");
    }


    // ---------------------------------------------------------------- v1.33: more phone controls
    private String brightness(String arg) {
        if (android.os.Build.VERSION.SDK_INT >= 23 && !Settings.System.canWrite(ctx)) {
            try { start(new Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:" + ctx.getPackageName()))); } catch (Exception e) { /* ignore */ }
            return res(false, "Android needs your one-time permission to change brightness. I opened the page: allow Jarvis, then ask again.");
        }
        android.content.ContentResolver cr = ctx.getContentResolver();
        String a = arg.toLowerCase(Locale.ROOT);
        if (a.equals("auto:on") || a.equals("auto:off")) {
            Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS_MODE, a.equals("auto:on") ? Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC : Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL);
            return res(true, "Auto-brightness is " + (a.equals("auto:on") ? "on." : "off."));
        }
        int cur = 128;
        try { cur = Settings.System.getInt(cr, Settings.System.SCREEN_BRIGHTNESS); } catch (Exception e) { /* default */ }
        int v;
        if (a.equals("up")) v = cur + 51;
        else if (a.equals("down")) v = cur - 51;
        else if (a.equals("max")) v = 255;
        else if (a.equals("min")) v = 10;
        else {
            try { v = Math.round(Math.max(0, Math.min(100, Integer.parseInt(a))) * 2.55f); } catch (Exception e) { return res(false, "What brightness?"); }
        }
        v = Math.max(5, Math.min(255, v));
        Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL);
        Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS, v);
        return res(true, "Brightness is " + Math.round(v / 2.55f) + " percent.");
    }

    private String dnd(String arg) {
        boolean on = !"off".equals(arg);
        if (android.os.Build.VERSION.SDK_INT >= 23) {
            android.app.NotificationManager nm = (android.app.NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (!nm.isNotificationPolicyAccessGranted()) {
                try { start(new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)); } catch (Exception e) { /* ignore */ }
                return res(false, "Android needs your one-time permission for Do Not Disturb. I opened the page: allow Jarvis, then ask again.");
            }
            nm.setInterruptionFilter(on ? android.app.NotificationManager.INTERRUPTION_FILTER_PRIORITY : android.app.NotificationManager.INTERRUPTION_FILTER_ALL);
            return res(true, "Do Not Disturb is " + (on ? "on." : "off."));
        }
        return res(false, "This Android version cannot do that.");
    }

    private String ringer() {
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        int m = am.getRingerMode();
        return res(true, "The phone is set to " + (m == AudioManager.RINGER_MODE_NORMAL ? "ring." : m == AudioManager.RINGER_MODE_VIBRATE ? "vibrate." : "silent."));
    }

    private String camera(String arg) {
        String[] p = arg.split(":");
        final String mode = p[0].toLowerCase(Locale.ROOT);
        int delay = 0;
        if (p.length > 1) { try { delay = Math.max(0, Math.min(30, Integer.parseInt(p[1].trim()))); } catch (Exception e) { /* none */ } }
        final Intent i;
        if (mode.equals("video")) i = new Intent(android.provider.MediaStore.INTENT_ACTION_VIDEO_CAMERA);
        else {
            i = new Intent(android.provider.MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA);
            if (mode.equals("selfie")) { i.putExtra("android.intent.extras.CAMERA_FACING", 1); i.putExtra("android.intent.extra.USE_FRONT_CAMERA", true); }
        }
        if (delay > 0) {
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(new Runnable() { public void run() { try { start(i); } catch (Exception e) { /* ignore */ } } }, delay * 1000L);
            return res(true, "The camera opens in " + delay + " seconds. Android does not let apps press the shutter, so tap it when it appears.");
        }
        start(i);
        return res(true, "Opening the " + (mode.equals("video") ? "video camera" : mode.equals("selfie") ? "camera on the front lens" : "camera") + ". Android does not let apps press the shutter, so tap it yourself.");
    }

    private String clockUi(String arg) {
        String a = arg.toLowerCase(Locale.ROOT);
        if (a.equals("timers") || a.startsWith("timer")) {
            if (android.os.Build.VERSION.SDK_INT >= 26) { start(new Intent(AlarmClock.ACTION_SHOW_TIMERS)); return res(true, "Showing your timers. Android lets apps start timers but not pause or cancel them, so use the screen."); }
            start(new Intent(AlarmClock.ACTION_SHOW_ALARMS)); return res(true, "Showing the clock.");
        }
        if (a.startsWith("snooze")) { if (android.os.Build.VERSION.SDK_INT >= 23) { start(new Intent(AlarmClock.ACTION_SNOOZE_ALARM)); return res(true, "Snoozing the ringing alarm."); } }
        if (a.startsWith("dismiss")) {
            if (android.os.Build.VERSION.SDK_INT >= 23) {
                Intent d = new Intent(AlarmClock.ACTION_DISMISS_ALARM);
                String[] hm = a.length() > 8 ? a.substring(8).split(":") : new String[0];
                if (hm.length == 2) {
                    try { d.putExtra(AlarmClock.EXTRA_ALARM_SEARCH_MODE, AlarmClock.ALARM_SEARCH_MODE_TIME); d.putExtra(AlarmClock.EXTRA_HOUR, Integer.parseInt(hm[0])); d.putExtra(AlarmClock.EXTRA_MINUTES, Integer.parseInt(hm[1])); } catch (Exception e) { d.putExtra(AlarmClock.EXTRA_ALARM_SEARCH_MODE, AlarmClock.ALARM_SEARCH_MODE_NEXT); }
                } else d.putExtra(AlarmClock.EXTRA_ALARM_SEARCH_MODE, AlarmClock.ALARM_SEARCH_MODE_NEXT);
                start(d);
                return res(true, "Asking the clock app to cancel that alarm. If it stays, open your alarms and switch it off.");
            }
        }
        start(new Intent(AlarmClock.ACTION_SHOW_ALARMS));
        return res(true, "Showing your alarms.");
    }

    /** Opens the calendar's new-event form filled in (the user taps Save; the app never writes the calendar silently). */
    private String calIns(String title, String when) {
        long begin = 0, dur = 3600000L;
        try { String[] p = when.split("\\|"); begin = Long.parseLong(p[0].trim()); if (p.length > 1) dur = Math.max(5, Long.parseLong(p[1].trim())) * 60000L; } catch (Exception e) { /* below */ }
        Intent i = new Intent(Intent.ACTION_INSERT).setData(android.provider.CalendarContract.Events.CONTENT_URI);
        if (title.length() > 0) i.putExtra(android.provider.CalendarContract.Events.TITLE, title);
        if (begin > 0) { i.putExtra(android.provider.CalendarContract.EXTRA_EVENT_BEGIN_TIME, begin); i.putExtra(android.provider.CalendarContract.EXTRA_EVENT_END_TIME, begin + dur); }
        start(i);
        return res(true, "I opened a new calendar event" + (title.length() > 0 ? " for " + title : "") + ". Tap Save to keep it.");
    }

    private String spotify(String q) {
        if (q.length() == 0) return res(false, "What should I play on Spotify?");
        try {
            Intent i = new Intent(android.provider.MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH);
            i.setPackage("com.spotify.music");
            i.putExtra(SearchManager.QUERY, q);
            i.putExtra(android.provider.MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*");
            start(i);
            return res(true, "Asking Spotify to play " + q + ".");
        } catch (Exception e) {
            try { start(new Intent(Intent.ACTION_VIEW, Uri.parse("https://open.spotify.com/search/" + Uri.encode(q)))); return res(true, "Spotify is not set up for voice play, so I opened the search for " + q + "."); }
            catch (Exception e2) { return res(false, "I could not open Spotify."); }
        }
    }

    private String emailOf(String who) {
        if (!has("android.permission.READ_CONTACTS")) return null;
        try {
            String[] f = findContact(who);
            if (f == null) return null;
            Cursor c = ctx.getContentResolver().query(ContactsContract.CommonDataKinds.Email.CONTENT_URI, new String[]{ContactsContract.CommonDataKinds.Email.ADDRESS},
                    ContactsContract.CommonDataKinds.Email.DISPLAY_NAME + " = ?", new String[]{f[0]}, null);
            if (c != null) { try { if (c.moveToFirst()) return c.getString(0); } finally { c.close(); } }
        } catch (Exception e) { /* none */ }
        return null;
    }

    private String mailto(String who, String body) {
        String to = who.indexOf('@') > 0 ? who : (who.length() > 0 ? emailOf(who) : null);
        Intent i = new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:"));
        if (to != null) i.putExtra(Intent.EXTRA_EMAIL, new String[]{to});
        if (body.length() > 0) i.putExtra(Intent.EXTRA_TEXT, body);
        start(i);
        return res(true, "Your email draft is ready" + (to == null && who.length() > 0 ? ". I could not find an address for " + who + ", so add it yourself" : "") + ". Tap send to confirm.");
    }

    private String whatsapp(String who, String body) {
        String number = null;
        if (looksLikeNumber(who)) number = digitsOnly(who);
        else if (who.length() > 0) {
            if (!has("android.permission.READ_CONTACTS")) return res(false, "I need contacts permission to find " + who + ".");
            String[] f = findContact(who);
            if (f == null) return res(false, "I couldn't find " + who + " in your contacts.");
            number = digitsOnly(f[1]);
        }
        String u = "https://wa.me/" + (number == null ? "" : number) + (body.length() > 0 ? "?text=" + Uri.encode(body) : "");
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(u));
        i.setPackage("com.whatsapp");
        try { start(i); } catch (Exception e) { i.setPackage(null); start(i); }
        return res(true, "WhatsApp is open on the chat" + (body.length() > 0 ? " with your message typed in. Tap send to confirm." : "."));
    }

    private String redial() {
        if (!has("android.permission.READ_CALL_LOG")) return res(false, "I need call log permission to redial. Grant phone access in Settings.");
        Cursor c = ctx.getContentResolver().query(android.provider.CallLog.Calls.CONTENT_URI, new String[]{android.provider.CallLog.Calls.NUMBER},
                android.provider.CallLog.Calls.TYPE + " = " + android.provider.CallLog.Calls.OUTGOING_TYPE, null, android.provider.CallLog.Calls.DATE + " DESC LIMIT 1");
        String n = null;
        if (c != null) { try { if (c.moveToFirst()) n = c.getString(0); } finally { c.close(); } }
        if (n == null || n.length() == 0) return res(false, "There is no outgoing call to redial.");
        return call(n);
    }

    /** Reads the visible text of the screen that is open (needs the Accessibility service); used for "what's on my screen". */
    private String screenText() {
        JarvisAccess svc = JarvisAccess.get();
        if (svc == null) return res(false, needAccess());
        String t = svc.screenText();
        if (t == null || t.trim().length() == 0) return res(false, "I cannot read any text on this screen.");
        return res(true, t);
    }

    private String battery() {
        Intent b = ctx.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (b == null) return res(false, "I can't read the battery right now.");
        int level = b.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = b.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
        int status = b.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
        boolean charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL;
        int pct = Math.round(level * 100f / scale);
        return res(true, "Battery is at " + pct + " percent" + (charging ? " and charging." : "."));
    }

    private String settings(String which) {
        String action;
        switch (which) {
            case "wifi": action = Settings.ACTION_WIFI_SETTINGS; break;
            case "bluetooth": action = Settings.ACTION_BLUETOOTH_SETTINGS; break;
            case "display": action = Settings.ACTION_DISPLAY_SETTINGS; break;
            case "sound": action = Settings.ACTION_SOUND_SETTINGS; break;
            case "location": action = Settings.ACTION_LOCATION_SOURCE_SETTINGS; break;
            case "airplane": action = Settings.ACTION_AIRPLANE_MODE_SETTINGS; break;
            case "nfc": action = Settings.ACTION_NFC_SETTINGS; break;
            case "internet": action = android.os.Build.VERSION.SDK_INT >= 29 ? "android.settings.panel.action.INTERNET_CONNECTIVITY" : Settings.ACTION_WIRELESS_SETTINGS; break;
            case "data": action = Settings.ACTION_DATA_ROAMING_SETTINGS; break;
            case "datausage": action = "android.settings.DATA_USAGE_SETTINGS"; break;
            case "hotspot": {
                try {
                    Intent h = new Intent(Intent.ACTION_MAIN).setClassName("com.android.settings", "com.android.settings.TetherSettings");
                    start(h);
                    return res(true, "Opening hotspot settings. Android does not let apps switch it on silently, so tap the switch.");
                } catch (Exception e) { action = Settings.ACTION_WIRELESS_SETTINGS; }
                break;
            }
            case "battery": action = Intent.ACTION_POWER_USAGE_SUMMARY; break;
            case "batterysaver": action = Settings.ACTION_BATTERY_SAVER_SETTINGS; break;
            case "dndaccess": action = Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS; break;
            case "developer": action = Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS; break;
            case "screentimeout": action = Settings.ACTION_DISPLAY_SETTINGS; break;
            case "defaultapps": action = Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS; break;
            case "accessibility": action = Settings.ACTION_ACCESSIBILITY_SETTINGS; break;
            default: action = Settings.ACTION_SETTINGS;
        }
        start(new Intent(action));
        return res(true, "Opening " + (which.length() == 0 || which.equals("main") ? "settings" : which + " settings") + (which.length() > 0 && !which.equals("main") && !which.equals("display") && !which.equals("sound") ? ". Android does not let apps flip this silently, so tap the switch." : "."));
    }

    // ---------------------------------------------------------------- typing / screen control (needs the accessibility service)
    private String needAccess() {
        if (JarvisAccess.enabledInSettings(ctx))
            return "Typing control is switched on, but Android has not started it. Open Accessibility settings and switch Jarvis off, then on again.";
        return "Typing needs the Jarvis accessibility service. Open Settings, tap Phone Access, and enable it.";
    }

    private String type(String text, String app) {
        if (text.length() == 0) return res(false, "What should I type?");
        final JarvisAccess svc = JarvisAccess.get();
        if (svc == null) return res(false, needAccess());
        if (app.length() == 0) {
            if (!svc.hasField()) return res(false, "I can't find a text box on screen. Tap into one first.");
            final String tt = text;
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        JarvisAccess s = JarvisAccess.get();
                        String why = s == null ? "Typing control stopped. Open Settings, then Phone Access, and switch it on again." : s.typeLikeKeyboard(tt);
                        if (why.length() > 0) tell(why);
                    } catch (Throwable ignored) {
                    }
                }
            }).start();
            return res(true, "Typing.");
        }
        String opened = openApp(app);
        try {
            if (!new JSONObject(opened).optBoolean("ok")) return opened;
        } catch (Exception ignored) {
        }
        final String t = text;
        final String appName = app;
        new Thread(new Runnable() {
            @Override
            public void run() {
              try {
                // wait for the app to come up and show a text field (max ~9 s)
                boolean sawService = false;
                for (int i = 0; i < 30; i++) {
                    try {
                        Thread.sleep(300);
                    } catch (InterruptedException e) {
                        return;
                    }
                    JarvisAccess s = JarvisAccess.get();
                    if (s != null) sawService = true;
                    if (s != null && s.hasField() && i >= 3) {
                        String why = s.typeLikeKeyboard(t);
                        if (why.length() > 0) tell(why);
                        return;
                    }
                }
                if (!sawService) tell("Typing control stopped while I was opening " + appName + ". Open Settings, then Phone Access, and switch it on again.");
                else tell("I opened " + appName + " but could not find a text box to type in (password fields are skipped on purpose). Tap the box you want, then say “type” and the text again.");
              } catch (Throwable ignored) {
              }
            }
        }).start();
        return res(true, "Opening " + app + " and typing.");
    }

    private String key(String what) {
        JarvisAccess svc = JarvisAccess.get();
        if (svc == null) return res(false, needAccess());
        String w = what.toLowerCase(Locale.ROOT).trim();
        if (w.equals("clear")) {
            return svc.typeText("", true) ? res(true, "Cleared.") : res(false, "I can't find a text box on screen.");
        }
        if (w.equals("newline") || w.equals("enter")) {
            return svc.typeText("\n", false) ? res(true, "Done.") : res(false, "I can't find a text box on screen.");
        }
        return svc.global(w) ? res(true, "Done.") : res(false, "I couldn't do that.");
    }

    private String tap(String label) {
        JarvisAccess svc = JarvisAccess.get();
        if (svc == null) return res(false, needAccess());
        return svc.clickLabel(label) ? res(true, "Tapped " + label + ".") : res(false, "I can't see a button called " + label + ".");
    }

    /** arg2 may hold a repeat count and/or a size word, e.g. "3", "small", "big", "3,big". */
    private static int[] countSize(String arg2) {
        int count = 1, size = 1;
        if (arg2 != null) {
            for (String part : arg2.toLowerCase(Locale.ROOT).split("[,|\\s]+")) {
                if (part.matches("\\d{1,2}")) count = Integer.parseInt(part);
                else if (part.equals("small")) size = 0;
                else if (part.equals("big")) size = 2;
            }
        }
        return new int[]{Math.max(1, Math.min(10, count)), size};
    }

    private String scroll(String dir, String arg2) {
        JarvisAccess svc = JarvisAccess.get();
        if (svc == null) return res(false, needAccess());
        String d = dir == null ? "" : dir.toLowerCase(Locale.ROOT).trim();
        if (d.equals("stop")) {
            svc.stopGestures();
            return res(true, "Stopped.");
        }
        int[] cs = countSize(arg2);
        if (d.equals("top") || d.equals("bottom")) return svc.scrollBy(d.equals("bottom"), 8, 2) ? res(true, "Going to the " + d + ".") : res(false, "Nothing to scroll here.");
        return svc.scrollBy(!d.startsWith("up"), cs[0], cs[1]) ? res(true, "Scrolled.") : res(false, "I couldn't scroll here.");
    }

    private void autoPlay(final int nth) {
        new Thread(new Runnable() {
            @Override
            public void run() {
              try {
                for (int i = 0; i < 40; i++) {
                    try {
                        Thread.sleep(400);
                    } catch (InterruptedException e) {
                        return;
                    }
                    JarvisAccess s = JarvisAccess.get();
                    if (s != null && i >= 4 && s.hasVideos()) {
                        s.playNth(nth);
                        return;
                    }
                }
              } catch (Throwable ignored) {
              }
            }
        }).start();
    }

    private String playNth(String n) {
        JarvisAccess svc = JarvisAccess.get();
        if (svc == null) return res(false, needAccess());
        int k = 1;
        try {
            k = Integer.parseInt(n.trim());
        } catch (Exception ignored) {
        }
        return svc.playNth(k) ? res(true, "Playing it.") : res(false, "I can't see any videos on the screen.");
    }

    private String swipe(String dir, String arg2) {
        JarvisAccess svc = JarvisAccess.get();
        if (svc == null) return res(false, needAccess());
        int[] cs = countSize(arg2);
        return svc.swipeN(dir.toLowerCase(Locale.ROOT).trim(), cs[0], cs[1]) ? res(true, "Done.") : res(false, "I couldn't swipe.");
    }

    /** Keeps indentation and inner line breaks; only drops blank lines at the start and whitespace at the end. */
    private static String stripBlank(String t) {
        return t.replaceAll("^(?:[ \\t]*\\r?\\n)+", "").replaceAll("\\s+$", "");
    }

    private String align(String dir) {
        JarvisAccess svc = JarvisAccess.get();
        if (svc == null) return res(false, needAccess());
        String d = dir.toLowerCase(Locale.ROOT).trim();
        if (d.equals("centre")) d = "center";
        boolean ok = svc.clickLabel("align " + d) || svc.clickLabel("align text " + d) || (d.equals("justify") && svc.clickLabel("justif"));
        if (ok) return res(true, "Aligned " + d + ".");
        return res(false, "I can't see an align " + d + " button. Plain-text apps like Notepad have no alignment; in Docs or Word, open the formatting bar first.");
    }
}
// CRB-MARK ebb0a890025b

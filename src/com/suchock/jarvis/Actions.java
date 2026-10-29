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
                case "swipe": return swipe(arg);
                case "key": return key(arg);
                case "tap": return tap(arg);
                case "scroll": return scroll(arg);
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
        else return res(false, "Unknown media command.");
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, key));
        am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, key));
        return res(true, "Done.");
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
            case "defaultapps": action = Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS; break;
            case "accessibility": action = Settings.ACTION_ACCESSIBILITY_SETTINGS; break;
            default: action = Settings.ACTION_SETTINGS;
        }
        start(new Intent(action));
        return res(true, "Opening " + (which.length() == 0 || which.equals("main") ? "settings" : which + " settings") + ".");
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

    private String scroll(String dir) {
        JarvisAccess svc = JarvisAccess.get();
        if (svc == null) return res(false, needAccess());
        return svc.scroll(!dir.toLowerCase(Locale.ROOT).startsWith("up")) ? res(true, "Scrolled.") : res(false, "Nothing to scroll here.");
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

    private String swipe(String dir) {
        JarvisAccess svc = JarvisAccess.get();
        if (svc == null) return res(false, needAccess());
        return svc.swipe(dir.toLowerCase(Locale.ROOT).trim()) ? res(true, "Done.") : res(false, "I couldn't swipe.");
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

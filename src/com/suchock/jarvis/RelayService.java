package com.suchock.jarvis;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import org.json.JSONObject;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Keeps the encrypted link to the PC alive in the background and carries out commands the PC sends.
 * What the PC may do is limited by three switches in Settings > Device Link (control / typing / calls+texts).
 */
public final class RelayService extends Service {
    private static final String PREF = "sys_link";
    private static final String CH = "jarvis_link";
    private static final int NOTE_ID = 78;

    static volatile LinkClient client;
    private Actions actions;
    private final Handler main = new Handler(Looper.getMainLooper());

    // ------------------------------------------------------------------ config (sealed with the Android Keystore like every other secret)

    static final class Cfg {
        boolean enabled = false, ctl = true, input = false, danger = false;
        String dbUrl = "", secret = "";
    }

    static Cfg load(Context c) {
        Cfg g = new Cfg();
        try {
            SharedPreferences p = c.getApplicationContext().getSharedPreferences("jarvis", Context.MODE_PRIVATE);
            String raw = Secure.open(p.getString(PREF, ""));
            if (raw.length() == 0) return g;
            Object o = LinkJson.parse(raw);
            Map<String, Object> m = LinkJson.obj(o);
            g.dbUrl = LinkJson.str(o, "u");
            g.secret = LinkJson.str(o, "s");
            g.enabled = Boolean.TRUE.equals(m.get("e"));
            g.ctl = !Boolean.FALSE.equals(m.get("c"));
            g.input = Boolean.TRUE.equals(m.get("i"));
            g.danger = Boolean.TRUE.equals(m.get("d"));
        } catch (Exception ignored) {
        }
        return g;
    }

    static void save(Context c, Cfg g) {
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        m.put("u", g.dbUrl);
        m.put("s", g.secret);
        m.put("e", Boolean.valueOf(g.enabled));
        m.put("c", Boolean.valueOf(g.ctl));
        m.put("i", Boolean.valueOf(g.input));
        m.put("d", Boolean.valueOf(g.danger));
        String json = LinkJson.write(m);
        String sealed = Secure.available() ? Secure.seal(json) : null;
        // never store the pairing secret unencrypted: if this phone's Keystore is broken the link simply cannot be saved
        if (sealed == null) return;
        c.getApplicationContext().getSharedPreferences("jarvis", Context.MODE_PRIVATE).edit().putString(PREF, sealed).commit();
    }

    /** Starts or stops the background service so that it matches the saved settings. */
    static void sync(Context c) {
        Context app = c.getApplicationContext();
        Cfg g = load(app);
        Intent i = new Intent(app, RelayService.class);
        try {
            if (g.enabled && g.dbUrl.length() > 0 && g.secret.length() > 0) {
                if (Build.VERSION.SDK_INT >= 26) app.startForegroundService(i);
                else app.startService(i);
            } else {
                app.stopService(i);
            }
        } catch (Exception ignored) {
        }
    }

    // ------------------------------------------------------------------ what each switch allows

    private static String tier(String t) {
        if ("open".equals(t) || "youtube".equals(t) || "search".equals(t) || "url".equals(t) || "navigate".equals(t) || "map".equals(t)
                || "torch".equals(t) || "volume".equals(t) || "media".equals(t) || "battery".equals(t) || "timer".equals(t)
                || "alarm".equals(t) || "settings".equals(t)) return "ctl";
        if ("type".equals(t) || "key".equals(t) || "tap".equals(t) || "scroll".equals(t) || "swipe".equals(t)
                || "align".equals(t) || "playnth".equals(t)) return "input";
        if ("call".equals(t) || "sms".equals(t) || "callanswer".equals(t) || "callreject".equals(t)) return "danger";
        return null;
    }

    private final LinkClient.Handler handler = new LinkClient.Handler() {
        @Override
        public LinkClient.Result onCommand(final String type, final String arg, final String arg2) {
            Cfg g = load(RelayService.this);
            String t = tier(type);
            if (t == null) return new LinkClient.Result(false, "I cannot do “" + (type.length() > 30 ? type.substring(0, 30) : type) + "” on the phone.");
            if (!g.enabled) return new LinkClient.Result(false, "The device link is switched off on the phone.");
            if (t.equals("ctl") && !g.ctl) return new LinkClient.Result(false, "Remote control is switched off on the phone. Turn it on in Settings → Device Link.");
            if (t.equals("input") && !g.input) return new LinkClient.Result(false, "Typing and screen control from the PC is switched off on the phone. Turn it on in Settings → Device Link.");
            if (t.equals("danger") && !g.danger) return new LinkClient.Result(false, "Calls and texts from the PC are switched off on the phone. Turn them on in Settings → Device Link.");
            final String[] out = new String[1];
            final CountDownLatch done = new CountDownLatch(1);
            main.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        out[0] = actions.run(type, arg, arg2);
                    } catch (Throwable e) {
                        out[0] = null;
                    }
                    done.countDown();
                }
            });
            boolean ok = false;
            String msg = "That did not finish in time.";
            try {
                if (done.await(15, TimeUnit.SECONDS) && out[0] != null) {
                    JSONObject r = new JSONObject(out[0]);
                    ok = r.optBoolean("ok", false);
                    msg = r.optString("msg", "");
                }
            } catch (Exception ignored) {
            }
            Bridge b = Bridge.current;
            if (b != null) {
                try {
                    JSONObject o = new JSONObject();
                    o.put("type", type);
                    o.put("arg", arg);
                    o.put("ok", ok);
                    o.put("msg", msg);
                    b.emit("linkIn", o);
                } catch (Exception ignored) {
                }
            }
            return new LinkClient.Result(ok, msg);
        }

        @Override
        public void onStatus(boolean connected) {
            Bridge b = Bridge.current;
            if (b == null) return;
            try {
                b.emit("linkStatus", new JSONObject().put("connected", connected));
            } catch (Exception ignored) {
            }
        }
    };

    // ------------------------------------------------------------------ service plumbing

    @Override
    public void onCreate() {
        super.onCreate();
        actions = new Actions(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startFg();
        Cfg g = load(this);
        if (!g.enabled || g.dbUrl.length() == 0 || g.secret.length() == 0) {
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            if (client == null) client = new LinkClient("phone", "pc", handler);
            client.start(g.dbUrl, g.secret);
        } catch (Exception e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }

    private void startFg() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null) {
            NotificationChannel c = new NotificationChannel(CH, "Jarvis device link", NotificationManager.IMPORTANCE_LOW);
            c.setShowBadge(false);
            nm.createNotificationChannel(c);
        }
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH) : new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
                .setContentTitle("Jarvis is linked to your PC")
                .setContentText("Your PC can send commands while this is on.")
                .setOngoing(true)
                .setContentIntent(pi);
        Notification n = b.build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTE_ID, n, 1073741824 /* FOREGROUND_SERVICE_TYPE_SPECIAL_USE */);
        else startForeground(NOTE_ID, n);
    }

    @Override
    public void onDestroy() {
        LinkClient c = client;
        client = null;
        if (c != null) c.stop();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}

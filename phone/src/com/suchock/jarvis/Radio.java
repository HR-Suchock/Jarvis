package com.suchock.jarvis;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;

/** Internet radio for emergency news (needs internet; the phone's own FM radio app is opened separately). */
final class Radio {
    private static final Handler H = new Handler(Looper.getMainLooper());
    private static MediaPlayer mp;
    private static volatile String url = "";
    private static volatile String status = "";   // "", "connecting", "playing", "error"

    private Radio() { }

    static String url() { return url; }

    static String status() { return status; }

    static synchronized String start(Context c, String u) {
        stop();
        if (u == null || !u.matches("(?i)https://[^\\s]{4,300}")) return "That is not a secure radio link. It must start with https://";
        try {
            final MediaPlayer p = new MediaPlayer();
            if (android.os.Build.VERSION.SDK_INT >= 21) {
                p.setAudioAttributes(new AudioAttributes.Builder().setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).setUsage(AudioAttributes.USAGE_MEDIA).build());
            } else {
                p.setAudioStreamType(AudioManager.STREAM_MUSIC);
            }
            p.setDataSource(u);
            p.setOnPreparedListener(new MediaPlayer.OnPreparedListener() {
                @Override
                public void onPrepared(MediaPlayer m) {
                    if (m == mp) { status = "playing"; m.start(); }
                }
            });
            p.setOnErrorListener(new MediaPlayer.OnErrorListener() {
                @Override
                public boolean onError(MediaPlayer m, int what, int extra) {
                    if (m == mp) { status = "error"; }
                    return true;
                }
            });
            mp = p;
            url = u;
            status = "connecting";
            p.prepareAsync();
            return "Tuning in. If nothing plays in 15 seconds the station is not reachable.";
        } catch (Exception e) {
            status = "error";
            return "I could not start that station.";
        }
    }

    static synchronized void stop() {
        MediaPlayer p = mp;
        mp = null;
        url = "";
        status = "";
        if (p != null) {
            try { p.stop(); } catch (Exception ignored) { }
            try { p.release(); } catch (Exception ignored) { }
        }
    }
}
// CRB-MARK 6c6ca68f9274

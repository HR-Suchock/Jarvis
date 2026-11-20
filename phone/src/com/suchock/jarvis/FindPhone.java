package com.suchock.jarvis;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.Vibrator;

/** "Find my phone": rings loudly on the alarm stream (even if the phone is silent) for up to a minute, with a Stop button. */
final class FindPhone {
    static final int NOTE_ID = 81;
    private static final String CH = "jarvis_find";
    private static MediaPlayer mp;
    private static int oldVol = -1;
    private static final Handler H = new Handler(Looper.getMainLooper());
    private static final Runnable AUTO = new Runnable() {
        @Override
        public void run() {
            if (ctxRef != null) stop(ctxRef);
        }
    };
    private static Context ctxRef;

    private FindPhone() {
    }

    static synchronized boolean ringing() {
        return mp != null || Emergency.soundPlaying();
    }

    static synchronized String start(Context c) {
        c = c.getApplicationContext();
        ctxRef = c;
        if (mp != null || Emergency.soundPlaying()) return "Already ringing.";
        if (Emergency.soundStart(c, "siren")) {
            try {
                Vibrator v = (Vibrator) c.getSystemService(Context.VIBRATOR_SERVICE);
                if (v != null && v.hasVibrator()) v.vibrate(new long[]{0, 700, 500}, 0);
            } catch (Exception ignored) {
            }
            notifyStop(c);
            H.removeCallbacks(AUTO);
            H.postDelayed(AUTO, 60000L);
            return "Ringing the phone loudly for up to a minute.";
        }
        try {
            AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
            oldVol = am.getStreamVolume(AudioManager.STREAM_ALARM);
            am.setStreamVolume(AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0);
            Uri u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            MediaPlayer m = new MediaPlayer();
            m.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            m.setDataSource(c, u);
            m.setLooping(true);
            m.prepare();
            m.start();
            mp = m;
        } catch (Exception e) {
            mp = null;
            restoreVol(c);
            return "I could not ring the phone: " + (e.getMessage() == null ? "unknown error" : e.getMessage());
        }
        try {
            Vibrator v = (Vibrator) c.getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) v.vibrate(new long[]{0, 700, 500}, 0);
        } catch (Exception ignored) {
        }
        notifyStop(c);
        H.removeCallbacks(AUTO);
        H.postDelayed(AUTO, 60000L);
        return "Ringing the phone loudly for up to a minute.";
    }

    static synchronized String stop(Context c) {
        c = c.getApplicationContext();
        H.removeCallbacks(AUTO);
        boolean was = mp != null || Emergency.soundPlaying();
        Emergency.soundStop();
        if (mp != null) {
            try {
                mp.stop();
            } catch (Exception ignored) {
            }
            try {
                mp.release();
            } catch (Exception ignored) {
            }
            mp = null;
        }
        try {
            Vibrator v = (Vibrator) c.getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) v.cancel();
        } catch (Exception ignored) {
        }
        restoreVol(c);
        try {
            ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(NOTE_ID);
        } catch (Exception ignored) {
        }
        return was ? "Stopped ringing." : "The phone was not ringing.";
    }

    private static void restoreVol(Context c) {
        if (oldVol < 0) return;
        try {
            ((AudioManager) c.getSystemService(Context.AUDIO_SERVICE)).setStreamVolume(AudioManager.STREAM_ALARM, oldVol, 0);
        } catch (Exception ignored) {
        }
        oldVol = -1;
    }

    private static void notifyStop(Context c) {
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel ch = new NotificationChannel(CH, "Find my phone", NotificationManager.IMPORTANCE_HIGH);
                ch.setSound(null, null);
                nm.createNotificationChannel(ch);
            }
            Intent si = new Intent(c, FindStopReceiver.class);
            PendingIntent stop = PendingIntent.getBroadcast(c, 81, si, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Intent oi = new Intent(c, MainActivity.class);
            PendingIntent open = PendingIntent.getActivity(c, 82, oi, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CH) : new Notification.Builder(c);
            b.setSmallIcon(android.R.drawable.ic_lock_idle_alarm).setContentTitle("Jarvis is ringing your phone")
                    .setContentText("Tap Stop to silence it.").setContentIntent(open).setOngoing(true)
                    .addAction(new Notification.Action.Builder(null, "STOP", stop).build());
            nm.notify(NOTE_ID, b.build());
        } catch (Exception ignored) {
        }
    }
}

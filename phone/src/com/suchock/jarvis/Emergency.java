package com.suchock.jarvis;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

/**
 * Emergency tools (phone only): loud survival-style alarm, Morse / SOS with the flashlight, and a live GPS fix.
 * Everything stops by itself (alarm 5 min, flashlight 10 min, GPS tracking 30 min) so nothing is left running by mistake.
 */
final class Emergency {
    private static final int RATE = 22050;
    private static final Handler H = new Handler(Looper.getMainLooper());

    private Emergency() {
    }

    // ------------------------------------------------------------------ loud sound (alarm stream, max volume)
    private static AudioTrack track;
    private static Thread soundThread;
    private static volatile boolean soundOn;
    private static volatile String soundKind = "";
    private static int oldVol = -1;
    private static Context soundCtx;
    private static final Runnable SOUND_AUTO = new Runnable() {
        @Override
        public void run() {
            soundStop();
        }
    };

    static boolean soundPlaying() {
        return soundOn;
    }

    static String soundKind() {
        return soundOn ? soundKind : "";
    }

    /** kind: "whistle" (3 sharp blasts, the international distress signal) or "siren" (rising and falling wail). */
    static synchronized boolean soundStart(Context c, final String kind) {
        if (soundOn) return true;
        c = c.getApplicationContext();
        soundCtx = c;
        try {
            AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
            oldVol = am.getStreamVolume(AudioManager.STREAM_ALARM);
            am.setStreamVolume(AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0);
            final short[] pcm = "whistle".equals(kind) ? whistle() : siren();
            int bytes = pcm.length * 2;
            AudioTrack t = new AudioTrack(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build(),
                    new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(RATE)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build(),
                    bytes, AudioTrack.MODE_STATIC, AudioManager.AUDIO_SESSION_ID_GENERATE);
            t.write(pcm, 0, pcm.length);
            t.setLoopPoints(0, pcm.length, -1);
            t.setVolume(1.0f);
            t.play();
            track = t;
            soundOn = true;
            soundKind = kind;
        } catch (Throwable e) {
            soundOn = false;
            releaseTrack();
            restoreVol();
            return false;
        }
        H.removeCallbacks(SOUND_AUTO);
        H.postDelayed(SOUND_AUTO, 300000L);
        return true;
    }

    static synchronized void soundStop() {
        H.removeCallbacks(SOUND_AUTO);
        soundOn = false;
        releaseTrack();
        restoreVol();
    }

    private static void releaseTrack() {
        if (track != null) {
            try {
                track.stop();
            } catch (Exception ignored) {
            }
            try {
                track.release();
            } catch (Exception ignored) {
            }
            track = null;
        }
    }

    private static void restoreVol() {
        if (oldVol < 0 || soundCtx == null) return;
        try {
            ((AudioManager) soundCtx.getSystemService(Context.AUDIO_SERVICE)).setStreamVolume(AudioManager.STREAM_ALARM, oldVol, 0);
        } catch (Exception ignored) {
        }
        oldVol = -1;
    }

    /** Pea-whistle: about 3 kHz carrier with a fast flutter, three blasts then a pause. Sharp and easy to locate by ear. */
    private static short[] whistle() {
        int blast = RATE * 45 / 100, gap = RATE * 25 / 100, rest = RATE * 12 / 10, n = 3 * (blast + gap) + rest;
        short[] s = new short[n];
        int pos = 0;
        double ph = 0;
        for (int b = 0; b < 3; b++) {
            for (int i = 0; i < blast; i++) {
                double tt = (double) i / RATE, flutter = Math.sin(2 * Math.PI * 38 * tt);
                double f = 3050 + 160 * flutter;
                ph += 2 * Math.PI * f / RATE;
                double env = Math.min(1.0, Math.min(i / 120.0, (blast - i) / 160.0));
                double v = Math.sin(ph) * 0.72 + Math.sin(2 * ph) * 0.22 + Math.sin(3 * ph) * 0.06;
                s[pos++] = (short) (v * env * (0.82 + 0.18 * flutter) * 30000);
            }
            pos += gap;
        }
        return s;
    }

    /** Emergency siren: a wail sweeping 700 to 1800 Hz and back, with a harsh square-ish tone that carries far. */
    private static short[] siren() {
        int n = RATE * 3;
        short[] s = new short[n];
        double ph = 0;
        for (int i = 0; i < n; i++) {
            double tt = (double) i / n, sweep = 0.5 - 0.5 * Math.cos(2 * Math.PI * tt * 2);
            double f = 700 + 1100 * sweep;
            ph += 2 * Math.PI * f / RATE;
            double v = Math.sin(ph) + Math.sin(3 * ph) / 3 + Math.sin(5 * ph) / 5;
            double env = Math.min(1.0, Math.min(i / 200.0, (n - i) / 200.0));
            s[i] = (short) Math.max(-32000, Math.min(32000, v * 0.85 * env * 26000));
        }
        return s;
    }

    // ------------------------------------------------------------------ flashlight Morse / SOS
    private static Thread morseThread;
    private static volatile boolean morseOn;

    static boolean morsePlaying() {
        return morseOn;
    }

    private static String torchId(Context c) throws Exception {
        CameraManager cm = (CameraManager) c.getSystemService(Context.CAMERA_SERVICE);
        for (String id : cm.getCameraIdList()) {
            CameraCharacteristics cc = cm.getCameraCharacteristics(id);
            Boolean f = cc.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
            if (f != null && f) return id;
        }
        return null;
    }

    /** morse: dots, dashes, spaces between letters and "/" between words. Returns an error text, or null when started. */
    static synchronized String morseStart(final Context ctx, final String morse, final boolean loop) {
        morseStop();
        final Context c = ctx.getApplicationContext();
        final String pat = morse == null ? "" : morse.trim();
        if (!pat.matches("[.\\- /]+") || pat.length() > 600) return "That is not valid Morse code.";
        final String id;
        final CameraManager cm;
        try {
            id = torchId(c);
            if (id == null) return "This phone has no flashlight I can reach.";
            cm = (CameraManager) c.getSystemService(Context.CAMERA_SERVICE);
        } catch (Exception e) {
            return "I could not reach the flashlight.";
        }
        morseOn = true;
        morseThread = new Thread(new Runnable() {
            @Override
            public void run() {
                final int unit = 220;                       // ms per dot: slow and clear, easy to read from far away
                long end = System.currentTimeMillis() + 600000L;
                try {
                    do {
                        for (int i = 0; i < pat.length() && morseOn; i++) {
                            char ch = pat.charAt(i);
                            if (ch == '.' || ch == '-') {
                                cm.setTorchMode(id, true);
                                Thread.sleep(ch == '.' ? unit : unit * 3);
                                cm.setTorchMode(id, false);
                                boolean nextSym = i + 1 < pat.length() && (pat.charAt(i + 1) == '.' || pat.charAt(i + 1) == '-');
                                Thread.sleep(nextSym ? unit : 0);
                            } else if (ch == ' ') Thread.sleep(unit * 2);
                            else if (ch == '/') Thread.sleep(unit * 3);
                        }
                        if (loop && morseOn) Thread.sleep(unit * 7);
                    } while (loop && morseOn && System.currentTimeMillis() < end);
                } catch (Exception ignored) {
                } finally {
                    try {
                        cm.setTorchMode(id, false);
                    } catch (Exception ignored) {
                    }
                    morseOn = false;
                }
            }
        }, "morse");
        morseThread.setDaemon(true);
        morseThread.start();
        return null;
    }

    static synchronized void morseStop() {
        morseOn = false;
        if (morseThread != null) {
            morseThread.interrupt();
            morseThread = null;
        }
    }

    // ------------------------------------------------------------------ GPS
    private static volatile Location best;
    private static LocationListener listener;
    private static final Runnable TRACK_AUTO = new Runnable() {
        @Override
        public void run() {
            trackStop();
        }
    };

    static boolean hasLocationPermission(Context c) {
        return c.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || c.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    static boolean tracking() {
        return listener != null;
    }

    private static void consider(Location l) {
        if (l == null) return;
        Location b = best;
        if (b == null || l.getTime() > b.getTime() + 20000 || l.getAccuracy() <= b.getAccuracy() || l.getTime() - b.getTime() > 60000) best = l;
    }

    /** Starts listening for a fresh fix (GPS and network) for up to 30 minutes. */
    static synchronized boolean trackStart(Context c) {
        c = c.getApplicationContext();
        if (!hasLocationPermission(c)) return false;
        if (listener != null) return true;
        try {
            LocationManager lm = (LocationManager) c.getSystemService(Context.LOCATION_SERVICE);
            for (String p : new String[]{LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER}) {
                try {
                    consider(lm.getLastKnownLocation(p));
                } catch (Exception ignored) {
                }
            }
            listener = new LocationListener() {
                @Override
                public void onLocationChanged(Location l) {
                    consider(l);
                }

                @Override
                public void onStatusChanged(String p, int s, Bundle e) {
                }

                @Override
                public void onProviderEnabled(String p) {
                }

                @Override
                public void onProviderDisabled(String p) {
                }
            };
            boolean any = false;
            for (String p : new String[]{LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER}) {
                try {
                    if (lm.isProviderEnabled(p)) {
                        lm.requestLocationUpdates(p, 5000L, 0f, listener, Looper.getMainLooper());
                        any = true;
                    }
                } catch (Exception ignored) {
                }
            }
            if (!any) {
                listener = null;
                return true;                               // location is switched off; still return what we remember
            }
            H.removeCallbacks(TRACK_AUTO);
            H.postDelayed(TRACK_AUTO, 1800000L);
            return true;
        } catch (Exception e) {
            listener = null;
            return false;
        }
    }

    static synchronized void trackStop() {
        H.removeCallbacks(TRACK_AUTO);
        if (listener != null) {
            try {
                ((LocationManager) soundCtxOrApp().getSystemService(Context.LOCATION_SERVICE)).removeUpdates(listener);
            } catch (Exception ignored) {
            }
            listener = null;
        }
    }

    private static Context appCtx;

    private static Context soundCtxOrApp() {
        return appCtx != null ? appCtx : soundCtx;
    }

    static void remember(Context c) {
        appCtx = c.getApplicationContext();
    }

    /** Best known position as "lat,lon|accuracy m|age seconds", or null when none. */
    static String lastFix() {
        Location l = best;
        if (l == null) return null;
        return String.format(java.util.Locale.US, "%.6f,%.6f|%d|%d", l.getLatitude(), l.getLongitude(), Math.round(l.getAccuracy()),
                Math.max(0, (System.currentTimeMillis() - l.getTime()) / 1000));
    }
}
// CRB-MARK 948bde4b8d68

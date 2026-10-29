package com.suchock.jarvis;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;

/**
 * Incoming-call helper: says who is calling, shows Answer / Reject buttons, and listens for "answer" / "reject".
 * Listening needs the microphone, which Android only gives to apps that are visible or have a running foreground
 * service (for example the floating ball). If the microphone is not available, the buttons still work.
 */
public class CallService extends Service {
    static final String ACT_RING = "com.suchock.jarvis.CALL_RING";
    static final String ACT_STOP = "com.suchock.jarvis.CALL_STOP";
    static final String ACT_ANSWER = "com.suchock.jarvis.CALL_ANSWER";
    static final String ACT_REJECT = "com.suchock.jarvis.CALL_REJECT";
    private static final int NID = 79;
    private static final String CH = "jarvis_call";
    private static volatile boolean active = false;

    static boolean active() {
        return active;
    }

    private final Handler h = new Handler(Looper.getMainLooper());
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private SpeechRecognizer sr;
    private String number = "";
    private String who = "";
    private boolean announced = false, finished = false;
    private int tries = 0;
    private final Runnable announceRun = new Runnable() {
        @Override
        public void run() {
            announce();
        }
    };

    @Override
    public IBinder onBind(Intent i) {
        return null;
    }

    @Override
    public int onStartCommand(Intent i, int flags, int id) {
        String a = i == null ? null : i.getAction();
        if (ACT_STOP.equals(a)) {
            finish();
            return START_NOT_STICKY;
        }
        if (ACT_RING.equals(a)) {
            String n = i.getStringExtra("number");
            if (n != null && n.length() > 0) number = n;
            if (!active) {
                active = true;
                initTts();
                h.postDelayed(announceRun, 1200);      // the number often arrives in a second broadcast
                h.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        finish();                      // safety: never stay longer than 45 s
                    }
                }, 45000);
            }
        }
        return START_NOT_STICKY;
    }

    private void initTts() {
        tts = new TextToSpeech(getApplicationContext(), new TextToSpeech.OnInitListener() {
            @Override
            public void onInit(int st) {
                ttsReady = st == TextToSpeech.SUCCESS;
                if (ttsReady) {
                    try {
                        tts.setLanguage(Locale.getDefault());
                        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                            @Override
                            public void onStart(String id) {
                            }

                            @Override
                            public void onDone(String id) {
                                h.post(new Runnable() {
                                    @Override
                                    public void run() {
                                        listen();
                                    }
                                });
                            }

                            @Override
                            public void onError(String id) {
                                h.post(new Runnable() {
                                    @Override
                                    public void run() {
                                        listen();
                                    }
                                });
                            }
                        });
                    } catch (Throwable ignored) {
                    }
                    if (announced) speak();
                }
            }
        });
    }

    private String sentence() {
        String name = who.length() > 0 ? who : (number.length() > 0 ? spell(number) : "an unknown number");
        return "Incoming call from " + name + ". Say answer, or reject.";
    }

    private static String spell(String n) {
        StringBuilder sb = new StringBuilder();
        for (char c : n.toCharArray()) if (Character.isDigit(c)) sb.append(c).append(' ');
        return sb.toString().trim();
    }

    private void announce() {
        if (finished) return;
        who = CallHelper.nameFor(this, number);
        announced = true;
        notifyCall();
        if (ttsReady) speak();
    }

    private void speak() {
        try {
            HashMap<String, String> p = new HashMap<String, String>();
            p.put(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, "call");
            tts.speak(sentence(), TextToSpeech.QUEUE_FLUSH, p);
        } catch (Throwable ignored) {
        }
    }

    private void notifyCall() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                NotificationChannel c = new NotificationChannel(CH, "Jarvis call help", NotificationManager.IMPORTANCE_HIGH);
                c.setSound(null, null);
                nm.createNotificationChannel(c);
            }
            PendingIntent ans = PendingIntent.getBroadcast(this, 41, new Intent(this, CallActionReceiver.class).setAction(ACT_ANSWER), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            PendingIntent rej = PendingIntent.getBroadcast(this, 42, new Intent(this, CallActionReceiver.class).setAction(ACT_REJECT), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            String name = who.length() > 0 ? who : (number.length() > 0 ? number : "Unknown number");
            int icon = getResources().getIdentifier("ic_tile", "drawable", getPackageName());
            Notification.Builder b = android.os.Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH) : new Notification.Builder(this);
            b.setSmallIcon(icon != 0 ? icon : android.R.drawable.sym_call_incoming)
                    .setContentTitle("Incoming call")
                    .setContentText(name)
                    .setCategory(Notification.CATEGORY_CALL)
                    .setOngoing(true)
                    .setOnlyAlertOnce(true)
                    .addAction(new Notification.Action.Builder(android.R.drawable.sym_action_call, "Answer", ans).build())
                    .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Reject", rej).build());
            nm.notify(NID, b.build());
        } catch (Throwable ignored) {
        }
    }

    private void listen() {
        if (finished || tries >= 4) return;
        tries++;
        try {
            if (!CallHelper.has(this, android.Manifest.permission.RECORD_AUDIO) || !SpeechRecognizer.isRecognitionAvailable(this)) return;
            if (sr == null) {
                sr = SpeechRecognizer.createSpeechRecognizer(this);
                sr.setRecognitionListener(new RecognitionListener() {
                    @Override
                    public void onReadyForSpeech(Bundle b) {
                    }

                    @Override
                    public void onBeginningOfSpeech() {
                    }

                    @Override
                    public void onRmsChanged(float v) {
                    }

                    @Override
                    public void onBufferReceived(byte[] bytes) {
                    }

                    @Override
                    public void onEndOfSpeech() {
                    }

                    @Override
                    public void onError(int e) {
                        if (e == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS || finished) return;   // no microphone in the background: buttons still work
                        h.postDelayed(new Runnable() {
                            @Override
                            public void run() {
                                listen();
                            }
                        }, 500);
                    }

                    @Override
                    public void onResults(Bundle b) {
                        handle(b);
                    }

                    @Override
                    public void onPartialResults(Bundle b) {
                        handle(b);
                    }

                    @Override
                    public void onEvent(int i, Bundle b) {
                    }
                });
            }
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, speechLang());
            sr.startListening(i);
        } catch (Throwable ignored) {
        }
    }

    private String speechLang() {
        try {
            String raw = Secure.open(getSharedPreferences("jarvis", Context.MODE_PRIVATE).getString("settings", ""));
            if (raw != null && raw.length() > 0) {
                String l = new org.json.JSONObject(raw).optString("lang", "");
                if (l.length() > 0) return l;
            }
        } catch (Throwable ignored) {
        }
        return "en-US";
    }

    private static boolean hit(String t, String[] words) {
        for (String w : words) {
            if (w.charAt(0) < 128) {
                if (java.util.regex.Pattern.compile("\\b" + w + "\\b").matcher(t).find()) return true;
            } else if (t.contains(w)) return true;
        }
        return false;
    }

    private static final String[] YES = {"answer", "pick up", "pickup", "accept", "receive", "yes", "haan", "han", "uthao", "uthao", "ধর", "উঠাও", "উঠান", "हाँ", "हां", "उठाओ", "रिसीव"};
    private static final String[] NO = {"reject", "decline", "cut", "hang up", "hangup", "end", "ignore", "dismiss", "no", "nahi", "kato", "কাট", "কেটে", "না", "কাट", "नहीं", "नही"};

    private void handle(Bundle b) {
        if (finished || b == null) return;
        ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (r == null) return;
        for (String s : r) {
            String t = s.toLowerCase(Locale.ROOT);
            boolean yes = hit(t, YES), no = hit(t, NO);
            if (yes && !no) {
                CallHelper.answer(this);
                finish();
                return;
            }
            if (no && !yes) {
                CallHelper.reject(this);
                finish();
                return;
            }
        }
    }

    private void finish() {
        if (finished) return;
        finished = true;
        active = false;
        h.removeCallbacksAndMessages(null);
        try {
            if (sr != null) {
                sr.cancel();
                sr.destroy();
            }
        } catch (Throwable ignored) {
        }
        try {
            if (tts != null) {
                tts.stop();
                tts.shutdown();
            }
        } catch (Throwable ignored) {
        }
        try {
            ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).cancel(NID);
        } catch (Throwable ignored) {
        }
        stopSelf();
    }

    @Override
    public void onDestroy() {
        finished = false;
        finish();
        super.onDestroy();
    }
}

package com.suchock.jarvis;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.List;
import java.util.Locale;

/** Speech-to-text (Android SpeechRecognizer) and text-to-speech (Android TTS). Always touched on the main thread. */
final class Voice {
    interface Emitter {
        void emit(String event, JSONObject data);
    }

    private final Activity act;
    private final Emitter em;
    private final Handler main = new Handler(Looper.getMainLooper());

    private TextToSpeech tts;
    private boolean ttsReady = false;
    private boolean ttsFailed = false;
    private final List<Runnable> pending = new ArrayList<Runnable>();
    private volatile int gen = 0;

    private SpeechRecognizer sr;
    private long lastLevelAt = 0;

    Voice(Activity a, Emitter e) {
        act = a;
        em = e;
        main.post(new Runnable() {
            @Override
            public void run() {
                initTts();
            }
        });
    }

    private void emit(String ev, String k, Object v) {
        JSONObject o = new JSONObject();
        try {
            if (k != null) o.put(k, v);
        } catch (Exception ignored) {
        }
        em.emit(ev, o);
    }

    // ---------------------------------------------------------------- TTS

    private void initTts() {
        tts = new TextToSpeech(act.getApplicationContext(), new TextToSpeech.OnInitListener() {
            @Override
            public void onInit(int status) {
                if (status == TextToSpeech.SUCCESS) {
                    ttsReady = true;
                    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override
                        public void onStart(String id) {
                            // "ttsStart" is emitted once from speak(); nothing to do per chunk
                        }

                        @Override
                        public void onDone(String id) {
                            finish(id);
                        }

                        @Override
                        public void onError(String id) {
                            finish(id);
                        }

                        private void finish(String id) {
                            // ids look like "<gen>_<index>" or "<gen>_last"; ignore stale generations
                            if (id == null || !id.endsWith("_last")) return;
                            String g = id.substring(0, id.indexOf('_'));
                            if (g.equals(String.valueOf(gen))) emit("ttsDone", null, null);
                        }
                    });
                } else {
                    ttsFailed = true;
                }
                List<Runnable> copy = new ArrayList<Runnable>(pending);
                pending.clear();
                for (Runnable r : copy) r.run();
            }
        });
    }

    private static List<String> chunk(String text) {
        List<String> out = new ArrayList<String>();
        String t = text.trim();
        while (t.length() > 3000) {
            int cut = Math.max(t.lastIndexOf(". ", 3000), t.lastIndexOf("\n", 3000));
            if (cut < 500) cut = 3000;
            out.add(t.substring(0, cut + 1).trim());
            t = t.substring(cut + 1).trim();
        }
        if (t.length() > 0) out.add(t);
        return out;
    }

    void speak(final String text, final String lang, final double rate, final double pitch) {
        speakSystem(text, lang, rate, pitch, "jarvis");
    }

    /** opts: lang, rate, pitch, mode ("jarvis" = deep British male when available, "phone" = the phone's default voice). */
    void speakEx(final String text, String optsJson) {
        JSONObject o;
        try {
            o = new JSONObject(optsJson);
        } catch (Exception e) {
            o = new JSONObject();
        }
        speakSystem(text, o.optString("lang", "en-GB"), o.optDouble("rate", 1.0), o.optDouble("pitch", 1.0), o.optString("mode", "jarvis"));
    }

    private void speakSystem(final String text, final String lang, final double rate, final double pitch, final String mode) {
        main.post(new Runnable() {
            @Override
            public void run() {
                final Runnable job = new Runnable() {
                    @Override
                    public void run() {
                        if (!ttsReady || text == null || text.trim().length() == 0) {
                            emit("ttsDone", null, null);
                            return;
                        }
                        gen++;
                        Locale loc = Locale.forLanguageTag(lang == null || lang.length() == 0 ? "en-GB" : lang);
                        int r = tts.setLanguage(loc);
                        if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
                            tts.setLanguage(Locale.getDefault());
                        } else {
                            try {
                                android.speech.tts.Voice v = "phone".equals(mode) ? tts.getDefaultVoice() : pickVoice(loc);
                                if (v != null && v.getLocale().getLanguage().equals(loc.getLanguage())) tts.setVoice(v);
                            } catch (Exception ignored) {
                            }
                        }
                        tts.setSpeechRate((float) rate);
                        tts.setPitch((float) pitch);
                        List<String> parts = chunk(text);
                        for (int i = 0; i < parts.size(); i++) {
                            String id = gen + (i == parts.size() - 1 ? "_last" : "_" + i);
                            if (i == 0 && parts.size() == 1) id = gen + "_last";
                            tts.speak(parts.get(i), i == 0 ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, new Bundle(), id);
                        }
                        emit("ttsStart", null, null);
                    }
                };
                if (!ttsReady && !ttsFailed) pending.add(job);
                else job.run();
            }
        });
    }

    /** Jarvis voice: for British English a male voice, otherwise the best installed voice; on-device voices preferred. */
    private android.speech.tts.Voice pickVoice(Locale loc) {
        Set<android.speech.tts.Voice> all = tts.getVoices();
        if (all == null) return null;
        android.speech.tts.Voice best = null;
        int bestScore = -1;
        for (android.speech.tts.Voice v : all) {
            Locale vl = v.getLocale();
            if (!vl.getLanguage().equals(loc.getLanguage())) continue;
            int score = 0;
            if (vl.getCountry().equals(loc.getCountry())) score += 20;
            String n = v.getName().toLowerCase(Locale.ROOT);
            if (loc.getLanguage().equals("en") && loc.getCountry().equals("GB")
                    && (n.contains("-gbb-") || n.contains("-gbd-") || n.contains("-rjs-") || n.contains("male") && !n.contains("female"))) score += 12;
            if (!v.isNetworkConnectionRequired()) score += 4;
            score += v.getQuality() / 100;
            if (v.getFeatures() != null && v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) score -= 50;
            if (score > bestScore) {
                bestScore = score;
                best = v;
            }
        }
        return best;
    }

    /** JSON array of installed voices: [{name, locale, quality, network}] plus availability of key languages. */
    String voicesJson() {
        final CountDownLatch latch = new CountDownLatch(1);
        final JSONObject out = new JSONObject();
        main.post(new Runnable() {
            @Override
            public void run() {
                try {
                    org.json.JSONArray arr = new org.json.JSONArray();
                    JSONObject langs = new JSONObject();
                    if (ttsReady && tts != null) {
                        Set<android.speech.tts.Voice> all = tts.getVoices();
                        if (all != null) {
                            for (android.speech.tts.Voice v : all) {
                                if (v.getFeatures() != null && v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                                JSONObject j = new JSONObject();
                                j.put("name", v.getName());
                                j.put("locale", v.getLocale().toLanguageTag());
                                j.put("quality", v.getQuality());
                                j.put("network", v.isNetworkConnectionRequired());
                                arr.put(j);
                            }
                        }
                        String[][] want = {{"en", "GB"}, {"bn", "BD"}, {"bn", "IN"}, {"hi", "IN"}};
                        for (String[] w : want) {
                            int r = tts.isLanguageAvailable(new Locale(w[0], w[1]));
                            langs.put(w[0] + "-" + w[1], r >= TextToSpeech.LANG_AVAILABLE);
                        }
                    }
                    out.put("voices", arr);
                    out.put("langs", langs);
                    out.put("ready", ttsReady);
                } catch (Exception ignored) {
                }
                latch.countDown();
            }
        });
        try {
            latch.await(2, TimeUnit.SECONDS);
        } catch (InterruptedException ignored) {
        }
        return out.toString();
    }

    void stopSpeaking() {
        main.post(new Runnable() {
            @Override
            public void run() {
                gen++;
                if (tts != null && ttsReady) tts.stop();
            }
        });
    }

    // ---------------------------------------------------------------- STT

    boolean hasMic() {
        return act.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    void listen(final String lang) {
        main.post(new Runnable() {
            @Override
            public void run() {
                if (!hasMic()) {
                    emit("listenError", "code", 9);
                    return;
                }
                if (!SpeechRecognizer.isRecognitionAvailable(act)) {
                    emit("listenError", "code", -1);
                    return;
                }
                gen++;
                if (tts != null && ttsReady) tts.stop();
                destroyRecognizer();
                sr = SpeechRecognizer.createSpeechRecognizer(act);
                sr.setRecognitionListener(new RecognitionListener() {
                    @Override
                    public void onReadyForSpeech(Bundle p) {
                        emit("listenReady", null, null);
                    }

                    @Override
                    public void onBeginningOfSpeech() {
                        emit("listenSpeech", null, null);
                    }

                    @Override
                    public void onRmsChanged(float rms) {
                        long now = System.currentTimeMillis();
                        if (now - lastLevelAt < 40) return;
                        lastLevelAt = now;
                        double v = Math.max(0, Math.min(1, (rms + 2) / 12.0));
                        emit("level", "v", v);
                    }

                    @Override
                    public void onBufferReceived(byte[] b) {
                    }

                    @Override
                    public void onEndOfSpeech() {
                        emit("listenEnd", null, null);
                    }

                    @Override
                    public void onError(int error) {
                        emit("listenError", "code", error);
                    }

                    @Override
                    public void onResults(Bundle r) {
                        ArrayList<String> list = r.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        emit("result", "text", list != null && list.size() > 0 ? list.get(0) : "");
                    }

                    @Override
                    public void onPartialResults(Bundle r) {
                        ArrayList<String> list = r.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        if (list != null && list.size() > 0) emit("partial", "text", list.get(0));
                    }

                    @Override
                    public void onEvent(int t, Bundle p) {
                    }
                });
                Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang == null || lang.length() == 0 ? "en-US" : lang);
                i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, act.getPackageName());
                sr.startListening(i);
            }
        });
    }

    void stopListening() {
        main.post(new Runnable() {
            @Override
            public void run() {
                destroyRecognizer();
            }
        });
    }

    private void destroyRecognizer() {
        if (sr != null) {
            try {
                sr.setRecognitionListener(null);
                sr.cancel();
                sr.destroy();
            } catch (Exception ignored) {
            }
            sr = null;
        }
    }

    void destroy() {
        destroyRecognizer();
        if (tts != null) {
            try {
                tts.stop();
                tts.shutdown();
            } catch (Exception ignored) {
            }
        }
    }
}

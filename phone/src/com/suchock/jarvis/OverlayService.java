package com.suchock.jarvis;

import android.animation.ValueAnimator;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.widget.TextView;

/** Floating Jarvis ball that stays above other apps. Tap = talk, drag = move, long-press = open Jarvis. */
public final class OverlayService extends Service {
    static final String ACT_STOP = "com.suchock.jarvis.STOP_BALL";
    private static volatile OverlayService inst;
    private static volatile boolean appFg = true;
    private static volatile String lastState = "idle";
    private static volatile boolean lastCall = false;
    private static volatile long lastStateAt = 0;
    private static final Handler wd = new Handler(Looper.getMainLooper());
    /** While a call is live: if the page sits idle (not listening, thinking or speaking) for 3 s, tell it to listen again. */
    private static final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (!lastCall) return;
            if ("idle".equals(lastState) && System.currentTimeMillis() - lastStateAt > 3000) {
                Bridge b = Bridge.current;
                if (b != null) b.emit("ballKick", new org.json.JSONObject());
            }
            wd.postDelayed(this, 3500);
        }
    };

    private WindowManager wm;
    private BallView ball;
    private WindowManager.LayoutParams ballLp;
    private TextView bubble;
    private boolean bubbleOn = false;
    private final Handler h = new Handler(Looper.getMainLooper());
    private final Runnable hideBubble = new Runnable() {
        @Override
        public void run() {
            if (bubble != null && bubbleOn) {
                wm.removeView(bubble);
                bubbleOn = false;
            }
        }
    };

    static boolean running() {
        return inst != null;
    }

    static void appForeground(final boolean fg) {
        appFg = fg;
        final OverlayService s = inst;
        if (s != null) s.h.post(new Runnable() {
            @Override
            public void run() {
                s.applyVisibility();
            }
        });
    }

    static void state(final String st) {
        lastState = st;
        lastStateAt = System.currentTimeMillis();
        final OverlayService s = inst;
        if (s != null) s.h.post(new Runnable() {
            @Override
            public void run() {
                if (s.ball != null) s.ball.setMode(lastState);
            }
        });
    }

    static void call(final boolean on) {
        lastCall = on;
        wd.removeCallbacks(tick);
        if (on) {
            lastStateAt = System.currentTimeMillis();
            wd.postDelayed(tick, 3500);
        }
        final OverlayService s = inst;
        if (s != null) s.h.post(new Runnable() {
            @Override
            public void run() {
                if (s.ball != null) s.ball.invalidate();
            }
        });
    }

    static void say(final String text) {
        final OverlayService s = inst;
        if (s != null) s.h.post(new Runnable() {
            @Override
            public void run() {
                s.showBubble(text);
            }
        });
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private int dp(float v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACT_STOP.equals(intent.getAction())) {
            getSharedPreferences("jarvis", MODE_PRIVATE).edit().putString("ball_on", "0").apply();
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            startFg();
        } catch (Exception e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ball == null && android.provider.Settings.canDrawOverlays(this)) {
            addBall();
            inst = this;
            ball.setMode(lastState);
            applyVisibility();
        }
        return START_STICKY;
    }

    private void startFg() {
        String ch = "jarvis_ball";
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel c = new NotificationChannel(ch, "Jarvis floating ball", NotificationManager.IMPORTANCE_LOW);
            nm.createNotificationChannel(c);
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Intent stop = new Intent(this, OverlayService.class).setAction(ACT_STOP);
        PendingIntent ps = PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, ch) : new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("Jarvis is ready")
                .setContentText("Tap the floating ball to talk to me.")
                .setContentIntent(pi)
                .setOngoing(true)
                .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Hide ball", ps).build());
        Notification n = b.build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(77, n, 128 /* FOREGROUND_SERVICE_TYPE_MICROPHONE */);
        else startForeground(77, n);
    }

    private int overlayType() {
        return Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
    }

    private void addBall() {
        final SharedPreferences p = getSharedPreferences("jarvis", MODE_PRIVATE);
        DisplayMetrics dm = getResources().getDisplayMetrics();
        int size = dp(66);
        ballLp = new WindowManager.LayoutParams(size, size, overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        ballLp.gravity = Gravity.TOP | Gravity.START;
        ballLp.x = p.getInt("ball_x", dm.widthPixels - size - dp(6));
        ballLp.y = p.getInt("ball_y", dm.heightPixels / 3);
        ball = new BallView(this);
        wm.addView(ball, ballLp);
    }

    private void applyVisibility() {
        if (ball != null) ball.setVisibility(appFg ? View.GONE : View.VISIBLE);
        if (appFg && bubble != null && bubbleOn) {
            h.removeCallbacks(hideBubble);
            hideBubble.run();
        }
    }

    private void showBubble(String text) {
        if (appFg || ball == null || text == null || text.trim().length() == 0) return;
        String t = text.trim();
        if (t.length() > 180) t = t.substring(0, 177) + "…";
        if (bubble == null) {
            bubble = new TextView(this);
            bubble.setTextColor(Color.parseColor("#D8FAFF"));
            bubble.setTextSize(14f);
            bubble.setPadding(dp(14), dp(10), dp(14), dp(10));
            GradientDrawable g = new GradientDrawable();
            g.setColor(Color.parseColor("#EB04141F"));
            g.setCornerRadius(dp(14));
            g.setStroke(dp(1), Color.parseColor("#8019E3FF"));
            bubble.setBackground(g);
        }
        bubble.setText(t);
        if (!bubbleOn) {
            WindowManager.LayoutParams lp = new WindowManager.LayoutParams(WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.WRAP_CONTENT, overlayType(),
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                    PixelFormat.TRANSLUCENT);
            lp.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
            lp.y = dp(70);
            lp.width = (int) (getResources().getDisplayMetrics().widthPixels * 0.88f);
            wm.addView(bubble, lp);
            bubbleOn = true;
        } else {
            wm.updateViewLayout(bubble, bubble.getLayoutParams());
        }
        h.removeCallbacks(hideBubble);
        h.postDelayed(hideBubble, 4000 + t.length() * 45L);
    }

    private void onTap() {
        Bridge b = Bridge.current;
        if (MainActivity.locked) {
            startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
        } else if (b != null) {
            b.emit("ballTap", new org.json.JSONObject());
        } else {
            Intent i = new Intent(Intent.ACTION_ASSIST).setClass(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        }
    }

    private void onLong() {
        Intent i = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        startActivity(i);
    }

    @Override
    public void onDestroy() {
        inst = null;
        h.removeCallbacksAndMessages(null);
        try {
            if (bubbleOn) wm.removeView(bubble);
        } catch (Exception ignored) {
        }
        try {
            if (ball != null) wm.removeView(ball);
        } catch (Exception ignored) {
        }
        ball = null;
        stopForeground(true);
        super.onDestroy();
    }

    // ================================================================== the ball itself
    private final class BallView extends View {
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF r = new RectF();
        private String mode = "idle";
        private float downRawX, downRawY;
        private int startX, startY;
        private boolean dragging, longFired;
        private final int slop = ViewConfiguration.get(getContext()).getScaledTouchSlop();
        private final Runnable longPress = new Runnable() {
            @Override
            public void run() {
                if (!dragging) {
                    longFired = true;
                    performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS);
                    onLong();
                }
            }
        };

        BallView(Context c) {
            super(c);
        }

        void setMode(String m) {
            mode = m == null ? "idle" : m;
            invalidate();
        }

        private int themeRgb() {
            String th = getSharedPreferences("jarvis_ui", MODE_PRIVATE).getString("theme", "cyan");
            if ("amber".equals(th)) return Color.rgb(255, 176, 64);
            if ("red".equals(th)) return Color.rgb(255, 90, 106);
            if ("green".equals(th)) return Color.rgb(61, 235, 140);
            if ("purple".equals(th)) return Color.rgb(176, 108, 255);
            if ("mark".equals(th)) return Color.rgb(255, 82, 64);
            if ("friday".equals(th)) return Color.rgb(232, 244, 255);
            return Color.rgb(25, 227, 255);
        }

        private int accent = Color.rgb(25, 227, 255);
        private long accentAt = 0;

        @Override
        protected void onDraw(Canvas c) {
            long nowMs = SystemClock.uptimeMillis();
            if (nowMs - accentAt > 3000) { accent = themeRgb(); accentAt = nowMs; }
            float w = getWidth(), cx = w / 2f, cy = getHeight() / 2f;
            float t = (nowMs % 100000L) / 1000f;
            float R = w * 0.40f;
            boolean listen = mode.equals("listening"), think = mode.equals("thinking"), speak = mode.equals("speaking");
            int ac = listen ? (accent == Color.rgb(255, 176, 64) ? Color.rgb(25, 227, 255) : Color.rgb(255, 179, 71)) : accent;
            int ar = Color.red(ac), ag = Color.green(ac), ab = Color.blue(ac);
            float pulse = listen ? 0.5f + 0.5f * (float) Math.sin(t * 5f) : speak ? 0.5f + 0.5f * (float) Math.sin(t * 7f) : 0.5f + 0.5f * (float) Math.sin(t * 1.6f);

            // outer halo
            p.setStyle(Paint.Style.FILL);
            p.setShader(new RadialGradient(cx, cy, w / 2f, new int[]{Color.argb((int) (60 + 100 * pulse), ar, ag, ab), Color.argb(0, ar, ag, ab)}, new float[]{0.55f, 1f}, Shader.TileMode.CLAMP));
            c.drawCircle(cx, cy, w / 2f, p);
            // glass body: deep dark sphere, lighter towards the middle
            p.setShader(new RadialGradient(cx, cy, R, new int[]{Color.argb(255, 8, 38, 52), Color.argb(255, 3, 14, 22), Color.argb(255, 1, 6, 11)}, new float[]{0f, 0.7f, 1f}, Shader.TileMode.CLAMP));
            c.drawCircle(cx, cy, R, p);
            p.setShader(null);
            // rim
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(dp(1.5f));
            p.setColor(Color.argb(235, ar, ag, ab));
            c.drawCircle(cx, cy, R, p);
            p.setStrokeWidth(dp(0.8f));
            p.setColor(Color.argb(70, ar, ag, ab));
            c.drawCircle(cx, cy, R - dp(3f), p);

            // fine tick ring
            p.setStrokeWidth(dp(0.9f));
            float t1 = R * 0.90f, t2 = R * 0.96f - dp(2f);
            for (int i = 0; i < 60; i++) {
                double an = Math.toRadians(i * 6);
                boolean big = i % 5 == 0;
                p.setColor(Color.argb(big ? 170 : 80, ar, ag, ab));
                float r1 = big ? t1 - dp(1.4f) : t1;
                c.drawLine(cx + (float) Math.cos(an) * r1, cy + (float) Math.sin(an) * r1, cx + (float) Math.cos(an) * t2, cy + (float) Math.sin(an) * t2, p);
            }

            // rotating outer arcs (faster while thinking)
            float spin = think ? t * 360f * 1.3f : t * 38f;
            p.setStrokeCap(Paint.Cap.ROUND);
            p.setStrokeWidth(dp(2.2f));
            p.setColor(Color.argb(255, ar, ag, ab));
            float r2 = R * 0.80f;
            r.set(cx - r2, cy - r2, cx + r2, cy + r2);
            for (int i = 0; i < 3; i++) c.drawArc(r, spin + i * 120f, think ? 62f : 40f, false, p);

            // segmented reactor ring (10 pills, counter-rotating)
            float segR = R * 0.60f;
            r.set(cx - segR, cy - segR, cx + segR, cy + segR);
            p.setStrokeWidth(dp(3.2f));
            for (int i = 0; i < 10; i++) {
                float wave = (speak || listen) ? 0.5f + 0.5f * (float) Math.sin(t * 9f - i * 0.8f) : think ? 0.5f + 0.5f * (float) Math.sin(t * 6f - i * 0.6f) : 0.55f + 0.2f * pulse;
                p.setColor(Color.argb((int) (90 + 165 * wave), ar, ag, ab));
                c.drawArc(r, -spin * 0.5f + i * 36f, 22f, false, p);
            }

            // voice equalizer between core and pills
            if (speak || listen || think) {
                p.setStrokeWidth(dp(1.6f));
                for (int i = 0; i < 28; i++) {
                    double an = Math.toRadians(i * (360f / 28f) + spin * 0.25f);
                    float amp = speak ? 0.25f + 0.75f * Math.abs((float) Math.sin(t * 11f + i * 1.7f) * (float) Math.cos(t * 5f + i * 0.5f))
                            : listen ? 0.2f + 0.5f * Math.abs((float) Math.sin(t * 6f + i * 1.1f)) : 0.15f + 0.25f * Math.abs((float) Math.sin(t * 4f + i));
                    float in = R * 0.27f, out = in + R * 0.17f * amp + dp(1f);
                    p.setColor(Color.argb((int) (120 + 120 * amp), ar, ag, ab));
                    c.drawLine(cx + (float) Math.cos(an) * in, cy + (float) Math.sin(an) * in, cx + (float) Math.cos(an) * out, cy + (float) Math.sin(an) * out, p);
                }
            }
            p.setStrokeCap(Paint.Cap.BUTT);

            // glowing core
            float cr = R * (listen ? 0.26f + 0.06f * pulse : speak ? 0.25f + 0.07f * pulse : 0.24f + 0.015f * pulse);
            p.setStyle(Paint.Style.FILL);
            p.setShader(new RadialGradient(cx, cy, cr * 1.9f, new int[]{Color.WHITE, Color.argb(255, Math.min(255, ar + 90), Math.min(255, ag + 30), Math.min(255, ab + 30)), Color.argb(200, ar, ag, ab), Color.argb(0, ar, ag, ab)}, new float[]{0.08f, 0.32f, 0.6f, 1f}, Shader.TileMode.CLAMP));
            c.drawCircle(cx, cy, cr * 1.9f, p);
            p.setShader(null);
            // arc-reactor triangle
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(dp(1.4f));
            p.setStrokeJoin(Paint.Join.ROUND);
            p.setColor(Color.argb(235, 255, 255, 255));
            android.graphics.Path tri = new android.graphics.Path();
            float rot = think ? t * 200f : 0f;
            float trr = cr * 0.95f;
            for (int i = 0; i < 3; i++) {
                double an = Math.toRadians(-90 + rot + i * 120);
                float x = cx + (float) Math.cos(an) * trr, y = cy + (float) Math.sin(an) * trr;
                if (i == 0) tri.moveTo(x, y); else tri.lineTo(x, y);
            }
            tri.close();
            c.drawPath(tri, p);

            // glass sheen on the upper-left
            p.setStyle(Paint.Style.FILL);
            p.setShader(new RadialGradient(cx - R * 0.38f, cy - R * 0.5f, R * 0.9f, new int[]{Color.argb(60, 255, 255, 255), Color.argb(0, 255, 255, 255)}, new float[]{0f, 1f}, Shader.TileMode.CLAMP));
            c.drawCircle(cx, cy, R - dp(1f), p);
            p.setShader(null);

            // listening / speaking ripple
            if (speak || listen) {
                p.setStyle(Paint.Style.STROKE);
                p.setStrokeWidth(dp(1.2f));
                float ph = (t * (listen ? 1.2f : 1.8f)) % 1f;
                p.setColor(Color.argb((int) (150 * (1 - ph)), ar, ag, ab));
                c.drawCircle(cx, cy, R * (0.4f + 0.6f * ph), p);
            }
            // live-call ring
            if (lastCall) {
                p.setStyle(Paint.Style.STROKE);
                p.setStrokeWidth(dp(2.4f));
                p.setColor(Color.argb((int) (150 + 100 * pulse), 61, 255, 154));
                c.drawCircle(cx, cy, R + dp(2.5f), p);
            }
            postInvalidateOnAnimation();
        }

        @Override
        public boolean onTouchEvent(MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downRawX = e.getRawX();
                    downRawY = e.getRawY();
                    startX = ballLp.x;
                    startY = ballLp.y;
                    dragging = false;
                    longFired = false;
                    postDelayed(longPress, 650);
                    return true;
                case MotionEvent.ACTION_MOVE:
                    float dx = e.getRawX() - downRawX, dy = e.getRawY() - downRawY;
                    if (!dragging && Math.hypot(dx, dy) > slop) {
                        dragging = true;
                        removeCallbacks(longPress);
                    }
                    if (dragging) {
                        ballLp.x = startX + (int) dx;
                        ballLp.y = startY + (int) dy;
                        try {
                            wm.updateViewLayout(this, ballLp);
                        } catch (Exception ignored) {
                        }
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                    removeCallbacks(longPress);
                    if (dragging) snap();
                    else if (!longFired) onTap();
                    return true;
                case MotionEvent.ACTION_CANCEL:
                    removeCallbacks(longPress);
                    if (dragging) snap();
                    return true;
                default:
                    return super.onTouchEvent(e);
            }
        }

        private void snap() {
            DisplayMetrics dm = getResources().getDisplayMetrics();
            int size = getWidth();
            final int target = (ballLp.x + size / 2 < dm.widthPixels / 2) ? dp(6) : dm.widthPixels - size - dp(6);
            final int maxY = dm.heightPixels - size - dp(40);
            ballLp.y = Math.max(dp(30), Math.min(ballLp.y, maxY));
            ValueAnimator a = ValueAnimator.ofInt(ballLp.x, target);
            a.setDuration(180);
            a.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator v) {
                    ballLp.x = (Integer) v.getAnimatedValue();
                    try {
                        wm.updateViewLayout(BallView.this, ballLp);
                    } catch (Exception ignored) {
                    }
                }
            });
            a.start();
            getSharedPreferences("jarvis", MODE_PRIVATE).edit().putInt("ball_x", target).putInt("ball_y", ballLp.y).apply();
        }
    }
}

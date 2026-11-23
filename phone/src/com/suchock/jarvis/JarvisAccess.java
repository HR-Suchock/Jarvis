package com.suchock.jarvis;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.os.Bundle;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Lets Jarvis type into other apps and press system buttons. Only acts when the user asks. */
public final class JarvisAccess extends AccessibilityService {
    private static volatile JarvisAccess instance;

    static boolean isRunning() {
        return instance != null;
    }

    /** True if the user has switched Jarvis on in Android's Accessibility settings (even if Android has not started it yet). */
    static boolean enabledInSettings(android.content.Context c) {
        try {
            String list = android.provider.Settings.Secure.getString(c.getContentResolver(), android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (list == null) return false;
            String full = new android.content.ComponentName(c, JarvisAccess.class).flattenToString();
            String shortName = new android.content.ComponentName(c, JarvisAccess.class).flattenToShortString();
            for (String part : list.split(":")) {
                if (part.equalsIgnoreCase(full) || part.equalsIgnoreCase(shortName)) return true;
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    static JarvisAccess get() {
        return instance;
    }

    @Override
    protected void onServiceConnected() {
        instance = this;
        try {
            getSharedPreferences("jarvis", MODE_PRIVATE).edit().putString("access_was", "1").apply();
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
    }

    @Override
    public void onInterrupt() {
    }

    @Override
    public boolean onUnbind(android.content.Intent intent) {
        instance = null;
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        instance = null;
        super.onDestroy();
    }

    // ------------------------------------------------------------ typing

    private static boolean usable(AccessibilityNodeInfo n) {
        if (n == null || !n.isVisibleToUser() || !n.isEnabled() || n.isPassword()) return false;
        if (n.isEditable()) return true;
        CharSequence cn = n.getClassName();
        return cn != null && cn.toString().contains("EditText");
    }

    private AccessibilityNodeInfo findField() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return null;
        AccessibilityNodeInfo f = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (usable(f)) return f;
        List<AccessibilityNodeInfo> found = new ArrayList<AccessibilityNodeInfo>();
        collectEditable(root, found, 0);
        if (found.isEmpty()) return null;
        // prefer the biggest field (a note body beats a title / search bar)
        AccessibilityNodeInfo best = null;
        int bestArea = -1;
        android.graphics.Rect r = new android.graphics.Rect();
        for (AccessibilityNodeInfo n : found) {
            n.getBoundsInScreen(r);
            int area = r.width() * r.height();
            if (area > bestArea) {
                bestArea = area;
                best = n;
            }
        }
        return best;
    }

    private void collectEditable(AccessibilityNodeInfo n, List<AccessibilityNodeInfo> out, int depth) {
        if (n == null || depth > 40) return;
        if (usable(n)) out.add(n);
        for (int i = 0; i < n.getChildCount(); i++) collectEditable(n.getChild(i), out, depth + 1);
    }

    /** Appends text to the focused (or best) text field. mode: "append" or "replace". */
    boolean typeText(String text, boolean replace) {
        AccessibilityNodeInfo f = findField();
        if (f == null) return false;
        f.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
        CharSequence cur = f.getText();
        String existing = cur == null ? "" : cur.toString();
        // hint text is reported as text on some apps; ignore it when the field is flagged empty
        if (Build_hasShowingHint(f)) existing = "";
        String sep = "";
        if (!replace && existing.length() > 0 && text.length() > 0) {
            char last = existing.charAt(existing.length() - 1), first = text.charAt(0);
            if (!Character.isWhitespace(last) && !Character.isWhitespace(first) && ".,!?;:)".indexOf(first) < 0)
                sep = text.indexOf('\n') >= 0 ? "\n" : " ";
        }
        String next = replace ? text : existing + sep + text;
        Bundle b = new Bundle();
        b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, next);
        boolean ok = f.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, b);
        if (ok) {
            Bundle sel = new Bundle();
            sel.putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, next.length());
            sel.putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, next.length());
            f.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, sel);
        }
        return ok;
    }


    // ------------------------------------------------------------ keyboard-style typing (runs on a worker thread)

    private static void nap(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ignored) {
        }
    }

    private static int chunkSize(int len) {
        if (len <= 160) return 8;
        if (len <= 700) return 24;
        return Math.max(60, len / 30);
    }

    private static List<String> chunks(String text) {
        List<String> out = new ArrayList<String>();
        int size = chunkSize(text.length()), i = 0;
        while (i < text.length()) {
            int end = Math.min(text.length(), i + size);
            // do not cut a word in half
            while (end < text.length() && !Character.isWhitespace(text.charAt(end - 1)) && end - i < size + 18) end++;
            out.add(text.substring(i, end));
            i = end;
        }
        return out;
    }

    private static String textOf(AccessibilityNodeInfo f) {
        f.refresh();
        CharSequence t = f.getText();
        return t == null ? "" : t.toString();
    }

    private void setCursorToEnd(AccessibilityNodeInfo f, int len) {
        Bundle sel = new Bundle();
        sel.putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, len);
        sel.putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, len);
        f.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, sel);
    }

    /**
     * Writes text into the focused field the way a keyboard does: it focuses the box (so your own keyboard pops up),
     * then adds the text in small pieces. First choice is direct text input, then paste, then clipboard.
     * Returns "" when done, otherwise a short explanation for the user.
     */
    String typeLikeKeyboard(String text) {
        AccessibilityNodeInfo f = findField();
        if (f == null) return "I can't find a text box on screen. Tap into one first.";
        if (!f.isFocused()) {
            f.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
            nap(150);
            if (!f.isFocused()) f.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            nap(350);
            AccessibilityNodeInfo again = findField();
            if (again != null) f = again;
        }
        String existing = textOf(f);
        if (Build_hasShowingHint(f)) existing = "";
        String sep = "";
        if (existing.length() > 0 && text.length() > 0) {
            char last = existing.charAt(existing.length() - 1), first = text.charAt(0);
            if (!Character.isWhitespace(last) && !Character.isWhitespace(first) && ".,!?;:)".indexOf(first) < 0)
                sep = text.indexOf('\n') >= 0 ? "\n" : " ";
        }
        String full = sep + text;
        List<String> parts = chunks(full);

        // ---- A: direct input, piece by piece (looks like typing)
        boolean aOk = true;
        StringBuilder sofar = new StringBuilder(existing);
        for (int i = 0; i < parts.size() && aOk; i++) {
            sofar.append(parts.get(i));
            Bundle b = new Bundle();
            b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, sofar.toString());
            if (!f.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, b)) { aOk = false; break; }
            if (i == 0) {
                nap(120);
                String now = textOf(f);
                String probe = parts.get(0).trim();
                if (probe.length() > 3) probe = probe.substring(0, 3);
                if (!now.contains(probe) || now.length() < existing.length() + Math.min(2, parts.get(0).length())) { aOk = false; break; }
            }
            nap(i + 1 < parts.size() ? 45 : 0);
        }
        if (aOk) {
            setCursorToEnd(f, sofar.length());
            return "";
        }
        if (!existing.equals(textOf(f)) && !textOf(f).startsWith(existing)) {
            // restore what was there before our failed attempt
            Bundle rb = new Bundle();
            rb.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, existing);
            f.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, rb);
        }

        // ---- B: paste, piece by piece (works in editors that ignore direct input)
        android.content.ClipboardManager cm = null;
        android.content.ClipData old = null;
        try {
            cm = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            try {
                old = cm.getPrimaryClip();
            } catch (Exception ignored) {
            }
        } catch (Exception ignored) {
        }
        if (cm != null) {
            boolean bOk = true;
            try {
                f.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
                setCursorToEnd(f, existing.length());
                for (int i = 0; i < parts.size() && bOk; i++) {
                    cm.setPrimaryClip(android.content.ClipData.newPlainText("Jarvis", parts.get(i)));
                    nap(60);
                    if (!f.performAction(AccessibilityNodeInfo.ACTION_PASTE)) { bOk = false; break; }
                    if (i == 0) {
                        nap(150);
                        if (textOf(f).length() <= existing.length()) { bOk = false; break; }
                    }
                    nap(60);
                }
            } catch (Exception e) {
                bOk = false;
            }
            if (bOk) {
                try {
                    if (old != null) cm.setPrimaryClip(old);
                } catch (Exception ignored) {
                }
                return "";
            }
            // ---- C: leave the whole text on the clipboard for the user to paste
            try {
                cm.setPrimaryClip(android.content.ClipData.newPlainText("Jarvis", text));
                return "This app does not let me insert text directly. I copied it to your clipboard: tap the box, hold, and choose Paste.";
            } catch (Exception ignored) {
            }
        }
        return "This app would not accept the text. Tap the box once and ask me again.";
    }

    private static boolean Build_hasShowingHint(AccessibilityNodeInfo n) {
        if (android.os.Build.VERSION.SDK_INT >= 26) return n.isShowingHintText();
        return false;
    }

    boolean hasField() {
        return findField() != null;
    }

    // ------------------------------------------------------------ controls

    boolean global(String what) {
        switch (what) {
            case "back": return performGlobalAction(GLOBAL_ACTION_BACK);
            case "home": return performGlobalAction(GLOBAL_ACTION_HOME);
            case "recents": return performGlobalAction(GLOBAL_ACTION_RECENTS);
            case "notifications": return performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS);
            case "quicksettings": return performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS);
            case "power": return performGlobalAction(GLOBAL_ACTION_POWER_DIALOG);
            case "screenshot": return android.os.Build.VERSION.SDK_INT >= 28 && performGlobalAction(GLOBAL_ACTION_TAKE_SCREENSHOT);
            case "lockscreen": return android.os.Build.VERSION.SDK_INT >= 28 && performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN);
            default: return false;
        }
    }



    // ---- v1.34: read ANOTHER app's screen. Jarvis' own window is skipped; after a delay the text is stored and Jarvis comes back to the front.
    static volatile String laterText = null;      // null = nothing yet, "" = nothing readable, else the text
    static volatile boolean laterBusy = false;
    private final android.os.Handler laterH = new android.os.Handler(android.os.Looper.getMainLooper());

    void screenLater(final int ms) {
        laterText = null; laterBusy = true;
        laterH.postDelayed(new Runnable() { public void run() {
            String out = "";
            try {
                AccessibilityNodeInfo root = getRootInActiveWindow();
                if (root != null && !getPackageName().equals(String.valueOf(root.getPackageName()))) {
                    StringBuilder sb = new StringBuilder();
                    collect(root, sb, 0);
                    out = sb.toString().replaceAll("[ \\t]+", " ").replaceAll("\\n{3,}", "\n\n").trim();
                    if (out.length() > 3500) out = out.substring(0, 3500);
                    if (out.length() == 0) out = "";
                } else out = "@JARVIS";
            } catch (Throwable t) { out = ""; }
            laterText = out; laterBusy = false;
            try {
                Intent i = new Intent(JarvisAccess.this, MainActivity.class);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                startActivity(i);
            } catch (Throwable t) { /* ignore */ }
        } }, ms);
    }

    /** Visible text of the open screen, trimmed to a size that is sensible to send to an AI. */
    String screenText() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return null;
        StringBuilder sb = new StringBuilder();
        collect(root, sb, 0);
        String s = sb.toString().replaceAll("[ \\t]+", " ").replaceAll("\\n{3,}", "\n\n").trim();
        return s.length() > 3500 ? s.substring(0, 3500) : s;
    }

    private void collect(AccessibilityNodeInfo n, StringBuilder sb, int depth) {
        if (n == null || depth > 40 || sb.length() > 4000) return;
        if (n.isVisibleToUser() && !n.isPassword()) {
            CharSequence t = n.getText(), d = n.getContentDescription();
            CharSequence v = (t != null && t.length() > 0) ? t : d;
            if (v != null && v.length() > 0) sb.append(v).append('\n');
        }
        for (int i = 0; i < n.getChildCount(); i++) collect(n.getChild(i), sb, depth + 1);
    }

    /** Taps the first visible clickable element whose text or description contains the label. */
    boolean clickLabel(String label) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        String want = label.toLowerCase(Locale.ROOT).trim();
        AccessibilityNodeInfo hit = search(root, want, 0);
        return hit != null && clickNode(hit);
    }

    private AccessibilityNodeInfo search(AccessibilityNodeInfo n, String want, int depth) {
        if (n == null || depth > 40) return null;
        CharSequence t = n.getText(), d = n.getContentDescription();
        if (n.isVisibleToUser()
                && ((t != null && t.toString().toLowerCase(Locale.ROOT).contains(want))
                || (d != null && d.toString().toLowerCase(Locale.ROOT).contains(want)))) return n;
        for (int i = 0; i < n.getChildCount(); i++) {
            AccessibilityNodeInfo r = search(n.getChild(i), want, depth + 1);
            if (r != null) return r;
        }
        return null;
    }

    boolean scroll(boolean down) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        AccessibilityNodeInfo s = findScrollable(root, 0);
        if (s == null) return false;
        return s.performAction(down ? AccessibilityNodeInfo.ACTION_SCROLL_FORWARD : AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD);
    }

    private AccessibilityNodeInfo findScrollable(AccessibilityNodeInfo n, int depth) {
        if (n == null || depth > 40) return null;
        if (n.isScrollable() && n.isVisibleToUser()) return n;
        for (int i = 0; i < n.getChildCount(); i++) {
            AccessibilityNodeInfo r = findScrollable(n.getChild(i), depth + 1);
            if (r != null) return r;
        }
        return null;
    }

    // ------------------------------------------------------------ video lists / gestures

    private boolean looksLikeVideo(AccessibilityNodeInfo n) {
        CharSequence d = n.getContentDescription();
        if (d == null) return false;
        String x = d.toString().toLowerCase(Locale.ROOT);
        return x.contains("play video") || (x.contains(" views") && x.contains(" ago")) || x.contains("play short");
    }

    private void collectVideos(AccessibilityNodeInfo n, List<AccessibilityNodeInfo> out, int depth) {
        if (n == null || depth > 40) return;
        if (n.isVisibleToUser() && looksLikeVideo(n)) {
            out.add(n);
            return;
        }
        for (int i = 0; i < n.getChildCount(); i++) collectVideos(n.getChild(i), out, depth + 1);
    }

    boolean hasVideos() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        List<AccessibilityNodeInfo> c = new ArrayList<AccessibilityNodeInfo>();
        collectVideos(root, c, 0);
        return !c.isEmpty();
    }

    /** Opens the nth (1-based) video/result visible on screen, ordered top to bottom. */
    boolean playNth(int nth) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;
        List<AccessibilityNodeInfo> c = new ArrayList<AccessibilityNodeInfo>();
        collectVideos(root, c, 0);
        if (c.isEmpty()) return false;
        final android.graphics.Rect a = new android.graphics.Rect(), b = new android.graphics.Rect();
        java.util.Collections.sort(c, new java.util.Comparator<AccessibilityNodeInfo>() {
            @Override
            public int compare(AccessibilityNodeInfo x, AccessibilityNodeInfo y) {
                x.getBoundsInScreen(a);
                y.getBoundsInScreen(b);
                return a.top - b.top;
            }
        });
        if (nth < 1) nth = 1;
        if (nth > c.size()) nth = c.size();
        return clickNode(c.get(nth - 1));
    }

    boolean clickNode(AccessibilityNodeInfo n) {
        AccessibilityNodeInfo x = n;
        while (x != null) {
            if (x.isClickable() && x.isEnabled() && x.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true;
            x = x.getParent();
        }
        android.graphics.Rect r = new android.graphics.Rect();
        n.getBoundsInScreen(r);
        return tapAt(r.centerX(), r.centerY());
    }

    boolean tapAt(float x, float y) {
        if (android.os.Build.VERSION.SDK_INT < 24) return false;
        android.graphics.Path path = new android.graphics.Path();
        path.moveTo(x, y);
        android.accessibilityservice.GestureDescription.Builder g = new android.accessibilityservice.GestureDescription.Builder();
        g.addStroke(new android.accessibilityservice.GestureDescription.StrokeDescription(path, 0, 60));
        return dispatchGesture(g.build(), null, null);
    }

    // ---- finger-style swipes: used for "scroll", "next reel", feeds, shorts and lists

    private final android.os.Handler gestureH = new android.os.Handler(android.os.Looper.getMainLooper());
    private volatile int gestureGen = 0;

    /** Cancels any swipes still queued by a repeat ("scroll down 5 times"). */
    void stopGestures() {
        gestureGen++;
    }

    /** dir = direction the finger moves: up, down, left, right. size: 0 small, 1 normal, 2 big. */
    private boolean oneSwipe(String dir, int size, android.accessibilityservice.AccessibilityService.GestureResultCallback cb) {
        if (android.os.Build.VERSION.SDK_INT < 24) return false;
        android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
        float w = dm.widthPixels, h = dm.heightPixels, x1 = w / 2, y1 = h / 2, x2 = w / 2, y2 = h / 2;
        long dur = 240;
        float a = 0.72f, b = 0.28f;                       // normal: 44% of the screen
        if (size == 0) { a = 0.60f; b = 0.40f; dur = 320; } // small: a nudge
        if (size == 2) { a = 0.84f; b = 0.18f; dur = 220; } // big: most of the screen
        switch (dir) {
            case "up": y1 = h * a; y2 = h * b; break;
            case "down": y1 = h * b; y2 = h * a; break;
            case "left": x1 = w * 0.84f; x2 = w * 0.16f; break;
            case "right": x1 = w * 0.16f; x2 = w * 0.84f; break;
            default: return false;
        }
        android.graphics.Path path = new android.graphics.Path();
        path.moveTo(x1, y1);
        path.lineTo(x2, y2);
        android.accessibilityservice.GestureDescription.Builder g = new android.accessibilityservice.GestureDescription.Builder();
        g.addStroke(new android.accessibilityservice.GestureDescription.StrokeDescription(path, 0, dur));
        try {
            return dispatchGesture(g.build(), cb, null);
        } catch (Exception e) {
            return false;
        }
    }

    /** Swipes count times (1..10), waiting for each swipe to finish before the next one. */
    boolean swipeN(final String dir, final int count, final int size) {
        final int total = Math.max(1, Math.min(10, count));
        final int gen = ++gestureGen;
        final int[] done = {0};
        final long gap = size == 2 ? 450 : 650;           // a short pause so feeds can settle on the new item
        final android.accessibilityservice.AccessibilityService.GestureResultCallback[] cb = new android.accessibilityservice.AccessibilityService.GestureResultCallback[1];
        cb[0] = new android.accessibilityservice.AccessibilityService.GestureResultCallback() {
            @Override
            public void onCompleted(android.accessibilityservice.GestureDescription g) {
                done[0]++;
                if (done[0] >= total || gen != gestureGen) return;
                gestureH.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        if (gen == gestureGen) oneSwipe(dir, size, cb[0]);
                    }
                }, gap);
            }
        };
        return oneSwipe(dir, size, total > 1 ? cb[0] : null);
    }

    boolean swipe(String dir) {
        return swipeN(dir, 1, 1);
    }

    /** "scroll down": content moves up, so the finger swipes up. Falls back to the accessibility scroll when gestures are unavailable. */
    boolean scrollBy(boolean down, int count, int size) {
        if (swipeN(down ? "up" : "down", count, size)) return true;
        boolean ok = false;
        for (int i = 0; i < Math.max(1, Math.min(10, count)); i++) ok |= scroll(down);
        return ok;
    }
}
// CRB-MARK b7fbd4eba2e8

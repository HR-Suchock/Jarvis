package com.suchock.jarvis;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ValueCallback;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.IOException;
import java.io.InputStream;

public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";

    /** True while the optional app lock is asking for the phone's screen lock. */
    static volatile boolean locked = false;
    private static final int REQ_UNLOCK = 77;
    private static final long LOCK_AFTER_MS = 60000;

    private WebView web;
    private Bridge bridge;
    private View cover;
    private long leftAt = 0;
    private boolean unlocking = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setLongClickable(false);
        web.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) {
                return true;
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        cover = new View(this);
        cover.setBackgroundColor(Color.BLACK);
        cover.setClickable(true);
        cover.setVisibility(View.GONE);
        root.addView(cover, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);
        s.setGeolocationEnabled(false);
        s.setSaveFormData(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (android.os.Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(true);
        WebView.setWebContentsDebuggingEnabled(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        StatusCard.cancel(this);
        bridge = new Bridge(this, web);
        bridge.launchFlag = isMonitor(getIntent()) ? "monitor" : (isAssist(getIntent()) ? "assist" : "");
        web.addJavascriptInterface(bridge, "AndroidBridge");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) {
                    String path = u.getPath();
                    if (path == null || path.equals("/") || path.length() == 0) path = "/index.html";
                    path = path.substring(1);
                    if (path.contains("..")) return notFound();
                    try {
                        InputStream in = getAssets().open(path);
                        return new WebResourceResponse(mime(path), "UTF-8", in);
                    } catch (IOException e) {
                        return notFound();
                    }
                }
                // Nothing outside the app is ever fetched by the page: a blocked request cannot leak data.
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", null, new java.io.ByteArrayInputStream(new byte[0]));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                bridge.trusted = url != null && url.startsWith("https://" + HOST + "/");
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                bridge.trusted = url != null && url.startsWith("https://" + HOST + "/");
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("https".equals(u.getScheme()) && HOST.equals(u.getHost())) return false;
                String sch = u.getScheme();
                if (!"http".equals(sch) && !"https".equals(sch)) return true;   // never launch other schemes from a page
                try {
                    Intent i = new Intent(Intent.ACTION_VIEW, u);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception ignored) {
                }
                return true;
            }
        });

        // Never load the page while locked: it would read empty settings and then overwrite the saved keys.
        locked = false;
        if (lockEnabled()) lock();
        if (!locked) loadPage();
    }

    private boolean pageLoaded = false;

    private void loadPage() {
        if (pageLoaded) return;
        pageLoaded = true;
        web.loadUrl("https://" + HOST + "/index.html");
    }

    private boolean lockEnabled() {
        return "1".equals(bridge.prefInternal("applock"));
    }

    private boolean privacyEnabled() {
        return "1".equals(bridge.prefInternal("privacy"));
    }

    void applyPrivacy(boolean on) {
        if (on) getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
        else getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
    }

    private void lock() {
        android.app.KeyguardManager km = (android.app.KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        if (km == null || !km.isDeviceSecure()) return;     // no phone lock set: nothing to ask for (page loads normally)
        locked = true;
        cover.setVisibility(View.VISIBLE);
    }

    private void askUnlock() {
        if (!locked || unlocking) return;
        android.app.KeyguardManager km = (android.app.KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        Intent i = km == null ? null : km.createConfirmDeviceCredentialIntent("Jarvis is locked", "Confirm it is you");
        if (i == null) { locked = false; cover.setVisibility(View.GONE); loadPage(); return; }
        unlocking = true;
        try {
            startActivityForResult(i, REQ_UNLOCK);
        } catch (Exception e) {
            unlocking = false;
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_UNLOCK) {
            unlocking = false;
            if (res == RESULT_OK) {
                locked = false;
                cover.setVisibility(View.GONE);
                loadPage();
                web.evaluateJavascript("window.JarvisNative&&window.JarvisNative.emit('resumed',{})", null);
            } else {
                moveTaskToBack(true);
            }
        }
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null, new java.io.ByteArrayInputStream(new byte[0]));
    }

    private static String mime(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    private static boolean isMonitor(Intent i) {
        return i != null && "com.suchock.jarvis.MONITOR".equals(i.getAction());
    }

    private static boolean isAssist(Intent i) {
        if (i == null || i.getAction() == null) return false;
        String a = i.getAction();
        return Intent.ACTION_ASSIST.equals(a) || Intent.ACTION_VOICE_COMMAND.equals(a) || "com.suchock.jarvis.LISTEN".equals(a);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (isMonitor(intent)) {
            bridge.emit("monitor", new org.json.JSONObject());
        } else if (isAssist(intent)) {
            bridge.emit("assist", new org.json.JSONObject());
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == Bridge.REQ_PERMS) bridge.onPermissionsResult();
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.__onBack&&window.__onBack())?1:0", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String v) {
                if (!"1".equals(v)) moveTaskToBack(true);
            }
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        JarvisWidget.refresh(this);
        OverlayService.appForeground(false);
        leftAt = android.os.SystemClock.elapsedRealtime();
        boolean ball = OverlayService.running();
        if (!ball) bridge.pause();
        web.evaluateJavascript("window.JarvisNative&&window.JarvisNative.emit('paused',{ball:" + ball + "})", null);
        if (!ball) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        JarvisWidget.refresh(this);
        OverlayService.appForeground(true);
        applyPrivacy(privacyEnabled());
        if (!locked && lockEnabled() && leftAt > 0 && android.os.SystemClock.elapsedRealtime() - leftAt > LOCK_AFTER_MS) lock();
        if (locked) askUnlock();
        web.onResume();
        web.evaluateJavascript("window.JarvisNative&&window.JarvisNative.emit('resumed',{})", null);
    }

    @Override
    protected void onDestroy() {
        bridge.trusted = false;
        bridge.destroy();
        web.removeJavascriptInterface("AndroidBridge");
        web.destroy();
        super.onDestroy();
    }
}

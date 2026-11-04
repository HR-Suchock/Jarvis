# What the phone app (APK) needs for the PC → phone file, screenshot and clipboard features (PC 1.27.0)

The PC now sends three things to the phone through the encrypted link. The phone app must understand them.

| PC sends (command type) | What it is | Phone tier |
|---|---|---|
| `filepart` | A piece of a file (a screenshot, or a file dropped on the PC ball). `arg` = JSON header `{id,i,n,size,name,mime}`, `arg2` = the piece in base64 | `ctl` |
| `setclip` | Text for the phone clipboard (from the PC ball) | `ctl` |
| `notify` | A short text to show as a notification (job finished, backup done, missed job) | `ctl` |

## 0. Do this first: publish the new Firebase rule (once)
Firebase console → Realtime Database → Rules → replace with `firebase-rules.json` from this package → Publish.
The only change: `length < 20000` became `length < 70000`. Without it every file piece is refused by the database.
Why it is safe: the largest message the PC now sends is about 64,500 characters (measured), the link itself still refuses anything over 64 KB, and the data is still encrypted. Every piece is 36,000 bytes of file data.

## 1. Add `FileParts.java` (already in this package: `src/com/suchock/jarvis/FileParts.java`)
Pure Java (no Android imports, no lambdas). It collects the pieces in order, refuses wrong order, bad base64, more than 3 MB, more than 200 pieces, more than 3 files at once, and cleans the file name (no folders, no `..`). Tested: 100 KB in 4 pieces comes out byte-identical, and the bad cases are refused.

## 2. Allow the three types (RelayService.java, function `tier`)
Add `|| "filepart".equals(t) || "setclip".equals(t) || "notify".equals(t)` to the line that returns `"ctl"`.

## 3. Handle them (Actions.java)
In `run(...)` next to `case "url":` add
```java
case "filepart": return filepart(arg, arg2);
case "setclip": return setclip(arg);
case "notify": return notifyText(arg);   // skip this line if your app already has a notify handler
```
and add these methods (check them on a real phone: they use the normal Android storage and clipboard calls and were NOT compiled against the Android SDK here):
```java
private final FileParts parts = new FileParts(new FileParts.Sink() {
    @Override public String save(String name, String mime, byte[] data) { return saveReceived(name, mime, data); }
});

private String filepart(String header, String b64) {
    String[] m = new String[1];
    boolean ok = parts.accept(header, b64, m);
    return res(ok, m[0]);
}

private String saveReceived(String name, String mime, byte[] data) {
    try {
        boolean pic = mime.startsWith("image/");
        if (android.os.Build.VERSION.SDK_INT >= 29) {
            android.content.ContentValues v = new android.content.ContentValues();
            v.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name);
            v.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mime);
            v.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, pic ? "Pictures/Jarvis" : "Download/Jarvis");
            android.net.Uri base = pic ? android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI : android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI;
            android.net.Uri u = ctx.getContentResolver().insert(base, v);
            if (u == null) return "could not create the file";
            java.io.OutputStream o = ctx.getContentResolver().openOutputStream(u);
            try { o.write(data); } finally { o.close(); }
        } else {
            java.io.File dir = ctx.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS);
            if (dir == null) return "no storage available";
            java.io.FileOutputStream o = new java.io.FileOutputStream(new java.io.File(dir, name));
            try { o.write(data); } finally { o.close(); }
        }
        return null;
    } catch (Exception e) { return "could not save the file"; }
}

private String setclip(String text) {
    try {
        android.content.ClipboardManager cm = (android.content.ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
        cm.setPrimaryClip(android.content.ClipData.newPlainText("Jarvis", text));
        return res(true, "copied to the phone clipboard");
    } catch (Exception e) { return res(false, "could not use the clipboard"); }
}
```
(`ctx` is the Context field your `Actions` class already uses. Pictures land in Gallery → Jarvis, other files in Downloads → Jarvis. Before Android 10 they go to the app's own Downloads folder.)

## 4. One more thing in `RelayService.java`
Receiving a file takes up to 100 short commands one after another. The handler currently runs each command on the main thread and waits up to 15 s, which is fine for pieces of 30 KB. If saving the last piece feels slow on an old phone, run `filepart` directly in `onCommand` instead of posting it to the main thread (it touches no screen).

## 5. Version
Raise `versionCode` / `versionName` in `AndroidManifest.xml` and `build.sh` (phone 1.27.0 suggested), then run the APK build workflow.

## Check on the phone
1. PC ball menu → send a small picture to the phone → it appears in Gallery → Jarvis.
2. PC: "send a screenshot to my phone" (or the phone asks for a PC screenshot) → picture in Gallery → Jarvis.
3. Drop a PDF under 3 MB on the ball → Downloads → Jarvis.
4. A file over 3 MB: the PC says too big (nothing is sent).

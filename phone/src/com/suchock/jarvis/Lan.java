package com.suchock.jarvis;

import android.util.Base64;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.Charset;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Enumeration;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Direct Wi-Fi file transfer between the phone and the PC (same network only). The address and a one-time token travel through the
 * encrypted device link; the file goes straight over TCP, encrypted with AES-256-CTR keyed from that token and checked with a SHA-256 trailer.
 * Protocol: "JLAN1 proof size name-b64url mime-b64url\n" + encrypted(file) + encrypted(64 hex chars of sha256); reply "OK msg\n" or "ERR msg\n".
 * Same protocol as src/main/lan.js on the PC.
 */
final class Lan {
    private Lan() { }

    interface Sink { String done(File file, String name, String mime) throws Exception; }

    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final int B64 = Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING;

    private static byte[] sha(String s) throws Exception { return MessageDigest.getInstance("SHA-256").digest(s.getBytes(UTF8)); }
    private static String hex(byte[] b) { StringBuilder sb = new StringBuilder(); for (byte x : b) sb.append(String.format("%02x", x & 0xff)); return sb.toString(); }
    private static Cipher cipher(String token, int mode) throws Exception {
        byte[] iv = new byte[16];
        System.arraycopy(sha("iv" + token), 0, iv, 0, 16);
        Cipher c = Cipher.getInstance("AES/CTR/NoPadding");
        c.init(mode, new SecretKeySpec(sha(token), "AES"), new IvParameterSpec(iv));
        return c;
    }
    private static String proof(String token) throws Exception { return hex(sha("auth" + token)); }
    private static String enc(String s) { return Base64.encodeToString(s.getBytes(UTF8), B64); }
    private static String dec(String s) { return new String(Base64.decode(s, B64), UTF8); }

    static String token() {
        byte[] b = new byte[12];
        new java.security.SecureRandom().nextBytes(b);
        return hex(b);
    }

    static ArrayList<String> ips() {
        ArrayList<String> out = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> e = NetworkInterface.getNetworkInterfaces();
            while (e != null && e.hasMoreElements()) {
                NetworkInterface ni = e.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                Enumeration<java.net.InetAddress> a = ni.getInetAddresses();
                while (a.hasMoreElements()) {
                    java.net.InetAddress ad = a.nextElement();
                    if (ad instanceof java.net.Inet4Address && ad.isSiteLocalAddress() && out.size() < 3) out.add(ad.getHostAddress());
                }
            }
        } catch (Exception ignored) { }
        return out;
    }

    /** Receiving side, runs on its own thread: waits up to 90 s for one connection, saves the file through the sink. */
    static void receiveOnce(ServerSocket ss, String token, File cacheDir, Sink sink) {
        File part = null;
        try {
            ss.setSoTimeout(90000);
            Socket s = ss.accept();
            try {
                s.setSoTimeout(30000);
                InputStream in = new java.io.BufferedInputStream(s.getInputStream(), 65536);
                OutputStream out = s.getOutputStream();
                StringBuilder h = new StringBuilder();
                int c;
                while ((c = in.read()) != '\n') { if (c < 0 || h.length() > 2048) return; h.append((char) c); }
                String[] p = h.toString().split(" ");
                if (p.length < 5 || !"JLAN1".equals(p[0]) || !proof(token).equals(p[1])) { out.write("ERR not allowed\n".getBytes(UTF8)); return; }
                long size = Long.parseLong(p[2]);
                if (size <= 0) { out.write("ERR bad size\n".getBytes(UTF8)); return; }
                cacheDir.mkdirs();
                if (cacheDir.getUsableSpace() < 2 * size + 100L * 1000 * 1000) { out.write("ERR the phone does not have enough free storage\n".getBytes(UTF8)); return; }
                String name = dec(p[3]), mime = dec(p[4]);
                cacheDir.mkdirs();
                part = new File(cacheDir, "lan-" + token.substring(0, 8) + ".part");
                Cipher dc = cipher(token, Cipher.DECRYPT_MODE);
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                FileOutputStream fo = new FileOutputStream(part);
                byte[] buf = new byte[32768];
                long got = 0;
                try {
                    while (got < size) {
                        int k = in.read(buf, 0, (int) Math.min(buf.length, size - got));
                        if (k < 0) break;
                        byte[] pl = dc.update(buf, 0, k);
                        if (pl != null) { fo.write(pl); md.update(pl); }
                        got += k;
                    }
                } finally { fo.close(); }
                byte[] tail = new byte[64];
                int t = 0;
                while (t < 64) { int k = in.read(tail, t, 64 - t); if (k < 0) break; t += k; }
                byte[] tp = t == 64 ? dc.update(tail) : null;
                if (got != size || tp == null || !new String(tp, UTF8).equals(hex(md.digest()))) { out.write("ERR the file was damaged on the way\n".getBytes(UTF8)); return; }
                String msg;
                try {
                    msg = sink.done(part, name, mime);
                } catch (Exception e) {
                    String em = e.getMessage() == null ? "the phone could not save it" : e.getMessage().replace('\n', ' ');
                    out.write(("ERR " + em + "\n").getBytes(UTF8));
                    return;
                }
                out.write(("OK " + msg + "\n").getBytes(UTF8));
                out.flush();
            } finally {
                try { s.close(); } catch (Exception ignored) { }
            }
        } catch (Exception ignored) {
            // timeout or broken connection: the sender falls back or reports
        } finally {
            try { ss.close(); } catch (Exception ignored) { }
            if (part != null) part.delete();
        }
    }

    /**
     * Sending side. Returns null when the other device could not be reached at all (nothing was read from the stream, use the slow route),
     * otherwise "OK message" or "ERR message".
     */
    static String send(InputStream in, long total, String name, String mime, String offer) {
        try {
            if (offer == null || !offer.startsWith("LAN ")) return null;
            String[] o = offer.split(" ");
            if (o.length != 4) return null;
            int port = Integer.parseInt(o[2]);
            String token = o[3];
            for (String ip : o[1].split(",")) {
                Socket s = new Socket();
                try {
                    s.connect(new InetSocketAddress(ip, port), 2000);
                } catch (Exception e) {
                    try { s.close(); } catch (Exception ignored) { }
                    continue;
                }
                try {
                    s.setSoTimeout(60000);
                    OutputStream out = new java.io.BufferedOutputStream(s.getOutputStream(), 65536);
                    out.write(("JLAN1 " + proof(token) + " " + total + " " + enc(name) + " " + enc(mime) + "\n").getBytes(UTF8));
                    Cipher ec = cipher(token, Cipher.ENCRYPT_MODE);
                    MessageDigest md = MessageDigest.getInstance("SHA-256");
                    byte[] buf = new byte[32768];
                    long sent = 0;
                    while (sent < total) {
                        int k = in.read(buf, 0, (int) Math.min(buf.length, total - sent));
                        if (k < 0) return "ERR the file changed while it was being sent";
                        md.update(buf, 0, k);
                        byte[] ct = ec.update(buf, 0, k);
                        if (ct != null) out.write(ct);
                        sent += k;
                    }
                    byte[] tl = ec.update(hex(md.digest()).getBytes(UTF8));
                    if (tl != null) out.write(tl);
                    out.flush();
                    StringBuilder r = new StringBuilder();
                    InputStream ri = s.getInputStream();
                    int c;
                    while ((c = ri.read()) != '\n' && c >= 0 && r.length() < 400) r.append((char) c);
                    String rs = r.toString().trim();
                    return rs.length() == 0 ? "ERR no answer from the PC" : rs;
                } catch (Exception e) {
                    return "ERR the Wi-Fi transfer was interrupted";
                } finally {
                    try { s.close(); } catch (Exception ignored) { }
                }
            }
        } catch (Exception ignored) { }
        return null;
    }
}
// CRB-MARK b18c915ce8b5

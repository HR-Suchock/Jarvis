package com.suchock.jarvis;

import java.nio.charset.Charset;
import java.security.SecureRandom;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Jarvis device-link protocol v1 — byte-for-byte the same as pc/src/main/link-protocol.js.
 *   pairing code  "JL1." + base64url(JSON {u: databaseUrl, s: secret})
 *   room          first 32 chars of base64url(HMAC-SHA256(secret, "jarvis-link/room/v1"))
 *   key           HMAC-SHA256(secret, "jarvis-link/key/v1")
 *   envelope      {v:1, n: base64url(12-byte IV), c: base64url(AES-256-GCM ciphertext || 16-byte tag)}, AAD "jl1:" + recipient
 * No Android classes here, so it can be tested on a plain JVM.
 */
final class LinkCore {
    static final String PREFIX = "JL1.";
    static final long MAX_AGE_MS = 120000L;
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final String B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    private static final Pattern HTTPS = Pattern.compile("^https://[a-z0-9.-]+(:\\d+)?(/.*)?$", Pattern.CASE_INSENSITIVE);
    private static final Pattern LOOPBACK = Pattern.compile("^http://(127\\.0\\.0\\.1|localhost)(:\\d+)?(/.*)?$", Pattern.CASE_INSENSITIVE);
    private static final SecureRandom RNG = new SecureRandom();

    private LinkCore() {
    }

    static final class Keys {
        String room;
        byte[] key;
    }

    static String b64uEnc(byte[] in) {
        StringBuilder o = new StringBuilder();
        int i = 0;
        for (; i + 2 < in.length; i += 3) {
            int n = ((in[i] & 255) << 16) | ((in[i + 1] & 255) << 8) | (in[i + 2] & 255);
            o.append(B64.charAt(n >> 18 & 63)).append(B64.charAt(n >> 12 & 63)).append(B64.charAt(n >> 6 & 63)).append(B64.charAt(n & 63));
        }
        int rem = in.length - i;
        if (rem == 1) {
            int n = (in[i] & 255) << 16;
            o.append(B64.charAt(n >> 18 & 63)).append(B64.charAt(n >> 12 & 63));
        } else if (rem == 2) {
            int n = ((in[i] & 255) << 16) | ((in[i + 1] & 255) << 8);
            o.append(B64.charAt(n >> 18 & 63)).append(B64.charAt(n >> 12 & 63)).append(B64.charAt(n >> 6 & 63));
        }
        return o.toString();
    }

    static byte[] b64uDec(String s) {
        s = s.replace('+', '-').replace('/', '_').replace("=", "");
        int len = s.length();
        byte[] out = new byte[len * 6 / 8];
        int buf = 0, bits = 0, o = 0;
        for (int k = 0; k < len; k++) {
            int v = B64.indexOf(s.charAt(k));
            if (v < 0) throw new IllegalArgumentException("bad base64");
            buf = (buf << 6) | v;
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                out[o++] = (byte) (buf >> bits & 255);
            }
        }
        return o == out.length ? out : java.util.Arrays.copyOf(out, o);
    }

    static String newSecret() {
        byte[] b = new byte[24];
        RNG.nextBytes(b);
        return b64uEnc(b);
    }

    static String normalizeDbUrl(String u) {
        if (u == null) return "";
        u = u.trim();
        if (!HTTPS.matcher(u).matches() && !LOOPBACK.matcher(u).matches()) return "";
        while (u.endsWith("/")) u = u.substring(0, u.length() - 1);
        return u;
    }

    static String makeCode(String dbUrl, String secret) {
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        m.put("u", dbUrl);
        m.put("s", secret);
        return PREFIX + b64uEnc(LinkJson.write(m).getBytes(UTF8));
    }

    /** @return {dbUrl, secret} */
    static String[] parseCode(String code) throws Exception {
        code = code == null ? "" : code.replaceAll("\\s+", "");
        if (!code.startsWith(PREFIX)) throw new Exception("That is not a Jarvis pairing code.");
        Object o;
        try {
            o = LinkJson.parse(new String(b64uDec(code.substring(PREFIX.length())), UTF8));
        } catch (Exception e) {
            throw new Exception("The pairing code is damaged — copy it again.");
        }
        String u = normalizeDbUrl(LinkJson.str(o, "u"));
        if (u.length() == 0) throw new Exception("The pairing code has no valid database address.");
        String s = LinkJson.str(o, "s");
        if (s.length() < 24) throw new Exception("The pairing code is too weak or damaged.");
        return new String[]{u, s};
    }

    private static byte[] hmac(String secret, String label) throws Exception {
        Mac m = Mac.getInstance("HmacSHA256");
        m.init(new SecretKeySpec(secret.getBytes(UTF8), "HmacSHA256"));
        return m.doFinal(label.getBytes(UTF8));
    }

    static Keys derive(String secret) throws Exception {
        Keys k = new Keys();
        k.room = b64uEnc(hmac(secret, "jarvis-link/room/v1")).substring(0, 32);
        k.key = hmac(secret, "jarvis-link/key/v1");
        return k;
    }

    static Map<String, Object> seal(byte[] key, Map<String, Object> msg, String recipient) throws Exception {
        byte[] iv = new byte[12];
        RNG.nextBytes(iv);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
        c.updateAAD(("jl1:" + recipient).getBytes(UTF8));
        byte[] ct = c.doFinal(LinkJson.write(msg).getBytes(UTF8));
        Map<String, Object> env = new LinkedHashMap<String, Object>();
        env.put("v", Long.valueOf(1));
        env.put("n", b64uEnc(iv));
        env.put("c", b64uEnc(ct));
        return env;
    }

    /** Decrypts and validates; returns null for anything that is not a fresh message for {@code recipient}. */
    static Map<String, Object> open(byte[] key, Object envObj, String recipient, long now) {
        try {
            Map<String, Object> env = LinkJson.obj(envObj);
            if (env == null || !(env.get("v") instanceof Number) || ((Number) env.get("v")).intValue() != 1) return null;
            byte[] iv = b64uDec(LinkJson.str(env, "n"));
            byte[] all = b64uDec(LinkJson.str(env, "c"));
            if (iv.length != 12 || all.length < 17 || all.length > 64 * 1024) return null;
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
            c.updateAAD(("jl1:" + recipient).getBytes(UTF8));
            Map<String, Object> m = LinkJson.obj(LinkJson.parse(new String(c.doFinal(all), UTF8)));
            if (m == null || !(m.get("id") instanceof String) || !(m.get("ts") instanceof Number)) return null;
            long ts = ((Number) m.get("ts")).longValue();
            if (Math.abs(now - ts) > MAX_AGE_MS) return null;
            return m;
        } catch (Exception e) {
            return null;
        }
    }
}

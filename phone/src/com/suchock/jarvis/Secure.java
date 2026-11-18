package com.suchock.jarvis;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.Charset;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** AES-GCM encryption with a key that lives in the Android Keystore (never leaves secure hardware / the system). */
final class Secure {
    private static final String ALIAS = "jarvis_store_v1";
    private static final String PREFIX = "enc1:";
    private static final Charset UTF8 = Charset.forName("UTF-8");

    private static volatile int works = 0;   // 0 unknown, 1 yes, -1 no

    private Secure() {
    }

    /** True only if a real encrypt+decrypt round trip succeeds on this phone. Some phones have a faulty Keystore. */
    static boolean available() {
        if (works == 0) {
            try {
                String t = seal("jarvis-selftest");
                works = (t != null && "jarvis-selftest".equals(openStrict(t))) ? 1 : -1;
            } catch (Exception e) {
                works = -1;
            }
        }
        return works == 1;
    }

    private static String openStrict(String v) throws Exception {
        byte[] all = Base64.decode(v.substring(PREFIX.length()), Base64.NO_WRAP);
        byte[] iv = new byte[12];
        System.arraycopy(all, 0, iv, 0, 12);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
        return new String(c.doFinal(all, 12, all.length - 12), UTF8);
    }

    private static synchronized SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) {
            return (SecretKey) ks.getKey(ALIAS, null);
        }
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return g.generateKey();
    }

    /** Returns "enc1:" + base64(iv + ciphertext). On failure returns null (caller must not store plaintext secrets then). */
    static String seal(String plain) {
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = c.getIV();
            byte[] ct = c.doFinal(plain.getBytes(UTF8));
            byte[] all = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, all, 0, iv.length);
            System.arraycopy(ct, 0, all, iv.length, ct.length);
            return PREFIX + Base64.encodeToString(all, Base64.NO_WRAP);
        } catch (Exception e) {
            return null;
        }
    }

    static boolean isSealed(String v) {
        return v != null && v.startsWith(PREFIX);
    }

    /** Decrypts a sealed value; legacy plaintext values are returned as they are. Undecryptable data gives "". */
    static String open(String v) {
        if (v == null) return "";
        if (!isSealed(v)) return v;
        try {
            byte[] all = Base64.decode(v.substring(PREFIX.length()), Base64.NO_WRAP);
            byte[] iv = new byte[12];
            System.arraycopy(all, 0, iv, 0, 12);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
            return new String(c.doFinal(all, 12, all.length - 12), UTF8);
        } catch (Exception e) {
            return "";
        }
    }

    static void deleteKey() {
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS);
        } catch (Exception ignored) {
        }
    }
}

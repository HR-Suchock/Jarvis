package com.suchock.jarvis;

import java.util.LinkedHashMap;
import java.util.Map;

/** JVM-side test driver for the Android link core (run by test/java-interop.test.js). */
public class LinkTest {
    public static void main(String[] a) throws Exception {
        String mode = a[0];
        if (mode.equals("encrypt")) {                       // encrypt <secret> <recipient> -> envelope json on stdout
            LinkCore.Keys k = LinkCore.derive(a[1]);
            Map<String, Object> m = new LinkedHashMap<String, Object>();
            m.put("id", "j1"); m.put("ts", Long.valueOf(System.currentTimeMillis())); m.put("from", "phone");
            m.put("k", "cmd"); m.put("type", "open"); m.put("arg", "café \"quoted\" \\ 中文"); 
            System.out.println(LinkJson.write(LinkCore.seal(k.key, m, a[2])));
        } else if (mode.equals("decrypt")) {                // decrypt <secret> <recipient> <envelope> -> plaintext json (or NULL)
            LinkCore.Keys k = LinkCore.derive(a[1]);
            Map<String, Object> m = LinkCore.open(k.key, LinkJson.parse(a[3]), a[2], System.currentTimeMillis());
            System.out.println(m == null ? "NULL" : LinkJson.write(m));
        } else if (mode.equals("room")) {
            LinkCore.Keys k = LinkCore.derive(a[1]);
            System.out.println(k.room);
        } else if (mode.equals("code")) {                   // parse a pairing code made by node
            String[] p = LinkCore.parseCode(a[1]);
            System.out.println(p[0] + " " + p[1] + " " + LinkCore.makeCode(p[0], p[1]).equals(a[1]));
        } else if (mode.equals("phone")) {                  // phone <dbUrl> <secret>
            final LinkClient[] holder = new LinkClient[1];
            LinkClient c = new LinkClient("phone", "pc", new LinkClient.Handler() {
                public LinkClient.Result onCommand(String type, String arg, String arg2) {
                    System.out.println("JAVA_GOT " + type + " " + arg);
                    return new LinkClient.Result(true, "java handled " + type);
                }
                public void onStatus(boolean connected) { }
            });
            c.start(a[1], a[2]);
            Thread.sleep(800);
            System.out.println("JAVA_CONNECTED " + c.isConnected());
            LinkClient.Result r = c.send("open", "notepad", "", 8000);
            System.out.println("JAVA_SEND " + r.ok + " " + r.msg);
            System.out.println("JAVA_PING " + c.ping().ok);
            System.out.println("READY");
            Thread.sleep(6000);
            c.stop();
            System.exit(0);
        }
    }
}

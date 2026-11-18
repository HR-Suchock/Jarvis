package com.suchock.jarvis;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.telephony.TelephonyManager;

/** Listens for the phone ringing. Only acts when the user switched "Call help" on and granted the permissions. */
public class CallReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        try {
            if (intent == null || !TelephonyManager.ACTION_PHONE_STATE_CHANGED.equals(intent.getAction())) return;
            if (!CallHelper.enabled(ctx)) return;
            String st = intent.getStringExtra(TelephonyManager.EXTRA_STATE);
            Intent s = new Intent(ctx, CallService.class);
            if (TelephonyManager.EXTRA_STATE_RINGING.equals(st)) {
                s.setAction(CallService.ACT_RING).putExtra("number", intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER));
                ctx.startService(s);
            } else if (TelephonyManager.EXTRA_STATE_OFFHOOK.equals(st) || TelephonyManager.EXTRA_STATE_IDLE.equals(st)) {
                if (CallService.active()) {
                    s.setAction(CallService.ACT_STOP);
                    ctx.startService(s);
                }
            }
        } catch (Throwable ignored) {
        }
    }
}

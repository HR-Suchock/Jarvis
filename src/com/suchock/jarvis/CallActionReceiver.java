package com.suchock.jarvis;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Handles the Answer / Reject buttons of the incoming-call notification (not exported). */
public class CallActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        try {
            String a = intent == null ? "" : intent.getAction();
            if (CallService.ACT_ANSWER.equals(a)) CallHelper.answer(ctx);
            else if (CallService.ACT_REJECT.equals(a)) CallHelper.reject(ctx);
            Intent s = new Intent(ctx, CallService.class).setAction(CallService.ACT_STOP);
            ctx.startService(s);
        } catch (Throwable ignored) {
        }
    }
}

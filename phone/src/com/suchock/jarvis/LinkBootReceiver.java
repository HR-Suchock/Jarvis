package com.suchock.jarvis;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Restarts the device link after the phone reboots or Jarvis is updated (only if the link is switched on). */
public final class LinkBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent == null ? null : intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) RelayService.sync(context);
    }
}

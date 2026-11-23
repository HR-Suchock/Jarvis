package com.suchock.jarvis;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Stop button on the "Find my phone" notification. */
public final class FindStopReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        FindPhone.stop(c);
    }
}
// CRB-MARK 2f91d96fde77

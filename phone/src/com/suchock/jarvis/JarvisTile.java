package com.suchock.jarvis;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/** Quick-settings tile: pull down the notification shade, tap "Jarvis" to start listening. */
public class JarvisTile extends TileService {

    @Override
    public void onStartListening() {
        try {
            Tile t = getQsTile();
            if (t != null) {
                t.setState(Tile.STATE_INACTIVE);
                t.setLabel("Jarvis");
                if (Build.VERSION.SDK_INT >= 29) t.setSubtitle("Tap to talk");
                t.updateTile();
            }
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onClick() {
        Intent i = new Intent(this, MainActivity.class).setAction("com.suchock.jarvis.LISTEN");
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startActivityAndCollapse(PendingIntent.getActivity(this, 21, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            } else {
                startActivityAndCollapse(i);
            }
        } catch (Throwable ignored) {
        }
    }
}

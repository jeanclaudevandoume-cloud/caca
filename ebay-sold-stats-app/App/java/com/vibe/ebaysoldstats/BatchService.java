package com.vibe.ebaysoldstats;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/** Foreground service holding a partial wake lock so the batch keeps running
 *  when the screen locks, and the process survives without losing progress. */
public class BatchService extends Service {

    public static final String CHANNEL_ID = "batch_running";
    private PowerManager.WakeLock wl;

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(
                    CHANNEL_ID, "Batch running",
                    NotificationManager.IMPORTANCE_LOW));
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification.Builder nb = (Build.VERSION.SDK_INT >= 26)
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        Notification n = nb
                .setContentTitle("eBay Sold Stats")
                .setContentText("Batch running - safe to lock the screen. Progress is saved continuously.")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setOngoing(true)
                .build();
        int id = 1;
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(id, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(id, n);
        }
        if (wl == null) {
            PowerManager pm = getSystemService(PowerManager.class);
            wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ebaysoldstats:batch");
            wl.acquire(12 * 60 * 60 * 1000L);
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (wl != null && wl.isHeld()) wl.release();
        wl = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}

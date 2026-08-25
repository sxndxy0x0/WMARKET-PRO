package com.example.pricesync.scheduler;

import com.example.pricesync.config.ConfigManager;
import com.example.pricesync.util.Logger;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * Drives "automatic" update mode by triggering a sync callback on an interval.
 * "manual" and "refresh_button" modes don't need this loop; EventManager
 * calls the sync logic directly for those.
 */
public class Scheduler {

    private final ConfigManager configManager;
    private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "price-sync-scheduler");
        t.setDaemon(true);
        return t;
    });

    private ScheduledFuture<?> currentTask;

    public Scheduler(ConfigManager configManager) {
        this.configManager = configManager;
    }

    /** Starts the periodic task if updateMode == "automatic". No-op otherwise. */
    public void start(Runnable onTick) {
        String mode = configManager.get().updateMode;
        if (!"automatic".equalsIgnoreCase(mode)) {
            Logger.debug("Scheduler not started (updateMode=" + mode + ")");
            return;
        }

        long intervalSeconds = configManager.get().updateInterval;
        if (intervalSeconds <= 0) {
            Logger.warn("Scheduler refused invalid interval=" + intervalSeconds + "s");
            return;
        }

        // JOIN can fire again after reconnects or test harness reinitialization.
        // Never leave an older periodic task running beside the new one.
        stop();
        Logger.info("Starting scheduler, interval=" + intervalSeconds + "s");

        currentTask = executor.scheduleAtFixedRate(
                onTick, intervalSeconds, intervalSeconds, TimeUnit.SECONDS);
    }

    public void stop() {
        if (currentTask != null) {
            currentTask.cancel(false);
            currentTask = null;
        }
    }

    public void shutdown() {
        stop();
        executor.shutdownNow();
    }
}

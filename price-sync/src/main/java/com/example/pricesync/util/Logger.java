package com.example.pricesync.util;

import java.io.IOException;
import java.io.PrintWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/**
 * Thin logging wrapper so the rest of the mod doesn't depend directly
 * on a specific logging library. Also writes to a rolling log file per
 * the project spec's ERROR HANDLING section ("Write logs").
 *
 * File writes are best-effort: if they fail, we fall back to console-only
 * rather than throwing (logging must never be the thing that crashes the game).
 */
public final class Logger {

    /**
     * Defaults to the game directory's config/price-sync/latest.log. The
     * "price-sync.logfile" system property redirects it — the Gradle test JVM
     * sets this so running the suite never litters a repository root (or a
     * real installation) with a stray runtime log.
     */
    private static final Path LOG_PATH = resolveLogPath();

    private static Path resolveLogPath() {
        String override = System.getProperty("price-sync.logfile");
        if (override != null && !override.isBlank()) {
            return Path.of(override);
        }
        return Path.of("config", "price-sync", "latest.log");
    }

    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("HH:mm:ss");

    private static boolean debugEnabled = false;
    private static PrintWriter fileWriter;

    private Logger() {}

    public static void setDebugEnabled(boolean enabled) {
        debugEnabled = enabled;
    }

    public static void info(String message) {
        log("INFO", message);
    }

    public static void warn(String message) {
        log("WARN", message);
    }

    public static void error(String message, Throwable t) {
        log("ERROR", message + (t != null ? " — " + t : ""));
        if (t != null) {
            // full stack trace goes to console + file (via writer) for debugging,
            // but never propagates up — callers must not let this crash the game.
            t.printStackTrace();
            writeToFile("    " + stackTraceToString(t));
        }
    }

    public static void debug(String message) {
        if (debugEnabled) {
            log("DEBUG", message);
        }
    }

    private static void log(String level, String message) {
        String line = "[" + LocalDateTime.now().format(TIME_FMT) + "] [" + level + "] " + message;
        if ("ERROR".equals(level)) {
            System.err.println("[PriceSync] " + line);
        } else {
            System.out.println("[PriceSync] " + line);
        }
        writeToFile(line);
    }

    private static synchronized void writeToFile(String line) {
        try {
            ensureWriter();
            if (fileWriter != null) {
                fileWriter.println(line);
                fileWriter.flush();
            }
        } catch (Exception ignored) {
            // Logging must never crash the mod — silently drop file writes on failure.
        }
    }

    private static void ensureWriter() {
        if (fileWriter != null) return;
        try {
            Files.createDirectories(LOG_PATH.getParent());
            fileWriter = new PrintWriter(Files.newBufferedWriter(LOG_PATH), false);
        } catch (IOException e) {
            // give up silently; console logging still works.
            fileWriter = null;
        }
    }

    private static String stackTraceToString(Throwable t) {
        StringBuilder sb = new StringBuilder(t.toString());
        for (StackTraceElement el : t.getStackTrace()) {
            sb.append("\n\tat ").append(el);
        }
        return sb.toString();
    }
}

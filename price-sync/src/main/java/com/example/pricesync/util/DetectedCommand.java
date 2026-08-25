package com.example.pricesync.util;

/** Server-provided price GUI command discovered from the client's command tree. */
public record DetectedCommand(String name) {
    public String literal() {
        return "/" + name;
    }
}

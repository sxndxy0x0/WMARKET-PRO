@echo off
REM ============================================================
REM  WMarket backend - ONE-TIME recovery boot
REM
REM  Run this AFTER the Firestore daily quota resets (~14:00 ICT).
REM  It boots with PRICE_SNAPSHOT=on so the successful load gets
REM  written to backend\data\price-cache.json - every later boot
REM  then serves from disk and never touches Firestore again,
REM  even when the quota is used up.
REM ============================================================
cd /d "%~dp0"
set PRICE_SNAPSHOT=on
echo [WMarket] starting backend with disk snapshot enabled...
node server.js

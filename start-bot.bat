@echo off
chcp 65001 > nul
title ChecklistTrigger - SMC Trading Engine
cd /d "%~dp0"
if exist data\runtime.lock del /f /q data\runtime.lock
set PORT=3000
node dist/server/index.js

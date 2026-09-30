@echo off
chcp 65001 > nul
title ChecklistTrigger - SMC Trading Engine
cd /d "%~dp0"
set PORT=3000
node dist/server/index.js

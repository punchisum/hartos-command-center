@echo off
REM HartOS Autopilot pulse — the organism's daily heartbeat (sense/remember/foresee/record/act).
REM Propose-only: every mutation stays behind Hart's approval + per-action env gates.
REM Invoke via a "HartOS Autopilot Pulse" Windows Scheduled Task (daily).
REM Loads .env.local via the npm script. Logs to autopilot-pulse.log in the repo root.
REM Reversible: delete the task with
REM   schtasks /Delete /TN "HartOS Autopilot Pulse" /F
cd /d "C:\Users\Hart Pun\Documents\GitHub\hartos-command-center"
echo. >> "autopilot-pulse.log"
echo ==== %DATE% %TIME% ==== >> "autopilot-pulse.log"
"C:\Program Files\nodejs\npm.cmd" run hartos:autopilot >> "autopilot-pulse.log" 2>&1

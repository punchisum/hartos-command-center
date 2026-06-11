@echo off
REM HartOS Live Runner — event-triggered execution daemon (GO -> runs in seconds).
REM Reconcile-polls the Hart-approved job queue; executes approved jobs through the gated runner.
REM Run 24/7 via a Windows Scheduled Task with trigger ONLOGON (keep it running):
REM   schtasks /Create /TN "HartOS Live Runner" /TR "\"%~f0\"" /SC ONLOGON /F
REM Reversible: delete with  schtasks /Delete /TN "HartOS Live Runner" /F
REM Loads .env.local via the npm script. Logs to live-runner.log in the repo root.
cd /d "C:\Users\Hart Pun\Documents\GitHub\hartos-command-center"
echo. >> "live-runner.log"
echo ==== %DATE% %TIME% (started) ==== >> "live-runner.log"
"C:\Program Files\nodejs\npm.cmd" run live:runner >> "live-runner.log" 2>&1

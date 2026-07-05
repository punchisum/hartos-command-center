@echo off
REM HartOS Live Runner — event-triggered execution daemon (GO -> runs in seconds).
REM Reconcile-polls the Hart-approved job queue; executes approved jobs through the gated runner.
REM Run 24/7 via a Windows Scheduled Task with trigger ONLOGON (keep it running):
REM   schtasks /Create /TN "HartOS Live Runner" /TR "\"%~f0\"" /SC ONLOGON /F
REM Reversible: delete with  schtasks /Delete /TN "HartOS Live Runner" /F
REM Loads .env.local via the npm script. Logs to live-runner.log in the repo root.
REM SUPERVISOR: auto-restarts the daemon if it exits (crash/OOM) so it survives within a logon.

REM --- Run HIDDEN: if not already relaunched, hand off to the no-window VBS launcher and close this console.
if not "%~1"=="__hidden__" (
  wscript.exe "%~dp0run-live-runner-hidden.vbs"
  exit /b
)

cd /d "C:\Users\Hart Pun\Documents\GitHub\hartos-command-center"
:loop
echo. >> "live-runner.log"
echo ==== %DATE% %TIME% (start/restart) ==== >> "live-runner.log"
"C:\Program Files\nodejs\npm.cmd" run live:runner >> "live-runner.log" 2>&1
echo ==== %DATE% %TIME% (daemon exited code %ERRORLEVEL% — restarting in 5s) ==== >> "live-runner.log"
timeout /t 5 /nobreak > NUL
goto loop

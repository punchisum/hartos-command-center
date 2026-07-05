' HartOS Live Runner — hidden launcher.
' Runs run-live-runner.cmd (in this same folder) with NO console window (mode 0).
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "cmd /c """ & dir & "\run-live-runner.cmd"" __hidden__", 0, False

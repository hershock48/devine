@echo off
rem Starts the DeVine's print helper in a window you can leave open or minimise.
rem Put this and print-helper.ps1 in C:\PrintHelper, and a shortcut to this
rem file in the Startup folder (Win+R, shell:startup) so it starts with Windows.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0print-helper.ps1"
pause

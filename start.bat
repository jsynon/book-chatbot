@echo off
rem Switch into this ZIP's folder so app.py can find its data and page files.
cd /d "%~dp0"
rem Use the Python 3 launcher installed on Windows to start the local server.
py -3 app.py
rem Keep the window open if startup fails so the error remains visible.
if errorlevel 1 pause

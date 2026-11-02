@echo off
chcp 65001 >nul
rem NerpaCad: убрать мусор из папки проекта. Лежит и запускается в корне проекта, рядом с package.json.
rem Удаляет: в dist - старые установщики и части всех версий, кроме текущей, и сборочные папки;
rem out, test-results, playwright-report, кеш Vite; ненужный теперь scripts\make_seal.py.
rem Не трогает: исходники, node_modules, mods, Others, Assets, examples, .git.
cd /d "%~dp0"
if exist package.json goto :found
echo  Положите clean.bat в папку проекта - рядом с package.json - и запустите оттуда.
pause
exit /b 1

:found
setlocal enabledelayedexpansion
set KEEP=
for /f "tokens=2 delims=:, " %%V in ('findstr /c:"\"version\":" package.json') do if not defined KEEP set KEEP=%%~V
echo  Текущая версия: %KEEP% - её установщики останутся.
echo.
echo  Будет удалено:
set N=0
call :scan list
if "%N%"=="0" goto :nothing
echo.
echo  1 - удалить,  2 - отмена
choice /c 12 /n /m " Ваш выбор: "
if errorlevel 2 goto :cancel
call :scan delete
echo.
echo  Готово. Папка out пересоберётся сама при следующем npm run dev.
pause
exit /b 0

:nothing
echo    ничего - мусора нет.
echo.
pause
exit /b 0

:cancel
echo  Ничего не удалено.
pause
exit /b 0

rem ---- :scan list | delete - пройти по мусору: показать или удалить
:scan
set MODE=%1
if not exist dist goto :scan_root
for %%F in (dist\NerpaCad-*) do call :old_installer "%%F"
for %%F in (dist\*.blockmap dist\builder-debug.yml dist\builder-effective-config.yaml dist\latest*.yml) do call :file "%%F"
for %%D in (win-unpacked linux-unpacked win-ia32-unpacked __uninstaller-nsis-nerpacad) do call :folder "dist\%%D"
:scan_root
for %%D in (out test-results playwright-report node_modules\.vite node_modules\.cache) do call :folder "%%D"
call :file "scripts\make_seal.py"
exit /b 0

:old_installer
set NAME=%~nx1
if "!NAME:NerpaCad-%KEEP%-=!"=="!NAME!" call :file %1
exit /b 0

:file
if not exist "%~1" exit /b 0
set /a N+=1
if "%MODE%"=="list" echo    %~1
if "%MODE%"=="delete" del /f /q "%~1"
exit /b 0

:folder
if not exist "%~1\" exit /b 0
set /a N+=1
if "%MODE%"=="list" echo    %~1\
if "%MODE%"=="delete" rmdir /s /q "%~1"
exit /b 0

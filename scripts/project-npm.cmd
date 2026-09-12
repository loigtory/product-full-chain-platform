@echo off
setlocal
set "PROJECT_ROOT=%~dp0.."
set "PATH=%PROJECT_ROOT%\.tools\node-v24.20.0-win-x64;%PATH%"
pushd "%PROJECT_ROOT%"
call npm.cmd %*
set "PFC_EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %PFC_EXIT_CODE%


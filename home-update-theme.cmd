@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Update only the four theme files, using the existing jukebox configuration.
set "jukeboxRepo=%USERPROFILE%\rockboard-home\repo"
set "themeSource=https://raw.githubusercontent.com/eddrock79/rockboard/bbdb8bb26d6043da412ef8d742e154edc9306b5b/home-site"
set "themeTemp=%TEMP%\jukebox-theme-%RANDOM%-%RANDOM%"
set "updateResult=1"

if not exist "%jukeboxRepo%\wrangler-home.toml" goto :missing_install
if not exist "%jukeboxRepo%\home-site\config.js" goto :missing_install
where curl.exe >nul 2>&1
if errorlevel 1 goto :missing_curl
where npx.cmd >nul 2>&1
if errorlevel 1 goto :missing_node

mkdir "%themeTemp%\assets"
if errorlevel 1 goto :temp_failed
echo Downloading the tested Ghost theme...
call :fetch "theme.css" "theme.css"
if errorlevel 1 goto :download_failed
call :fetch "theme.js" "theme.js"
if errorlevel 1 goto :download_failed
call :fetch "assets/cathedral.svg" "assets\cathedral.svg"
if errorlevel 1 goto :download_failed
call :fetch "assets/ghost-wordmark.webp" "assets\ghost-wordmark.webp"
if errorlevel 1 goto :download_failed

rem All downloads must succeed before any installed file is replaced.
if not exist "%jukeboxRepo%\home-site\assets\" mkdir "%jukeboxRepo%\home-site\assets"
if not exist "%jukeboxRepo%\home-site\assets\" goto :install_failed
copy /y "%themeTemp%\theme.css" "%jukeboxRepo%\home-site\theme.css" >nul
if errorlevel 1 goto :install_failed
copy /y "%themeTemp%\theme.js" "%jukeboxRepo%\home-site\theme.js" >nul
if errorlevel 1 goto :install_failed
copy /y "%themeTemp%\assets\cathedral.svg" "%jukeboxRepo%\home-site\assets\cathedral.svg" >nul
if errorlevel 1 goto :install_failed
copy /y "%themeTemp%\assets\ghost-wordmark.webp" "%jukeboxRepo%\home-site\assets\ghost-wordmark.webp" >nul
if errorlevel 1 goto :install_failed

pushd "%jukeboxRepo%"
if errorlevel 1 goto :install_failed
call npx.cmd wrangler deploy -c wrangler-home.toml
set "updateResult=%ERRORLEVEL%"
popd
if not "%updateResult%"=="0" goto :deploy_failed
echo.
echo Theme updated. Refresh the jukebox pages and select GHOST in the admin page.
echo Your configuration, player, keys and current theme selection have been kept.
goto :cleanup

:fetch
curl.exe --fail --location --silent --show-error "%themeSource%/%~1" --output "%themeTemp%\%~2"
exit /b %ERRORLEVEL%

:missing_install
echo Home jukebox installation not found in "%jukeboxRepo%". No files changed.
goto :done
:missing_curl
echo Windows curl.exe was not found. No files changed.
goto :done
:missing_node
echo Node.js npx.cmd was not found. No files changed.
goto :done
:temp_failed
echo Could not create the temporary download folder. No installed files changed.
goto :done
:download_failed
echo Download failed. No installed files changed. Rerun this updater to retry.
goto :cleanup
:install_failed
echo Could not copy the theme files. Deployment was not started. Rerun to retry.
goto :cleanup
:deploy_failed
echo Deployment failed. Theme files are ready. Rerun this updater to retry.
:cleanup
if exist "%themeTemp%\" rmdir /s /q "%themeTemp%"
:done
endlocal & exit /b %updateResult%

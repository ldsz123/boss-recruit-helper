@echo off
chcp 65001 >nul
setlocal
title Boss Recruit Helper - Update & Push to Gitee

echo ==================================================
echo   Boss Recruit Helper  -  Update and Push
echo   Repo: https://gitee.com/zzc356/boss-recruit-helper
echo ==================================================
echo.

set /p MSG=Commit message [update script]:
if "%MSG%"=="" set MSG=update script

echo.
echo [1/3] Checking git user config...
git config user.name >nul 2>&1
if errorlevel 1 (
  git config user.name "zq17"
  git config user.email "1691594247@qq.com"
  echo   local git user set
)

echo.
echo [2/3] Staging and committing...
git add .
git commit -m "%MSG%"
if errorlevel 1 (
  echo   [INFO] nothing to commit
)

echo.
echo [3/3] Pushing to Gitee (a sign-in window may appear)...
git push -u origin master
if errorlevel 1 (
  echo.
  echo   [ERROR] push failed. Check network / credentials.
  echo   https://gitee.com/zzc356/boss-recruit-helper
  pause
  exit /b 1
)

echo.
echo ==================================================
echo  DONE.
echo  Repo:      https://gitee.com/zzc356/boss-recruit-helper
echo  Install:   https://gitee.com/zzc356/boss-recruit-helper/raw/master/boss-recruit-helper.user.js
echo ==================================================
pause

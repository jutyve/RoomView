@echo off
setlocal
cd /d "%~dp0"

echo [1/5] Installing project dependencies...
call npm install
if errorlevel 1 goto fail

echo [2/5] Building the offline web app...
call npm run build
if errorlevel 1 goto fail

if not exist "android" (
  echo [3/5] Creating the Android project...
  call npx cap add android
  if errorlevel 1 goto fail
) else (
  echo [3/5] Android project already exists; keeping it.
)

echo [4/5] Syncing the app into Android...
call npx cap sync android
if errorlevel 1 goto fail

echo [5/5] Opening Android Studio...
call npx cap open android
if errorlevel 1 goto fail

echo.
echo In Android Studio, choose Build ^> Build Bundle(s) / APK(s) ^> Build APK(s).
echo The debug APK will be in android\app\build\outputs\apk\debug\app-debug.apk
pause
exit /b 0

:fail
echo.
echo Build setup failed. Read the error above, then check README.md.
pause
exit /b 1

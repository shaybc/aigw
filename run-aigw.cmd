@echo off
setlocal
cd /d "%~dp0"
if errorlevel 1 exit /b 1

node -e "if (Number(process.versions.node.split('.')[0]) < 22) process.exit(1)"
if errorlevel 1 (
    echo Node.js 22 or newer is required.
    exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
    echo npm is required to check and install AIGW dependencies.
    exit /b 1
)

call npm ls --omit=dev --all >nul 2>&1
if errorlevel 1 (
    echo Installing AIGW dependencies using the configured npm registry...
    call npm ci --no-audit --no-fund
    if errorlevel 1 (
        echo Dependency installation failed. Check your npm registry configuration.
        exit /b 1
    )
)

call npm start
exit /b %errorlevel%

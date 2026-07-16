# Crea un acceso directo en el Escritorio para arrancar el servidor de desarrollo
# Uso: ejecutar una sola vez desde PowerShell

$projectPath = "C:\Users\Usuario\Desktop\Apps Web\Control Produccion"
$shortcutPath = "$env:USERPROFILE\Desktop\Control Produccion — Dev.lnk"

# Script que abre una ventana, arranca npm run dev, y luego abre el browser
$launcherScript = @"
Set-Location '$projectPath'
Start-Process "http://localhost:3000"  # abre el browser anticipado
npm run dev
"@

$launcherFile = "$projectPath\scripts\start-dev.ps1"
Set-Content -Path $launcherFile -Value $launcherScript -Encoding UTF8

# Crear el acceso directo
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath      = "powershell.exe"
$shortcut.Arguments       = "-NoExit -ExecutionPolicy Bypass -File `"$launcherFile`""
$shortcut.WorkingDirectory = $projectPath
$shortcut.Description     = "Arranca el servidor de desarrollo de Control Produccion"
$shortcut.IconLocation    = "powershell.exe,0"
$shortcut.Save()

Write-Host ""
Write-Host "✓ Acceso directo creado en: $shortcutPath" -ForegroundColor Green
Write-Host "  Doble click para arrancar el servidor y abrir el browser." -ForegroundColor Cyan
Write-Host ""

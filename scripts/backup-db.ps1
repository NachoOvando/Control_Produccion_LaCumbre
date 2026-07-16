# Backup manual de la base (mitigación mientras el free tier de Supabase no
# tiene backups automáticos — ver docs/auditoria-2026-07.md, deuda #1).
# Uso: npm run db:backup
# Requiere pg_dump (PostgreSQL client tools) en el PATH.

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot ".env.local"

if (-not (Test-Path $envFile)) {
    Write-Error "No se encontró .env.local en la raíz del repo."
}

# Extraer DATABASE_URL sin imprimirla (contiene la contraseña)
$linea = Get-Content $envFile | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $linea) {
    Write-Error "No se encontró DATABASE_URL en .env.local."
}
$databaseUrl = $linea -replace '^DATABASE_URL=', '' -replace '^"', '' -replace '"$', ''

# Parsear la URL para pasar la password por PGPASSWORD (env var, no visible en
# el listado de procesos) en vez de embebida en --dbname en la línea de
# comandos — un `pg_dump --dbname` con password inline queda legible para
# cualquier proceso local (Task Manager / Get-CimInstance Win32_Process) y se
# ecoa entera si la URL es inválida (hallazgo de seguridad-analista).
if ($databaseUrl -notmatch '^postgresql://([^:]+):([^@]+)@([^:/]+)(?::(\d+))?/([^?]+)') {
    Write-Error "DATABASE_URL no tiene el formato esperado postgresql://user:pass@host:port/db"
}
$pgUser = $Matches[1]
$pgPass = $Matches[2]
$pgHost = $Matches[3]
$pgPort = if ($Matches[4]) { $Matches[4] } else { "5432" }
$pgDb = $Matches[5]

$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgDump) {
    Write-Host "pg_dump no está instalado o no está en el PATH." -ForegroundColor Red
    Write-Host "Instalar PostgreSQL client tools: https://www.postgresql.org/download/windows/"
    Write-Host "(alcanza con marcar solo 'Command Line Tools' en el instalador)"
    exit 1
}

$backupDir = Join-Path $repoRoot "backups"
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$destino = Join-Path $backupDir "backup-$timestamp.sql"

Write-Host "Generando backup en $destino ..."
$env:PGPASSWORD = $pgPass
try {
    & pg_dump --host="$pgHost" --port="$pgPort" --username="$pgUser" --dbname="$pgDb" --no-owner --no-privileges --file="$destino"
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

if ($LASTEXITCODE -eq 0) {
    $tamano = [math]::Round((Get-Item $destino).Length / 1KB, 1)
    Write-Host "Backup OK: $destino ($tamano KB)" -ForegroundColor Green

    # Retención: conservar solo los 10 dumps más recientes (el timestamp en el
    # nombre ordena cronológicamente). Los dumps quedan sin cifrar en disco —
    # deuda #12 de docs/auditoria-2026-07.md, cifrado pendiente por decisión
    # del usuario.
    $retencion = 10
    $viejos = Get-ChildItem $backupDir -Filter "backup-*.sql" |
        Sort-Object Name -Descending |
        Select-Object -Skip $retencion
    if ($viejos) {
        $viejos | Remove-Item -Force
        Write-Host "Retención: se borraron $($viejos.Count) backups viejos (se conservan los $retencion más recientes)."
    }
} else {
    Write-Error "pg_dump falló (exit $LASTEXITCODE)."
}

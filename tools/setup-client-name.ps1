<#
  Понятные имена для боевого приложения React_Suz (ЭСЗ):
    http://esz:3000/   http://zayavki.nioch.nsc.ru:3000/   http://el-ap-sys:3000/

  Скрипт добавляет записи в файл hosts КЛИЕНТСКОГО компьютера Windows, чтобы имена
  указывали на сервер hund03. На самом сервере его запускать не нужно: служба
  react-suz слушает все адреса машины, а имена живут в hosts у клиентов.

  Обычно скрипт не нужен: в сети НИОХ имена разрешаются через DNS (esz — с
  клиентской сети, zayavki.nioch.nsc.ru — отовсюду). Запускайте его там, где имя
  не открывается, а по IP http://192.168.129.31:3000 всё работает, или если
  браузер ходит через VPN/прокси (там нужен ещё список обхода — см. README,
  раздел «Имена для входа»).

  Запуск: PowerShell от имени администратора, из папки с этим файлом
  (или двойным щелчком по setup-client-name.cmd — он сам запросит права).

    powershell -ExecutionPolicy Bypass -File .\setup-client-name.ps1
    powershell -ExecutionPolicy Bypass -File .\setup-client-name.ps1 -Names esz,zayavki
    powershell -ExecutionPolicy Bypass -File .\setup-client-name.ps1 -Name esz -Port 3000
    powershell -ExecutionPolicy Bypass -File .\setup-client-name.ps1 -Remove

  Параметры:
    -Names  имена (по умолчанию esz, zayavki, el-ap-sys)
    -Name   одно имя (старый вариант вызова)
    -Ip     один или несколько адресов сервера (по умолчанию 192.168.129.31)
    -Port   порт для проверки доступности (по умолчанию 3000)
    -Remove убрать записи
#>
[CmdletBinding()]
param(
  [string[]]$Names = @('esz', 'zayavki', 'el-ap-sys'),
  [string]$Name,
  [string[]]$Ip = @('192.168.129.31'),
  [int]$Port = 3000,
  [switch]$Remove
)

# Совместимость со старым вызовом -Name el-ap-sys.
if ($Name) { $Names = @($Name) }

$ErrorActionPreference = 'Stop'
$hosts = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$marker = '# React_Suz production server (hund03) - added by tools/setup-client-name.ps1'

function Write-Step([string]$text) {
  Write-Host ""
  Write-Host "==> $text" -ForegroundColor Cyan
}
function Write-Warn([string]$text) {
  Write-Host "(!) $text" -ForegroundColor Yellow
}

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "Нужны права администратора: закройте окно и откройте PowerShell «от имени администратора»." -ForegroundColor Red
  exit 1
}
if (-not (Test-Path -LiteralPath $hosts)) {
  Write-Host "Не найден файл $hosts" -ForegroundColor Red
  exit 1
}

Write-Step "Файл: $hosts"
Write-Host "Имена: $($Names -join ', ')  ->  $($Ip -join ', ')"

$lines = @(Get-Content -LiteralPath $hosts)
# Убираем прежние записи этих имён и прежний маркер: повторный запуск
# обновляет адрес, а не дописывает строки заново.
$patterns = @($Names | ForEach-Object { "(^|\s)$([regex]::Escape($_))(\s|$)" })
$kept = @($lines | Where-Object {
  $line = $_
  if ($line.Trim() -eq $marker) { return $false }
  foreach ($pattern in $patterns) { if ($line -match $pattern) { return $false } }
  return $true
})

if ($Remove) {
  Write-Step "Удаляю записи $($Names -join ', ') (если были)"
  Set-Content -LiteralPath $hosts -Value $kept -Encoding Ascii
  Write-Host "Готово: имена $($Names -join ', ') больше не задаются в $hosts." -ForegroundColor Green
  exit 0
}

$added = @()
foreach ($address in $Ip) {
  $added += "$address`t$($Names -join ' ')"
}
$added += $marker
$result = @($kept + $added)

Set-Content -LiteralPath $hosts -Value $result -Encoding Ascii
foreach ($address in $Ip) {
  Write-Host "Добавлено: $address -> $($Names -join ' ')"
}

Write-Step "Проверяю"
ipconfig /flushdns | Out-Null

foreach ($n in $Names) {
  try {
    Resolve-DnsName -Name $n -ErrorAction Stop | Select-Object Name, IPAddress | Format-Table -AutoSize | Out-String | Write-Host
  } catch {
    Write-Warn "Имя $n ещё не разрешается — откройте новую вкладку браузера (кэш DNS уже сброшен)."
  }
}

foreach ($n in $Names) {
  $reachable = $false
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $reachable = $client.ConnectAsync($n, $Port).Wait(4000) -and $client.Connected
    $client.Close()
  } catch {
    $reachable = $false
  }

  if ($reachable) {
    try {
      $response = Invoke-WebRequest "http://${n}:$Port/" -UseBasicParsing -TimeoutSec 10
      Write-Host "Работает: http://${n}:$Port/ (HTTP $($response.StatusCode))" -ForegroundColor Green
    } catch {
      Write-Warn "Имя ${n} разрешается, но приложение не ответило: $($_.Exception.Message)"
    }
  } else {
    Write-Warn "Сервер ${n}:$Port не отвечает. Проверьте, что компьютер hund03 включён."
    Write-Host "  Служба на сервере: ssh qwest@$($Ip[0]) 'systemctl --user status react-suz'"
  }
}

Write-Host ""
Write-Host "Дальше:"
foreach ($n in $Names) {
  Write-Host "  приложение:    http://${n}:$Port/"
}
Write-Host "  адрес по IP:   http://$($Ip[0]):$Port/   (и порт 5000 для старых ссылок)"
Write-Host "  без порта:     http://$($Names[0])/   (если администратор включил адрес без порта)"
Write-Host "  убрать записи: powershell -ExecutionPolicy Bypass -File .\setup-client-name.ps1 -Remove"
Write-Host ""
Write-Warn "Если браузер открывается через VPN/прокси, добавьте имена esz, zayavki, *.nsc.ru"
Write-Host "  в список обхода (README, раздел «Имена для входа»)."

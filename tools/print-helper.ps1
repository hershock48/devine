# DeVine's print helper: prints every new website order on the counter's Brother,
# on the right paper, with nobody at the screen. Runs on the counter PC.
#
#   Delivery orders -> the "Order forms" printer entry (bottom tray, the
#                      pre-printed six-panel form, landscape)
#   Pickup orders   -> the "Plain paper" printer entry (top tray, portrait)
#
# Every 30 seconds it asks the site which website orders have not printed,
# downloads each one as a PDF, hands it to SumatraPDF to print silently to the
# named printer, then tells the site it printed, so nothing prints twice even
# if this restarts. Setup and the printer entries: research/printing.md.
#
# Fill in the four values below. Keep this file where only staff can read it:
# it holds the workroom PIN.

$Base         = "https://devine.glazedweb.com"
$Pin          = "PUT-THE-STAFF-PIN-HERE"
$FormsPrinter = "Order forms"
$PlainPrinter = "Plain paper"
$Sumatra      = "C:\PrintHelper\SumatraPDF.exe"
$OutDir       = "C:\PrintHelper\printed"
$Every        = 30   # seconds

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Headers = @{ "x-workroom-pin" = $Pin }

function Log($msg) { Write-Host ("{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg) }

Log "Print helper up. Forms -> '$FormsPrinter', plain -> '$PlainPrinter'. Ctrl+C stops it."
while ($true) {
  try {
    $q = Invoke-RestMethod -Uri "$Base/api/workroom/print/queue" -Headers $Headers -TimeoutSec 20
    foreach ($o in $q.orders) {
      $pdf = Join-Path $OutDir ("{0}-{1}.pdf" -f $o.number, $o.layout)
      Invoke-WebRequest -Uri "$Base/api/workroom/print/$($o.id)" -Headers $Headers -OutFile $pdf -TimeoutSec 30
      $printer = if ($o.paper -eq "forms") { $FormsPrinter } else { $PlainPrinter }
      # noscale: the form is drawn on the creases; fit-to-page would move them.
      & $Sumatra -print-to $printer -print-settings "noscale" -silent $pdf
      if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) { throw "SumatraPDF exited $LASTEXITCODE for $($o.number)" }
      Invoke-RestMethod -Method Post -Uri "$Base/api/workroom/print/queue" -Headers $Headers -ContentType "application/json" -Body (@{ id = $o.id } | ConvertTo-Json) -TimeoutSec 20 | Out-Null
      Log "Printed $($o.number) ($($o.fulfillment)) on '$printer'."
    }
  } catch {
    Log "Problem: $($_.Exception.Message). Trying again in $Every seconds."
  }
  Start-Sleep -Seconds $Every
}

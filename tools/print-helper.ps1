# DeVine's print helper: prints every new website order on the counter's Brother,
# on the right paper, with nobody at the screen. Runs on the counter PC.
#
#   Delivery orders, and pickups with a card message
#                   -> the "Order forms" printer entry (bottom tray, the
#                      pre-printed six-panel form, landscape)
#   Other pickups   -> the "Plain paper" printer entry (top tray, portrait)
#
# Every 30 seconds it asks the site which website orders have not printed,
# downloads each one as a PDF, hands it to SumatraPDF to print silently to the
# named printer, then tells the site it printed. A LOCAL LEDGER (printed-local
# .txt in the output folder) remembers what this PC already printed, so if the
# "I printed it" message fails to reach the site, the order is NOT printed
# again on the next pass; the message is retried until it lands. Setup and
# the printer entries: research/printing.md.
#
# Fill in the values below. Keep this file where only staff can read it: it
# holds the workroom PIN.

$Base         = "https://devine.glazedweb.com"
$Pin          = "PUT-THE-STAFF-PIN-HERE"
$FormsPrinter = "Order forms"
$PlainPrinter = "Plain paper"
$Sumatra      = "C:\PrintHelper\SumatraPDF.exe"
$OutDir       = "C:\PrintHelper\printed"
$Every        = 30   # seconds

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Headers = @{ "x-workroom-pin" = $Pin }
$LedgerFile = Join-Path $OutDir "printed-local.txt"

function Log($msg) { Write-Host ("{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg) }

# The ledger: one line per order this PC printed, "id<TAB>acked|pending".
$Ledger = @{}
if (Test-Path $LedgerFile) {
  foreach ($line in Get-Content $LedgerFile) {
    $parts = $line -split "`t"
    if ($parts.Count -ge 2) { $Ledger[$parts[0]] = $parts[1] }
  }
}
function Save-Ledger {
  $lines = $Ledger.GetEnumerator() | ForEach-Object { "{0}`t{1}" -f $_.Key, $_.Value }
  Set-Content -Path $LedgerFile -Value ($lines | Select-Object -Last 2000)
}
function Ack($id) {
  Invoke-RestMethod -Method Post -Uri "$Base/api/workroom/print/queue" -Headers $Headers -ContentType "application/json" `
    -Body (@{ id = $id } | ConvertTo-Json) -TimeoutSec 20 -UseBasicParsing | Out-Null
  $Ledger[$id] = "acked"
  Save-Ledger
}

Log "Print helper up. Forms -> '$FormsPrinter', plain -> '$PlainPrinter'. Ctrl+C stops it."
while ($true) {
  try {
    $q = Invoke-RestMethod -Uri "$Base/api/workroom/print/queue" -Headers $Headers -TimeoutSec 20 -UseBasicParsing
    foreach ($o in $q.orders) {
      if ($Ledger.ContainsKey($o.id)) {
        # Already printed here; only the ack is outstanding.
        if ($Ledger[$o.id] -ne "acked") {
          try { Ack $o.id; Log "Told the site about $($o.number) (printed earlier)." }
          catch { Log "Still could not tell the site about $($o.number): $($_.Exception.Message)" }
        }
        continue
      }
      $pdf = Join-Path $OutDir ("{0}-{1}.pdf" -f $o.number, $o.layout)
      Invoke-WebRequest -Uri "$Base/api/workroom/print/$($o.id)" -Headers $Headers -OutFile $pdf -TimeoutSec 30 -UseBasicParsing
      $printer = if ($o.paper -eq "forms") { $FormsPrinter } else { $PlainPrinter }
      # noscale: the form is drawn on the creases; fit-to-page would move them.
      & $Sumatra -print-to $printer -print-settings "noscale" -silent $pdf
      if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "SumatraPDF exited $LASTEXITCODE for $($o.number)" }
      # Printed. Write that down FIRST, so a failed ack never reprints.
      $Ledger[$o.id] = "pending"
      Save-Ledger
      Log "Printed $($o.number) ($($o.fulfillment)) on '$printer'."
      try { Ack $o.id }
      catch { Log "Printed, but could not tell the site yet ($($_.Exception.Message)); will keep trying." }
    }
  } catch {
    Log "Problem: $($_.Exception.Message). Trying again in $Every seconds."
  }
  Start-Sleep -Seconds $Every
}

# DeVine's print helper: prints every new website order on the counter's Brother,
# on the right paper, with nobody at the screen. Runs on the counter PC.
# OPTIONAL: the board's morning banner does the same job in two clicks.
#
#   Delivery orders, and pickups with a card message
#                   -> the "Six-panel forms (bottom tray)" printer entry (the
#                      pre-printed six-panel form, landscape)
#   Other pickups   -> the "Plain paper (top tray)" printer entry (portrait)
#
# Every 30 seconds it asks the site which website orders have not printed and
# fetches each one through the same door the board's Print buttons use, which
# marks the order printed AS THE PDF LEAVES THE SITE. So a phone and this PC
# can never print the same order twice: whichever asks first gets it, and the
# other is told it is gone. SumatraPDF then prints the PDF silently to the
# named printer. If the printer refuses the job after that, the helper says so
# in its window, loudly, and the order's own Print link on the board reprints
# it. Setup and the printer entries: research/printing.md.
#
# Fill in the values below. Keep this file where only staff can read it: it
# holds the workroom PIN.

$Base         = "https://devine.glazedweb.com"
$Pin          = "PUT-THE-STAFF-PIN-HERE"
$FormsPrinter = "Six-panel forms (bottom tray)"
$PlainPrinter = "Plain paper (top tray)"
$Sumatra      = "C:\PrintHelper\SumatraPDF.exe"
$OutDir       = "C:\PrintHelper\printed"
$Every        = 30   # seconds

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Headers = @{ "x-workroom-pin" = $Pin }

function Log($msg) { Write-Host ("{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg) }
function StatusOf($err) { try { return [int]$err.Exception.Response.StatusCode } catch { return $null } }

Log "Print helper up. Forms -> '$FormsPrinter', plain -> '$PlainPrinter'. Ctrl+C stops it."
$Locked = 0
while ($true) {
  try {
    try {
      $q = Invoke-RestMethod -Uri "$Base/api/workroom/print/queue" -Headers $Headers -TimeoutSec 20 -UseBasicParsing
      $Locked = 0
    } catch {
      # A wrong PIN answers 401; asking again every half minute would only
      # trip the site's lockout. Five in a row and the helper stops.
      if ((StatusOf $_) -eq 401) {
        $Locked += 1
        if ($Locked -ge 5) { Log "The PIN was refused 5 times. Fix `$Pin at the top of this file and start the helper again."; exit 1 }
      }
      throw
    }
    foreach ($o in $q.orders) {
      $pdf = Join-Path $OutDir ("{0}-{1}.pdf" -f $o.number, $o.layout)
      $printer = if ($o.paper -eq "forms") { $FormsPrinter } else { $PlainPrinter }
      # The claim and the download are one request: a 404 means a phone
      # printed it from the board a moment ago, so this PC leaves it alone.
      try {
        Invoke-WebRequest -Uri "$Base/api/workroom/print/queue?paper=$($o.paper)&ids=$($o.id)" -Headers $Headers -OutFile $pdf -TimeoutSec 30 -UseBasicParsing
      } catch {
        if ((StatusOf $_) -eq 404) { Log "$($o.number) was printed from the board a moment ago; leaving it."; continue }
        Log "Could not fetch $($o.number): $($_.Exception.Message). Will try again next pass."
        continue
      }
      # From here the site counts it printed; anything that goes wrong
      # below is said loudly, and the board's Print link is the reprint.
      try {
        # noscale: the form is drawn on the creases; fit-to-page would move
        # them. -Wait: a GUI program returns to PowerShell at once otherwise,
        # before it has printed or failed, and the exit code would be unknowable.
        $proc = Start-Process -FilePath $Sumatra -ArgumentList @("-print-to", "`"$printer`"", "-print-settings", "noscale", "-silent", "`"$pdf`"") -Wait -PassThru -WindowStyle Hidden
        if ($proc.ExitCode -ne 0) { throw "SumatraPDF exited $($proc.ExitCode)" }
        Log "Printed $($o.number) ($($o.fulfillment)) on '$printer'."
      } catch {
        Log "*** $($o.number) DID NOT PRINT: $($_.Exception.Message). The site has it as printed; open it on the board and use its Print link. ***"
      }
    }
  } catch {
    Log "Problem: $($_.Exception.Message). Trying again in $Every seconds."
  }
  Start-Sleep -Seconds $Every
}

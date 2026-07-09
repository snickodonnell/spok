# Permanently add %USERPROFILE%\.cargo\bin to the User PATH if missing.
# Safe to run multiple times.

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"

if (-not (Test-Path $cargoBin)) {
  Write-Error "Cargo bin not found at $cargoBin. Install Rust from https://rustup.rs/"
  exit 1
}

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not $userPath) { $userPath = "" }

$parts = $userPath -split ';' | Where-Object { $_ -and $_.Trim() -ne '' }
$already = $parts | Where-Object { $_.TrimEnd('\') -ieq $cargoBin.TrimEnd('\') }

if ($already) {
  Write-Host "[spok] User PATH already includes: $cargoBin"
} else {
  $newPath = "$cargoBin;$userPath"
  [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
  Write-Host "[spok] Added to User PATH: $cargoBin"
  Write-Host "[spok] Open a new terminal for system-wide PATH to take effect."
}

# Also fix current process
if ($env:Path -notlike "*$cargoBin*") {
  $env:Path = "$cargoBin;$env:Path"
  Write-Host "[spok] Prepended to current session PATH."
}

& "$cargoBin\cargo.exe" --version
& "$cargoBin\rustc.exe" --version

param(
  [Parameter(Mandatory = $true)][string]$PfxPath,
  [Parameter(Mandatory = $true)][string]$Executable,
  [string]$TimestampServer = "http://timestamp.digicert.com",
  [string]$PasswordEnvironmentVariable = "BODY_PFX_PASSWORD"
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $PfxPath)) { throw "PFX not found: $PfxPath" }
if (-not (Test-Path -LiteralPath $Executable)) { throw "Executable not found: $Executable" }

$passwordText = [Environment]::GetEnvironmentVariable($PasswordEnvironmentVariable)
if ([string]::IsNullOrWhiteSpace($passwordText) -and $PasswordEnvironmentVariable -eq "BODY_PFX_PASSWORD") {
  $passwordText = [Environment]::GetEnvironmentVariable("BODYBRAIN_PFX_PASSWORD")
}
if ([string]::IsNullOrWhiteSpace($passwordText)) { throw "$PasswordEnvironmentVariable is required" }
$password = ConvertTo-SecureString $passwordText -AsPlainText -Force
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($PfxPath, $password)
$result = Set-AuthenticodeSignature -LiteralPath $Executable -Certificate $cert -HashAlgorithm SHA256 -TimestampServer $TimestampServer
if ($result.Status -ne "Valid") { throw "Authenticode signing failed: $($result.Status) $($result.StatusMessage)" }
Write-Output "Authenticode signature: Valid"

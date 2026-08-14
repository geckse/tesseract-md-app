param(
  [Parameter(Mandatory = $true)]
  [string]$ArtifactDirectory,
  [switch]$RequireSignature,
  [string]$ExpectedPublisher,
  [switch]$InstallNsis
)

$ErrorActionPreference = 'Stop'

function Get-SingleFile {
  param(
    [string]$Directory,
    [string]$Filter,
    [string]$Description
  )

  $files = @(Get-ChildItem -LiteralPath $Directory -File -Filter $Filter)
  if ($files.Count -ne 1) {
    throw "Expected exactly one $Description in $Directory; found $($files.Count)."
  }
  return $files[0]
}

function Get-PortableExecutableMachine {
  param([System.IO.FileInfo]$File)

  $stream = [System.IO.File]::OpenRead($File.FullName)
  try {
    $reader = [System.IO.BinaryReader]::new($stream)
    if ($reader.ReadUInt16() -ne 0x5A4D) {
      throw "$($File.FullName) is not a PE file (missing MZ header)."
    }
    $stream.Position = 0x3C
    $peOffset = $reader.ReadUInt32()
    $stream.Position = $peOffset
    if ($reader.ReadUInt32() -ne 0x00004550) {
      throw "$($File.FullName) is not a PE file (missing PE header)."
    }
    return $reader.ReadUInt16()
  }
  finally {
    $stream.Dispose()
  }
}

function Assert-PortableExecutable {
  param([System.IO.FileInfo]$File)

  $null = Get-PortableExecutableMachine $File
}

function Assert-X64PortableExecutable {
  param([System.IO.FileInfo]$File)

  $machine = Get-PortableExecutableMachine $File
  if ($machine -ne 0x8664) {
    throw ("Expected x64 PE machine 0x8664 for {0}; got 0x{1:X4}." -f $File.FullName, $machine)
  }
}

function Assert-AuthenticodeSignature {
  param([System.IO.FileInfo]$File)

  $signature = Get-AuthenticodeSignature -FilePath $File.FullName
  if ($signature.Status -ne 'Valid') {
    throw "Invalid Authenticode signature on $($File.FullName): $($signature.StatusMessage)"
  }
  if ($ExpectedPublisher) {
    $expectedCommonName = "CN=$ExpectedPublisher"
    if ($signature.SignerCertificate.Subject -notmatch [regex]::Escape($expectedCommonName)) {
      throw (
        "Unexpected signer on {0}: expected {1}, got {2}." -f
        $File.FullName,
        $expectedCommonName,
        $signature.SignerCertificate.Subject
      )
    }
  }
}

function Start-AppSmoke {
  param(
    [System.IO.FileInfo]$Executable,
    [string]$Label
  )

  $profile = Join-Path $env:RUNNER_TEMP ("tesseract-profile-" + [guid]::NewGuid())
  $stdout = Join-Path $env:RUNNER_TEMP ("tesseract-stdout-" + [guid]::NewGuid() + '.log')
  $stderr = Join-Path $env:RUNNER_TEMP ("tesseract-stderr-" + [guid]::NewGuid() + '.log')
  New-Item -ItemType Directory -Path $profile -Force | Out-Null

  $process = Start-Process `
    -FilePath $Executable.FullName `
    -ArgumentList "--user-data-dir=$profile" `
    -PassThru `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr
  try {
    Start-Sleep -Seconds 20
    $process.Refresh()
    if ($process.HasExited) {
      $output = (Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue) +
        (Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue)
      throw "$Label exited during launch smoke with code $($process.ExitCode).`n$output"
    }
  }
  finally {
    if (-not $process.HasExited) {
      & taskkill.exe /PID $process.Id /T /F | Out-Null
      $process.WaitForExit(10000) | Out-Null
    }
  }
}

$artifactRoot = (Resolve-Path -LiteralPath $ArtifactDirectory).Path
$installer = Get-SingleFile $artifactRoot '*.exe' 'NSIS installer'
$archive = Get-SingleFile $artifactRoot '*.zip' 'Windows ZIP package'
$null = Get-SingleFile $artifactRoot 'latest.yml' 'Windows update metadata file'
$blockmaps = @(Get-ChildItem -LiteralPath $artifactRoot -File -Filter '*.blockmap')
if ($blockmaps.Count -lt 1) {
  throw "Missing Windows update blockmap in $artifactRoot."
}

# NSIS intentionally uses a 32-bit bootstrapper even for an x64-only payload.
# The extracted application and every native module are checked as x64 below.
Assert-PortableExecutable $installer
if ($RequireSignature) {
  if (-not $ExpectedPublisher) {
    throw 'ExpectedPublisher is required when RequireSignature is set.'
  }
  Assert-AuthenticodeSignature $installer
}

$extractRoot = Join-Path $env:RUNNER_TEMP ("tesseract-zip-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
Expand-Archive -LiteralPath $archive.FullName -DestinationPath $extractRoot

$executables = @(Get-ChildItem -LiteralPath $extractRoot -Recurse -File -Filter 'Tesseract.exe')
if ($executables.Count -ne 1) {
  throw "Expected exactly one Tesseract.exe in $($archive.Name); found $($executables.Count)."
}
$application = $executables[0]
$applicationRoot = $application.Directory.FullName
Assert-X64PortableExecutable $application

$skillsManifest = Join-Path $applicationRoot 'resources/tesseract-skills/.claude-plugin/plugin.json'
if (-not (Test-Path -LiteralPath $skillsManifest -PathType Leaf)) {
  throw "Packaged Tesseract skills manifest is missing: $skillsManifest"
}

$nativeModules = @(Get-ChildItem -LiteralPath $applicationRoot -Recurse -File -Filter '*.node')
if ($nativeModules.Count -eq 0) {
  throw 'Packaged app contains no native Node modules.'
}

# node-pty ships prebuilds for multiple operating systems in one package. Only
# the win32-x64 binaries are loadable by this artifact and must be x64 PE files.
$nodePtyX64Modules = @(
  $nativeModules | Where-Object FullName -Match '[\\/]node-pty[\\/].*[\\/]win32-x64[\\/]'
)
if ($nodePtyX64Modules.Count -eq 0) {
  throw 'Packaged app is missing the win32-x64 node-pty native module.'
}
$sharpX64Modules = @(
  $nativeModules | Where-Object FullName -Match '[\\/]sharp-win32-x64[\\/]'
)
if ($sharpX64Modules.Count -eq 0) {
  throw 'Packaged app is missing the win32-x64 sharp native module.'
}
foreach ($module in @($nodePtyX64Modules + $sharpX64Modules)) {
  Assert-X64PortableExecutable $module
}

if ($RequireSignature) {
  Assert-AuthenticodeSignature $application
}
Start-AppSmoke $application 'ZIP application'

if ($InstallNsis) {
  $installRoot = Join-Path $env:RUNNER_TEMP ("tesseract-installed-" + [guid]::NewGuid())
  $installProcess = Start-Process `
    -FilePath $installer.FullName `
    -ArgumentList @('/S', "/D=$installRoot") `
    -PassThru `
    -Wait
  if ($installProcess.ExitCode -ne 0) {
    throw "NSIS installer failed with exit code $($installProcess.ExitCode)."
  }

  $installedExecutables = @(
    Get-ChildItem -LiteralPath $installRoot -Recurse -File -Filter 'Tesseract.exe'
  )
  if ($installedExecutables.Count -ne 1) {
    throw "Expected one installed Tesseract.exe; found $($installedExecutables.Count)."
  }
  $installedApplication = $installedExecutables[0]
  Assert-X64PortableExecutable $installedApplication
  if ($RequireSignature) {
    Assert-AuthenticodeSignature $installedApplication
  }
  Start-AppSmoke $installedApplication 'Installed NSIS application'
}

Write-Output "Windows packages verified: $($installer.Name), $($archive.Name)"

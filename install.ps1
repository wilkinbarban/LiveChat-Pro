# ============================================================
# LiveChat Pro — Windows Installer Script
# ============================================================

$ErrorActionPreference = "Stop"

# Clean UI Headers
Clear-Host
Write-Host "┌──────────────────────────────────────────────────────────┐" -ForegroundColor Cyan
Write-Host "│             LiveChat Pro — Windows Installer             │" -ForegroundColor Cyan -Bold
Write-Host "└──────────────────────────────────────────────────────────┘" -ForegroundColor Cyan
Write-Host ""

# Functions to check dependencies
function Check-Node {
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCmd) {
        $versionStr = & node -v
        if ($versionStr -match 'v(\d+)\.') {
            $major = [int]$Matches[1]
            if ($major -ge 24) {
                return $true
            }
        }
    }
    return $false
}

# Check administrative privileges and node installation
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$nodeInstalled = Check-Node

# Administrative privileges are only required if Node.js needs to be installed
if (-not $nodeInstalled -and -not $isAdmin) {
    Write-Host "[ℹ] Node.js >= 24 is not installed. Administrative privileges are required for installation." -ForegroundColor Yellow
    Write-Host "[ℹ] Requesting elevation to run as Administrator..." -ForegroundColor Blue
    Start-Sleep -Seconds 1
    try {
        Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
        Exit 0
    } catch {
        Write-Host "[✗] Administrative elevation was denied or failed. Please run this script in an Elevated PowerShell prompt (Run as Administrator)." -ForegroundColor Red
        Exit 1
    }
}

# Initialize temporary log path to capture early installer tasks
$LogPath = Join-Path $env:TEMP "livechat_install.log"
"=== Instalacion ===" | Out-File -FilePath $LogPath
"--- LiveChat Pro Windows installation log started at $(Get-Date) ---" | Out-File -FilePath $LogPath -Append

# Function to run a task with a spinner
function Run-TaskWithSpinner {
    param (
        [string]$TaskName,
        [scriptblock]$ScriptBlock
    )
    
    # Write command header to log
    "=== STARTING: $TaskName ===" | Out-File -FilePath $LogPath -Append
    
    # Start job
    $job = Start-Job -ScriptBlock $ScriptBlock
    
    $spin = @('-', '\', '|', '/')
    $i = 0
    while ($job.State -eq 'Running') {
        $char = $spin[$i]
        Write-Host -NoNewline "`r[$char] $TaskName..." -ForegroundColor Yellow
        $i = ($i + 1) % 4
        Start-Sleep -Milliseconds 150
    }
    
    # Temporarily set ErrorActionPreference to SilentlyContinue during Receive-Job
    # to prevent native stderr warnings (like npm deprecations) from crashing the script
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $result = Receive-Job -Job $job
    $ErrorActionPreference = $oldPreference
    
    $jobState = $job.State
    Remove-Job $job
    
    # Log results
    $result | Out-File -FilePath $LogPath -Append
    
    if ($jobState -eq 'Completed') {
        Write-Host "`r[✓] $TaskName completed successfully!" -ForegroundColor Green
        "=== SUCCESS: $TaskName ===" | Out-File -FilePath $LogPath -Append
        return $true
    } else {
        Write-Host "`r[✗] $TaskName failed! Check install.log for details." -ForegroundColor Red
        "=== FAILED: $TaskName ===" | Out-File -FilePath $LogPath -Append
        return $false
    }
}

# Define Paths
$DesktopPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
$TargetDir = Join-Path $DesktopPath "LiveChat-Pro"
$TempZip = Join-Path $env:TEMP "LiveChat-Pro.zip"
$ExtractedTempDir = Join-Path $DesktopPath "LiveChat-Pro-main"

# Rename existing folder if found on Desktop to prevent overwriting
if (Test-Path $TargetDir) {
    Write-Host "[ℹ] Existing LiveChat-Pro directory found on Desktop. Renaming to avoid overwriting..." -ForegroundColor Yellow
    $BaseBackupName = Join-Path $DesktopPath "LiveChat-Pro_Backup"
    $BackupDir = $BaseBackupName
    $counter = 1
    while (Test-Path $BackupDir) {
        $BackupDir = "${BaseBackupName}_$counter"
        $counter++
    }
    Rename-Item -Path $TargetDir -NewName (Split-Path $BackupDir -Leaf)
    Write-Host "[✓] Renamed existing project folder to: $(Split-Path $BackupDir -Leaf)" -ForegroundColor Green
}

# Clean up any leftover temp extraction folder
if (Test-Path $ExtractedTempDir) {
    Remove-Item -Path $ExtractedTempDir -Recurse -Force
}

# Download ZIP from GitHub repository
$zipUrl = "https://github.com/wilkinbarban/LiveChat-Pro/archive/refs/heads/main.zip"
$downloadBlock = [scriptblock]::Create("Invoke-WebRequest -Uri '$zipUrl' -OutFile '$TempZip'")
$success = Run-TaskWithSpinner "Downloading repository ZIP to Desktop" $downloadBlock
if (-not $success) {
    Write-Host "[✗] Failed to download ZIP. Aborting." -ForegroundColor Red
    Exit 1
}

# Extract ZIP archive directly to user Desktop
$extractBlock = [scriptblock]::Create("Expand-Archive -Path '$TempZip' -DestinationPath '$DesktopPath' -Force")
$success = Run-TaskWithSpinner "Extracting repository ZIP to Desktop" $extractBlock
if (-not $success) {
    Write-Host "[✗] Failed to extract ZIP. Aborting." -ForegroundColor Red
    Exit 1
}

# Clean up temporary ZIP file
if (Test-Path $TempZip) {
    Remove-Item -Path $TempZip -Force
}

# Rename the extracted folder 'LiveChat-Pro-main' to 'LiveChat-Pro'
if (Test-Path $ExtractedTempDir) {
    Rename-Item -Path $ExtractedTempDir -NewName "LiveChat-Pro"
} else {
    Write-Host "[✗] Extracted folder was not found. Expected: $ExtractedTempDir" -ForegroundColor Red
    Exit 1
}

# Change location to the new project directory on the Desktop
Set-Location $TargetDir

# Relocate the install log file to the newly created project folder
Move-Item -Path $LogPath -Destination (Join-Path $TargetDir "install.log") -Force
$LogPath = Join-Path $TargetDir "install.log"

# 1. Verify/Install Node.js >= 24
if (Check-Node) {
    Write-Host "[✓] Node.js >= 24 is already installed ($(node -v))" -ForegroundColor Green
} else {
    Write-Host "[ℹ] Node.js >= 24 is not installed. Preparing installation..." -ForegroundColor Yellow
    
    $wingetExists = Get-Command winget -ErrorAction SilentlyContinue
    if ($wingetExists) {
        $installBlock = {
            winget install --id OpenJS.NodeJS --source winget --accept-package-agreements --accept-source-agreements --silent
        }
        $success = Run-TaskWithSpinner "Installing Node.js via Winget" $installBlock
    } else {
        # Fallback to downloading MSI
        $msiUrl = "https://nodejs.org/dist/v24.1.0/node-v24.1.0-x64.msi"
        $msiPath = "$env:TEMP\node-v24.msi"
        
        $downloadBlock = [scriptblock]::Create("Invoke-WebRequest -Uri '$msiUrl' -OutFile '$msiPath'")
        Run-TaskWithSpinner "Downloading Node.js Installer" $downloadBlock
        
        $installBlock = [scriptblock]::Create("Start-Process msiexec.exe -ArgumentList '/i `"$msiPath`" /qn /norestart' -Wait")
        $success = Run-TaskWithSpinner "Installing Node.js MSI silently" $installBlock
    }
    
    if (-not $success) {
        Write-Host "[✗] Node.js installation failed. Aborting." -ForegroundColor Red
        Exit 1
    }
    
    # Reload environment path to pick up new node command
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

# 2. Install Project Dependencies (npm install)
Write-Host "[ℹ] Installing project dependencies..." -ForegroundColor Yellow
$currentPath = Get-Location
$npmInstallBlock = [scriptblock]::Create("Set-Location '$currentPath'; npm install --no-fund --no-audit; if (`$LASTEXITCODE -ne 0) { throw 'npm install failed' }")
$success = Run-TaskWithSpinner "Running npm install" $npmInstallBlock

if (-not $success) {
    Write-Host "[✗] npm install failed. Please check install.log." -ForegroundColor Red
    Exit 1
}

# 3. Clean up env
Write-Host ""
Write-Host "[✓] Dependencies verification completed successfully!" -ForegroundColor Green
Write-Host "[ℹ] Launching environment configuration wizard..." -ForegroundColor Blue
Write-Host ""

# Run setup.js
& node setup.js


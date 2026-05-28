# ============================================================
# LiveChat Pro — Windows Installer Script
# ============================================================

$ErrorActionPreference = "Stop"

if (-not (Test-Path "setup.js")) {
    Write-Host "[ℹ] LiveChat Pro directory not detected. Cloning repository..." -ForegroundColor Blue
    $gitExists = Get-Command git -ErrorAction SilentlyContinue
    if (-not $gitExists) {
        Write-Host "[✗] git is not installed. Please install git or run the script from the project root directory." -ForegroundColor Red
        Exit 1
    }
    git clone https://github.com/wilkinbarban/LiveChat-Pro.git
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[✗] Failed to clone repository." -ForegroundColor Red
        Exit 1
    }
    Set-Location "LiveChat-Pro"
}

# Clear or create install.log
"--- LiveChat Pro Windows installation log started at $(Get-Date) ---" | Out-File -FilePath "install.log"

# Clean UI Headers
Clear-Host
Write-Host "┌──────────────────────────────────────────────────────────┐" -ForegroundColor Cyan
Write-Host "│             LiveChat Pro — Windows Installer             │" -ForegroundColor Cyan -Bold
Write-Host "└──────────────────────────────────────────────────────────┘" -ForegroundColor Cyan
Write-Host ""

# Check administrative privileges
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[✗] Administrative privileges are required. Please run this script in an Elevated PowerShell prompt (Run as Administrator)." -ForegroundColor Red
    Exit 1
}

# Function to run a task with a spinner
function Run-TaskWithSpinner {
    param (
        [string]$TaskName,
        [scriptblock]$ScriptBlock
    )
    
    # Write command header to log
    "=== STARTING: $TaskName ===" | Out-File -FilePath "install.log" -Append
    
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
    
    $result = Receive-Job -Job $job
    $jobState = $job.State
    Remove-Job $job
    
    # Log results
    $result | Out-File -FilePath "install.log" -Append
    
    if ($jobState -eq 'Completed') {
        Write-Host "`r[✓] $TaskName completed successfully!" -ForegroundColor Green
        "=== SUCCESS: $TaskName ===" | Out-File -FilePath "install.log" -Append
        return $true
    } else {
        Write-Host "`r[✗] $TaskName failed! Check install.log for details." -ForegroundColor Red
        "=== FAILED: $TaskName ===" | Out-File -FilePath "install.log" -Append
        return $false
    }
}

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
$npmInstallBlock = [scriptblock]::Create("Set-Location '$currentPath'; npm install --no-fund --no-audit")
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

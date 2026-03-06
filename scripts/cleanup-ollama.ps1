# Ollama Cleanup Script for Windows
# 
# This script helps remove the local Ollama installation and models
# to free up disk space after switching to Groq API.
#
# Run from PowerShell as Administrator if needed.

Write-Host "╔════════════════════════════════════════════════════════════╗"
Write-Host "║              OLLAMA CLEANUP SCRIPT                         ║"
Write-Host "╠════════════════════════════════════════════════════════════╣"
Write-Host "║  This script will help remove Ollama and its models.       ║"
Write-Host "╚════════════════════════════════════════════════════════════╝"
Write-Host ""

# Check if Ollama is installed
$ollamaPath = Get-Command ollama -ErrorAction SilentlyContinue

if (-not $ollamaPath) {
    Write-Host "ℹ️  Ollama is not installed or not in PATH."
    Write-Host ""
} else {
    Write-Host "1. Checking installed Ollama models..."
    Write-Host ""
    
    try {
        $models = ollama list 2>$null
        Write-Host $models
        Write-Host ""
    } catch {
        Write-Host "   Could not list models."
    }
    
    Write-Host "2. To remove a specific model, run:"
    Write-Host "   ollama rm <model-name>"
    Write-Host ""
    Write-Host "   Example:"
    Write-Host "   ollama rm deepseek-coder-v2:16b"
    Write-Host ""
}

# Check for Ollama service
Write-Host "3. Checking Ollama service status..."
$service = Get-Service -Name "Ollama" -ErrorAction SilentlyContinue

if ($service) {
    Write-Host "   Service found: $($service.Status)"
    Write-Host ""
    Write-Host "   To stop the service:"
    Write-Host "   Stop-Service -Name 'Ollama' -Force"
    Write-Host ""
    Write-Host "   To disable the service:"
    Write-Host "   Set-Service -Name 'Ollama' -StartupType Disabled"
    Write-Host ""
} else {
    Write-Host "   No Ollama service found."
    Write-Host ""
}

# Check model directory
$modelDir = Join-Path $env:USERPROFILE ".ollama\models"
Write-Host "4. Checking model directory..."
Write-Host "   Path: $modelDir"

if (Test-Path $modelDir) {
    $size = (Get-ChildItem $modelDir -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    $sizeGB = [math]::Round($size / 1GB, 2)
    Write-Host "   Size: $sizeGB GB"
    Write-Host ""
    Write-Host "   To remove all models manually:"
    Write-Host "   Remove-Item -Recurse -Force `"$modelDir`""
    Write-Host ""
} else {
    Write-Host "   Directory does not exist."
    Write-Host ""
}

Write-Host "╔════════════════════════════════════════════════════════════╗"
Write-Host "║                    MANUAL STEPS                            ║"
Write-Host "╠════════════════════════════════════════════════════════════╣"
Write-Host "║  1. Stop Ollama:        ollama stop                        ║"
Write-Host "║  2. Remove model:       ollama rm <model-name>             ║"
Write-Host "║  3. Uninstall Ollama:   winget uninstall Ollama.Ollama     ║"
Write-Host "║  4. Remove cache:       rm -r ~/.ollama                    ║"
Write-Host "╚════════════════════════════════════════════════════════════╝"

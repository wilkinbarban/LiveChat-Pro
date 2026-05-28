#!/usr/bin/env bash
# ============================================================
# LiveChat Pro — Linux Installer Script
# ============================================================

set -o pipefail

# Visual styling colors
RED='\e[31m'
GREEN='\e[32m'
YELLOW='\e[33m'
BLUE='\e[34m'
CYAN='\e[36m'
BOLD='\e[1m'
RESET='\e[0m'

# Check if setup.js exists. If not, we clone the repo and enter it
if [ ! -f "setup.js" ]; then
    echo -e "${BLUE}[ℹ]${RESET} LiveChat Pro directory not detected. Cloning repository..."
    if ! command -v git >/dev/null 2>&1; then
        echo -e "${RED}[✗] git is not installed. Please install git or run the script from the project root directory.${RESET}"
        exit 1
    fi
    git clone https://github.com/wilkinbarban/LiveChat-Pro.git || { echo -e "${RED}[✗] Failed to clone repository.${RESET}"; exit 1; }
    cd LiveChat-Pro || exit 1
fi

# Clear log file on startup
echo "--- LiveChat Pro installation log started at $(date) ---" > install.log

# Show header
echo -e "${CYAN}┌──────────────────────────────────────────────────────────┐${RESET}"
echo -e "${CYAN}│${BOLD}             LiveChat Pro — Linux Installer               ${CYAN}│${RESET}"
echo -e "${CYAN}└──────────────────────────────────────────────────────────┘${RESET}"
echo -e ""

# Function to run a task with a spinner
run_task() {
    local task_name="$1"
    local cmd="$2"
    
    # Write command header to log
    echo -e "\n=== STARTING: $task_name ===" >> install.log
    echo -e "Command: $cmd\n" >> install.log
    
    # Run command in background, redirecting output to log
    eval "$cmd" >> install.log 2>&1 &
    local pid=$!
    
    local spin='-\|/'
    local i=0
    while kill -0 $pid 2>/dev/null; do
        i=$(( (i+1) % 4 ))
        echo -ne "\r${YELLOW}[${spin:$i:1}]${RESET} $task_name..."
        sleep 0.1
    done
    
    wait $pid
    local status=$?
    
    if [ $status -eq 0 ]; then
        echo -e "\r${GREEN}[✓]${RESET} $task_name completed successfully!"
        echo -e "=== SUCCESS: $task_name ===" >> install.log
        return 0
    else
        echo -e "\r${RED}[✗]${RESET} $task_name failed! Check install.log for details."
        echo -e "=== FAILED (Exit Code $status): $task_name ===" >> install.log
        return 1
    fi
}

# 1. Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_ID=$(echo "$ID" | tr '[:upper:]' '[:lower:]')
    OS_NAME="$PRETTY_NAME"
else
    OS_ID=$(uname -s | tr '[:upper:]' '[:lower:]')
    OS_NAME="Generic Unix ($OS_ID)"
fi

echo -e "${BLUE}[ℹ]${RESET} Detected System: ${BOLD}$OS_NAME${RESET}"

# 2. Check Sudo Access
if [ "$EUID" -ne 0 ]; then
    echo -e "${YELLOW}[ℹ]${RESET} Sudo access is required to install dependencies."
    sudo -v || { echo -e "${RED}[✗]${RESET} Sudo validation failed. Exiting."; exit 1; }
    # Keep sudo alive
    while true; do sudo -n true; sleep 60; kill -0 "$$" || exit; done 2>/dev/null &
fi

# 3. Check for existing packages
check_node() {
    if command -v node >/dev/null 2>&1; then
        local version=$(node -v | cut -d'v' -f2)
        local major=$(echo "$version" | cut -d'.' -f1)
        if [ "$major" -ge 24 ]; then
            return 0
        fi
    fi
    return 1
}

check_docker() {
    if command -v docker >/dev/null 2>&1; then
        if docker compose version >/dev/null 2>&1; then
            return 0
        fi
    fi
    return 1
}

# 4. Formulate Installation Commands based on Distro
NODE_CMD=""
DOCKER_CMD=""
START_DOCKER_CMD=""

case "$OS_ID" in
    ubuntu|debian)
        NODE_CMD="sudo apt-get remove -y nodejs npm || true; sudo apt-get update; sudo apt-get install -y ca-certificates curl gnupg; curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -; sudo apt-get install -y nodejs"
        
        DOCKER_CMD="sudo apt-get update; sudo apt-get install -y ca-certificates curl gnupg; sudo install -m 0755 -d /etc/apt/keyrings; curl -fsSL https://download.docker.com/linux/$OS_ID/gpg | sudo gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg; sudo chmod a+r /etc/apt/keyrings/docker.gpg; echo \"deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$OS_ID \$(. /etc/os-release && echo \"\$VERSION_CODENAME\") stable\" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null; sudo apt-get update; sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"
        ;;
        
    fedora)
        NODE_CMD="sudo dnf -y remove nodejs npm || true; sudo dnf -y install ca-certificates curl; curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo -E bash -; sudo dnf -y install nodejs"
        
        DOCKER_CMD="sudo dnf -y install dnf-plugins-core; sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo; sudo dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"
        ;;
        
    centos|rhel|rocky|almalinux)
        PKG_MGR="dnf"
        command -v dnf >/dev/null 2>&1 || PKG_MGR="yum"
        
        NODE_CMD="sudo $PKG_MGR -y remove nodejs npm || true; sudo $PKG_MGR -y module reset nodejs || true; sudo $PKG_MGR -y install ca-certificates curl; curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo -E bash -; sudo $PKG_MGR -y install nodejs"
        
        DOCKER_CMD="sudo $PKG_MGR -y install yum-utils; sudo $PKG_MGR-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo; sudo $PKG_MGR -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"
        ;;
        
    arch)
        NODE_CMD="sudo pacman -Sy --noconfirm nodejs npm"
        DOCKER_CMD="sudo pacman -Sy --noconfirm docker docker-compose"
        ;;
        
    alpine)
        NODE_CMD="sudo apk add --no-cache nodejs npm"
        DOCKER_CMD="sudo apk add --no-cache docker docker-cli-compose"
        ;;
        
    *)
        # Default or fallback
        if [[ "$ID_LIKE" == *"debian"* || "$ID_LIKE" == *"ubuntu"* ]]; then
            NODE_CMD="sudo apt-get remove -y nodejs npm || true; sudo apt-get update; sudo apt-get install -y ca-certificates curl gnupg; curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -; sudo apt-get install -y nodejs"
            DOCKER_CMD="sudo apt-get update && sudo apt-get install -y docker.io docker-compose"
        elif [[ "$ID_LIKE" == *"rhel"* || "$ID_LIKE" == *"fedora"* ]]; then
            NODE_CMD="sudo dnf -y remove nodejs npm || true; curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo -E bash -; sudo dnf -y install nodejs"
            DOCKER_CMD="sudo dnf -y install docker docker-compose"
        else
            echo -e "${RED}[✗] Unsupported Linux distribution ($OS_ID / $ID_LIKE). Please install Node.js >= 24 and Docker manually.${RESET}"
            exit 1
        fi
        ;;
esac

# Start Docker daemon command
if command -v systemctl >/dev/null 2>&1; then
    START_DOCKER_CMD="sudo systemctl enable --now docker"
elif command -v rc-service >/dev/null 2>&1; then
    START_DOCKER_CMD="sudo rc-update add docker default || true; sudo rc-service docker start"
else
    START_DOCKER_CMD="sudo service docker start"
fi

# 5. Install Node.js if needed
if check_node; then
    echo -e "${GREEN}[✓]${RESET} Node.js >= 24 is already installed ($(node -v))"
else
    echo -e "${YELLOW}[ℹ]${RESET} Node.js >= 24 is not installed. Preparing installation..."
    run_task "Installing Node.js 24 & npm" "$NODE_CMD" || { echo -e "${RED}[✗] Node.js installation failed. Aborting.${RESET}"; exit 1; }
fi

# 6. Install Docker if needed
if check_docker; then
    echo -e "${GREEN}[✓]${RESET} Docker & Docker Compose plugin are already installed."
else
    echo -e "${YELLOW}[ℹ]${RESET} Docker & Docker Compose are not installed. Preparing installation..."
    run_task "Installing Docker Engine & Compose" "$DOCKER_CMD" || { echo -e "${RED}[✗] Docker installation failed. Aborting.${RESET}"; exit 1; }
fi

# 7. Start/Enable Docker service
run_task "Starting Docker Service" "$START_DOCKER_CMD" || { echo -e "${RED}[✗] Failed to start Docker. Setup will continue but Docker launch might fail.${RESET}"; }

# 8. Check Docker info
run_task "Verifying Docker Daemon" "sudo docker info" || { echo -e "${RED}[✗] Docker daemon is not responding. Ensure it is running.${RESET}"; }

# 9. Clean package managers (best effort)
if command -v apt-get >/dev/null 2>&1; then
    run_task "Cleaning APT cache" "sudo apt-get autoremove -y && sudo apt-get autoclean -y"
elif command -v dnf >/dev/null 2>&1; then
    run_task "Cleaning DNF cache" "sudo dnf clean all"
fi

# 10. Run setup.js for Env configuration
echo -e "\n${GREEN}[✓] Dependencies verification completed successfully!${RESET}"
echo -e "${BLUE}[ℹ] Launching environment configuration wizard...${RESET}\n"

node setup.js

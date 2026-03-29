#!/bin/bash
# 珂溪财务分析系统 - 服务器部署脚本
# 适用于 Ubuntu 22.04 / Debian

set -e

echo "=== 珂溪财务分析系统部署脚本 ==="
echo ""

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 检查是否为 root
if [ "$EUID" -ne 0 ]; then
    echo "请使用 sudo 运行此脚本"
    exit 1
fi

# 1. 更新系统
echo -e "${YELLOW}[1/7] 更新系统包...${NC}"
apt update && apt upgrade -y

# 2. 安装 Node.js 20.x
echo -e "${YELLOW}[2/7] 安装 Node.js...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi
node --version && npm --version

# 3. 安装 Nginx
echo -e "${YELLOW}[3/7] 安装 Nginx...${NC}"
if ! command -v nginx &> /dev/null; then
    apt install -y nginx
fi

# 4. 安装 PM2
echo -e "${YELLOW}[4/7] 安装 PM2...${NC}"
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
fi

# 5. 创建部署目录
echo -e "${YELLOW}[5/7] 创建部署目录...${NC}"
mkdir -p /var/www/kexi
mkdir -p /var/log/kexi

# 6. 配置 Nginx
echo -e "${YELLOW}[6/7] 配置 Nginx...${NC}"
cp -f ./deploy/nginx.conf /etc/nginx/sites-available/kexi
ln -sf /etc/nginx/sites-available/kexi /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

# 7. 配置防火墙
echo -e "${YELLOW}[7/7] 配置防火墙...${NC}"
if command -v ufw &> /dev/null; then
    ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw --force enable
fi

echo ""
echo -e "${GREEN}=== 服务器环境配置完成 ===${NC}"
echo ""
echo "接下来请手动执行以下步骤："
echo "1. 克隆代码: git clone https://github.com/lux888093-hash/kexi.git /opt/kexi"
echo "2. 运行应用部署: cd /opt/kexi && ./deploy/deploy-app.sh"
echo ""
echo "服务器 IP: $(curl -s ifconfig.me)"

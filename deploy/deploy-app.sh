#!/bin/bash
# 珂溪财务分析系统 - 应用部署脚本

set -e

echo "=== 珂溪财务分析系统 - 应用部署 ==="
echo ""

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 项目路径
APP_DIR="/opt/kexi"
BACKEND_DIR="$APP_DIR/kexi-backend"
FRONTEND_DIR="$APP_DIR/kexi-frontend"

# 1. 后端部署
echo -e "${YELLOW}[1/3] 部署后端...${NC}"
cd "$BACKEND_DIR"
npm install --production

# 创建生产环境变量
if [ ! -f "$BACKEND_DIR/.env" ]; then
    cp "$BACKEND_DIR/.env.production" "$BACKEND_DIR/.env" 2>/dev/null || true
    cat > "$BACKEND_DIR/.env" << EOF
PORT=3101
NODE_ENV=production
EOF
fi

# 停止旧进程
pm2 delete kexi-backend 2>/dev/null || true

# 启动后端
pm2 start server.js --name kexi-backend --cwd "$BACKEND_DIR"
pm2 save

# 2. 前端构建
echo -e "${YELLOW}[2/3] 构建前端...${NC}"
cd "$FRONTEND_DIR"
npm install
npm run build

# 3. 部署前端到 Nginx
echo -e "${YELLOW}[3/3] 部署前端到 Nginx...${NC}"
rm -rf /var/www/kexi/*
cp -r dist/* /var/www/kexi/
chown -R www-data:www-data /var/www/kexi

echo ""
echo -e "${GREEN}=== 部署完成 ===${NC}"
echo ""
echo "后端状态:"
pm2 status kexi-backend
echo ""
echo "Nginx 状态:"
systemctl status nginx --no-pager | head -3
echo ""
echo "访问地址: http://$(curl -s ifconfig.me)"

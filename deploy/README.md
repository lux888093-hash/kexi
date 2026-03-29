# 珂溪财务分析系统 - 部署指南

## 国内用户访问部署方案

---

## 第一步：购买云服务器

推荐选择以下任一：

| 提供商 | 推荐配置 | 价格 | 购买链接 |
|--------|----------|------|----------|
| 阿里云 | 2核2G | ~¥60-100/年 | [轻量应用服务器](https://www.aliyun.com/product/swas) |
| 腾讯云 | 2核2G | ~¥60-100/年 | [轻量应用服务器](https://cloud.tencent.com/product/lighthouse) |

**系统选择**：Ubuntu 22.04 / 22.10

---

## 第二步：本地推送代码

```bash
# 确保代码已推送到 GitHub
git add .
git commit -m "准备部署"
git push origin main
```

---

## 第三步：服务器初始化

### 3.1 登录服务器

```bash
# SSH 方式（推荐使用密码登录）
ssh root@your_server_ip

# 或使用腾讯云/阿里云的网页终端
```

### 3.2 下载并运行环境配置脚本

```bash
# 克隆代码
git clone https://github.com/lux888093-hash/kexi.git /opt/kexi
cd /opt/kexi

# 给脚本执行权限
chmod +x deploy/*.sh

# 运行服务器环境配置
sudo bash deploy/server-setup.sh
```

---

## 第四步：部署应用

```bash
# 在服务器上运行
cd /opt/kexi
sudo bash deploy/deploy-app.sh
```

---

## 第五步：验证部署

```bash
# 检查后端状态
pm2 status
pm2 logs kexi-backend

# 检查 Nginx 状态
systemctl status nginx

# 查看服务器 IP
curl ifconfig.me
```

在浏览器访问：`http://your_server_ip`

---

## 第六步：配置域名（可选）

### 6.1 购买域名
- 阿里云：[域名注册](https://wanwang.aliyun.com/)
- 腾讯云：[域名注册](https://dnspod.cloud.tencent.com/)

### 6.2 DNS 解析
添加 A 记录：
| 主机记录 | 记录类型 | 记录值 |
|----------|----------|--------|
| @ | A | your_server_ip |
| www | A | your_server_ip |

### 6.3 更新 Nginx 配置

```bash
sudo nano /etc/nginx/sites-available/kexi
```

将 `server_name _;` 改为 `server_name your-domain.com www.your-domain.com;`

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 第七步：配置 HTTPS（推荐）

```bash
# 安装 Certbot
sudo apt install certbot python3-certbot-nginx -y

# 申请 SSL 证书（自动配置 Nginx）
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# 证书会自动续期
```

---

## 常用管理命令

```bash
# 查看后端日志
pm2 logs kexi-backend

# 重启后端
pm2 restart kexi-backend

# 重新部署前端
cd /opt/kexi/kexi-frontend
git pull
npm run build
sudo cp -r dist/* /var/www/kexi/

# 查看 Nginx 日志
sudo tail -f /var/log/nginx/error.log
```

---

## 端口说明

| 端口 | 用途 | 说明 |
|------|------|------|
| 80 | HTTP | Nginx 入口 |
| 443 | HTTPS | Nginx SSL 入口 |
| 3101 | 后端 API | 内部端口，不直接暴露 |

---

## 故障排查

### 无法访问网站
```bash
# 检查 Nginx 是否运行
sudo systemctl status nginx

# 检查防火墙
sudo ufw status

# 检查端口监听
sudo netstat -tlnp | grep :80
```

### API 请求失败
```bash
# 检查后端状态
pm2 status kexi-backend

# 查看后端日志
pm2 logs kexi-backend --lines 50
```

### 文件上传失败
检查 Nginx 配置中的 `client_max_body_size` 设置。

---

## 文件结构

```
kexi/
├── deploy/
│   ├── server-setup.sh      # 服务器环境初始化脚本
│   ├── deploy-app.sh         # 应用部署脚本
│   └── nginx.conf            # Nginx 配置文件
├── kexi-backend/             # 后端代码
│   ├── server.js
│   └── .env.production       # 生产环境变量模板
└── kexi-frontend/            # 前端代码
    └── vite.config.js
```

---

## 费用估算

| 项目 | 价格 |
|------|------|
| 云服务器（2核2G） | ¥60-100/年 |
| 域名（可选） | ¥30-50/年 |
| SSL 证书 | 免费（Let's Encrypt） |
| **总计** | **约 ¥100-150/年** |

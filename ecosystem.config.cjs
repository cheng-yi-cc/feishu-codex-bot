module.exports = {
  apps: [
    {
      name: "feishu-codex-bot",
      script: "dist/index.js",
      cwd: "C:/Users/45057/.codex/feishu-codex-bot",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};

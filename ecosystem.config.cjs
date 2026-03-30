const path = require("node:path");

const projectRoot = __dirname;

module.exports = {
  apps: [
    {
      name: "feishu-codex-bot",
      script: path.join(projectRoot, "dist", "index.js"),
      cwd: projectRoot,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      out_file: path.join(projectRoot, "logs", "app.log"),
      error_file: path.join(projectRoot, "logs", "app.err.log"),
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};

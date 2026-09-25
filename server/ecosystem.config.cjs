/**
 * Colyseus Cloud / PM2 deployment configuration.
 * See documentation: https://docs.colyseus.io/deployment/cloud
 *
 * One process: rooms live in memory and guests join by room code, so a second
 * process would need Redis presence/driver to route joins. One venue session
 * with 12 phones is far below a single process's capacity.
 */
module.exports = {
  apps: [{
    name: "haunted-gallery",
    script: "build/index.js",
    time: true,
    watch: false,
    instances: 1,
    exec_mode: "fork",
    wait_ready: true,
    max_memory_restart: "512M",
    env_production: { NODE_ENV: "production" },
  }],
};

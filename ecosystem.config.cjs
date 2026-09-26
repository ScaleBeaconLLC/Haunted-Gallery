/**
 * Colyseus Cloud / PM2 process configuration (repository root = Cloud "Root Directory").
 * Cloud clones the repo, runs `npm install` + `npm run build` here (which builds the
 * PlayCanvas client into server/public and compiles the server), then starts this app.
 *
 * One process: rooms live in memory and guests join by room code; a second process
 * would need Redis presence/driver to route joins. NODE_ENV=production enforces
 * HOST_KEY (set it in the Cloud dashboard's environment variables, never in git).
 */
module.exports = {
  apps: [{
    name: "haunted-gallery",
    script: "server/build/index.js",
    time: true,
    watch: false,
    instances: 1,
    exec_mode: "fork",
    wait_ready: true,
    max_memory_restart: "512M",
    env: { NODE_ENV: "production" },
  }],
};

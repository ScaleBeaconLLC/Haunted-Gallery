import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { defineServer, defineRoom, monitor } from "colyseus";
import { GalleryRoom } from "./rooms/GalleryRoom.js";

// The built PlayCanvas client (client/ -> `npm run build`) is copied to server/public,
// so one HTTPS origin serves the game page and the WSS endpoint.
const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const server = defineServer({
  rooms: {
    gallery: defineRoom(GalleryRoom),
  },

  express: (app) => {
    app.get("/healthz", (_req, res) => { res.json({ ok: true }); });

    if (process.env.NODE_ENV !== "production") {
      // Development only; never expose the monitor publicly without a password.
      app.use("/monitor", monitor());
      // Lets the host console build a QR link phones on the same Wi-Fi can open.
      app.get("/api/lan", (_req, res) => {
        res.set("Access-Control-Allow-Origin", "*");
        const addresses = Object.values(networkInterfaces()).flat()
          .filter(i => i && i.family === "IPv4" && !i.internal).map(i => i!.address);
        res.json({ addresses });
      });
    }

    if (existsSync(publicDir)) {
      app.use(express.static(publicDir, {
        setHeaders: (res, path) => {
          if (/\.(mp3|ogg|js|css|woff2?)$/.test(path) && /assets[\\/]/.test(path)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      }));
    } else {
      app.get("/", (_req, res) => { res.send("Haunted Gallery server is running. Build the client (npm run build in client/) to serve the game here."); });
    }
  },
});

export default server;

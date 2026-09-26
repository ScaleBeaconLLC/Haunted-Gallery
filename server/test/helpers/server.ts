/**
 * One Colyseus test server shared by every suite. The matchmaker is a process-wide
 * singleton, so booting a second server after shutting one down breaks room creation.
 * Loaded as a mocha root-hook plugin (see the "test" script in package.json).
 */
import { ColyseusTestServer, boot } from "@colyseus/testing";
import appConfig from "../../src/app.config.js";

let instance: ColyseusTestServer<typeof appConfig> | null = null;

export async function testServer() {
  if (!instance) {
    delete process.env.HOST_KEY;
    instance = await boot(appConfig);
  }
  return instance;
}

export const mochaHooks = {
  async afterAll() {
    await instance?.shutdown();
    instance = null;
  },
};

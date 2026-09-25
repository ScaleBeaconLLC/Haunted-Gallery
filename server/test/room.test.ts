import assert from "assert";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import appConfig from "../src/app.config.js";

type Inbox = { type: string; payload: any }[];

function record(room: any): Inbox {
  const inbox: Inbox = [];
  room.onMessage("*", (type: string, payload: any) => inbox.push({ type, payload }));
  room.send("hello");
  return inbox;
}
const key = (n: number) => `testdevicekey-${n}-abcdefghij`;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (!fn()) { if (Date.now() > end) throw new Error("condition not met in time"); await sleep(20); }
}
const lastView = (inbox: Inbox) => [...inbox].reverse().find(m => m.type === "view")?.payload;

describe("GalleryRoom over WebSockets", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;
  before(async () => { delete process.env.HOST_KEY; colyseus = await boot(appConfig); });
  after(async () => colyseus.shutdown());
  beforeEach(async () => colyseus.cleanup());

  it("counts a guest who claims after joining, so the host can start", async () => {
    const host = await colyseus.sdk.create("gallery", { role: "host" });
    record(host);
    const phone = await colyseus.sdk.joinById(host.roomId, { playerKey: key(42) });
    record(phone);
    await sleep(200);
    assert.strictEqual((host.state as any).humanCount, 0);
    phone.send("claim", { character: "nia", name: "Solo" });
    await until(() => (host.state as any).humanCount === 1);
    phone.send("release");
    await until(() => (host.state as any).humanCount === 0);
  });

  it("runs lobby, host auth, private SOS delivery and rejoin", async () => {
    const host = await colyseus.sdk.create("gallery", { role: "host" });
    const hostInbox = record(host);
    await until(() => hostInbox.some(m => m.type === "host"));
    const { joinCode, hostToken } = hostInbox.find(m => m.type === "host")!.payload;
    assert.match(joinCode, /^[A-Z2-9]{5}$/);
    assert.strictEqual(host.roomId, joinCode);

    await assert.rejects(colyseus.sdk.joinById(joinCode, { role: "host" }), /Not authorized/);
    const host2 = await colyseus.sdk.joinById(joinCode, { role: "host", hostToken });
    await host2.leave();

    const players = await Promise.all([1, 2, 3].map(n => colyseus.sdk.joinById(joinCode, { playerKey: key(n) })));
    const inboxes = players.map(record);
    const [p1, p2, p3] = players;
    p1.send("claim", { character: "julian", name: "Ana" });
    await until(() => (host.state as any).seats.get("julian")?.taken === true);
    p2.send("claim", { character: "julian", name: "Ben" });
    await until(() => inboxes[1].some(m => m.type === "error"));
    assert.match(inboxes[1].find(m => m.type === "error")!.payload.message, /already chose/);
    p2.send("claim", { character: "anika", name: "Ben" });
    p3.send("claim", { character: "marcus", name: "Cy" });
    p3.send("host:start");
    await until(() => inboxes[2].some(m => m.type === "error" && /Not allowed/.test(m.payload.message)));

    host.send("host:cpuFill", { on: false });
    host.send("host:start");
    const server: any = colyseus.getRoomById(joinCode);
    await until(() => server.state.phase === "opening");
    assert.ok(!["julian", "anika", "marcus"].includes(server.state.birthday));

    // Skip the cinematic.
    server.game.phaseEndsAt = 0;
    await until(() => server.state.phase === "choice");

    p3.send("choose", { action: "hide", spot: "curtain_recess" });
    p1.send("sos:send", { to: "anika", preset: "come_get_me" });
    await until(() => lastView(inboxes[1])?.sos?.inbox?.length === 1);
    const card = lastView(inboxes[1]).sos.inbox[0];
    assert.strictEqual(card.senderName, "Julian (Ana)");
    assert.strictEqual(card.roomName, "Grand Portrait Gallery");
    await until(() => lastView(inboxes[0])?.sos?.outbox?.length === 1);

    // Marcus must never receive the SOS id or content.
    await sleep(300);
    const marcusTraffic = JSON.stringify(inboxes[2]);
    assert.ok(!marcusTraffic.includes(card.id), "SOS leaked to a third guest");
    assert.ok(!marcusTraffic.includes("Come get me"));
    // Public state never includes rooms or hiding places.
    assert.ok(!JSON.stringify(host.state.toJSON()).match(/curtain_recess|portrait|sos/));

    p2.send("sos:reply", { id: card.id, reply: "coming" });
    await until(() => lastView(inboxes[0])?.sos?.outbox?.[0]?.reply === "coming");

    // Mid-match strangers are refused; a returning device gets its own seat back.
    await assert.rejects(colyseus.sdk.joinById(joinCode, { playerKey: key(9) }), /already started/);
    await p1.leave(true);
    await until(() => server.state.seats.get("julian").connected === false);
    const back = await colyseus.sdk.joinById(joinCode, { playerKey: key(1) });
    const backInbox = record(back);
    await until(() => lastView(backInbox)?.id === "julian");
    assert.strictEqual(server.game.get("julian").cpu, false);

    host.send("host:pause");
    await until(() => server.state.paused === true);
    back.send("choose", { action: "stay" });
    await until(() => backInbox.some(m => m.type === "error" && /paused/.test(m.payload.message)));
    host.send("host:resume");
    host.send("host:reset");
    await until(() => server.state.phase === "lobby");
    assert.strictEqual(server.state.seats.get("anika").taken, true);
  });
});

import { integer, sqliteTable, text, index, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const events = sqliteTable('gallery_events', {
  code: text('code').primaryKey(),
  owner: text('owner').notNull(),
  revision: integer('revision').notNull().default(1),
  document: text('document').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, t => [index('gallery_owner_created').on(t.owner,t.createdAt)]);
export const controllerSessions=sqliteTable('controller_sessions',{
 code:text('code').primaryKey(),device:text('device').notNull(),createdAt:integer('created_at').notNull(),expiresAt:integer('expires_at').notNull(),heartbeat:integer('heartbeat').notNull().default(0),telemetry:text('telemetry').notNull().default('{}'),
 mode:text('mode').notNull().default('multiplayer'),humanLimit:integer('human_limit').notNull().default(12),phase:text('phase').notNull().default('lobby'),runId:integer('run_id').notNull().default(0),
},t=>[index('controller_device_created').on(t.device,t.createdAt)]);
export const controllerSeats=sqliteTable('controller_seats',{
 code:text('code').notNull().references(()=>controllerSessions.code),character:text('character').notNull(),name:text('name').notNull(),tokenHash:text('token_hash').notNull(),seq:integer('seq').notNull().default(0),inputAt:integer('input_at').notNull().default(0),intent:text('intent').notNull().default('{"x":0,"y":0,"run":false}'),
},t=>[primaryKey({columns:[t.code,t.character]}),uniqueIndex('controller_seat_token').on(t.code,t.tokenHash)]);
export const controllerMessages=sqliteTable('controller_messages',{
 id:integer('id').primaryKey({autoIncrement:true}),
 code:text('code').notNull().references(()=>controllerSessions.code),
 runId:integer('run_id').notNull(),round:integer('round').notNull(),
 sender:text('sender').notNull(),recipient:text('recipient').notNull(),
 preset:text('preset').notNull(),roomSnapshot:text('room_snapshot').notNull(),
 status:text('status').notNull().default('pending'),createdAt:integer('created_at').notNull(),
},t=>[
 uniqueIndex('controller_message_one_per_window').on(t.code,t.runId,t.round,t.sender),
 index('controller_message_inbox').on(t.code,t.runId,t.recipient),
]);

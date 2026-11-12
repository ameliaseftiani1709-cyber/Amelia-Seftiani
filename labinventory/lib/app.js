'use strict';
// Merakit handler dari konfigurasi environment.
const { createHandler } = require('./handler');
const { createSupabaseDb } = require('./db-supabase');
const { createMemoryDb } = require('./db-memory');

function createApp(env = process.env) {
  const production = !!env.VERCEL || env.NODE_ENV === 'production';
  let db;

  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
    db = createSupabaseDb({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_KEY });
  } else if (!production || env.ALLOW_MEMORY_DB === '1') {
    console.warn('[LabInventory] SUPABASE_URL / SUPABASE_SERVICE_KEY belum diatur → memakai database MEMORI (data hilang saat restart).');
    db = createMemoryDb();
  } else {
    throw new Error('SUPABASE_URL dan SUPABASE_SERVICE_KEY belum diatur di Environment Variables.');
  }

  let secret = env.JWT_SECRET;
  if (!secret) {
    if (production && env.ALLOW_MEMORY_DB !== '1') throw new Error('JWT_SECRET belum diatur di Environment Variables.');
    secret = 'dev-only-secret-change-me';
  }
  if (production && secret.length < 32) throw new Error('JWT_SECRET minimal 32 karakter.');

  return createHandler(db, { secret });
}

module.exports = { createApp };

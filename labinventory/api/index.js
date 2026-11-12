'use strict';
// Vercel Serverless Function: semua permintaan /api/* diarahkan ke sini lewat rewrite di vercel.json
const { createApp } = require('../lib/app');

let handler;

module.exports = async (req, res) => {
  try {
    handler = handler || createApp();
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Konfigurasi server belum lengkap: ' + e.message }));
    return;
  }
  return handler(req, res);
};

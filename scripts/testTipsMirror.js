const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const tips = require('../src/tips');

const pool = db.pool || db;
const FILE = path.join(__dirname, '../data/tips.json');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readOriginalTipsJson() {
  if (!fs.existsSync(FILE)) return JSON.stringify({ tips: [], folders: [], sends: [] }, null, 2);
  return fs.readFileSync(FILE, 'utf8');
}

async function testTipsMirror() {
  const originalJson = readOriginalTipsJson();
  const requestId = `test_tip_mirror_${Date.now()}`;
  let tip = null;
  let send = null;

  try {
    tip = tips.upsertTip({
      requestId,
      type: 'phrase',
      title: `Prueba espejo tips ${Date.now()}`,
      desc: 'Tip temporal creado por scripts/testTipsMirror.js',
      phrase: 'Tip temporal creado por scripts/testTipsMirror.js',
      folderId: 'general',
    });

    const sends = tips.createSends(
      tip,
      [{ clientId: 'test_mirror', phone: '56900000000', name: 'Paciente prueba', role: 'paciente principal' }],
      'Mensaje temporal de prueba espejo tips',
      new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      ''
    );
    send = sends[0];

    console.log('[test-tips] tip/send temporales creados', JSON.stringify({ tipId: tip.id, sendId: send.id }));
    await sleep(3000);

    const tipResult = await pool.query('SELECT tip_id, title FROM tip_library WHERE tip_id = $1', [tip.id]);
    const sendResult = await pool.query('SELECT send_id, tip_id, status FROM tip_sends WHERE send_id = $1', [send.id]);

    if (!tipResult.rows.length) throw new Error('El tip temporal no apareció en tip_library.');
    if (!sendResult.rows.length) throw new Error('El envío temporal no apareció en tip_sends.');

    console.log('✅ Espejo de tips funcionando:', {
      tip: tipResult.rows[0],
      send: sendResult.rows[0],
    });
  } catch (error) {
    console.error('❌ Error probando espejo de tips:', error.message);
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(FILE, originalJson);
    if (send?.id) await pool.query('DELETE FROM tip_sends WHERE send_id = $1', [send.id]).catch(() => {});
    if (tip?.id) await pool.query('DELETE FROM tip_library WHERE tip_id = $1', [tip.id]).catch(() => {});
    await pool.end();
  }
}

testTipsMirror();

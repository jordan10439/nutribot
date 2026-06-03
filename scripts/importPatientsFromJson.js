const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const pool = db.pool || db;

const FILE = path.join(__dirname, '../data/db.json');

function readPatients() {
  if (!fs.existsSync(FILE)) return [];
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  return Array.isArray(raw?.clients) ? raw.clients : [];
}

function displayNameFor(patient) {
  return patient.displayName || (patient.nombres || []).filter(Boolean).join(' & ') || patient.name || patient.nombre || '';
}

function internalNameFor(patient, displayName, type) {
  return patient.internalName || `${displayName || 'Paciente'} · ${type === 'couple' ? 'Pareja' : 'Individual'}`;
}

function patientType(patient) {
  return patient.type || patient.tipo || ((patient.phones || []).length > 1 ? 'couple' : 'individual');
}

function patientMembers(patient, type) {
  if (Array.isArray(patient.members) && patient.members.length) return patient.members;
  const nombres = Array.isArray(patient.nombres) ? patient.nombres : [];
  const phones = Array.isArray(patient.phones) ? patient.phones : [];
  return nombres.map((name, index) => ({
    name,
    phone: phones[index] || '',
    role: index === 0 ? 'partner_1' : 'partner_2',
    internalName: `${name || 'Paciente'} · ${type === 'couple' ? 'En pareja' : 'Individual'}`,
  }));
}

async function importPatientsFromJson() {
  const patients = readPatients();
  const warnings = [];
  let imported = 0;

  try {
    for (const patient of patients) {
      const clientId = patient.id || '';
      const nombres = Array.isArray(patient.nombres) ? patient.nombres : [];
      const phones = Array.isArray(patient.phones) ? patient.phones : [];
      const type = patientType(patient);
      const displayName = displayNameFor(patient);
      const internalName = internalNameFor(patient, displayName, type);
      const members = patientMembers(patient, type);
      const contextKey = patient.contextKey || (clientId ? `${type}:${clientId}` : '');

      if (!clientId) warnings.push({ patient: displayName || '(sin nombre)', issue: 'sin id' });
      if (!phones.length) warnings.push({ clientId, patient: displayName || '(sin nombre)', issue: 'sin phones' });
      if (!nombres.length && !displayName) warnings.push({ clientId, issue: 'sin nombres/displayName' });
      if (!clientId) continue;

      await pool.query(`
        INSERT INTO patients (
          client_id,
          name,
          phone,
          display_name,
          internal_name,
          context_key,
          type,
          nombres,
          phones,
          members,
          timezone,
          welcome,
          goals,
          data,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8::jsonb, $9::jsonb, $10::jsonb,
          $11, $12::jsonb, $13::jsonb, $14::jsonb, NOW()
        )
        ON CONFLICT (client_id) DO UPDATE SET
          name = EXCLUDED.name,
          phone = EXCLUDED.phone,
          display_name = EXCLUDED.display_name,
          internal_name = EXCLUDED.internal_name,
          context_key = EXCLUDED.context_key,
          type = EXCLUDED.type,
          nombres = EXCLUDED.nombres,
          phones = EXCLUDED.phones,
          members = EXCLUDED.members,
          timezone = EXCLUDED.timezone,
          welcome = EXCLUDED.welcome,
          goals = EXCLUDED.goals,
          data = EXCLUDED.data,
          updated_at = NOW()
      `, [
        clientId,
        displayName || nombres[0] || 'Paciente',
        phones[0] || null,
        displayName,
        internalName,
        contextKey,
        type,
        JSON.stringify(nombres),
        JSON.stringify(phones),
        JSON.stringify(members),
        patient.timezone || 'America/Santiago',
        JSON.stringify(patient.welcome || null),
        JSON.stringify(patient.goals || []),
        JSON.stringify(patient),
      ]);
      imported += 1;
    }

    const count = await pool.query('SELECT COUNT(*)::int AS count FROM patients WHERE client_id IS NOT NULL');
    console.log('✅ Pacientes importados correctamente');
    console.log(`Pacientes en data/db.json: ${patients.length}`);
    console.log(`Pacientes importados/actualizados: ${imported}`);
    console.log(`Pacientes con client_id en PostgreSQL: ${count.rows[0].count}`);
    if (warnings.length) {
      console.log('⚠️ Advertencias:', JSON.stringify(warnings, null, 2));
    } else {
      console.log('Sin advertencias de datos importantes.');
    }
  } catch (error) {
    console.error('❌ Error importando pacientes desde JSON:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

importPatientsFromJson();

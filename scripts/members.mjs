// Members with their own code (run on the server, in the app folder):
//   npm run members -- add "Dana" trader      adds a member and prints the new code ONCE (it is not stored)
//   npm run members -- list                   names, roles, ids
//   npm run members -- disable <id>           the code stops working (open sessions end at the next request)
//   npm run members -- enable <id>
//   npm run members -- role <id> admin        roles: viewer, trader (can send orders), admin
// The shared ACCESS_CODE keeps working as a viewer.
import { randomBytes, randomInt } from 'node:crypto';
import { openStore } from '../server/store/db.js';
import { hashCode, ROLES } from '../server/auth.js';

const store = openStore(process.env.DB_PATH || 'data/boilerroom.db');
const [cmd, a, b] = process.argv.slice(2);
const taken = code => code === process.env.ACCESS_CODE || store.activeMembers().some(m => hashCode(code, m.salt) === m.code_hash);
try {
  if (cmd === 'add') {
    const name = String(a || '').trim(), role = b || 'trader';
    if (!name) throw new Error('Give a name: add "Dana" trader');
    if (!ROLES.includes(role)) throw new Error(`Role must be one of ${ROLES.join(', ')}`);
    let code; do code = String(randomInt(0, 1e6)).padStart(6, '0'); while (taken(code));
    const salt = randomBytes(16).toString('hex'), id = randomBytes(6).toString('hex');
    store.addMember({ id, name, role, salt, codeHash: hashCode(code, salt), createdAt: Date.now() });
    console.log(`Added ${name} (${role}), id ${id}\nTheir code: ${code}\nGive it to them in person or by phone. It is shown only now.`);
  } else if (cmd === 'list') {
    const rows = store.listMembers();
    console.log(rows.length ? rows.map(m => `${m.id}  ${m.name.padEnd(20)} ${m.role.padEnd(7)} ${m.disabled ? 'DISABLED' : 'active'}  since ${new Date(m.created_at).toISOString().slice(0, 10)}`).join('\n') : 'No members yet: the shared code is the only way in.');
  } else if (cmd === 'disable' || cmd === 'enable') {
    if (!store.setMember(a, { disabled: cmd === 'disable' ? 1 : 0 })) throw new Error('No member with that id');
    console.log(`${cmd}d ${a}`);
  } else if (cmd === 'role') {
    if (!ROLES.includes(b)) throw new Error(`Role must be one of ${ROLES.join(', ')}`);
    if (!store.setMember(a, { role: b })) throw new Error('No member with that id');
    console.log(`${a} is now ${b}`);
  } else console.log('Use: add "Name" [viewer|trader|admin] | list | disable <id> | enable <id> | role <id> <role>');
} catch (e) { console.error('Error:', e.message); process.exitCode = 1; } finally { store.close(); }

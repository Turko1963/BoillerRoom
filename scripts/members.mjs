// Members with their own code (run on the server, in the app folder):
//   npm run members -- add "Dana" trader      adds a member and prints the new code ONCE (it is not stored)
//   npm run members -- reset <id>             a new code for the same member (the old one stops working)
//   npm run members -- list                   names, roles, ids
//   npm run members -- disable <id>           the code stops working (open sessions end at the next request)
//   npm run members -- enable <id>
//   npm run members -- role <id> admin        roles: viewer, trader (can send orders), admin
// The shared ACCESS_CODE keeps working as a viewer.
// In a terminal the code is shown until you press Enter, then the screen is cleared, so a copy of the terminal never holds it.
import { randomBytes, randomInt } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { openStore } from '../server/store/db.js';
import { hashCode, ROLES } from '../server/auth.js';

const store = openStore(process.env.DB_PATH || 'data/boilerroom.db');
const [cmd, a, b] = process.argv.slice(2);
const taken = code => code === process.env.ACCESS_CODE || store.activeMembers().some(m => hashCode(code, m.salt) === m.code_hash);
const newCode = () => { let code; do code = String(randomInt(0, 1e6)).padStart(6, '0'); while (taken(code)); return code; };
// show the code once; in a terminal wait for Enter and clear the screen and its scrollback
async function reveal(line, code) {
  if (!process.stdout.isTTY) return console.log(`${line}\nTheir code: ${code}\nGive it to them in person or by phone. It is shown only now.`);
  console.log(`\n  Code: ${code}\n\n  Write it down now (paper or a password manager). Do not paste it anywhere.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question('  Press Enter when it is saved: the screen will be cleared. ');
  rl.close();
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
  console.log(`${line}\nThe code was shown once and is not stored. Lost it? npm run members -- reset <id>`);
}
try {
  if (cmd === 'add') {
    const name = String(a || '').trim(), role = b || 'trader';
    if (!name) throw new Error('Give a name: add "Dana" trader');
    if (!ROLES.includes(role)) throw new Error(`Role must be one of ${ROLES.join(', ')}`);
    const code = newCode(), salt = randomBytes(16).toString('hex'), id = randomBytes(6).toString('hex');
    store.addMember({ id, name, role, salt, codeHash: hashCode(code, salt), createdAt: Date.now() });
    await reveal(`Added ${name} (${role}), id ${id}`, code);
  } else if (cmd === 'reset') {
    const m = store.listMembers().find(x => x.id === a);
    if (!m) throw new Error('No member with that id');
    const code = newCode(), salt = randomBytes(16).toString('hex');
    store.resetMemberCode(a, salt, hashCode(code, salt));
    await reveal(`New code for ${m.name} (${m.role}), id ${a}; the old code no longer works`, code);
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
  } else console.log('Use: add "Name" [viewer|trader|admin] | reset <id> | list | disable <id> | enable <id> | role <id> <role>');
} catch (e) { console.error('Error:', e.message); process.exitCode = 1; } finally { store.close(); }

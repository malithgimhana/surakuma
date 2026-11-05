const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'frontend/src/i18n.ts'), 'utf8');
const match = source.match(/const entries: string\[\]\[\] = (\[[\s\S]*?\n\]);/);
if (!match) throw new Error('Translation entries were not found; review the source format.');
const entries = vm.runInNewContext(`(${match[1]})`, {}, { timeout: 1000 });
const escape = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const header = ['Key', 'English', 'Sinhala', 'Tamil', 'Review priority', 'Reviewer', 'Review date', 'Approved', 'Suggested correction', 'Notes'];
const rows = entries.map(row => [...row, /status|urgency|priority|auth|alert|privacy|synthetic|emergency|error|required|location/i.test(row[0]) ? 'Critical wording' : 'Standard wording', '', '', '', '', '']);
const folder = path.join(root, 'docs/submission');
fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(path.join(folder, 'translation-review.csv'), '\uFEFF' + [header, ...rows].map(row => row.map(escape).join(',')).join('\r\n') + '\r\n');
fs.writeFileSync(path.join(folder, 'contribution-record.csv'), '\uFEFF' + [
  ['Student name', 'Student ID', 'Date', 'Actual activity', 'Implementation testing translation documentation or presentation', 'Evidence path or Git reference', 'Challenge and decision', 'Reflection'],
  ...Array.from({ length: 8 }, () => Array(8).fill('')),
].map(row => row.map(escape).join(',')).join('\r\n') + '\r\n');
console.log(`Prepared ${entries.length} translation rows with blank reviewer/approval fields and a blank contribution record.`);

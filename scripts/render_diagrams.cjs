const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const folder = path.resolve(__dirname, '../docs/diagrams/rendered');
(async () => {
  for (const name of fs.readdirSync(folder).filter(name => name.endsWith('.svg'))) {
    await sharp(path.join(folder, name), { density: 180 }).png().toFile(path.join(folder, name.replace(/\.svg$/, '.png')));
    process.stdout.write(`Rendered ${name}\n`);
  }
})().catch(error => { process.stderr.write(error.message); process.exitCode = 1; });

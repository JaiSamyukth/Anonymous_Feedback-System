'use strict';
const path = require('node:path');
const { open } = require('./db');
const { seed } = require('./seed');
const { createApp } = require('./app');

const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'feedback.db');
const db = open(file);
seed(db, { demo: process.env.SEED_DEMO !== '0' });

const app = createApp(db, { secureCookies: process.env.SECURE_COOKIES === '1' });
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Anonymous Faculty Feedback System running at http://localhost:${port}`);
  console.log(`  Student portal: http://localhost:${port}/`);
  console.log(`  Faculty portal: http://localhost:${port}/faculty`);
  console.log(`  Admin portal:   http://localhost:${port}/admin`);
  const lan = Object.values(require('node:os').networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal);
  for (const i of lan) console.log(`  Network:        http://${i.address}:${port}/   (for other computers on the same network)`);
});

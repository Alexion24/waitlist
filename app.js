import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const dataDir = process.env.WAITLIST_DATA_DIR || fileURLToPath(new URL('./.data/', import.meta.url));
await mkdir(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, 'waitlist.sqlite'), { timeout: 5000 });
db.exec(`
  CREATE TABLE IF NOT EXISTS subscribers (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TEXT
  );
  CREATE TABLE IF NOT EXISTS launch (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    url TEXT NOT NULL,
    sender TEXT
  );
`);
const getLaunch = db.prepare('SELECT url, sender FROM launch WHERE id = 1');

if (process.argv[2] === 'launch') {
  await sendLaunchEmails(process.argv[3]);
} else {
  const assets = new Map([
    ['/', ['index.html', 'text/html']],
    ['/styles.css', ['styles.css', 'text/css']],
    ['/form.js', ['form.js', 'text/javascript']],
  ].map(([path, [file, type]]) => [path, [readFileSync(new URL(`./public/${file}`, import.meta.url)), type]]));
  const subscribe = db.prepare(`
    INSERT INTO subscribers (id, email)
    SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM launch)
    ON CONFLICT (email) DO NOTHING
  `);

  const server = createServer(async (req, res) => {
    const path = req.url.split('?')[0];
    const asset = assets.get(path);
    if (req.method === 'GET' && asset) {
      const [body, type] = asset;
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }).end(body);
      return;
    }
    if (req.method === 'GET' && path === '/api/status') {
      reply(res, 200, { url: getLaunch.get()?.url ?? null });
      return;
    }
    if (req.method !== 'POST' || path !== '/api/subscribe') {
      reply(res, 404, { error: 'Страница не найдена.' });
      return;
    }

    let body = '';
    req.setEncoding('utf8');
    try {
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) {
          reply(res, 413, { error: 'Запрос слишком большой.' });
          return;
        }
      }
      const { email } = JSON.parse(body) ?? {};
      const address = typeof email === 'string' ? email.trim().toLowerCase() : '';
      if (address.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(address)) {
        reply(res, 400, { error: 'Введите корректный email.' });
        return;
      }
      subscribe.run(randomUUID(), address);
      reply(res, 200, { url: getLaunch.get()?.url ?? null });
    } catch (error) {
      if (error instanceof SyntaxError) {
        reply(res, 400, { error: 'Проверьте email и попробуйте снова.' });
      } else {
        console.error('Registration failed:', error.code ?? error.name);
        reply(res, 500, { error: 'Не удалось записать вас. Попробуйте ещё раз.' });
      }
    }
  });
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${server.address().port}`));
}

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function sendLaunchEmails(value) {
  const url = URL.parse(value ?? '');
  if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Usage: node app.js launch https://example.com');
  }
  const { RESEND_API_KEY: key, EMAIL_FROM: sender } = process.env;
  if (Boolean(key) !== Boolean(sender)) throw new Error('Set both RESEND_API_KEY and EMAIL_FROM, or leave both unset.');

  db.prepare('INSERT OR IGNORE INTO launch (id, url, sender) VALUES (1, ?, ?)').run(url.href, sender || null);
  const launch = getLaunch.get();
  if (launch.url !== url.href || launch.sender !== (sender || null)) {
    throw new Error('Use the original launch URL and email settings when retrying.');
  }

  const outbox = join(dataDir, 'outbox');
  if (!key) await mkdir(outbox, { recursive: true });
  const pending = db.prepare('SELECT id, email FROM subscribers WHERE sent_at IS NULL ORDER BY joined_at').all();
  const markSent = db.prepare('UPDATE subscribers SET sent_at = CURRENT_TIMESTAMP WHERE id = ?');
  const subject = 'Сайт открыт!';
  const message = `Привет! Сайт уже открыт. Вот ссылка, которую вы ждали:\n\n${launch.url}\n`;
  let sent = 0;
  for (const { id, email } of pending) {
    try {
      if (key) {
        await delay(150);
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `launch/${id}`,
          },
          body: JSON.stringify({ from: sender, to: [email], subject, text: message }),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error(`Resend HTTP ${response.status}`);
      } else {
        const draft = join(outbox, `${randomUUID()}.tmp`);
        const encodedSubject = Buffer.from(subject).toString('base64');
        const headers = [
          'From: waitlist@example.invalid', `To: ${email}`, `Subject: =?UTF-8?B?${encodedSubject}?=`,
          'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit',
        ];
        await writeFile(draft, `${headers.join('\r\n')}\r\n\r\n${message.replaceAll('\n', '\r\n')}`);
        await rename(draft, join(outbox, `${id}.eml`));
      }
      markSent.run(id);
      sent += 1;
    } catch (error) {
      console.error(`Launch email ${id}: ${error.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`${key ? 'Sent' : 'Saved to outbox'}: ${sent}. Pending: ${pending.length - sent}.`);
}

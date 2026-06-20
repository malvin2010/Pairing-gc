import { makeWASocket, useMultiFileAuthState, Browsers, delay } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';

export const config = {
  maxDuration: 60, // Vercel max
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ error: 'POST only' });

  const { number } = req.body || {};
  if (!number) return res.status(400).json({ error: 'Number required. Format: 2637XXXXXXXX' });

  const cleanNum = number.replace(/\D/g, '');
  if (cleanNum.length < 10) return res.status(400).json({ error: 'Invalid number. Use format: 2637XXXXXXXX' });

  const sessionFolder = path.join(tmpdir(), 'malvin_' + Date.now() + '_' + Math.random().toString(36).slice(2));

  try {
    fs.mkdirSync(sessionFolder, { recursive: true });
  } catch (e) {
    return res.status(500).json({ error: 'Server storage error. Try again.' });
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

  const sock = makeWASocket({
    auth: state,
    browser: Browsers.macOS('Chrome'),
    printQRInTerminal: false,
    logger: { level: 'silent' }
  });

  let responded = false;
  const timeout = setTimeout(() => {
    if (!responded) {
      responded = true;
      res.status(408).json({
        error: 'Timeout: You took too long to enter code on WhatsApp. Refresh and try again fast.',
        tip: 'Enter the code on WhatsApp within 45 seconds'
      });
      try { sock.end(); } catch {}
      fs.rmSync(sessionFolder, { recursive: true, force: true });
    }
  }, 55000); // 55s safety timeout

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open' &&!responded) {
      clearTimeout(timeout);
      responded = true;
      await delay(1500);

      try {
        const credsPath = path.join(sessionFolder, 'creds.json');
        if (!fs.existsSync(credsPath)) throw new Error('Creds not found');

        const creds = fs.readFileSync(credsPath, 'utf8');
        const sessionString = 'MALVIN~' + Buffer.from(creds).toString('base64');

        res.status(200).json({
          status: 'success',
          session: sessionString,
          bot: 'Malvin C MD',
          powered: 'Handsome Tech 🇿🇼'
        });
      } catch (e) {
        if (!responded) {
          responded = true;
          res.status(500).json({ error: 'Failed to read session file' });
        }
      }

      sock.end();
      fs.rmSync(sessionFolder, { recursive: true, force: true });
    }

    if (connection === 'close' &&!responded) {
      clearTimeout(timeout);
      responded = true;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      let msg = 'Connection closed';

      if (statusCode === 401) msg = 'Wrong code entered or code expired';
      if (statusCode === 515) msg = 'Too many attempts. Wait 5min and try again';

      res.status(500).json({ error: msg });
      fs.rmSync(sessionFolder, { recursive: true, force: true });
    }
  });

  if (!sock.authState.creds.registered) {
    try {
      const code = await sock.requestPairingCode(cleanNum);

      setTimeout(() => {
        if (!responded) {
          res.status(200).json({
            status: 'code',
            code: code,
            message: 'Enter this code on WhatsApp FAST. You have 45 seconds.'
          });
        }
      }, 1000);
    } catch (e) {
      clearTimeout(timeout);
      if (!responded) {
        responded = true;
        res.status(500).json({ error: 'Failed to request code. Check number format.' });
        fs.rmSync(sessionFolder, { recursive: true, force: true });
      }
    }
  }
}

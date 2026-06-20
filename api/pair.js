import { makeWASocket, useMultiFileAuthState, Browsers, delay, DisconnectReason } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  const { number } = req.body || {};
  if (!number) return res.status(400).json({ error: 'Send WhatsApp number with country code. Ex: 2637XXXXXXXX' });

  const sessionFolder = path.join(tmpdir(), 'malvin_' + Date.now());
  fs.mkdirSync(sessionFolder, { recursive: true });
  
  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  
  const sock = makeWASocket({
    auth: state,
    browser: Browsers.macOS('Desktop'),
    printQRInTerminal: false,
    logger: require('pino')({ level: 'silent' })
  });

  sock.ev.on('creds.update', saveCreds);

  let responded = false;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    
    if (connection === 'open' && !responded) {
      responded = true;
      await delay(2000);
      
      try {
        const credsPath = path.join(sessionFolder, 'creds.json');
        const creds = fs.readFileSync(credsPath, 'utf8');
        const sessionString = 'MALVIN~' + Buffer.from(creds).toString('base64');
        
        res.status(200).json({
          status: 'success',
          session: sessionString,
          bot: 'Malvin C MD',
          powered: 'Handsome Tech 🇿🇼',
          message: 'Copy this session ID and use it on Render/Railway/Katabump'
        });
      } catch (e) {
        res.status(500).json({ error: 'Failed to generate session' });
      }
      
      sock.end();
      fs.rmSync(sessionFolder, { recursive: true, force: true });
    }
    
    if (connection === 'close' && !responded) {
      responded = true;
      const reason = lastDisconnect?.error?.output?.statusCode;
      res.status(500).json({ error: 'Connection failed', reason });
      fs.rmSync(sessionFolder, { recursive: true, force: true });
    }
  });

  if (!sock.authState.creds.registered) {
    try {
      const code = await sock.requestPairingCode(number.replace(/[^0-9]/g, ''));
      setTimeout(() => {
        if (!responded) {
          responded = true;
          res.status(200).json({
            status: 'code',
            code: code,
            message: 'Go to WhatsApp > Settings > Linked Devices > Link with phone number code',
            bot: 'Malvin C MD'
          });
        }
      }, 1500);
    } catch (e) {
      if (!responded) {
        responded = true;
        res.status(500).json({ error: 'Invalid number or pairing failed' });
      }
    }
  }
          }

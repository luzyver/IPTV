import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { Readable } from 'stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 5000;
const app = express();

app.use(cors());
app.use(express.json());

const M3U_PATH = path.join(__dirname, 'data', '.SPORTS.m3u');
const SCRAPE_SCRIPT_PATH = path.join(__dirname, 'scripts', 'generate-sport-m3u.py');

// Parse M3U playlist file into structured JSON
function parseM3U(filePath) {
  let activePath = filePath;
  if (!fs.existsSync(activePath)) {
    const fallbackPath = path.join(__dirname, 'SPORTS.m3u');
    if (fs.existsSync(fallbackPath)) {
      console.log(`[INFO] .SPORTS.m3u not found. Falling back to committed SPORTS.m3u`);
      activePath = fallbackPath;
    } else {
      console.log(`[WARN] M3U file not found at ${filePath}`);
      return [];
    }
  }
  
  const content = fs.readFileSync(activePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  
  const channels = [];
  let currentChannel = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    if (line.startsWith('#EXTM3U')) {
      continue;
    }
    
    if (line.startsWith('#EXTINF:')) {
      currentChannel = {
        name: '',
        logo: '',
        group: 'Sports',
        userAgent: '',
        referer: '',
        url: ''
      };
      
      const tvgNameMatch = line.match(/tvg-name="([^"]+)"/i);
      const groupMatch = line.match(/group-title="([^"]+)"/i);
      const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
      
      const commaIndex = line.lastIndexOf(',');
      let name = '';
      if (commaIndex !== -1) {
        name = line.substring(commaIndex + 1).trim();
      }
      
      currentChannel.name = name || (tvgNameMatch ? tvgNameMatch[1] : 'Unknown Channel');
      currentChannel.group = groupMatch ? groupMatch[1] : 'Sports';
      currentChannel.logo = logoMatch ? logoMatch[1] : '';
    } else if (line.startsWith('#EXTVLCOPT:')) {
      if (currentChannel) {
        const opt = line.substring('#EXTVLCOPT:'.length).trim();
        if (opt.startsWith('http-user-agent=')) {
          currentChannel.userAgent = opt.substring('http-user-agent='.length).trim();
        } else if (opt.startsWith('http-referrer=')) {
          currentChannel.referer = opt.substring('http-referrer='.length).trim();
        } else if (opt.startsWith('referrer=')) {
          currentChannel.referer = opt.substring('referrer='.length).trim();
        } else if (opt.startsWith('user-agent=')) {
          currentChannel.userAgent = opt.substring('user-agent='.length).trim();
        }
      }
    } else if (line.startsWith('#')) {
      // Ignore other comments
    } else {
      if (currentChannel) {
        currentChannel.url = line;
        // Generate a URL-safe Base64 ID based on the name
        currentChannel.id = Buffer.from(currentChannel.name).toString('base64url');
        channels.push(currentChannel);
        currentChannel = null;
      }
    }
  }
  return channels;
}

// Rewrite URLs inside M3U8 files to redirect through our proxy
function rewriteM3U8(content, parentUrl, proxyHost, ua, referer) {
  const lines = content.split(/\r?\n/);
  const rewrittenLines = [];
  
  for (let line of lines) {
    let trimmed = line.trim();
    if (!trimmed) {
      rewrittenLines.push(line);
      continue;
    }
    
    if (trimmed.startsWith('#')) {
      // Rewrite URIs in tags (like keys, initialization maps, etc.)
      const uriMatch = trimmed.match(/URI="([^"]+)"/);
      if (uriMatch) {
        const originalUri = uriMatch[1];
        try {
          const absoluteUri = new URL(originalUri, parentUrl).toString();
          const proxiedUri = `${proxyHost}/api/proxy?url=${encodeURIComponent(absoluteUri)}&ua=${encodeURIComponent(ua)}&referer=${encodeURIComponent(referer)}`;
          trimmed = trimmed.replace(`URI="${originalUri}"`, `URI="${proxiedUri}"`);
        } catch (e) {
          // Keep original on parse failure
        }
      }
      rewrittenLines.push(trimmed);
    } else {
      // Rewrite media/segment URLs
      try {
        const absoluteUri = new URL(trimmed, parentUrl).toString();
        const proxiedUri = `${proxyHost}/api/proxy?url=${encodeURIComponent(absoluteUri)}&ua=${encodeURIComponent(ua)}&referer=${encodeURIComponent(referer)}`;
        rewrittenLines.push(proxiedUri);
      } catch (e) {
        rewrittenLines.push(trimmed); // Keep original if it's invalid
      }
    }
  }
  
  return rewrittenLines.join('\n');
}

// API: Get Channels List
app.get('/api/channels', (req, res) => {
  try {
    const channels = parseM3U(M3U_PATH);
    res.json({
      success: true,
      count: channels.length,
      channels
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Refresh Channels (run python script)
app.post('/api/refresh', (req, res) => {
  console.log('[*] Refresh requested. Running python scrape script...');
  
  exec(`python3 "${SCRAPE_SCRIPT_PATH}"`, (error, stdout, stderr) => {
    if (error) {
      console.error(`[ERROR] Scraping failed: ${error.message}`);
      console.error(stderr);
      return res.status(500).json({
        success: false,
        error: error.message,
        details: stderr
      });
    }
    
    console.log(`[INFO] Scraping completed successfully: ${stdout}`);
    
    try {
      const channels = parseM3U(M3U_PATH);
      res.json({
        success: true,
        message: 'Playlist regenerated successfully',
        count: channels.length,
        channels
      });
    } catch (parseError) {
      res.status(500).json({
        success: false,
        error: `Scrape succeeded but parsing failed: ${parseError.message}`
      });
    }
  });
});

// API: Stream Proxy (Bypasses CORS & Referer block)
app.get('/api/proxy', async (req, res) => {
  const { url, ua, referer } = req.query;
  if (!url) {
    return res.status(400).send('Missing target URL');
  }

  const targetUrl = decodeURIComponent(url);
  const targetUa = ua ? decodeURIComponent(ua) : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
  const targetReferer = referer ? decodeURIComponent(referer) : 'https://cdnlivetv.tv/';

  try {
    const headers = {
      'User-Agent': targetUa,
      'Referer': targetReferer
    };

    const fetchResponse = await fetch(targetUrl, { headers });

    if (!fetchResponse.ok) {
      return res.status(fetchResponse.status).send(`Failed fetching stream: ${fetchResponse.statusText}`);
    }

    const contentType = fetchResponse.headers.get('content-type') || '';
    
    // Enable CORS for HLS playing in browsers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    // If it's a playlist (.m3u8), we need to parse and rewrite URLs
    const isPlaylist = contentType.includes('mpegurl') || contentType.includes('x-mpegurl') || targetUrl.includes('.m3u8');

    if (isPlaylist) {
      const text = await fetchResponse.text();
      const proto = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['host'];
      const proxyHost = `${proto}://${host}`;
      
      const rewritten = rewriteM3U8(text, targetUrl, proxyHost, targetUa, targetReferer);
      
      res.setHeader('Content-Type', contentType || 'application/vnd.apple.mpegurl');
      return res.send(rewritten);
    } else {
      // Pipe the binary segment stream (e.g. .ts files)
      res.setHeader('Content-Type', contentType || 'video/mp2t');
      
      if (fetchResponse.body) {
        Readable.fromWeb(fetchResponse.body).pipe(res);
      } else {
        res.status(500).send('Response body is empty');
      }
    }
  } catch (error) {
    console.error(`[ERROR] Proxy path: ${targetUrl} - Message: ${error.message}`);
    if (!res.headersSent) {
      res.status(500).send(`Proxy error: ${error.message}`);
    }
  }
});

// Serve static frontend in production
const frontendDist = path.join(__dirname, 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.send('Backend Server is Running! Frontend dist folder not found. Please build frontend first.');
  });
}

// Auto-refresh M3U playlist every 30 minutes in background
const AUTO_REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes
setInterval(() => {
  console.log('[AUTO-REFRESH] Running python scrape script in background...');
  exec(`python3 "${SCRAPE_SCRIPT_PATH}"`, (error, stdout, stderr) => {
    if (error) {
      console.error(`[AUTO-REFRESH ERROR] Auto-scraping failed: ${error.message}`);
      console.error(stderr);
    } else {
      console.log(`[AUTO-REFRESH] Auto-scraping completed: ${stdout.trim()}`);
    }
  });
}, AUTO_REFRESH_INTERVAL);

app.listen(PORT, () => {
  console.log(`[INFO] Server running on port ${PORT}`);
  console.log(`[INFO] Client proxy endpoints are active.`);
  console.log(`[INFO] Auto-refresh playlist enabled (every 30 minutes).`);
});


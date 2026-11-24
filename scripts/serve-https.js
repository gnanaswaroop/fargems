#!/usr/bin/env node
'use strict';
// Serves FarGems over HTTPS on your LAN so phones can use location and compass.
// Usage: npm run serve:https            (port 8443)
//        npm run serve:https -- 9443    (custom port)
// The self-signed certificate is created once in tmp/certs (git-ignored) with openssl.
// Your browser will warn about the certificate; accept it once.

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CERT_DIR = path.join(ROOT, 'tmp', 'certs');
const CERT_FILE = path.join(CERT_DIR, 'cert.pem');
const KEY_FILE = path.join(CERT_DIR, 'key.pem');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.pem': 'text/plain; charset=utf-8',
};

// Content-Type for a file name. Unknown types are served as octet-stream.
function contentType(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

// Map a request URL to a file inside `root`. Returns null for anything outside the root.
function resolveRequest(root, url) {
  let p;
  try { p = decodeURIComponent(new URL(url, 'https://x').pathname); } catch { return null; }
  if (p.endsWith('/')) p += 'index.html';
  const abs = path.resolve(root, '.' + p);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}

// openssl arguments for a self-signed certificate valid for the LAN IP and localhost.
function certArgs(ip, certFile = CERT_FILE, keyFile = KEY_FILE) {
  return [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-sha256',
    '-subj', '/CN=fargems-lan',
    '-addext', `subjectAltName=IP:${ip},IP:127.0.0.1,DNS:localhost`,
    '-keyout', keyFile, '-out', certFile,
  ];
}

// IPv4 addresses on the LAN (non-internal interfaces).
function lanAddresses(ifaces = os.networkInterfaces()) {
  return Object.values(ifaces).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

function ensureCertificate(ip) {
  if (fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE)) return;
  fs.mkdirSync(CERT_DIR, { recursive: true });
  try {
    execFileSync('openssl', certArgs(ip), { stdio: 'inherit' });
  } catch (err) {
    throw new Error('Could not create a certificate with openssl. Install OpenSSL (or mkcert) and run again. ' + err.message);
  }
}

function handler(req, res) {
  const file = resolveRequest(ROOT, req.url);
  // Keep the certificate folder private even though it sits inside the project.
  if (!file || file.startsWith(CERT_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') res.end(); else res.end(data);
  });
}

function main() {
  const port = Number(process.argv[2] || process.env.PORT || 8443);
  const ips = lanAddresses();
  const ip = ips[0] || '127.0.0.1';
  ensureCertificate(ip);
  const server = https.createServer({ cert: fs.readFileSync(CERT_FILE), key: fs.readFileSync(KEY_FILE) }, handler);
  server.listen(port, '0.0.0.0', () => {
    console.log(`FarGems over HTTPS on this PC: https://localhost:${port}/`);
    for (const a of ips) console.log(`On your phone (same Wi-Fi): https://${a}:${port}/`);
    console.log('Accept the certificate warning once. Ctrl+C to stop.');
  });
}

if (require.main === module) main();

module.exports = { contentType, resolveRequest, certArgs, lanAddresses, MIME };

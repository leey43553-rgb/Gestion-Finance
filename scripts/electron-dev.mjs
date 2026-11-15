import { spawn } from 'node:child_process';
import http from 'node:http';

const DEV_URL = 'http://localhost:3000';

function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http
        .get(url, (res) => {
          res.resume();
          resolve();
        })
        .on('error', () => {
          if (Date.now() - start > timeoutMs) {
            reject(new Error('Délai dépassé en attendant Vite sur le port 3000.'));
          } else {
            setTimeout(check, 400);
          }
        });
    };
    check();
  });
}

const isWin = process.platform === 'win32';
const viteProc = spawn(isWin ? 'npx.cmd' : 'npx', ['vite', '--port=3000', '--host=127.0.0.1'], {
  stdio: 'inherit',
  shell: isWin,
});

waitForServer(DEV_URL)
  .then(() => {
    const electronProc = spawn(isWin ? 'npx.cmd' : 'npx', ['electron', '.'], {
      stdio: 'inherit',
      shell: isWin,
      env: { ...process.env, VITE_DEV_SERVER_URL: DEV_URL },
    });

    electronProc.on('close', (code) => {
      viteProc.kill();
      process.exit(code ?? 0);
    });
  })
  .catch((err) => {
    console.error(err);
    viteProc.kill();
    process.exit(1);
  });

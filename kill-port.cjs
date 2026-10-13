// Kill all node processes using a Node script (cross-platform)
const { execSync } = require('child_process');
try {
  const out = execSync('netstat -ano 2>nul', { encoding: 'utf8' });
  const lines = out.split('\n');
  for (const line of lines) {
    if (line.includes(':3000')) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && !isNaN(pid)) {
        try { process.kill(pid); console.log('killed pid ' + pid); } catch (e) { console.log('kill failed ' + pid + ': ' + e.message); }
      }
    }
  }
} catch (e) {
  console.log('netstat error: ' + e.message);
}

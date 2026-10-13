const { execSync } = require('child_process');
// Get PIDs listening on port 3000
try {
  const out = execSync('netstat -ano 2>nul', { encoding: 'utf8' });
  for (const line of out.split('\n')) {
    if (line.includes(':3000')) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && !isNaN(pid)) {
        try {
          process.kill(pid);
          console.log('killed node pid ' + pid);
        } catch (e) {
          console.log('kill failed pid ' + pid + ': ' + e.message);
        }
      }
    }
  }
} catch (e) {
  console.log('netstat error: ' + e.message);
}

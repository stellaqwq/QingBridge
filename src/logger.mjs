// Deliberately exclude message bodies, credentials and driver exception text.
export function createLogger(write = line => process.stdout.write(`${line}\n`)) {
  return (level, event, fields = {}) => {
    const safe = {};
    for (const key of ['job', 'state', 'code', 'count', 'port', 'driver', 'attempt', 'reason']) {
      if (fields[key] !== undefined) safe[key] = fields[key];
    }
    write(JSON.stringify({ time: new Date().toISOString(), level, event, ...safe }));
  };
}

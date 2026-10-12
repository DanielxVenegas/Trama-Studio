/* Registro básico en consola con marca de tiempo, nivel y origen. Sin dependencias.
   Con LOG_LEVEL=silent no escribe nada (lo usan las pruebas automatizadas). */
const write = (stream, level, scope, message) => {
  if (process.env.LOG_LEVEL === 'silent') return;
  stream.write(`${new Date().toISOString()} ${level} [${scope}] ${message}\n`);
};

module.exports = {
  info: (scope, message) => write(process.stdout, 'INFO', scope, message),
  warn: (scope, message) => write(process.stderr, 'WARN', scope, message),
  error: (scope, message) => write(process.stderr, 'ERROR', scope, message),
  detail: e => (e && e.stack ? e.stack : String(e))
};

'use strict';

const {
  RUNTIME_HOST,
  endpointPaths,
  readJson,
  validPort,
  readRememberedRuntimePort,
  rememberRuntimePort
} = require('./runtime_endpoint');

function ensureRememberedRuntimePort(baseDir) {
  const remembered = readRememberedRuntimePort(baseDir);
  if (remembered) return remembered;

  const current = readJson(endpointPaths(baseDir).state);
  const port = validPort(current?.port);
  if (current?.active === true && current?.host === RUNTIME_HOST && port) {
    return rememberRuntimePort(baseDir, port);
  }
  return null;
}

module.exports = { ensureRememberedRuntimePort };

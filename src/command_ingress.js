'use strict';

const COMMAND_MESSAGE_TYPE = 'body.command';

function commandError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizeText(value) {
  if (typeof value !== 'string') throw commandError('body_command_text_string_required');
  const text = value.trim();
  if (!text) throw commandError('body_command_text_required');
  return text;
}

function assertTextOnlyPayload(payload, label = 'command') {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw commandError(`${label}_object_required`);
  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== 'text') throw commandError(`${label}_text_only`);
  return { text: normalizeText(payload.text) };
}

class BodyCommandIngress {
  constructor({ runCommand } = {}) {
    if (typeof runCommand !== 'function') throw commandError('body_command_runner_required');
    this.runCommand = runCommand;
  }

  async dispatch(source, payload) {
    const command = assertTextOnlyPayload(payload, `${source}_command`);
    const result = await this.runCommand({ text: command.text, source });
    return {
      ...result,
      commandIngress: {
        source,
        textOnly: true
      }
    };
  }
}

module.exports = { COMMAND_MESSAGE_TYPE, normalizeText, assertTextOnlyPayload, BodyCommandIngress };

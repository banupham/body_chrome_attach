'use strict';

function commandError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function stripOuterQuotes(value) {
  const text = String(value ?? '').trim();
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    return text.slice(1, -1);
  }
  return text;
}

function number(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw commandError(`${name}_number_required`);
  return parsed;
}

function parseBodyCommand(input) {
  if (typeof input !== 'string') throw commandError('body_command_text_required');
  const text = input.trim();
  if (!text) throw commandError('body_command_text_required');

  const typeMatch = /^type\s+([\s\S]+)$/i.exec(text);
  if (typeMatch) return { type: 'typeText', text: stripOuterQuotes(typeMatch[1]) };

  const parts = text.split(/\s+/);
  const verb = String(parts.shift() || '').toLowerCase();

  if (verb === 'move') return { type: 'move', x: number(parts[0], 'x'), y: number(parts[1], 'y') };
  if (verb === 'click') return { type: 'click', x: number(parts[0], 'x'), y: number(parts[1], 'y') };
  if (verb === 'doubleclick' || verb === 'double-click') return { type: 'doubleClick', x: number(parts[0], 'x'), y: number(parts[1], 'y') };
  if (verb === 'scroll') {
    const command = { type: 'scroll', deltaY: number(parts[0], 'deltaY') };
    if (parts[1] != null && parts[2] != null) {
      command.x = number(parts[1], 'x');
      command.y = number(parts[2], 'y');
    }
    return command;
  }
  if (verb === 'press') {
    const key = parts.join(' ').trim();
    if (!key) throw commandError('key_required');
    return { type: 'pressKey', key };
  }
  if (verb === 'combo') {
    const key = parts.join('').trim();
    if (!key) throw commandError('key_combo_required');
    return { type: 'keyCombo', key };
  }
  if (verb === 'submit') {
    const command = { type: 'submit' };
    if (parts[0] != null && parts[1] != null) {
      command.x = number(parts[0], 'x');
      command.y = number(parts[1], 'y');
    }
    return command;
  }
  if (verb === 'status') return { type: 'status' };
  if (verb === 'profile') return { type: 'profile' };
  if (verb === 'events') return { type: 'events', limit: Math.max(1, Math.min(5000, Number(parts[0]) || 250)) };
  if (verb === 'attach') return { type: 'attach' };
  if (verb === 'detach') return { type: 'detach' };
  if (verb === 'help') return { type: 'help' };

  throw commandError(`body_command_unsupported:${verb}`);
}

module.exports = { parseBodyCommand };

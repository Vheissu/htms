import { EventModifiers, TemplateBinding } from './ir';
import { SourceElement } from '../source-dom';

// Inline directive attributes on ordinary markup:
//
//   <button on:click="count++">          event listener (alias: @click)
//   <form on:submit.prevent="save()">    with modifiers
//   <input bind:value="name">            two-way binding
//   <li class:done="todo.done">          conditional class
//   <div style:width="pct + '%'">        inline style property
//   <p if="error">{error}</p>            conditional rendering
//
// The HTML parser lowercases attribute names, so event types and property
// names are matched in lower case.

const EVENT_PREFIXES = ['on:', '@'];
const KEY_MODIFIERS = new Map([
  ['enter', 'Enter'],
  ['esc', 'Escape'],
  ['escape', 'Escape'],
  ['space', ' '],
  ['tab', 'Tab'],
  ['up', 'ArrowUp'],
  ['down', 'ArrowDown'],
  ['left', 'ArrowLeft'],
  ['right', 'ArrowRight'],
  ['delete', 'Delete'],
  ['backspace', 'Backspace'],
]);
const KEYBOARD_EVENTS = new Set(['keydown', 'keyup', 'keypress']);
const DEFAULT_DEBOUNCE_MS = 300;
const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_:-]*$/;
const CLASS_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const STYLE_PROPERTY_PATTERN = /^(--[a-zA-Z0-9_-]+|[a-z][a-z-]*)$/;

// bind:<property> → DOM property name and the event that reports changes.
const BINDABLE_PROPERTIES = new Map<
  string,
  { property: string; eventType: string }
>([
  ['value', { property: 'value', eventType: 'input' }],
  ['checked', { property: 'checked', eventType: 'change' }],
  ['valueasnumber', { property: 'valueAsNumber', eventType: 'input' }],
  ['selectedindex', { property: 'selectedIndex', eventType: 'change' }],
  ['open', { property: 'open', eventType: 'toggle' }],
]);

const IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

function isBindingPath(path: string): boolean {
  const segments = path.split('.');
  if (segments[0] === 'this') {
    segments.shift();
  }
  return (
    segments.length > 0 && segments.every((segment) => IDENTIFIER.test(segment))
  );
}

export const CONDITIONAL_ATTRIBUTE = 'if';

export function isBindingAttribute(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === CONDITIONAL_ATTRIBUTE ||
    EVENT_PREFIXES.some((prefix) => lower.startsWith(prefix)) ||
    lower.startsWith('bind:') ||
    lower.startsWith('class:') ||
    lower.startsWith('style:')
  );
}

export interface BindingParseResult {
  binding?: TemplateBinding;
  error?: string;
}

function applyFlagModifier(
  modifiers: EventModifiers,
  modifier: string
): boolean {
  switch (modifier) {
    case 'prevent':
      modifiers.prevent = true;
      return true;
    case 'stop':
      modifiers.stop = true;
      return true;
    case 'once':
      modifiers.once = true;
      return true;
    case 'passive':
      modifiers.passive = true;
      return true;
    case 'self':
      modifiers.self = true;
      return true;
    case 'capture':
      modifiers.capture = true;
      return true;
    default:
      return false;
  }
}

function parseEventBinding(rawName: string, value: string): BindingParseResult {
  const [eventType, ...modifierNames] = rawName.split('.');
  if (!eventType || !EVENT_TYPE_PATTERN.test(eventType)) {
    return { error: `Invalid event name in "${rawName}"` };
  }
  if (!value.trim()) {
    return { error: `Event attribute for "${eventType}" needs a statement` };
  }

  const modifiers: EventModifiers = {};
  for (const modifier of modifierNames) {
    if (modifier === 'debounce' || modifier.startsWith('debounce-')) {
      const delay = modifier === 'debounce' ? '' : modifier.slice(9);
      if (delay && !/^\d+$/.test(delay)) {
        return { error: `Invalid debounce delay in ".${modifier}"` };
      }
      modifiers.debounceMs = delay ? Number(delay) : DEFAULT_DEBOUNCE_MS;
      continue;
    }
    if (applyFlagModifier(modifiers, modifier)) {
      continue;
    }
    const key = KEY_MODIFIERS.get(modifier);
    if (key && KEYBOARD_EVENTS.has(eventType)) {
      modifiers.key = key;
      continue;
    }
    return {
      error: `Unknown event modifier ".${modifier}" on ${eventType}`,
    };
  }

  return {
    binding: {
      kind: 'event',
      eventType,
      code: value.trim(),
      modifiers,
    },
  };
}

function parseModelBinding(
  propertyName: string,
  value: string,
  element: SourceElement
): BindingParseResult {
  const bindable = BINDABLE_PROPERTIES.get(propertyName);
  if (!bindable) {
    return {
      error: `bind:${propertyName} is not supported. Use one of: ${Array.from(BINDABLE_PROPERTIES.keys()).join(', ')}`,
    };
  }
  const path = value.trim();
  if (!isBindingPath(path)) {
    return {
      error: `bind:${propertyName} needs a field path such as "name" or "user.email"`,
    };
  }

  const inputType = (element.getAttribute('type') || '').toLowerCase();
  const isSelect = element.localName === 'select';
  const numeric =
    bindable.property === 'value' &&
    (inputType === 'number' || inputType === 'range');
  return {
    binding: {
      kind: 'model',
      property: bindable.property,
      eventType:
        bindable.property === 'value' && isSelect
          ? 'change'
          : bindable.eventType,
      path,
      numeric,
    },
  };
}

export function parseBindingAttribute(
  name: string,
  value: string,
  element: SourceElement
): BindingParseResult {
  const lower = name.toLowerCase();

  if (lower === CONDITIONAL_ATTRIBUTE) {
    return value.trim()
      ? { binding: { kind: 'if', expression: value.trim() } }
      : { error: 'The if attribute needs a condition' };
  }

  const eventPrefix = EVENT_PREFIXES.find((prefix) => lower.startsWith(prefix));
  if (eventPrefix) {
    return parseEventBinding(lower.slice(eventPrefix.length), value);
  }

  if (lower.startsWith('bind:')) {
    return parseModelBinding(lower.slice(5), value, element);
  }

  if (lower.startsWith('class:')) {
    const className = name.slice(6);
    if (!CLASS_NAME_PATTERN.test(className)) {
      return { error: `Invalid class name in "${name}"` };
    }
    if (!value.trim()) {
      return { error: `${name} needs a condition` };
    }
    return {
      binding: { kind: 'class', className, expression: value.trim() },
    };
  }

  if (lower.startsWith('style:')) {
    const property = lower.slice(6);
    if (!STYLE_PROPERTY_PATTERN.test(property)) {
      return { error: `Invalid style property in "${name}"` };
    }
    if (!value.trim()) {
      return { error: `${name} needs a value expression` };
    }
    return {
      binding: { kind: 'style', property, expression: value.trim() },
    };
  }

  return { error: `Unknown binding attribute "${name}"` };
}

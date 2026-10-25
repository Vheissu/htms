// Source text of the members generated component classes share, indented
// for the class body. Member runs end with a blank line.

export function renderRootHelper(shadowMode: 'open' | 'closed'): string {
  return `  __htmsEnsureRenderRoot() {
    if (this.__htmsRoot) {
      return this.__htmsRoot;
    }

    const declarativeTemplate = Array.from(this.children).find(child =>
      child.localName === 'template' && child.hasAttribute('shadowrootmode')
    );
    const existingRoot = this.shadowRoot;
    const root = existingRoot || this.attachShadow({ mode: '${shadowMode}' });
    if (declarativeTemplate) {
      root.appendChild(declarativeTemplate.content);
      declarativeTemplate.remove();
    }
    this.__htmsRoot = root;
    return root;
  }

`;
}

export const ATTRIBUTE_CHANGED_CALLBACK = `  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) {
      return;
    }
    const reflected = this.__htmsSetInputFromAttribute(name, newValue);
    if (!reflected && this.__htmsConnected) {
      this.requestUpdate();
    }
  }`;

export function inputHelpers(inputMap: object): string {
  return `  static get __htmsInputMap() {
    return ${JSON.stringify(inputMap)};
  }

  __htmsDeserializeAttribute(type, value) {
    if (type === 'boolean') {
      return value !== null;
    }
    if (value === null) {
      return null;
    }
    if (type === 'number') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (type === 'json') {
      try {
        return JSON.parse(value);
      } catch (error) {
        return null;
      }
    }
    return value;
  }

  __htmsDefineInputProperty(propName, attributeName, type, bit, rendered) {
    const hadOwnValue = Object.prototype.hasOwnProperty.call(this, propName);
    const ownValue = hadOwnValue ? this[propName] : undefined;
    if (hadOwnValue) {
      delete this[propName];
    }

    // \`bit\` marks the property dirty; \`rendered\` is false when nothing
    // the component renders reads it, so a change needs no render.
    Object.defineProperty(this, propName, {
      configurable: true,
      enumerable: true,
      get: () => this.__htmsProps[propName],
      set: value => {
        const previous = this.__htmsProps[propName];
        if (Object.is(previous, value)) {
          return;
        }
        this.__htmsProps[propName] = value;
        this.__htmsDirty |= bit;
        if (rendered) {
          this.__htmsRequestRender();
        }
      }
    });

    if (hadOwnValue) {
      this.__htmsProps[propName] = ownValue;
      return;
    }

    if (this.hasAttribute(attributeName)) {
      this.__htmsProps[propName] = this.__htmsDeserializeAttribute(
        type,
        this.getAttribute(attributeName)
      );
      return;
    }

    this.__htmsProps[propName] = type === 'boolean' ? false : null;
  }

  __htmsSetInputFromAttribute(name, value) {
    const input = this.constructor.__htmsInputMap[name];
    if (!input) {
      return false;
    }
    this[input.propName] = this.__htmsDeserializeAttribute(input.type, value);
    return true;
  }

`;
}

export const STATE_HELPERS = `  __htmsDefineStateProperty(propName, bit = -1, rendered = true) {
    const hadOwnValue = Object.prototype.hasOwnProperty.call(this, propName);
    const ownValue = hadOwnValue ? this[propName] : undefined;
    if (hadOwnValue) {
      delete this[propName];
    }

    Object.defineProperty(this, propName, {
      configurable: true,
      enumerable: true,
      get: () => this.__htmsState[propName],
      set: value => {
        const previous = this.__htmsState[propName];
        if (Object.is(previous, value)) {
          return;
        }
        this.__htmsState[propName] = value;
        this.__htmsDirty |= bit;
        if (rendered && !this.__htmsRendering) {
          this.__htmsRequestRender();
        }
      }
    });

    if (hadOwnValue) {
      this.__htmsState[propName] = ownValue;
    }
  }

  __htmsAdoptState(propName) {
    // A value assigned before the element upgraded is an own property that
    // would hide the class accessor; move it into state.
    if (Object.prototype.hasOwnProperty.call(this, propName)) {
      const value = this[propName];
      delete this[propName];
      this.__htmsState[propName] = value;
    }
  }

  __htmsNotifyStateChange(mask = -1) {
    // \`mask\` names the fields a nested write changed; every bit when the
    // caller does not know.
    this.__htmsDirty |= mask;
    if (!this.__htmsRendering) {
      this.__htmsRequestRender();
    }
  }

  __htmsResolvePath(path) {
    if (!Array.isArray(path) || path.length === 0) {
      throw new Error('Invalid state path');
    }
    let ref = this;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      const next = ref[key];
      if (next === undefined || next === null || typeof next !== 'object') {
        ref[key] = {};
      }
      ref = ref[key];
    }
    return { target: ref, key: path[path.length - 1] };
  }

  __htmsInitState(path, initializer) {
    const { target, key } = this.__htmsResolvePath(path);
    const storage = target === this ? this.__htmsState : target;
    if (!Object.prototype.hasOwnProperty.call(storage, key)) {
      target[key] = initializer();
    }
  }

  __htmsSetState(path, op, valueFactory, mask) {
    const { target, key } = this.__htmsResolvePath(path);
    if (op === '++') {
      const current = typeof target[key] === 'number' ? target[key] : 0;
      target[key] = current + 1;
      this.__htmsNotifyStateChange(mask);
      return;
    }
    if (op === '--') {
      const current = typeof target[key] === 'number' ? target[key] : 0;
      target[key] = current - 1;
      this.__htmsNotifyStateChange(mask);
      return;
    }
    const current = target[key];
    const value = valueFactory();
    switch (op) {
      case '+=':
        if (current == null) {
          target[key] = typeof value === 'string' ? value : 0 + value;
        } else {
          target[key] = current + value;
        }
        break;
      case '-=':
        target[key] = (typeof current === 'number' ? current : 0) - value;
        break;
      case '*=':
        target[key] = (typeof current === 'number' ? current : 0) * value;
        break;
      case '/=':
        target[key] = (typeof current === 'number' ? current : 0) / value;
        break;
      default:
        target[key] = value;
    }
    this.__htmsNotifyStateChange(mask);
  }

  __htmsEnsureArray(path) {
    const { target, key } = this.__htmsResolvePath(path);
    if (!Array.isArray(target[key])) {
      target[key] = [];
    }
    return target[key];
  }

  __htmsPushState(path, valueFactory, mask) {
    const arr = this.__htmsEnsureArray(path);
    arr.push(valueFactory());
    this.__htmsNotifyStateChange(mask);
  }

  __htmsSpliceState(path, indexFactory, deleteFactory, valuesFactory, mask) {
    const arr = this.__htmsEnsureArray(path);
    const index = indexFactory();
    const del = deleteFactory();
    const values = valuesFactory();
    arr.splice(index, del, ...values);
    this.__htmsNotifyStateChange(mask);
  }

`;

export const UPDATE_HELPERS = `  get updateComplete() {
    // A promise exists only while a render is pending and someone waits.
    if (!this.__htmsRenderScheduled && !this.__htmsRendering) {
      return Promise.resolve();
    }
    return this.__htmsUpdatePromise || (this.__htmsUpdatePromise = new Promise(resolve => {
      this.__htmsResolveUpdate = resolve;
    }));
  }

  get renderError() {
    return this.__htmsLastError;
  }

  requestUpdate() {
    this.__htmsDirty = -1;
    this.__htmsRequestRender();
    return this.updateComplete;
  }

  $(selector) {
    return (this.__htmsRoot || this).querySelector(selector);
  }

  $$(selector) {
    return Array.from((this.__htmsRoot || this).querySelectorAll(selector));
  }

  emit(name, detail, options) {
    return this.dispatchEvent(new CustomEvent(name, Object.assign({
      detail,
      bubbles: true,
      composed: true,
      cancelable: false
    }, options)));
  }

  __htmsAfterMethod(mask = -1) {
    // Methods may mutate nested state; re-render afterwards unless the
    // method was called while rendering (e.g. from an interpolation).
    // \`mask\` names the fields the method's nested writes can change.
    this.__htmsDirty |= mask;
    if (!this.__htmsRendering) {
      this.__htmsRequestRender();
    }
  }

  __htmsSafeUrl(value) {
    const text = value == null ? '' : String(value);
    const normalized = text.replace(/[\\u0000-\\u0020]/g, '').toLowerCase();
    if (
      normalized.startsWith('javascript:') ||
      normalized.startsWith('vbscript:') ||
      normalized.startsWith('data:text/html')
    ) {
      console.warn('HTMS blocked an unsafe URL:', text);
      return 'about:blank';
    }
    return text;
  }

  __htmsToText(value) {
    return value == null ? '' : String(value);
  }

  __htmsRequestRender() {
    if (this.__htmsConnected && !this.__htmsRenderScheduled) {
      this.__htmsRenderScheduled = true;
      queueMicrotask(this.__htmsFlush);
    }
  }

  __htmsFlushRender() {
    if (!this.__htmsRenderScheduled) {
      return;
    }
    this.__htmsRenderScheduled = false;
    if (this.__htmsConnected) {
      this.render();
    } else {
      this.__htmsFinishUpdate();
    }
  }

  __htmsFinishUpdate() {
    const resolve = this.__htmsResolveUpdate;
    if (resolve) {
      this.__htmsResolveUpdate = null;
      this.__htmsUpdatePromise = null;
      resolve();
    }
  }

  __htmsReportRenderError(error) {
    this.__htmsLastError = error;
    const errorEvent = new CustomEvent('htms-error', {
      detail: { error, component: this },
      bubbles: true,
      composed: true,
      cancelable: true
    });
    const shouldLog = this.dispatchEvent(errorEvent);
    if (shouldLog) {
      console.error('HTMS component render failed:', error);
    }
  }

`;

export const LEGACY_LISTENER_HELPERS = `  __htmsMarkListener(target, eventType, handler, options) {
    if (!target.__htmsListeners) {
      target.__htmsListeners = [];
    }
    target.__htmsListeners.push({ eventType, handler, options });
  }

  __htmsActivateListeners(target, source) {
    const listeners = source.__htmsListeners || [];
    for (const listener of listeners) {
      this.__htmsListen(target, listener.eventType, listener.handler, listener.options);
    }
  }

  __htmsResolveEventRoot(currentTarget, sourceScope) {
    if (sourceScope && sourceScope.__htmsMountedNode) {
      return sourceScope.__htmsMountedNode;
    }
    if (sourceScope && sourceScope.nodeType === Node.ELEMENT_NODE && sourceScope.isConnected) {
      return sourceScope;
    }
    const eventRoot = currentTarget && typeof currentTarget.getRootNode === 'function'
      ? currentTarget.getRootNode()
      : null;
    if (eventRoot && eventRoot !== document) {
      return eventRoot;
    }
    return this.__htmsRoot || this;
  }

`;

export const SHARED_EVENT_HELPERS = `  __htmsListen(target, eventType, handler, options) {
    target.addEventListener(eventType, handler, options);
    this.__htmsRenderCleanups.push(() => {
      target.removeEventListener(eventType, handler, options);
    });
  }

  __htmsClaimOnce(target, id) {
    if (!target) {
      return true;
    }
    if (!target.__htmsOnceFired) {
      target.__htmsOnceFired = new Set();
    }
    if (target.__htmsOnceFired.has(id)) {
      return false;
    }
    target.__htmsOnceFired.add(id);
    return true;
  }

  __htmsDebounce(event, id, delay, callback) {
    const target = event.currentTarget;
    const deferred = this.__htmsDeferEvent(event);
    let timers = this.__htmsTimers.get(target);
    if (!timers) {
      timers = new Map();
      this.__htmsTimers.set(target, timers);
    }
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      if (timers.size === 0) {
        this.__htmsTimers.delete(target);
      }
      callback(deferred);
    }, delay));
  }

  __htmsDeferEvent(event) {
    // currentTarget is reset to null once dispatch ends; keep the value the
    // handler saw so deferred bodies can still read event.currentTarget.
    const currentTarget = event.currentTarget;
    if (typeof Proxy !== 'function') {
      return event;
    }
    return new Proxy(event, {
      get(target, property) {
        if (property === 'currentTarget') {
          return currentTarget;
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  }

  __htmsClearTimers() {
    for (const timers of this.__htmsTimers.values()) {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
    }
    this.__htmsTimers.clear();
  }

  __htmsCleanupRenderListeners() {
    const cleanups = this.__htmsRenderCleanups;
    this.__htmsRenderCleanups = [];
    for (const cleanup of cleanups) {
      cleanup();
    }
  }

`;

export function reconciliationHelpers(hasEventDirectives: boolean): string {
  return `  __htmsMarkProperty(target, path, value) {
    if (!target.__htmsProperties) {
      target.__htmsProperties = [];
    }
    target.__htmsProperties.push({ path, value });
  }

  __htmsApplyProperties(target, source) {
    const properties = source.__htmsProperties;
    if (!properties) return;
    for (const property of properties) {
      let receiver = target;
      for (const segment of property.path.slice(0, -1)) {
        if (receiver[segment] == null) {
          receiver[segment] = {};
        }
        receiver = receiver[segment];
      }
      receiver[property.path[property.path.length - 1]] = property.value;
    }
  }

  __htmsNodesMatch(target, source) {
    if (
      !target ||
      target.nodeType !== source.nodeType ||
      target.nodeName !== source.nodeName ||
      target.namespaceURI !== source.namespaceURI
    ) {
      return false;
    }
    if (source.nodeType !== Node.ELEMENT_NODE) {
      return true;
    }
    const sourceKey = source.getAttribute('data-key');
    const targetKey = target.getAttribute('data-key');
    return sourceKey === null && targetKey === null
      ? true
      : sourceKey === targetKey;
  }

  __htmsFindMatchingNode(reference, source, keyedTargets, idTargets) {
    if (source.nodeType === Node.ELEMENT_NODE) {
      const key = source.getAttribute('data-key');
      const id = source.id;
      if (key !== null) {
        const candidate = keyedTargets && keyedTargets.get(key);
        if (this.__htmsNodesMatch(candidate, source)) {
          keyedTargets.delete(key);
          return candidate;
        }
      } else if (id) {
        const candidate = idTargets && idTargets.get(id);
        if (this.__htmsNodesMatch(candidate, source)) {
          idTargets.delete(id);
          return candidate;
        }
      }
    }
    return this.__htmsNodesMatch(reference, source) ? reference : null;
  }

  __htmsAttributeSnapshot(node) {
    const attrs = node.attributes;
    // null is a recorded empty snapshot; undefined means not adopted yet.
    if (attrs.length === 0) return null;
    const snapshot = Object.create(null);
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      snapshot[attr.name] = attr.value;
    }
    return snapshot;
  }

  __htmsRecordAttributes(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    node.__htmsAttrs = this.__htmsAttributeSnapshot(node);
    Array.from(node.querySelectorAll('*')).forEach(child => {
      child.__htmsAttrs = this.__htmsAttributeSnapshot(child);
    });
  }

  __htmsSyncAttributes(target, source) {
    const next = this.__htmsAttributeSnapshot(source);
    const previous = target.__htmsAttrs;
    if (previous === undefined) {
      // First sync of an adopted node (server-rendered markup): match the
      // rendered output exactly.
      Array.from(target.attributes).forEach(attr => {
        if (!next || !(attr.name in next)) {
          target.removeAttribute(attr.name);
        }
      });
      for (const name in next) {
        if (target.getAttribute(name) !== next[name]) {
          target.setAttribute(name, next[name]);
        }
      }
    } else {
      // Only touch attributes whose rendered value changed. Attributes the
      // browser or other code changed (an opened <details>, a class added by
      // a library) survive unrelated re-renders.
      for (const name in previous) {
        if (!next || !(name in next)) {
          target.removeAttribute(name);
        }
      }
      for (const name in next) {
        if (!previous || previous[name] !== next[name]) {
          target.setAttribute(name, next[name]);
        }
      }
    }
    target.__htmsAttrs = next;
  }

  __htmsActivateTree(node) {
${
  hasEventDirectives
    ? `    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    this.__htmsActivateListeners(node, node);
    Array.from(node.querySelectorAll('*')).forEach(child => {
      this.__htmsActivateListeners(child, child);
    });
`
    : `    return;
`
}  }

  __htmsSyncNode(target, source) {
    source.__htmsMountedNode = target;
    if (
      source.nodeType === Node.TEXT_NODE ||
      source.nodeType === Node.COMMENT_NODE
    ) {
      if (target.nodeValue !== source.nodeValue) {
        target.nodeValue = source.nodeValue;
      }
      return;
    }
    if (source.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    this.__htmsSyncAttributes(target, source);
    this.__htmsApplyProperties(target, source);
${
  hasEventDirectives
    ? `    this.__htmsActivateListeners(target, source);
`
    : ''
}    if (source.localName === 'template' && target.content && source.content) {
      this.__htmsReconcileChildren(target.content, source.content);
      return;
    }
    this.__htmsReconcileChildren(target, source);
  }

  __htmsReconcileChildren(targetParent, sourceParent) {
    if (!sourceParent.firstChild) {
      if (targetParent.firstChild) targetParent.textContent = '';
      return;
    }
    const sourceChildren = Array.from(sourceParent.childNodes);
    // Most child lists have no identities to look up.
    let keyedTargets = null;
    let idTargets = null;
    Array.from(targetParent.children || []).forEach(child => {
      const key = child.getAttribute('data-key');
      if (key !== null) {
        if (!keyedTargets) keyedTargets = new Map();
        if (!keyedTargets.has(key)) keyedTargets.set(key, child);
      }
      if (child.id) {
        if (!idTargets) idTargets = new Map();
        if (!idTargets.has(child.id)) idTargets.set(child.id, child);
      }
    });
    let reference = targetParent.firstChild;

    for (const source of sourceChildren) {
      const match = this.__htmsFindMatchingNode(
        reference,
        source,
        keyedTargets,
        idTargets
      );
      if (!match) {
        targetParent.insertBefore(source, reference);
        source.__htmsMountedNode = source;
        this.__htmsRecordAttributes(source);
        this.__htmsActivateTree(source);
        reference = source.nextSibling;
        continue;
      }

      if (match !== reference) {
        targetParent.insertBefore(match, reference);
      }
      this.__htmsSyncNode(match, source);
      reference = match.nextSibling;
    }

    while (reference) {
      const next = reference.nextSibling;
      targetParent.removeChild(reference);
      reference = next;
    }
  }

`;
}

export const FOCUS_HELPERS = `  __htmsSnapshotFocus(root, controlledSelectors) {
    const documentActive = typeof document !== 'undefined' ? document.activeElement : null;
    const candidate = root.activeElement || (documentActive && root.contains(documentActive) ? documentActive : null);
    if (!candidate || candidate === root) {
      return null;
    }

    const path = [];
    let current = candidate;
    while (current && current !== root) {
      const parent = current.parentNode;
      if (!parent) {
        return null;
      }
      path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
      current = parent;
    }
    if (current !== root) {
      return null;
    }

    let controlled = candidate.__htmsControlled === true;
    if (!controlled && typeof candidate.matches === 'function') {
      for (const selector of controlledSelectors) {
        try {
          if (candidate.matches(selector)) {
            controlled = true;
            break;
          }
        } catch (error) {
          console.warn('HTMS ignored invalid controlled selector:', selector, error);
        }
      }
    }

    return {
      path,
      id: candidate.id || null,
      nodeName: candidate.nodeName,
      value: !controlled && 'value' in candidate ? candidate.value : undefined,
      checked: !controlled && 'checked' in candidate ? candidate.checked : undefined,
      selectionStart: typeof candidate.selectionStart === 'number' ? candidate.selectionStart : null,
      selectionEnd: typeof candidate.selectionEnd === 'number' ? candidate.selectionEnd : null,
      selectionDirection: candidate.selectionDirection || 'none',
      scrollTop: candidate.scrollTop,
      scrollLeft: candidate.scrollLeft
    };
  }

  __htmsRestoreFocus(root, snapshot) {
    if (!snapshot) {
      return;
    }

    let candidate = null;
    if (snapshot.id) {
      candidate = Array.from(root.querySelectorAll('[id]')).find(node => node.id === snapshot.id) || null;
    }
    if (!candidate) {
      candidate = root;
      for (const index of snapshot.path) {
        candidate = candidate && candidate.childNodes ? candidate.childNodes[index] : null;
        if (!candidate) {
          return;
        }
      }
    }
    if (!candidate || candidate.nodeName !== snapshot.nodeName || typeof candidate.focus !== 'function') {
      return;
    }

    if (snapshot.value !== undefined && 'value' in candidate) {
      candidate.value = snapshot.value;
    }
    if (snapshot.checked !== undefined && 'checked' in candidate) {
      candidate.checked = snapshot.checked;
    }
    try {
      candidate.focus({ preventScroll: true });
    } catch (error) {
      candidate.focus();
    }
    if (
      snapshot.selectionStart !== null &&
      snapshot.selectionEnd !== null &&
      typeof candidate.setSelectionRange === 'function'
    ) {
      try {
        candidate.setSelectionRange(
          snapshot.selectionStart,
          snapshot.selectionEnd,
          snapshot.selectionDirection
        );
      } catch (error) {
        // Some input types do not expose a selectable text range.
      }
    }
    candidate.scrollTop = snapshot.scrollTop;
    candidate.scrollLeft = snapshot.scrollLeft;
  }

`;

export function staticTemplateGetter(html: string): string {
  return `  static get __htmsTemplate() {\n    if (!this.__templateCache) {\n      const template = document.createElement('template');\n      template.innerHTML = ${JSON.stringify(html)};\n      this.__templateCache = template;\n    }\n    return this.__templateCache;\n  }\n\n`;
}

// Statements every generated constructor starts with.
export const CONSTRUCTOR_START = `    super();
    this.__htmsRoot = null;
    this.__htmsProps = Object.create(__HTMS_CLASS__.__htmsStore());
    this.__htmsState = Object.create(__HTMS_CLASS__.__htmsStore());
    this.__htmsConnected = false;
    this.__htmsRendering = false;
    this.__htmsRenderScheduled = false;
    this.__htmsResolveUpdate = null;
    this.__htmsUpdatePromise = null;
    this.__htmsFlush = () => this.__htmsFlushRender();
    this.__htmsLastError = null;
    this.__htmsDirty = -1;
`;

export const ENSURE_RENDER_ROOT = `    this.__htmsEnsureRenderRoot();\n`;

export const DISCONNECT_START = `    this.__htmsConnected = false;
    this.__htmsRenderScheduled = false;
    this.__htmsFinishUpdate();
`;

// Effects registered with the shared runtime stop with their element.
export const DISPOSE_EFFECTS = `    if (typeof window !== 'undefined' && window.__htms && typeof window.__htms.disposeEffectsFor === 'function') {
      window.__htms.disposeEffectsFor(this);
    }
`;

export function renderMethod(body: string): string {
  return `  render() {
    this.__htmsRenderScheduled = false;
    this.__htmsRendering = true;
    this.__htmsLastError = null;
    try {
${body}
    } catch (error) {
      this.__htmsReportRenderError(error);
    } finally {
      this.__htmsRendering = false;
      this.__htmsFinishUpdate();
    }
  }`;
}

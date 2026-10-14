'use strict';

const { TextEncoder, TextDecoder } = require('util');
const { default: $JSDOMEnvironment, TestEnvironment } = require('jest-environment-jsdom');

Object.defineProperty(exports, '__esModule', {
  value: true
});

class JSDOMEnvironment extends $JSDOMEnvironment {
  constructor(...args) {
    const { global } = super(...args);
    if ( !global.TextEncoder )
      global.TextEncoder = TextEncoder;
    if ( !global.TextDecoder )
      global.TextDecoder = TextDecoder;
    if ( !global.Uint8Array )
      global.Uint8Array = Uint8Array;
    if ( typeof global.setImmediate !== 'function' ) {
      global.setImmediate = (fn, ...rest) => setTimeout(fn, 0, ...rest);
    }
    // jsdom's global lacks structuredClone, which Node and browsers have
    // and the JavaScript parser uses.
    if ( typeof global.structuredClone !== 'function' ) {
      global.structuredClone = structuredClone;
    }
  }
}

exports.default = JSDOMEnvironment;
exports.TestEnvironment = TestEnvironment === $JSDOMEnvironment ?
                            JSDOMEnvironment : TestEnvironment;

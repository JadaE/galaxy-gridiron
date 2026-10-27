// Test-only: stand-in for 'react-native' so pure modules that read Platform can run under tsx.
const Module = require('module');
const orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { return req === 'react-native' ? require.resolve('./rn-stub.cjs') : orig.call(this, req, ...a); };

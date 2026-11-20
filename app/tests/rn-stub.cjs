// Test-only: stand-in for 'react-native' so pure modules that read Platform can run under tsx.
module.exports = {
  Platform: { OS: 'android', Version: 35, constants: { Release: '15', Manufacturer: 'samsung', Model: 'SM-S921U' }, select: o => o.android ?? o.default },
  AppState: { addEventListener: () => ({ remove() {} }) },
};

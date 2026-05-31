const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Supabase's ESM build (index.mjs) uses `import(variable)` for optional OpenTelemetry
  // support, which Hermes can't compile. Force the CJS build (index.cjs) which uses
  // require() instead.
  if (moduleName === '@supabase/supabase-js') {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'node_modules/@supabase/supabase-js/dist/index.cjs'),
    };
  }

  // Stub out @opentelemetry/* — Node/browser-only, unused in React Native
  if (moduleName.startsWith('@opentelemetry/')) {
    return { type: 'empty' };
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

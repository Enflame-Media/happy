# Test Data - DO NOT IMPORT IN PRODUCTION CODE

This directory contains large JSON trace files used for testing the sync reducer.

## HAP-850: Production Bundle Exclusion

These files are explicitly excluded from production bundles via:

1. **metro.config.js**: `blockList` prevents Metro bundler from including `__testdata__/`
2. **vitest.config.ts**: Excluded from coverage reports
3. **oxlint.json**: Ignored by linter

## Files

- `trace_0.json`, `trace_1.json`, `trace_2.json` - Real Claude Code session traces for reducer testing

## Usage

These fixtures are only for local development and testing. If you need to use them in tests:

```typescript
// Only in *.spec.ts or *.test.ts files
const trace = require('./__testdata__/trace_0.json');
```

**Never import these files from production code paths.**

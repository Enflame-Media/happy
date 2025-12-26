#!/usr/bin/env npx tsx
/**
 * Bundle Size Analyzer for Happy App
 *
 * Analyzes the Expo web build output and generates a report of bundle sizes.
 * Used by CI/CD pipeline to track bundle size changes and detect regressions.
 *
 * Usage:
 *   npx tsx sources/scripts/analyzeBundleSize.ts [options]
 *
 * Options:
 *   --dist-dir <path>     Path to dist directory (default: ./dist)
 *   --baseline <path>     Path to baseline JSON file for comparison
 *   --output <path>       Path to output JSON file (default: ./bundle-stats.json)
 *   --format <type>       Output format: json, markdown, github (default: json)
 *   --threshold <percent> Alert threshold for size increase (default: 5)
 *   --fail-on-regression  Exit with code 1 if threshold exceeded
 *
 * @see HAP-555 - Add bundle size tracking to CI/CD pipeline
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

// ============================================================================
// Types
// ============================================================================

interface FileStats {
  path: string;
  size: number;
  sizeFormatted: string;
  gzipSize?: number;
  gzipFormatted?: string;
}

interface BundleStats {
  timestamp: string;
  commitHash?: string;
  branch?: string;
  jsBundle: {
    main: FileStats[];
    chunks: FileStats[];
    total: number;
    totalFormatted: string;
  };
  assets: {
    images: FileStats[];
    fonts: FileStats[];
    other: FileStats[];
    total: number;
    totalFormatted: string;
  };
  totalSize: number;
  totalFormatted: string;
}

interface BundleComparison {
  current: BundleStats;
  baseline?: BundleStats;
  diff: {
    jsBundle: { bytes: number; percent: number };
    assets: { bytes: number; percent: number };
    total: { bytes: number; percent: number };
  };
  regressions: string[];
  improvements: string[];
  alerts: string[];
}

// ============================================================================
// Utilities
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  const sign = bytes < 0 ? '' : '';
  return `${sign}${value.toFixed(2)} ${sizes[i]}`;
}

function formatPercent(percent: number): string {
  const sign = percent > 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
}

function getFilesRecursively(dir: string, pattern?: RegExp): string[] {
  const files: string[] = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getFilesRecursively(fullPath, pattern));
    } else if (!pattern || pattern.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function getFileStats(filePath: string, distDir: string): FileStats {
  const stats = fs.statSync(filePath);
  const relativePath = path.relative(distDir, filePath);

  return {
    path: relativePath,
    size: stats.size,
    sizeFormatted: formatBytes(stats.size),
  };
}

function getGitInfo(): { commitHash?: string; branch?: string } {
  const result: { commitHash?: string; branch?: string } = {};

  // Get commit hash from environment (GitHub Actions) or git command
  result.commitHash = process.env.GITHUB_SHA?.substring(0, 7);
  if (!result.commitHash) {
    try {
      // Use execFileSync with explicit arguments - no shell injection possible
      result.commitHash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      // Ignore git errors - this might run without git context
    }
  }

  // Get branch from environment or git command
  result.branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME;
  if (!result.branch) {
    try {
      // Use execFileSync with explicit arguments - no shell injection possible
      result.branch = execFileSync('git', ['branch', '--show-current'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      // Ignore git errors
    }
  }

  return result;
}

// ============================================================================
// Analysis
// ============================================================================

function analyzeBundleSize(distDir: string): BundleStats {
  const gitInfo = getGitInfo();

  // Find all files
  const allFiles = getFilesRecursively(distDir);

  // Categorize files
  const jsFiles = allFiles.filter(f => /\.js$/.test(f));
  const imageFiles = allFiles.filter(f => /\.(png|jpg|jpeg|gif|webp|svg|ico)$/i.test(f));
  const fontFiles = allFiles.filter(f => /\.(woff|woff2|ttf|otf|eot)$/i.test(f));
  const otherAssets = allFiles.filter(f =>
    !jsFiles.includes(f) &&
    !imageFiles.includes(f) &&
    !fontFiles.includes(f) &&
    !/\.(html|map|json|txt|css)$/i.test(f)
  );

  // Analyze JS bundles - main vs chunks
  const mainBundles = jsFiles.filter(f =>
    /bundle\.js$/.test(f) || /index.*\.js$/.test(f) || /main.*\.js$/.test(f)
  );
  const chunkBundles = jsFiles.filter(f => !mainBundles.includes(f));

  // Get stats for each category
  const mainStats = mainBundles.map(f => getFileStats(f, distDir));
  const chunkStats = chunkBundles.map(f => getFileStats(f, distDir));
  const imageStats = imageFiles.map(f => getFileStats(f, distDir));
  const fontStats = fontFiles.map(f => getFileStats(f, distDir));
  const otherStats = otherAssets.map(f => getFileStats(f, distDir));

  // Calculate totals
  const jsBundleTotal = [...mainStats, ...chunkStats].reduce((sum, f) => sum + f.size, 0);
  const assetsTotal = [...imageStats, ...fontStats, ...otherStats].reduce((sum, f) => sum + f.size, 0);
  const totalSize = jsBundleTotal + assetsTotal;

  return {
    timestamp: new Date().toISOString(),
    commitHash: gitInfo.commitHash,
    branch: gitInfo.branch,
    jsBundle: {
      main: mainStats.sort((a, b) => b.size - a.size),
      chunks: chunkStats.sort((a, b) => b.size - a.size),
      total: jsBundleTotal,
      totalFormatted: formatBytes(jsBundleTotal),
    },
    assets: {
      images: imageStats.sort((a, b) => b.size - a.size),
      fonts: fontStats.sort((a, b) => b.size - a.size),
      other: otherStats.sort((a, b) => b.size - a.size),
      total: assetsTotal,
      totalFormatted: formatBytes(assetsTotal),
    },
    totalSize,
    totalFormatted: formatBytes(totalSize),
  };
}

function compareStats(current: BundleStats, baseline: BundleStats, threshold: number): BundleComparison {
  const calcDiff = (curr: number, base: number) => ({
    bytes: curr - base,
    percent: base > 0 ? ((curr - base) / base) * 100 : 0,
  });

  const diff = {
    jsBundle: calcDiff(current.jsBundle.total, baseline.jsBundle.total),
    assets: calcDiff(current.assets.total, baseline.assets.total),
    total: calcDiff(current.totalSize, baseline.totalSize),
  };

  const regressions: string[] = [];
  const improvements: string[] = [];
  const alerts: string[] = [];

  // Check for regressions
  if (diff.jsBundle.percent > threshold) {
    const msg = `JS bundle increased by ${formatPercent(diff.jsBundle.percent)} (${formatBytes(diff.jsBundle.bytes)})`;
    regressions.push(msg);
    alerts.push(`⚠️ ${msg}`);
  } else if (diff.jsBundle.percent < -1) {
    improvements.push(`JS bundle decreased by ${formatPercent(Math.abs(diff.jsBundle.percent))} (${formatBytes(Math.abs(diff.jsBundle.bytes))})`);
  }

  if (diff.assets.percent > threshold) {
    const msg = `Assets increased by ${formatPercent(diff.assets.percent)} (${formatBytes(diff.assets.bytes)})`;
    regressions.push(msg);
    alerts.push(`⚠️ ${msg}`);
  } else if (diff.assets.percent < -1) {
    improvements.push(`Assets decreased by ${formatPercent(Math.abs(diff.assets.percent))} (${formatBytes(Math.abs(diff.assets.bytes))})`);
  }

  if (diff.total.percent > threshold) {
    alerts.push(`🚨 Total bundle size exceeded ${threshold}% threshold!`);
  }

  return {
    current,
    baseline,
    diff,
    regressions,
    improvements,
    alerts,
  };
}

// ============================================================================
// Output Formatters
// ============================================================================

function formatAsMarkdown(comparison: BundleComparison): string {
  const { current, baseline, diff } = comparison;

  let md = `## 📦 Bundle Size Report\n\n`;

  if (current.commitHash) {
    md += `**Commit:** \`${current.commitHash}\``;
    if (current.branch) {
      md += ` on \`${current.branch}\``;
    }
    md += `\n\n`;
  }

  // Summary table
  md += `### Summary\n\n`;
  md += `| Category | Size | ${baseline ? 'Change' : ''} |\n`;
  md += `|----------|------|${baseline ? '--------|' : ''}\n`;

  if (baseline) {
    md += `| **JS Bundle** | ${current.jsBundle.totalFormatted} | ${formatDiffCell(diff.jsBundle)} |\n`;
    md += `| **Assets** | ${current.assets.totalFormatted} | ${formatDiffCell(diff.assets)} |\n`;
    md += `| **Total** | ${current.totalFormatted} | ${formatDiffCell(diff.total)} |\n`;
  } else {
    md += `| **JS Bundle** | ${current.jsBundle.totalFormatted} |\n`;
    md += `| **Assets** | ${current.assets.totalFormatted} |\n`;
    md += `| **Total** | ${current.totalFormatted} |\n`;
  }

  md += `\n`;

  // Alerts
  if (comparison.alerts.length > 0) {
    md += `### ⚠️ Alerts\n\n`;
    for (const alert of comparison.alerts) {
      md += `- ${alert}\n`;
    }
    md += `\n`;
  }

  // Improvements
  if (comparison.improvements.length > 0) {
    md += `### ✅ Improvements\n\n`;
    for (const improvement of comparison.improvements) {
      md += `- ${improvement}\n`;
    }
    md += `\n`;
  }

  // Detailed breakdown (collapsible)
  md += `<details>\n<summary>📊 Detailed Breakdown</summary>\n\n`;

  // JS Bundle details
  md += `#### JS Bundle (${current.jsBundle.totalFormatted})\n\n`;

  if (current.jsBundle.main.length > 0) {
    md += `**Main Bundle:**\n`;
    for (const file of current.jsBundle.main.slice(0, 5)) {
      md += `- \`${file.path}\`: ${file.sizeFormatted}\n`;
    }
    md += `\n`;
  }

  if (current.jsBundle.chunks.length > 0) {
    md += `**Chunks (${current.jsBundle.chunks.length} files):**\n`;
    for (const file of current.jsBundle.chunks.slice(0, 10)) {
      md += `- \`${file.path}\`: ${file.sizeFormatted}\n`;
    }
    if (current.jsBundle.chunks.length > 10) {
      md += `- ... and ${current.jsBundle.chunks.length - 10} more\n`;
    }
    md += `\n`;
  }

  // Assets details
  md += `#### Assets (${current.assets.totalFormatted})\n\n`;

  if (current.assets.images.length > 0) {
    const imagesTotal = current.assets.images.reduce((sum, f) => sum + f.size, 0);
    md += `**Images (${current.assets.images.length} files, ${formatBytes(imagesTotal)}):**\n`;
    for (const file of current.assets.images.slice(0, 5)) {
      md += `- \`${file.path}\`: ${file.sizeFormatted}\n`;
    }
    if (current.assets.images.length > 5) {
      md += `- ... and ${current.assets.images.length - 5} more\n`;
    }
    md += `\n`;
  }

  if (current.assets.fonts.length > 0) {
    const fontsTotal = current.assets.fonts.reduce((sum, f) => sum + f.size, 0);
    md += `**Fonts (${current.assets.fonts.length} files, ${formatBytes(fontsTotal)}):**\n`;
    for (const file of current.assets.fonts.slice(0, 5)) {
      md += `- \`${file.path}\`: ${file.sizeFormatted}\n`;
    }
    md += `\n`;
  }

  md += `</details>\n\n`;

  md += `---\n*Generated by bundle-size-analyzer at ${current.timestamp}*\n`;

  return md;
}

function formatDiffCell(diff: { bytes: number; percent: number }): string {
  if (diff.bytes === 0) {
    return '—';
  }

  const arrow = diff.bytes > 0 ? '📈' : '📉';
  const sign = diff.bytes > 0 ? '+' : '';
  return `${arrow} ${sign}${formatBytes(diff.bytes)} (${formatPercent(diff.percent)})`;
}

function formatAsGitHubComment(comparison: BundleComparison): string {
  // Same as markdown but with GitHub-specific formatting
  return formatAsMarkdown(comparison);
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(): {
  distDir: string;
  baseline?: string;
  output: string;
  format: 'json' | 'markdown' | 'github';
  threshold: number;
  failOnRegression: boolean;
} {
  const args = process.argv.slice(2);
  const options = {
    distDir: './dist',
    baseline: undefined as string | undefined,
    output: './bundle-stats.json',
    format: 'json' as 'json' | 'markdown' | 'github',
    threshold: 5,
    failOnRegression: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--dist-dir':
        options.distDir = next;
        i++;
        break;
      case '--baseline':
        options.baseline = next;
        i++;
        break;
      case '--output':
        options.output = next;
        i++;
        break;
      case '--format':
        if (next === 'json' || next === 'markdown' || next === 'github') {
          options.format = next;
        }
        i++;
        break;
      case '--threshold':
        options.threshold = parseFloat(next) || 5;
        i++;
        break;
      case '--fail-on-regression':
        options.failOnRegression = true;
        break;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();

  // Validate dist directory exists
  if (!fs.existsSync(options.distDir)) {
    console.error(`❌ Dist directory not found: ${options.distDir}`);
    console.error('   Run "yarn build:web" first to create the build output.');
    process.exit(1);
  }

  console.log(`📊 Analyzing bundle size in: ${options.distDir}`);

  // Analyze current build
  const current = analyzeBundleSize(options.distDir);

  // Load baseline if provided
  let baseline: BundleStats | undefined;
  if (options.baseline && fs.existsSync(options.baseline)) {
    console.log(`📋 Loading baseline from: ${options.baseline}`);
    try {
      const baselineData = fs.readFileSync(options.baseline, 'utf-8');
      baseline = JSON.parse(baselineData);
    } catch (e) {
      console.warn(`⚠️ Failed to load baseline: ${e}`);
    }
  }

  // Compare with baseline
  const comparison = baseline
    ? compareStats(current, baseline, options.threshold)
    : { current, baseline: undefined, diff: { jsBundle: { bytes: 0, percent: 0 }, assets: { bytes: 0, percent: 0 }, total: { bytes: 0, percent: 0 } }, regressions: [], improvements: [], alerts: [] };

  // Output results
  let output: string;
  switch (options.format) {
    case 'markdown':
    case 'github':
      output = options.format === 'github'
        ? formatAsGitHubComment(comparison)
        : formatAsMarkdown(comparison);
      break;
    case 'json':
    default:
      output = JSON.stringify(comparison.current, null, 2);
  }

  // Write to file or stdout
  if (options.output === '-') {
    console.log(output);
  } else {
    const outputDir = path.dirname(options.output);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(options.output, output);
    console.log(`✅ Results written to: ${options.output}`);
  }

  // Print summary
  console.log(`\n📦 Bundle Size Summary:`);
  console.log(`   JS Bundle: ${current.jsBundle.totalFormatted}`);
  console.log(`   Assets:    ${current.assets.totalFormatted}`);
  console.log(`   Total:     ${current.totalFormatted}`);

  if (baseline) {
    console.log(`\n📊 Comparison vs baseline:`);
    console.log(`   JS Bundle: ${formatDiffCell(comparison.diff.jsBundle).replace(/📈|📉/g, '').trim()}`);
    console.log(`   Total:     ${formatDiffCell(comparison.diff.total).replace(/📈|📉/g, '').trim()}`);
  }

  // Check for regressions
  if (comparison.alerts.length > 0) {
    console.log(`\n⚠️ Alerts:`);
    for (const alert of comparison.alerts) {
      console.log(`   ${alert}`);
    }
  }

  // Exit with error if regression detected and flag is set
  if (options.failOnRegression && comparison.regressions.length > 0) {
    console.error(`\n❌ Bundle size regression detected! Threshold: ${options.threshold}%`);
    process.exit(1);
  }

  console.log(`\n✅ Bundle analysis complete`);
}

main().catch(e => {
  console.error('❌ Error:', e);
  process.exit(1);
});

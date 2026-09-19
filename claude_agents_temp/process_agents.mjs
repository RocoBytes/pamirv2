import fs from 'fs';
import path from 'path';

const TARGET_DIR = path.join(process.env.HOME, '.claude/agents');
const INDEX_FILE = path.join(TARGET_DIR, 'index.json');
const duplicates = new Set();
const registry = [];

const IGNORE_FILES = new Set(['README.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'WORKFLOWS.md', 'LICENSE', 'SECURITY.md', 'CHANGELOG.md', 'WORKFLOW_CONFIG.md']);

function extractMetadata(content, filename) {
  let name = path.basename(filename, '.md');
  let description = 'Claude sub-agent for specialized tasks.';
  
  // Try to find an h1 for name, avoiding `# ` only
  const h1Match = content.match(/^#\s+(.*?)\s*$/m);
  if (h1Match) {
    name = h1Match[1].trim();
  }
  
  // Try to find description from first non-heading paragraph or quote
  const lines = content.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (t && !t.startsWith('#') && !t.startsWith('-') && !t.startsWith('*') && !t.startsWith('<')) {
      if (t.length > 20) {
        description = t.slice(0, 150) + (t.length > 150 ? '...' : '');
        break;
      }
    }
  }
  
  return { name, description };
}

function processDirectory(sourceDir, targetSubDir, isStrategy = false) {
  if (!fs.existsSync(sourceDir)) return;
  
  const files = fs.readdirSync(sourceDir);
  for (const file of files) {
    if (file === '.git' || file === 'node_modules') continue;
    
    const fullPath = path.join(sourceDir, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      processDirectory(fullPath, targetSubDir, isStrategy);
    } else if (file.endsWith('.md') && !IGNORE_FILES.has(file)) {
      // Logic to copy and register
      let targetFileName = file;
      if (isStrategy && file === 'profile.md') {
        const parentDir = path.basename(path.dirname(fullPath));
        targetFileName = `${parentDir}.md`;
      }
      
      const targetFileNameLower = targetFileName.toLowerCase();
      // Avoid duplication by filename
      if (duplicates.has(targetFileNameLower)) {
        continue;
      }
      
      const content = fs.readFileSync(fullPath, 'utf8');
      const { name, description } = extractMetadata(content, targetFileName);
      
      // Also avoid duplication by extracted name
      const nameKey = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (duplicates.has(nameKey)) {
        continue; // skip
      }
      
      const finalDest = path.join(TARGET_DIR, targetSubDir, targetFileNameLower);
      
      // Add standard headers if not present
      let finalContent = content;
      if (!content.includes(name)) {
        finalContent = `# ${name}\n\n${content}`;
      }
      
      fs.writeFileSync(finalDest, finalContent, 'utf8');
      
      duplicates.add(targetFileNameLower);
      duplicates.add(nameKey);
      
      registry.push({
        id: targetFileNameLower.replace('.md', ''),
        name,
        description,
        path: `${targetSubDir}/${targetFileNameLower}`,
        type: targetSubDir
      });
      
    }
  }
}

// 1. Base (rshah515)
processDirectory('./rshah', 'base');
// 2. Tech (0xfurai)
processDirectory('./furai', 'tech');
// 3. Strategy (srbryers/cc-them)
processDirectory('./srbryers/profiles', 'strategy', true);
// 4. Misc (awesome)
processDirectory('./awesome', 'misc');

// Write registry
fs.writeFileSync(INDEX_FILE, JSON.stringify({ agents: registry, count: registry.length }, null, 2));

console.log(`Successfully processed and copied ${registry.length} non-duplicated agents.`);

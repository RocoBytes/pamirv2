import fs from 'fs';
import path from 'path';

const TARGET_DIR = path.join(process.env.HOME, '.claude/agents');
const INDEX_FILE = path.join(TARGET_DIR, 'index.json');

// Files to forcefully remove
const forceRemove = [
  'misc/sap-expert.md',
  'misc/digital-marketer.md',
  'misc/ads-generator.md'
];

// Keywords indicating non-IT or non-Dev topics
const forbiddenKeywords = [
   'sap', 'erp', 'crm', 'marketing', 'sales', 'seo', 'ads ', 'copywrit', 
   'ecommerce', 'recruiter', 'hr', 'human resources', 'business analyst',
   'financial', 'accounting', 'investor', 'brand strategy', 'social media',
   'conversion rate', 'funnel', 'customer success', 'customer support',
   'lead generation', 'roi', 'cpa'
];

function containsForbidden(content, name) {
  const combined = (content + ' ' + name).toLowerCase();
  for (const keyword of forbiddenKeywords) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(combined)) return true;
  }
  return false;
}

let removedCount = 0;
let keptCount = 0;
const registry = [];

function processDir(dirPath, relativeDir) {
  if (!fs.existsSync(dirPath)) return;
  const files = fs.readdirSync(dirPath);
  
  for (const file of files) {
    if (file === '.git' || file === 'node_modules') continue;
    const fullPath = path.join(dirPath, file);
    const relPath = path.join(relativeDir, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      processDir(fullPath, relPath);
    } else if (file.endsWith('.md')) {
      if (forceRemove.includes(relPath)) {
        fs.unlinkSync(fullPath);
        removedCount++;
        continue;
      }
      
      const content = fs.readFileSync(fullPath, 'utf8');
      if (containsForbidden(content, file)) {
        fs.unlinkSync(fullPath);
        removedCount++;
        console.log(`Removed: ${relPath}`);
      } else {
        // keep it, add to new registry
        // extracting name and description again
        let name = path.basename(file, '.md');
        let description = 'Claude sub-agent for specialized tasks.';
        const h1Match = content.match(/^#\s+(.*?)\s*$/m);
        if (h1Match) name = h1Match[1].trim();
        
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
        
        registry.push({
          id: file.replace('.md', ''),
          name,
          description,
          path: relPath,
          type: relativeDir
        });
        keptCount++;
      }
    }
  }
}

// Clean up
processDir(path.join(TARGET_DIR, 'base'), 'base');
processDir(path.join(TARGET_DIR, 'tech'), 'tech');
processDir(path.join(TARGET_DIR, 'strategy'), 'strategy');
processDir(path.join(TARGET_DIR, 'misc'), 'misc');

// Create the new Form expert agent
const formExpertPath = path.join(TARGET_DIR, 'misc/form-expert.md');
const formExpertContent = `# Web Forms & UI/UX App Architect

## Description
Expert in developing responsive, accessible, and high-performance web forms for both desktop and mobile, specifically tailored for efficient data entry and internal tools.

## Tools
- Frontend form validation patterns (React Hook Form, Zod, etc.)
- Responsive CSS/Layout design
- Database schema and API endpoints for form submissions

## System Prompt
You are an expert Developer specializing in Web Forms, UI/UX, and data-entry applications. The user is building a web application primarily used by a group of friends. It does NOT need enterprise complexity (no ERP, CRM, SAP). Keep solutions straightforward, responsive, and mobile-friendly. Prioritize clear state management, clean responsive CSS (or Tailwind/Bootstrap per user choice), and solid input validation. Offer pragmatic advice rather than over-engineering. Focus purely on software development, infrastructure, and IT best practices relevant to consumer or small-team web apps.
`;

fs.writeFileSync(formExpertPath, formExpertContent, 'utf8');

registry.push({
  id: 'form-expert',
  name: 'Web Forms & UI/UX App Architect',
  description: 'Expert in developing responsive, accessible, and high-performance web forms for both desktop and mobile.',
  path: 'misc/form-expert.md',
  type: 'misc'
});
keptCount++;

fs.writeFileSync(INDEX_FILE, JSON.stringify({ agents: registry, count: registry.length }, null, 2));

console.log(`Cleanup complete. Removed ${removedCount} agents. Kept ${keptCount} agents (including the new Form Expert).`);

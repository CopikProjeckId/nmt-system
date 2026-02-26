/**
 * CLI Formatters - Output formatting functions
 */

/**
 * Format inference results
 */
export function formatInferenceResults(title: string, results: Array<{
  neuronId?: string;
  target?: { id: string };
  source?: { id: string };
  confidence: number;
  path?: string[];
  pathLength?: number;
  explanation?: string;
}>): string {
  let output = `${title}:\n`;
  output += '='.repeat(60) + '\n';

  if (!results || results.length === 0) {
    output += '\n  No results found.\n';
    return output;
  }

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const targetId = r.neuronId ?? r.target?.id ?? r.source?.id ?? 'unknown';
    output += `\n  #${i + 1} ${targetId}\n`;
    output += `      Confidence: ${r.confidence.toFixed(4)}\n`;
    output += `      Path Length: ${r.path?.length || r.pathLength || 1}\n`;
    if (r.explanation) {
      output += `      Explanation: ${r.explanation}\n`;
    }
  }

  return output;
}

/**
 * Format causal chain
 */
export function formatCausalChain(chain: {
  strength: number;
  path: Array<{ neuronId: string }>;
  links: Array<{ from: string; to: string; strength: number }>;
}): string {
  let output = 'Causal Chain:\n';
  output += '='.repeat(60) + '\n';
  output += `\nTotal Strength: ${chain.strength.toFixed(4)}\n`;
  output += `Chain Length: ${chain.path.length}\n\n`;

  for (let i = 0; i < chain.path.length; i++) {
    const node = chain.path[i];
    const arrow = i < chain.path.length - 1 ? ' → ' : '';
    output += `  ${node.neuronId}${arrow}`;
    if ((i + 1) % 3 === 0) output += '\n';
  }

  output += '\n\nCausal Links:\n';
  for (const link of chain.links) {
    output += `  ${link.from} → ${link.to} (strength: ${link.strength.toFixed(3)})\n`;
  }

  return output;
}

/**
 * Format bidirectional inference results
 */
export function formatBidirectionalResults(results: {
  forward?: Array<{ neuronId: string; confidence: number }>;
  backward?: Array<{ neuronId: string; confidence: number }>;
}): string {
  let output = 'Bidirectional Inference Results:\n';
  output += '='.repeat(60) + '\n';

  output += '\nForward (Causes → Effects):\n';
  if (results.forward && results.forward.length > 0) {
    for (const r of results.forward.slice(0, 5)) {
      output += `  → ${r.neuronId} (conf: ${r.confidence.toFixed(3)})\n`;
    }
  } else {
    output += '  (none)\n';
  }

  output += '\nBackward (Effects ← Causes):\n';
  if (results.backward && results.backward.length > 0) {
    for (const r of results.backward.slice(0, 5)) {
      output += `  ← ${r.neuronId} (conf: ${r.confidence.toFixed(3)})\n`;
    }
  } else {
    output += '  (none)\n';
  }

  return output;
}

/**
 * Format section header
 */
export function formatHeader(title: string): string {
  return `${title}:\n${'='.repeat(60)}\n`;
}

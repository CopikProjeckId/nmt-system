/**
 * NMT CLI - Probabilistic Ontology Commands
 * 확률적 존재론 기반 CLI 확장 명령어
 *
 * Commands:
 * - infer: 양방향 추론 (forward/backward/causal)
 * - attractor: 미래 끌개 관리 (create/list/influence/path)
 * - learn: 4단계 학습 (from interaction)
 * - dimension: 동적 차원 관리 (expand/list/analyze)
 * - prob: 확률적 뉴런 관리 (observe/evolve/correlate/superpose)
 */

// Re-export types
export type { ProbabilisticContext, CommandConfig, CommandResult } from './types.js';

// Re-export commands
export { cmdInfer } from './commands/infer.js';
export { cmdAttractor } from './commands/attractor.js';
export { cmdLearn } from './commands/learn.js';
export { cmdDimension } from './commands/dimension.js';
export { cmdOrchestrate } from './commands/orchestrate.js';
export { cmdProb } from './commands/prob.js';
export { cmdSync } from './commands/sync.js';

// Re-export utils
export {
  extractFlag,
  extractStringFlag,
  hasFlag,
  formatOutput,
  formatInferenceResults,
  formatCausalChain,
  formatBidirectionalResults,
  formatHeader,
} from './utils/index.js';

/**
 * Probabilistic Commands Help Text
 */
export const PROBABILISTIC_HELP = `
Probabilistic Ontology Commands (확률적 존재론)
================================================

Inference (양방향 추론):
  nmt infer forward <neuron-id>     Forward reasoning (cause → effect)
  nmt infer backward <neuron-id>    Backward reasoning (abduction)
  nmt infer causal <from> <to>      Find causal chain between neurons
  nmt infer bidirectional <id>      Both directions simultaneously

Attractors (미래 끌개):
  nmt attractor create <name>       Create future goal attractor
  nmt attractor list                List active attractors
  nmt attractor influence <id>      Calculate attractor influence on neuron
  nmt attractor path <id> <attr>    Find path to attractor
  nmt attractor update <id>         Update attractor properties
  nmt attractor stats               Attractor model statistics

Learning (4단계 학습):
  nmt learn extract <neuron-id>     Extract meaningful content
  nmt learn session start|end       Manage learning session
  nmt learn stats                   Learning statistics

Dimensions (동적 차원):
  nmt dimension stats               Dimension statistics
  nmt dimension register            Register new semantic dimension
  nmt dimension category <cat>      List dimensions by category
  nmt dimension count               Get current dimension count

Orchestrator (통합 오케스트레이터):
  nmt orchestrate infer <id>        Unified inference using all modules
  nmt orchestrate goal <id> <attr>  Create goal-driven neuron
  nmt orchestrate expand <concept>  Expand dimensions for concept
  nmt orchestrate learn             Learn from interaction
  nmt orchestrate feedback          Provide feedback on interaction
  nmt orchestrate reinforce         Reinforce successful path
  nmt orchestrate stats             All modules statistics

System Management (시스템 관리):
  nmt prob init                     Initialize all probabilistic modules
  nmt prob save                     Save current state to storage
  nmt prob load                     Load state from storage
  nmt prob evolve                   Trigger manual evolution
  nmt prob status                   Show full system status

State Synchronization (상태 동기화):
  nmt sync status                   Show synchronization status
  nmt sync changes [--from N]       List changes from journal
  nmt sync export [--output file]   Export sync state to JSON
  nmt sync import <file>            Import sync state from JSON
  nmt sync peers                    List connected peers
  nmt sync journal                  Show journal statistics
`;

/**
 * Default export for compatibility
 */
export default {
  cmdInfer: async (args: string[], config: any, ctx: any) => {
    const { cmdInfer } = await import('./commands/infer.js');
    return cmdInfer(args, config, ctx);
  },
  cmdAttractor: async (args: string[], config: any, ctx: any) => {
    const { cmdAttractor } = await import('./commands/attractor.js');
    return cmdAttractor(args, config, ctx);
  },
  cmdLearn: async (args: string[], config: any, ctx: any) => {
    const { cmdLearn } = await import('./commands/learn.js');
    return cmdLearn(args, config, ctx);
  },
  cmdDimension: async (args: string[], config: any, ctx: any) => {
    const { cmdDimension } = await import('./commands/dimension.js');
    return cmdDimension(args, config, ctx);
  },
  cmdOrchestrate: async (args: string[], config: any, ctx: any) => {
    const { cmdOrchestrate } = await import('./commands/orchestrate.js');
    return cmdOrchestrate(args, config, ctx);
  },
  cmdProb: async (args: string[], config: any, ctx: any) => {
    const { cmdProb } = await import('./commands/prob.js');
    return cmdProb(args, config, ctx);
  },
  cmdSync: async (args: string[], config: any, ctx: any) => {
    const { cmdSync } = await import('./commands/sync.js');
    return cmdSync(args, config, ctx);
  },
  PROBABILISTIC_HELP,
};

import type { ReasoningStep } from '../../src/client/ReasoningSlider';

export interface PreviewModel {
  id: string;
  label: string;
  vendor: string;
  steps: readonly ReasoningStep[];
  initialValue?: string;
  availability?: 'available' | 'unsupported' | 'unknown';
  controlLabel?: string;
  message?: string;
  note: string;
  source?: string;
}

const names: Record<string, string> = {
  none: '关闭', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高',
  disabled: '关闭', enabled: '开启',
};
const levels = (...values: string[]): ReasoningStep[] => values.map(value => ({ value, label: names[value] ?? value }));

// Verified official examples for this isolated preview; no runtime model matching or API requests.
export const previewModels: readonly PreviewModel[] = [
  { id: 'sol', label: '6.1 Sol', vendor: 'OpenAI', steps: levels('low', 'medium', 'high', 'xhigh', 'max'), initialValue: 'high',
    note: '5 个原生档位 · reasoning.effort', source: 'https://developers.openai.com/api/docs/models/gpt-6.1-sol' },
  { id: 'astra', label: '6 Astra', vendor: 'OpenAI', steps: levels('low', 'medium', 'high', 'xhigh', 'max'), initialValue: 'medium',
    note: '5 个原生档位 · reasoning.effort', source: 'https://developers.openai.com/api/docs/models/gpt-6-astra' },
  { id: 'terra', label: '5.6 Terra', vendor: 'OpenAI', steps: levels('none', 'low', 'medium', 'high', 'xhigh', 'max'), initialValue: 'medium',
    note: '5 个思考档位 + 关闭 · reasoning.effort', source: 'https://developers.openai.com/api/docs/models/gpt-5.6-terra' },
  { id: 'claude', label: 'Claude Opus 5.5', vendor: 'Anthropic', steps: levels('low', 'medium', 'high', 'xhigh', 'max'), initialValue: 'medium',
    note: '5 个原生档位 · output_config.effort；Adaptive 为独立模式', source: 'https://platform.claude.com/docs/en/build-with-claude/effort' },
  { id: 'gemini', label: 'Gemini 4 Argon', vendor: 'Google', steps: levels('low', 'medium', 'high'), initialValue: 'medium',
    note: 'Interactions API · generation_config.thinking_level，3 档', source: 'https://aistudio.google.com/docs/thinking' },
  { id: 'grok', label: 'Grok 4.7', vendor: 'xAI', steps: levels('low', 'medium', 'high', 'xhigh'), initialValue: 'high',
    note: '4 个原生档位 · 不支持关闭', source: 'https://docs.x.ai/docs/guides/reasoning' },
  { id: 'deepseek', label: 'DeepSeek Flash', vendor: 'DeepSeek', steps: levels('low', 'high', 'max'), initialValue: 'high',
    note: '3 个原生档位 · reasoning_effort；关闭另用 thinking.type', source: 'https://api-docs.deepseek.com/guides/thinking_mode' },
  { id: 'qwen-omni', label: 'Qwen3.8 Omni Flash', vendor: 'Qwen', steps: levels('none', 'low', 'medium', 'xhigh'), initialValue: 'xhigh',
    note: '3 个真实深度 + 关闭 · 兼容别名不重复计档', source: 'https://www.alibabacloud.com/help/en/model-studio/qwen-omni' },
  { id: 'glm', label: 'GLM-5.3', vendor: 'Z.ai', steps: levels('low', 'high', 'max'), initialValue: 'max',
    note: '3 个原生档位 · 不支持关闭', source: 'https://docs.z.ai/guides/llm/glm-5.3' },
  { id: 'kimi', label: 'Kimi K3.1 Pro', vendor: 'Kimi', steps: levels('low', 'high', 'max'), initialValue: 'max',
    note: '3 个原生档位 · reasoning_effort', source: 'https://platform.kimi.ai/docs/guide/use-reasoning-effort' },
  { id: 'minimax', label: 'MiniMax M3.1 Flash', vendor: 'MiniMax', steps: levels('low', 'medium', 'high', 'xhigh', 'max'), initialValue: 'max',
    note: '5 个原生档位 · 不支持关闭', source: 'https://platform.minimax.io/docs/api-reference/text-chat' },
  { id: 'toggle', label: 'Kimi K2.6', vendor: '开关示例', steps: levels('disabled', 'enabled'), initialValue: 'enabled', controlLabel: '思考模式',
    note: '只有关闭 / 开启 · thinking.type；没有深度档位', source: 'https://platform.kimi.ai/docs/guide/use-thinking-models' },
  { id: 'budget', label: 'Qwen3.8 Max', vendor: '预算示例', steps: [], availability: 'unsupported', controlLabel: '思考预算',
    message: '此模型使用思考 Token 预算，没有统一的原生深度档位',
    note: '使用 enable_thinking / thinking_budget，不虚构低中高档位', source: 'https://www.alibabacloud.com/help/en/model-studio/deep-thinking' },
  { id: 'fixed', label: 'Kimi K2.7 Code', vendor: '固定思考示例', steps: [], availability: 'unsupported',
    message: '此模型始终思考，不支持 reasoning_effort', note: '固定思考状态，不提供假调节', source: 'https://platform.kimi.ai/docs/guide/use-thinking-models' },
  { id: 'unknown', label: '自定义模型', vendor: '未知能力示例', steps: [], availability: 'unknown',
    message: '提供方和原生参数尚未核实', note: '等待核实模型能力后再启用控件' },
];

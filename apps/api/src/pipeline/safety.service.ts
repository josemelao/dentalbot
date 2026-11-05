import { normalizeText } from '../common/text';
import { Intent } from '../contracts/intent';
import { SafetyTier, TriageResult } from '../contracts/triage';

interface SafetyRule {
  id: string;
  tier: SafetyTier;
  patterns: RegExp[];
}

const RULES: SafetyRule[] = [
  {
    id: 'airway',
    tier: 'EMERGENCY',
    patterns: [/nao consigo respirar/, /dificuldade (para )?respirar/, /nao consigo engolir/],
  },
  {
    id: 'severe_swelling',
    tier: 'EMERGENCY',
    patterns: [/inchaco (no rosto|na face|no pescoco)/, /rosto inchou/, /inchou muito/],
  },
  {
    id: 'heavy_bleeding',
    tier: 'EMERGENCY',
    patterns: [/sangramento intenso/, /sangrando muito/, /nao para de sangrar/],
  },
  {
    id: 'trauma',
    tier: 'EMERGENCY',
    patterns: [/trauma/, /bati (o dente|a boca|a cabeca)/, /acidente/],
  },
  {
    id: 'high_fever',
    tier: 'EMERGENCY',
    patterns: [/febre alta/, /febre acima de 39/],
  },
  {
    id: 'disabling_pain',
    tier: 'EMERGENCY',
    patterns: [/dor insuportavel/, /dor incapacitante/, /nao consigo nem abrir a boca/],
  },
  {
    id: 'clinical',
    tier: 'CLINICAL',
    patterns: [/\bdor\b/, /inflamad/, /sensibilidade/, /sangr/],
  },
];

export class SafetyService {
  triage(text: string | null): TriageResult {
    if (!text) {
      return { tier: 'ADMINISTRATIVE', matchedRule: null, confidence: 0.5 };
    }

    const normalized = normalizeText(text);

    for (const rule of RULES) {
      if (rule.patterns.some((pattern) => pattern.test(normalized))) {
        return { tier: rule.tier, matchedRule: rule.id, confidence: 1 };
      }
    }

    return { tier: 'ADMINISTRATIVE', matchedRule: null, confidence: 0.5 };
  }

  escalate(triage: TriageResult, intent: Intent): TriageResult {
    if (triage.tier === 'EMERGENCY') return triage;

    if (intent === 'EMERGENCY') {
      return {
        tier: 'EMERGENCY',
        matchedRule: triage.matchedRule ?? 'intent_emergency',
        confidence: Math.max(triage.confidence, 0.9),
      };
    }

    if (triage.tier === 'CLINICAL') return triage;

    if (intent === 'CLINICAL_QUESTION') {
      return {
        tier: 'CLINICAL',
        matchedRule: 'intent_clinical',
        confidence: Math.max(triage.confidence, 0.8),
      };
    }

    return triage;
  }
}

import { SafetyService } from '../src/pipeline/safety.service';

const service = new SafetyService();

describe('SafetyService.triage', () => {
  it.each([
    ['Não consigo respirar', 'EMERGENCY'],
    ['meu rosto inchou muito e não consigo engolir', 'EMERGENCY'],
    ['estou com sangramento intenso', 'EMERGENCY'],
    ['bati o dente, teve trauma', 'EMERGENCY'],
    ['estou com febre alta', 'EMERGENCY'],
    ['dor insuportável, não consigo nem abrir a boca', 'EMERGENCY'],
    ['Estou com dificuldade para engolir', 'EMERGENCY'],
    ['meu rosto está inchado', 'EMERGENCY'],
    ['o sangramento não para', 'EMERGENCY'],
    ['tive uma queda', 'EMERGENCY'],
    ['estou com dor muito forte', 'EMERGENCY'],
    ['Estou com dor no dente', 'CLINICAL'],
    ['meu dente está inflamado', 'CLINICAL'],
    ['Qual o horário de vocês?', 'ADMINISTRATIVE'],
    ['Quanto custa a limpeza?', 'ADMINISTRATIVE'],
  ])('%s -> %s', (text, tier) => {
    expect(service.triage(text).tier).toBe(tier);
  });

  it('treats null as administrative', () => {
    expect(service.triage(null).tier).toBe('ADMINISTRATIVE');
  });

  it('does not lower an emergency when the AI says otherwise', () => {
    const triage = service.triage('não consigo respirar');
    expect(service.escalate(triage, 'FAQ_ADMIN').tier).toBe('EMERGENCY');
  });

  it('raises a clinical case when the AI classifies it as clinical', () => {
    const triage = service.triage('bom dia');
    expect(service.escalate(triage, 'CLINICAL_QUESTION').tier).toBe('CLINICAL');
  });
});

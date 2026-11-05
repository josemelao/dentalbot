# Clínica fictícia + checklist de entrevista — Fase 2

**Status:** hipótese de trabalho. Nada aqui é dado real da clínica dos seus amigos.
Serve para (a) você ter algo concreto para mostrar na reunião e (b) o plano da
Fase 2 ser construído sobre dados plausíveis, não sobre `TBD`.

**Como usar na reunião (90 min):** percorra as seções 3 a 8. Para cada linha,
marque **Confirmado**, **Ajustar** ou **Remover**. O que não for confirmado
continua como hipótese e não vai para o piloto.

**Fontes de mercado usadas para calibrar as hipóteses**

- Dental Index Brasil, Dental Price Index, referência 05/10/2026:
  <https://dentalindex.com.br/precos/> (preços de 10 procedimentos nas capitais;
  São Paulo é a capital mais cara da amostra).
- Agiliza Clínica, “Taxa de no-show na odontologia”, atualizado 27/09/2026:
  <https://agilizaclinica.com.br/blog/no-show-odontologia-taxa-faltas/>.
  Cita Dantas et al. (Health Policy, 2018) com média de ~23% em 105 estudos,
  clínicas brasileiras entre 15% e 25%, e 8–12% com confirmação ativa por
  WhatsApp; lembretes por SMS reduziram faltas em ~29% e ligações em ~39%
  (Hasvold & Wootton, 2011).
- Duração de implante: 30–60 min para um implante unitário; 90–120 min em casos
  com múltiplos implantes ou enxerto (variação relatada em clínicas brasileiras;
  use como ordem de grandeza, não como regra clínica).

> **Aviso:** preços e durações variam por região, complexidade e avaliação
> clínica. O Código de Ética Odontológica restringe divulgação de preços em
> publicidade; por isso a coluna “Pode divulgar?” precisa ser decidida pelos
> sócios, não inferida.

---

## 1. Fatos conhecidos (do que você já me contou)

- Dois sócios dentistas: **Chow** e **Caio**.
- Sem recepcionista; o custo do funcionário não se paga.
- Pacientes particulares falam no **WhatsApp pessoal** de cada um.
- Agenda **individual por profissional**.
- Procedimentos **conjuntos** combinados informalmente.
- Atendem também em **outras clínicas e hospitais**.
- A clínica não fica aberta 8h/dia.
- Não há taxa de desistência medida nem baseline de atendimento.
- O paciente espera horas por resposta e às vezes vai para outra clínica.

## 2. Perfil fictício proposto

| Campo | Hipótese |
|---|---|
| Nome | Clínica Sorriso Vila Mariana (fictício) |
| Cidade | São Paulo/SP — Vila Mariana |
| Sócios | Dr. Chow (implantodontia e cirurgia oral) · Dr. Caio (ortodontia e clínica geral) |
| Recepção | nenhuma; bot + os dois sócios |
| Cadeiras | 1 no piloto; 2ª planejada |
| Público | particular; sem convênio no piloto |
| Canal | WhatsApp business da clínica, separado do pessoal |
| Agenda atual | Google Calendar, um calendário por profissional (a confirmar) |
| Tom | próximo, direto, sem emojis excessivos; “secretária virtual da clínica” |

---

## 3. Catálogo fictício de serviços

Valores de referência para São Paulo (Dental Index, 05/10/2026), arredondados.
**Não são a tabela da clínica.**

| # | Serviço | Duração | Preço (SP) | Pode divulgar? | Agendamento direto? | Exige avaliação? | Variante | Documentos / preparo |
|---|---|---|---|---|---|---|---|---|
| 1 | Avaliação inicial | 30 min | R$ 250 | Sim | Sim | Não | — | RG/CPF; exames se tiver |
| 2 | Profilaxia (limpeza) | 40 min | R$ 240 | Sim | Sim | Não | — | — |
| 3 | Profilaxia + flúor | 45 min | R$ 280 | Sim | Sim | Não | — | — |
| 4 | Restauração em resina | 60 min | R$ 450 | “A partir de” | Não | Sim | por dente | Radiografia se tiver |
| 5 | Tratamento de canal | 90 min | R$ 1.100 | Não | Não | Sim | por dente | Radiografia |
| 6 | Extração simples | 60 min | R$ 350 | Não | Não | Sim | por dente | Radiografia |
| 7 | Extração de siso | 90 min | R$ 1.200 | Não | Não | Sim | por dente | Panorâmica |
| 8 | Implante unitário com coroa | 120 min (cirurgia) | R$ 6.000 | Não | Não | Sim | por implante | Tomografia |
| 9 | Prótese total | 90 min/sessão | R$ 2.600 | Não | Não | Sim | por arcada | Avaliação |
| 10 | Clareamento | 60 min | R$ 1.300 | Sim | Não | Sim (sensibilidade) | — | — |
| 11 | Faceta em resina | 90 min | R$ 1.400/dente | Não | Não | Sim | por dente | Avaliação |
| 12 | Aparelho fixo | 60 min inicial + 30 min manutenção | R$ 8.000 | Não | Não | Sim | — | Documentação ortodôntica |
| 13 | Raspagem periodontal | 60 min | R$ 500/quadrante | Não | Não | Sim | por quadrante | Avaliação |
| 14 | Placa de contenção | 45 min | R$ 600 | Não | Não | Sim | — | Moldagem |
| 15 | Documentação ortodôntica | 45 min | R$ 350 | Sim | Não | Sim | — | Radiografias e fotos |

**Buffers:** 10 min antes e 10 min depois em todos os serviços.
**Granularidade da agenda:** 15 min.
**Antecedência mínima:** 2h para avaliação/urgência; 24h para rotina.
**Horizonte máximo:** 90 dias.

### Procedimentos conjuntos (hipótese)

| Procedimento | Profissionais | Duração | Regra |
|---|---|---|---|
| Extração + planejamento ortodôntico | Chow + Caio | maior duração + buffers | agendas interseccionadas |
| Implante + planejamento protético | Chow + Caio | maior duração + buffers | agendas interseccionadas |

Janela sugerida: **segunda 14h–18h**, quando os dois estão na clínica.

---

## 4. Profissionais e horários (hipótese)

| Profissional | Seg | Ter | Qua | Qui | Sex |
|---|---|---|---|---|---|
| Dr. Chow | 09–12, 13–18 | Hospital / outra clínica | 09–12, 13–18 | Hospital / outra clínica | 09–12, 13–18 |
| Dr. Caio | 09–12, 13–18 | 09–12, 13–18 | Outra clínica | 09–12, 13–18 | Outra clínica |
| Conjunto | 14–18 | — | — | — | — |

- Almoço: 12h–13h para os dois.
- Feriados nacionais e de São Paulo; recesso de 24/12 a 02/01 (hipótese).
- Timezone: `America/Sao_Paulo`.
- Outros bloqueios: cursos, cirurgias hospitalares, viagens.

---

## 5. Agenda e sistemas (hipótese a confirmar — MVP-D09)

- Hoje: Google Calendar, um calendário por profissional, compartilhado com a
  conta da clínica.
- Proposta: a **agenda interna é a fonte de verdade**; o Google é espelho.
- Os sócios podem continuar editando o Google; a reconciliação detecta e avisa.
- Agendamentos futuros existentes precisam ser importados no onboarding.
- Se hoje for papel ou ERP, o adaptador muda; o núcleo não.

---

## 6. Políticas (hipótese)

| Política | Hipótese |
|---|---|
| Cancelamento com aviso | 24h de antecedência |
| Cancelamento tardio (<24h) | status `LATE_CANCELLED`, não conta como no-show |
| No-show | status `NO_SHOW`, conta sobre todas as consultas agendadas |
| Taxa de no-show no piloto | não cobrar; medir e conversar |
| Pagamento | Pix, crédito e débito; parcelamento em até 3x |
| Convênio | não aceitar no piloto; se perguntarem, escalar |
| Preço não autorizado | “o Dr. confirma na avaliação” |
| Menor de idade | responsável legal obrigatório; fluxo de guardião |
| Emergência | protocolo de segurança com SAMU 192 (já implementado) |

---

## 7. Baseline e métricas (hipótese, para validar)

| Métrica | Hipótese inicial |
|---|---|
| Mensagens recebidas/semana | 60–100 |
| Mensagens fora do horário | 30–40% |
| Tempo até a primeira resposta | 2–8h |
| Conversas que viram agendamento | 20–30% |
| No-show | 15–25% |
| Escalonamentos clínicos/semana | 5–10 |
| Emergências/mês | 2–3 |

---

## 8. Checklist de entrevista

### 8.1 Identidade e marca

- [ ] Nome oficial da clínica e do número business.
- [ ] Quem é o titular do número/CNPJ.
- [ ] Como o bot se apresenta.
- [ ] Formal ou informal? Emojis? Assinatura?
- [ ] O que o bot **nunca** pode dizer.

### 8.2 Serviços (percorrer a tabela da seção 3)

Para cada serviço:

- [ ] Nome e descrição.
- [ ] Duração real (incluindo preparo/limpeza).
- [ ] Preço e variação por quantidade.
- [ ] Pode divulgar o preço? (sim / não / “a partir de”)
- [ ] Pode agendar direto? Ou exige avaliação?
- [ ] Documentos e exames necessários.
- [ ] Orientações de preparo.
- [ ] Serviços que não fazem e para onde encaminham.

### 8.3 Profissionais, horários e bloqueios

- [ ] Confirmar a grade da seção 4.
- [ ] Férias, hospital, outras clínicas, cursos.
- [ ] Procedimentos conjuntos: quais, duração, janela.
- [ ] Quantas cadeiras/salas.
- [ ] Intervalo mínimo, limpeza/preparo.
- [ ] Antecedência mínima e horizonte máximo.
- [ ] Encaixe e urgência.

### 8.4 Agenda e sistemas

- [ ] Google, papel ou ERP?
- [ ] Quantas contas/calendários?
- [ ] Quem edita hoje?
- [ ] Aceitam que a agenda interna seja a fonte de verdade?
- [ ] Importar agendamentos futuros?
- [ ] Acesso à API do Google / administrador da conta.

### 8.5 Políticas

- [ ] Cancelamento, atraso, no-show.
- [ ] Pagamento e parcelamento.
- [ ] Convênios.
- [ ] Menores e responsável legal.
- [ ] O que fazer com faltas repetidas.

### 8.6 Escalonamento (Fase 3)

- [ ] Quem responde: Chow, Caio ou os dois?
- [ ] Canal: WhatsApp individual, inbox ou outro.
- [ ] SLA no horário comercial.
- [ ] Fallback se ninguém responder.
- [ ] Quem pode “assumir a conversa”.

### 8.7 Segurança

- [ ] Sinais de risco que os fazem parar tudo.
- [ ] Quando indicar SAMU/pronto-socorro.
- [ ] O que o bot não pode afirmar em emergência.
- [ ] Responsável técnico que aprova o protocolo.

### 8.8 Baseline

- [ ] Mensagens/dia e horários de pico.
- [ ] Tempo de resposta atual.
- [ ] Conversas perdidas.
- [ ] No-show atual.
- [ ] Principais dúvidas e objeções.

### 8.9 Fechamento

- [ ] Quem aprova o Manual da Secretária.
- [ ] Data do go-live.
- [ ] Critérios de sucesso e de kill.
- [ ] Assinatura/confirmacão das decisões MVP-D02, D03, D04, D09.

---

## 9. Exemplos de conversa para classificar na reunião

| Mensagem | Gaveta esperada | Ação |
|---|---|---|
| “Quanto custa a limpeza?” | Autônomo (preço autorizado) | Responde R$ 240 |
| “Quero marcar limpeza” | Autônomo (agendamento direto) | Oferece slots |
| “Preciso arrancar 2 dentes, tenho encaminhamento” | Cinzento | Coleta documento; pergunta ao dentista; fallback avaliação |
| “Estou com dor no dente” | Clínico | Avaliação; não diagnostica |
| “Meu rosto inchou e não consigo respirar” | Segurança | SAMU 192 + protocolo |
| “Vocês aceitam Unimed?” | Autônomo se cadastrado; senão escalar | Informa ou escala |
| “Pode fazer desconto?” | Sempre escala | Não negocia |
| “Quero cancelar” | Autônomo com confirmação | Identidade + política + confirmação |
| “Meu filho de 8 anos precisa de avaliação” | Cinzento | Fluxo de responsável legal |
| “Quero remarcar para semana que vem” | Autônomo | Nova reserva primeiro |

---

## 10. Decisões abertas (bloqueiam a Fase 2)

| ID | Decisão | Hipótese atual | Confirmado? |
|---|---|---|---|
| MVP-D02 | Tabela de serviços, preços, durações e divulgação | seção 3 | [ ] |
| MVP-D03 | Agendamento direto vs. avaliação por serviço | seção 3 | [ ] |
| MVP-D04 | Horários, férias e bloqueios | seção 4 | [ ] |
| MVP-D09 | Agenda real hoje e se editam direto nela | Google Calendar | [ ] |

**Regra:** o que não for confirmado não entra no piloto. O plano da Fase 2 usa
estas hipóteses para construir e testar; a configuração real é um seed separado,
trocado antes do go-live.

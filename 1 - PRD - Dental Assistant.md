# PRD — Dental Assistant
**Produto:** Dental Assistant  
**Versão:** 1.0  
**Status:** Especificação inicial do MVP  
**Plataforma inicial:** n8n + Supabase + Google Calendar  
**Canal de desenvolvimento:** Chat do n8n  
**Canal de testes externos:** Telegram  
**Canal de produção:** WhatsApp Cloud API oficial  

---

# 1. Visão geral do produto

## 1.1. Descrição

O Dental Assistant será um assistente virtual de atendimento para clínicas odontológicas, responsável por automatizar atividades administrativas e operacionais relacionadas ao relacionamento com pacientes.

O sistema deverá compreender mensagens em linguagem natural, responder dúvidas com base nas informações cadastradas pela clínica, realizar operações autorizadas na agenda, acompanhar solicitações e encaminhar situações específicas para atendimento humano.

O produto deverá ser desenvolvido inicialmente para uma única clínica, mas sua arquitetura deverá permitir a evolução para um SaaS multiclínicas, com isolamento de dados, configurações individuais e possibilidade de expansão funcional.

## 1.2. Problema que o produto resolve

Clínicas odontológicas recebem um volume recorrente de mensagens relacionadas a:

- Informações sobre procedimentos e especialidades.
- Preços e formas de pagamento.
- Disponibilidade de profissionais.
- Agendamentos e remarcações.
- Cancelamentos.
- Confirmações de consultas.
- Orientações administrativas.
- Dúvidas sobre localização e funcionamento.
- Recuperação de pacientes que não compareceram.
- Solicitações que precisam de intervenção da recepção.

O atendimento manual dessas demandas consome tempo da equipe, pode gerar demora nas respostas, perda de oportunidades de agendamento e inconsistências na gestão da agenda.

O Dental Assistant deverá reduzir esse trabalho operacional sem comprometer a segurança, a confiabilidade ou a qualidade do atendimento.

## 1.3. Objetivos do produto

1. Automatizar o atendimento administrativo inicial.
2. Disponibilizar informações da clínica continuamente.
3. Permitir agendamentos, remarcações e cancelamentos controlados.
4. Reduzir faltas por meio de confirmações e lembretes.
5. Registrar o histórico das interações.
6. Encaminhar solicitações que exigem intervenção humana.
7. Manter consistência entre o atendimento automatizado e a agenda oficial.
8. Permitir configuração individual por clínica.
9. Preparar a estrutura para evolução comercial como SaaS.

## 1.4. Indicadores de sucesso

Os seguintes indicadores deverão ser acompanhados:

| Indicador | Objetivo |
|---|---|
| Taxa de resolução automática | Medir atendimentos resolvidos sem intervenção humana |
| Taxa de agendamento | Medir conversas que resultam em consultas marcadas |
| Taxa de abandono | Identificar conversas interrompidas |
| Taxa de transferência humana | Medir solicitações encaminhadas à equipe |
| Erros de agendamento | Manter o menor índice possível |
| Falhas de integração | Monitorar problemas com agenda e banco de dados |
| Tempo de resposta | Acompanhar a velocidade do atendimento |
| Taxa de comparecimento | Avaliar o impacto de confirmações e lembretes |

As metas quantitativas serão definidas após a implantação e coleta de dados reais.

---

# 2. Público e atores do sistema

## 2.1. Paciente

Pessoa que interage com o assistente para obter informações, realizar solicitações administrativas e gerenciar consultas.

**Permissões:**
- Consultar informações públicas da clínica.
- Solicitar agendamento.
- Consultar horários disponíveis.
- Solicitar remarcação ou cancelamento.
- Confirmar ou recusar presença.
- Solicitar atendimento humano.
- Fornecer dados cadastrais necessários.

Não poderá acessar informações de outros pacientes ou dados internos da clínica.

## 2.2. Recepcionista / atendente

Responsável por assumir atendimentos encaminhados pelo sistema e executar atividades administrativas que não podem ser concluídas automaticamente.

**Responsabilidades:**
- Receber solicitações encaminhadas.
- Consultar o contexto da conversa.
- Assumir o atendimento.
- Responder ao paciente pelo canal disponível.
- Registrar a resolução da solicitação.
- Solicitar retomada da automação quando apropriado.

## 2.3. Administrador da clínica

Responsável pelas configurações operacionais do assistente.

**Responsabilidades:**
- Cadastrar profissionais.
- Cadastrar procedimentos e serviços.
- Definir horários de funcionamento.
- Configurar políticas de agendamento.
- Cadastrar informações institucionais.
- Configurar parâmetros de atendimento.
- Gerenciar integrações.
- Consultar indicadores e registros operacionais.

## 2.4. Profissional odontológico

Dentista ou profissional responsável pela realização dos procedimentos.

No MVP, sua participação será principalmente relacionada à configuração de disponibilidade e à agenda.

Não será necessário disponibilizar ao profissional acesso ao sistema de atendimento automatizado.

## 2.5. Administrador da plataforma

Ator interno responsável pela administração da infraestrutura SaaS.

Responsabilidades futuras:
- Gerenciar clínicas cadastradas.
- Administrar planos e limites.
- Monitorar integrações.
- Gerenciar configurações globais.
- Acompanhar disponibilidade e falhas.
- Gerenciar isolamento e segurança entre clientes.

Esse perfil não precisa de interface própria no primeiro MVP.

---

# 3. Escopo funcional do MVP

## 3.1. Módulo de recepção virtual

O sistema deverá funcionar como primeiro ponto de contato da clínica.

**Requisitos:**

- RF-001: Receber mensagens dos canais habilitados.
- RF-002: Identificar o paciente pelo identificador do canal e pelos dados disponíveis.
- RF-003: Recuperar o histórico e o contexto da conversa.
- RF-004: Identificar a intenção principal da mensagem.
- RF-005: Responder utilizando as informações oficiais cadastradas.
- RF-006: Solicitar esclarecimentos quando a mensagem for ambígua.
- RF-007: Manter o contexto durante a conversa.
- RF-008: Evitar repetir perguntas cujas respostas já estejam registradas.
- RF-009: Informar quando não possuir dados suficientes para responder.
- RF-010: Permitir solicitação de atendimento humano.

**Critérios de aceite:**
- O sistema deverá responder adequadamente às perguntas previstas na base de conhecimento.
- Não poderá inventar informações sobre a clínica.
- Deverá pedir esclarecimentos quando não compreender uma solicitação.
- Deverá preservar o contexto entre mensagens.
- Deverá reconhecer quando uma conversa está sob responsabilidade humana.

## 3.2. Módulo de informações da clínica

O sistema deverá consultar uma base de informações cadastradas e aprovadas pela clínica.

**Informações contempladas:**

- Nome e descrição da clínica.
- Endereço e localização.
- Telefones e canais de contato.
- Horários de funcionamento.
- Especialidades.
- Profissionais.
- Procedimentos.
- Valores autorizados para divulgação.
- Convênios aceitos.
- Formas de pagamento.
- Orientações administrativas.
- Políticas de agendamento.
- Políticas de cancelamento e remarcação.
- Informações sobre primeira consulta.

**Requisitos:**

- RF-011: Consultar informações institucionais.
- RF-012: Consultar serviços e procedimentos cadastrados.
- RF-013: Consultar profissionais habilitados para cada serviço.
- RF-014: Consultar valores e condições cadastradas.
- RF-015: Consultar convênios e formas de pagamento.
- RF-016: Consultar políticas da clínica.
- RF-017: Identificar informações ausentes ou desatualizadas.
- RF-018: Utilizar somente fontes autorizadas pela clínica.

**Critérios de aceite:**
- Informações comerciais deverão corresponder ao cadastro vigente.
- O sistema não poderá presumir que um convênio é aceito.
- Não poderá informar valores não cadastrados.
- Informações ausentes deverão resultar em esclarecimento ou encaminhamento humano.

## 3.3. Módulo de cadastro de pacientes

O sistema deverá manter um cadastro administrativo mínimo.

**Dados previstos:**

- Nome completo.
- Telefone.
- Identificador externo do canal.
- Data de nascimento, quando necessária.
- E-mail, quando necessário.
- Identificador interno do paciente.
- Data de criação do cadastro.
- Data da última atualização.
- Situação do cadastro.

**Requisitos:**

- RF-019: Identificar pacientes já cadastrados.
- RF-020: Criar cadastro administrativo quando necessário.
- RF-021: Atualizar dados mediante confirmação.
- RF-022: Evitar duplicidade de pacientes.
- RF-023: Registrar a origem das informações.
- RF-024: Permitir associação de diferentes contatos ao mesmo paciente mediante validação.
- RF-025: Diferenciar paciente de responsável legal.

**Critérios de aceite:**
- O sistema deverá verificar a existência de cadastro antes de criar outro.
- Não deverá associar automaticamente duas pessoas apenas porque utilizam o mesmo telefone.
- Dados de terceiros não poderão ser revelados sem autorização adequada.
- Dados cadastrais deverão ser limitados ao necessário para a finalidade administrativa.

**Limite do MVP:** não haverá cadastro de prontuário, anamnese, diagnóstico, evolução clínica ou histórico de tratamentos.

## 3.4. Módulo de agendamento

O Google Calendar será a fonte oficial de disponibilidade e registro dos compromissos no MVP.

**Dados necessários para agendamento:**

- Paciente.
- Procedimento ou serviço.
- Profissional, quando definido.
- Data.
- Horário.
- Duração.
- Agenda correspondente.
- Observações administrativas, quando necessárias.

**Requisitos:**

- RF-026: Identificar o serviço desejado.
- RF-027: Identificar profissionais habilitados para o serviço.
- RF-028: Consultar a duração configurada do procedimento.
- RF-029: Consultar horários disponíveis no Google Calendar.
- RF-030: Apresentar opções de horários ao paciente.
- RF-031: Receber a escolha do paciente.
- RF-032: Revalidar a disponibilidade antes de confirmar.
- RF-033: Criar o evento na agenda.
- RF-034: Registrar o identificador do evento no banco de dados.
- RF-035: Confirmar o agendamento somente após verificar o resultado da operação.
- RF-036: Impedir duplicidade de agendamentos causada por mensagens repetidas.
- RF-037: Informar indisponibilidade e oferecer alternativas.

**Fluxo obrigatório:**

1. Identificar o procedimento.
2. Identificar o profissional ou apresentar opções.
3. Determinar a duração.
4. Consultar as agendas.
5. Apresentar horários disponíveis.
6. Receber a escolha.
7. Confirmar os dados com o paciente.
8. Revalidar o horário.
9. Criar o evento.
10. Verificar o resultado.
11. Registrar a operação.
12. Confirmar ao paciente.

**Critérios de aceite:**
- Nenhum agendamento poderá ser confirmado sem registro válido na agenda.
- Horários ocupados não poderão ser oferecidos como disponíveis.
- A disponibilidade deverá ser consultada novamente antes da gravação.
- Em caso de falha ou resultado incerto, o sistema deverá verificar se o evento foi criado antes de tentar novamente.
- O paciente deverá receber os dados corretos do compromisso.

## 3.5. Módulo de remarcação

**Requisitos:**

- RF-038: Identificar o compromisso que o paciente deseja alterar.
- RF-039: Validar a autorização para realizar a operação.
- RF-040: Consultar novas disponibilidades.
- RF-041: Apresentar alternativas.
- RF-042: Solicitar confirmação explícita.
- RF-043: Efetuar a alteração.
- RF-044: Atualizar o registro interno.
- RF-045: Confirmar a alteração ao paciente.

**Regra crítica:**

O sistema não deverá cancelar o agendamento original antes de garantir a nova reserva.

Caso a integração não permita uma alteração segura, deverá utilizar uma estratégia controlada de criação da nova reserva e compensação da operação anterior.

**Critérios de aceite:**
- O agendamento antigo deverá permanecer válido até a nova reserva estar garantida.
- Falhas deverão gerar estado de operação pendente ou incerta.
- O sistema não poderá informar remarcação concluída sem verificar a agenda.

## 3.6. Módulo de cancelamento

**Requisitos:**

- RF-046: Identificar o compromisso.
- RF-047: Validar a autorização do solicitante.
- RF-048: Consultar a política de cancelamento.
- RF-049: Solicitar confirmação explícita.
- RF-050: Cancelar o evento na agenda.
- RF-051: Registrar o motivo, quando informado.
- RF-052: Atualizar o status do agendamento.
- RF-053: Confirmar o cancelamento.

**Critérios de aceite:**
- Expressões ambíguas não deverão resultar em cancelamento.
- O sistema deverá solicitar confirmação antes de executar a operação.
- Não poderá informar cancelamento concluído sem verificar o resultado.
- A política da clínica deverá prevalecer sobre interpretações da IA.

## 3.7. Módulo de confirmação e lembretes

**Requisitos:**

- RF-054: Identificar consultas futuras.
- RF-055: Enviar lembretes conforme a configuração da clínica.
- RF-056: Solicitar confirmação de presença.
- RF-057: Registrar a resposta do paciente.
- RF-058: Atualizar o status de confirmação.
- RF-059: Permitir encaminhamento de respostas ambíguas.
- RF-060: Evitar envio duplicado de lembretes.

**Respostas previstas:**
- Confirmo.
- Não poderei comparecer.
- Quero remarcar.
- Tenho uma dúvida.
- Não reconheço esse agendamento.

**Regras:**
- Mensagem enviada não significa mensagem entregue.
- Mensagem entregue não significa consulta confirmada.
- Confirmação exige manifestação inequívoca do paciente.
- Respostas de cancelamento ou remarcação deverão seguir os fluxos próprios.

## 3.8. Módulo de relacionamento

**Requisitos:**

- RF-061: Identificar pacientes que não concluíram um agendamento.
- RF-062: Permitir retomada de conversas interrompidas.
- RF-063: Permitir comunicação administrativa pós-atendimento.
- RF-064: Permitir campanhas ou mensagens somente quando houver base legal e autorização aplicável.
- RF-065: Registrar interações de relacionamento.
- RF-066: Respeitar solicitações de interrupção de mensagens.

**Limite:** campanhas promocionais complexas e automações avançadas de marketing não fazem parte do MVP.

## 3.9. Módulo de atendimento humano

O atendimento humano será realizado manualmente pela equipe, inicialmente pelo WhatsApp normal.

O sistema deverá gerenciar o encaminhamento e a responsabilidade pela conversa, mesmo quando a equipe utilizar outro canal para responder.

**Requisitos:**

- RF-067: Identificar solicitações que exigem atendimento humano.
- RF-068: Criar uma pendência de atendimento.
- RF-069: Registrar o motivo e a prioridade.
- RF-070: Preservar o histórico e o contexto.
- RF-071: Notificar a equipe responsável.
- RF-072: Registrar aceite do atendimento.
- RF-073: Pausar respostas automáticas quando o atendimento humano assumir.
- RF-074: Permitir registrar a resolução.
- RF-075: Permitir retomada autorizada da automação.

**Motivos de encaminhamento:**
- Solicitação explícita do paciente.
- Reclamação.
- Negociação ou condição comercial não cadastrada.
- Dúvida não respondida pela base de conhecimento.
- Problema de agendamento.
- Falha de integração.
- Situação clínica.
- Emergência ou possível urgência.
- Solicitação administrativa excepcional.

**Critérios de aceite:**
- A conversa deverá ser marcada como pendente.
- O contexto deverá estar disponível à equipe.
- O bot não poderá continuar respondendo enquanto o humano estiver com a responsabilidade da conversa.
- A automação só poderá ser retomada mediante encerramento ou liberação do atendimento humano.
- O sistema não deverá prometer que um atendente assumiu antes da confirmação do aceite.

## 3.10. Módulo de segurança e situações clínicas

O assistente é administrativo, não clínico.

**Requisitos:**

- RF-076: Identificar mensagens que indiquem possível emergência odontológica ou médica.
- RF-077: Interromper fluxos administrativos quando houver risco identificado.
- RF-078: Orientar busca por atendimento profissional adequado, conforme protocolo aprovado pela clínica.
- RF-079: Encaminhar a situação para atendimento humano quando apropriado.
- RF-080: Impedir diagnósticos ou prescrições.
- RF-081: Impedir recomendações de dosagem ou alteração de medicamentos.
- RF-082: Não interpretar exames ou radiografias como diagnóstico.
- RF-083: Não afirmar que sintomas são inofensivos.
- RF-084: Não substituir avaliação profissional.

**Regra de emergência:**

Quando houver sinais de possível emergência médica, o sistema deverá orientar a busca imediata por atendimento de emergência. No Brasil, poderá indicar o SAMU pelo número 192 quando pertinente.

O sistema não deverá tentar resolver uma emergência por meio de perguntas administrativas nem aguardar a equipe da clínica para fornecer uma orientação básica de segurança.

As mensagens e os critérios de classificação deverão ser definidos e aprovados por responsável técnico da clínica.

---

# 4. Requisitos transversais

## 4.1. Inteligência artificial

A IA será responsável por:
- Interpretar linguagem natural.
- Identificar intenção.
- Extrair dados de mensagens.
- Identificar ambiguidades.
- Consultar a base de conhecimento.
- Elaborar respostas.
- Sugerir encaminhamentos.

A IA não será responsável por:
- Autorizar operações.
- Determinar regras comerciais.
- Decidir permissões de acesso.
- Confirmar gravações na agenda.
- Executar cancelamentos sem confirmação.
- Inventar dados ausentes.
- Emitir orientações clínicas.

**Regra arquitetural:** a IA interpreta e propõe; o motor determinístico valida e autoriza; as integrações executam; o sistema verifica o resultado.

## 4.2. Base de conhecimento (RAG administrativo)

A base de conhecimento deverá conter documentos e informações aprovados pela clínica.

**Requisitos:**
- Armazenar documentos e informações estruturadas.
- Permitir atualização.
- Registrar origem e data de atualização.
- Recuperar conteúdos relevantes.
- Restringir respostas às informações autorizadas.
- Identificar ausência de informação.
- Permitir desativação de documentos desatualizados.

A base não deverá conter prontuários odontológicos no MVP.

## 4.3. Histórico de conversas

O sistema deverá registrar:
- Identificação da conversa.
- Paciente associado, quando identificado.
- Canal de origem.
- Mensagens recebidas e enviadas.
- Data e horário.
- Intenção identificada.
- Operações realizadas.
- Encaminhamentos humanos.
- Resultado das operações.
- Erros relevantes.

Os registros deverão respeitar políticas de retenção, minimização de dados e controle de acesso.

## 4.4. Auditoria

Operações relevantes deverão gerar registros de auditoria.

Exemplos:
- Criação de agendamento.
- Cancelamento.
- Remarcação.
- Alteração cadastral.
- Transferência para humano.
- Alteração de configuração.
- Falha de integração.
- Acesso administrativo relevante.

Cada registro deverá conter, quando aplicável:
- Identificador da clínica.
- Identificador da operação.
- Tipo de ação.
- Responsável pela ação.
- Data e horário.
- Resultado.
- Referência ao objeto afetado.

---

# 5. Regras de negócio

As regras abaixo deverão ser tratadas como obrigatórias no MVP.

## 5.1. Identificação e cadastro

**RN-001:** Todo paciente deverá possuir identificador interno único.

**RN-002:** Um número de telefone não será considerado prova suficiente de identidade para acessar informações sensíveis.

**RN-003:** Telefones compartilhados poderão estar associados a diferentes pessoas.

**RN-004:** O sistema deverá evitar cadastros duplicados.

**RN-005:** A associação de contatos deverá exigir validação apropriada.

**RN-006:** Pacientes menores de idade poderão exigir identificação e validação do responsável legal.

## 5.2. Agendamentos

**RN-007:** Cada procedimento deverá possuir duração configurada.

**RN-008:** Cada profissional deverá possuir disponibilidade própria.

**RN-009:** Um profissional só poderá ser oferecido para procedimentos para os quais esteja habilitado.

**RN-010:** A disponibilidade deverá ser consultada na fonte oficial.

**RN-011:** O horário deverá ser revalidado antes da criação do evento.

**RN-012:** O sistema deverá evitar agendamentos duplicados.

**RN-013:** Operações com resultado incerto deverão ser verificadas antes de uma nova tentativa.

**RN-014:** Toda confirmação de agendamento deverá depender de resultado validado.

## 5.3. Cancelamentos e remarcações

**RN-015:** Cancelamentos exigem confirmação explícita.

**RN-016:** Remarcações não poderão invalidar a reserva original antes da garantia da nova.

**RN-017:** Políticas de cancelamento deverão ser configuradas pela clínica.

**RN-018:** O sistema deverá registrar as operações realizadas.

## 5.4. Atendimento humano

**RN-019:** O atendimento humano terá prioridade sobre a automação.

**RN-020:** Uma conversa assumida por um atendente deverá suspender respostas automáticas.

**RN-021:** O sistema deverá preservar o contexto da conversa.

**RN-022:** Uma pendência não poderá ser considerada resolvida apenas porque uma notificação foi enviada.

**RN-023:** A retomada da automação deverá ser controlada.

## 5.5. Segurança clínica

**RN-024:** O sistema não poderá diagnosticar.

**RN-025:** O sistema não poderá prescrever ou recomendar dosagens.

**RN-026:** O sistema não poderá garantir ausência de risco clínico.

**RN-027:** Situações potencialmente emergenciais deverão seguir protocolo específico.

**RN-028:** Dúvidas clínicas deverão ser encaminhadas a profissional habilitado.

## 5.6. Dados e privacidade

**RN-029:** Cada clínica deverá acessar exclusivamente seus próprios dados.

**RN-030:** Dados deverão ser coletados conforme necessidade e finalidade.

**RN-031:** Dados de saúde deverão ser tratados como dados pessoais sensíveis.

**RN-032:** Acesso administrativo deverá obedecer a permissões específicas.

**RN-033:** Integrações deverão utilizar credenciais protegidas.

**RN-034:** Logs não deverão expor desnecessariamente dados pessoais ou sensíveis.

**RN-035:** A clínica deverá definir políticas de retenção e descarte de dados.

---

# 6. Estados operacionais

## 6.1. Estados da conversa

| Estado | Significado |
|---|---|
| NEW | Conversa recém-criada |
| ACTIVE | Atendimento automatizado ativo |
| COLLECTING_DATA | Coleta de informações |
| AWAITING_CONFIRMATION | Aguardando confirmação |
| PROCESSING | Operação em execução |
| WAITING_EXTERNAL | Aguardando integração externa |
| WAITING_HUMAN | Aguardando atendente |
| HUMAN_ACTIVE | Atendimento assumido por humano |
| PAUSED | Automação pausada |
| RESOLVED | Solicitação resolvida |
| CLOSED | Conversa encerrada |
| ERROR | Erro operacional |
| ABANDONED | Conversa abandonada |

## 6.2. Estados do agendamento

| Estado | Significado |
|---|---|
| REQUESTED | Solicitação recebida |
| SEARCHING | Consultando disponibilidade |
| OFFERED | Horários apresentados |
| PENDING_CONFIRMATION | Aguardando confirmação |
| BOOKING | Criando agendamento |
| BOOKED | Agendamento confirmado |
| RESCHEDULE_PENDING | Remarcação pendente |
| CANCEL_PENDING | Cancelamento pendente |
| CANCELLED | Agendamento cancelado |
| FAILED | Operação falhou |
| UNKNOWN | Resultado da operação ainda não confirmado |

O estado UNKNOWN é obrigatório para situações em que uma integração sofre timeout e não é possível determinar imediatamente se a operação foi concluída.

## 6.3. Estados do atendimento humano

| Estado | Significado |
|---|---|
| CREATED | Pendência criada |
| NOTIFIED | Equipe notificada |
| ACCEPTED | Atendente aceitou |
| IN_PROGRESS | Atendimento em andamento |
| RESOLVED | Solicitação resolvida |
| CLOSED | Atendimento encerrado |
| UNASSIGNED | Sem responsável |
| OVERDUE | Prazo de atendimento excedido |
| REASSIGNED | Responsabilidade transferida |
| REOPENED | Solicitação reaberta |

---

# 7. Requisitos não funcionais

## 7.1. Confiabilidade

- RNF-001: Operações críticas deverão possuir controle de idempotência.
- RNF-002: Eventos repetidos não deverão produzir operações duplicadas.
- RNF-003: Falhas temporárias deverão permitir novas tentativas controladas.
- RNF-004: Operações incertas deverão ser verificadas antes de repetição.
- RNF-005: Erros deverão ser registrados.
- RNF-006: O sistema deverá permitir recuperação de operações pendentes.

## 7.2. Segurança

- RNF-007: Isolamento de dados por clínica.
- RNF-008: Controle de acesso baseado em papéis.
- RNF-009: Credenciais armazenadas de forma segura.
- RNF-010: Comunicação protegida por HTTPS nas integrações públicas.
- RNF-011: Proteção contra acesso indevido.
- RNF-012: Proteção contra injeção de instruções em mensagens e documentos.
- RNF-013: Validação de entradas externas.
- RNF-014: Auditoria de operações relevantes.

## 7.3. Escalabilidade

- RNF-015: A arquitetura deverá permitir inclusão de novas clínicas.
- RNF-016: Dados deverão possuir identificação de tenant desde o início.
- RNF-017: Workflows deverão ser modulares.
- RNF-018: Integrações deverão ser desacopladas da lógica conversacional.
- RNF-019: O provedor de IA deverá poder ser substituído sem reconstrução completa do produto.
- RNF-020: O processamento deverá permitir evolução para filas e workers.

## 7.4. Manutenibilidade

- RNF-021: Workflows deverão possuir responsabilidades delimitadas.
- RNF-022: Entradas e saídas deverão seguir contratos padronizados.
- RNF-023: Configurações da clínica não deverão ficar espalhadas em nós e prompts.
- RNF-024: Alterações deverão ser documentadas.
- RNF-025: Erros deverão possuir identificação e contexto suficientes para diagnóstico.

## 7.5. Desempenho

- RNF-026: O sistema deverá responder em tempo adequado ao canal utilizado.
- RNF-027: Consultas de banco deverão utilizar índices apropriados.
- RNF-028: Operações externas lentas não deverão bloquear indefinidamente o atendimento.
- RNF-029: O sistema deverá possuir timeout configurado para integrações.
- RNF-030: Mensagens recebidas deverão ser processadas sem perda silenciosa.

As metas de latência e disponibilidade serão definidas após os testes do MVP.

---

# 8. Integrações previstas

| Integração | Finalidade | Fase |
|---|---|---|
| n8n Chat | Desenvolvimento e testes | MVP |
| Supabase | Banco de dados e armazenamento | MVP |
| Google Calendar | Agenda dos profissionais | MVP |
| Telegram Bot API | Testes externos | MVP |
| Provedor de IA | Interpretação e geração de respostas | MVP |
| WhatsApp Cloud API | Atendimento de produção | Implantação |
| Supabase Storage | Documentos e arquivos | Conforme necessidade |

## 8.1. Abstração de canais

Os canais deverão utilizar uma estrutura interna padronizada de mensagens.

A lógica de atendimento não deverá depender diretamente de Telegram, WhatsApp ou Chat do n8n.

Isso permitirá trocar ou adicionar canais sem reconstruir os módulos centrais.

## 8.2. Abstração de IA

O sistema deverá utilizar uma camada de integração que permita substituir o modelo de IA.

A troca de provedor não deverá exigir alterações nas regras de negócio, na agenda ou no banco de dados.

---

# 9. Fora do escopo do MVP

Os seguintes recursos não serão desenvolvidos nesta primeira versão:

1. Prontuário odontológico eletrônico.
2. Anamnese digital.
3. Diagnóstico automatizado.
4. Interpretação de radiografias e exames.
5. Prescrição de medicamentos.
6. Gestão financeira completa.
7. Controle de estoque.
8. Emissão fiscal.
9. Gestão de comissões.
10. Aplicativo próprio para pacientes.
11. Aplicativo próprio para dentistas.
12. Painel administrativo completo.
13. Gestão avançada de campanhas.
14. Integração com múltiplos sistemas de gestão odontológica.
15. RAG sobre documentos clínicos.
16. Análise clínica de histórico de pacientes.

Esses recursos poderão ser avaliados em versões futuras, mediante análise de viabilidade, segurança, conformidade regulatória e impacto arquitetural.

---

# 10. Requisitos de conformidade e LGPD

O produto poderá tratar dados pessoais e dados pessoais sensíveis, inclusive informações relacionadas à saúde.

Antes da utilização em produção, deverão ser definidos:

- Papéis e responsabilidades da clínica e do fornecedor da plataforma.
- Finalidades e bases legais de tratamento.
- Política de privacidade.
- Política de retenção e descarte.
- Procedimentos para atendimento aos direitos dos titulares.
- Controle de acesso.
- Proteção das credenciais.
- Registro de operações de tratamento.
- Procedimentos para incidentes de segurança.
- Contratos e responsabilidades com fornecedores de infraestrutura e IA.
- Regras para utilização de dados em testes.

O sistema deverá ser projetado considerando a LGPD, especialmente os princípios de finalidade, adequação, necessidade, segurança, prevenção e responsabilização.

A implantação em produção deverá passar por revisão de segurança e conformidade. A utilização de ferramentas gratuitas ou de uma infraestrutura simplificada não elimina essas obrigações.

---

# 11. Critérios gerais de aprovação do MVP

O MVP será considerado funcionalmente aprovado quando atender aos seguintes cenários:

**Cenário 1 — Atendimento informativo**
- Paciente pergunta sobre horário, endereço ou procedimento.
- Sistema consulta informações cadastradas.
- Sistema responde corretamente.

**Cenário 2 — Agendamento**
- Paciente solicita uma consulta.
- Sistema identifica o procedimento.
- Consulta disponibilidade.
- Apresenta opções.
- Recebe confirmação.
- Cria o evento.
- Verifica a gravação.
- Confirma ao paciente.

**Cenário 3 — Conflito de horário**
- Dois pacientes selecionam o mesmo horário.
- Sistema identifica o conflito na revalidação.
- Não cria reservas duplicadas.
- Apresenta alternativas.

**Cenário 4 — Remarcação**
- Paciente solicita alteração.
- Sistema identifica o compromisso.
- Consulta novas opções.
- Confirma a escolha.
- Garante a nova reserva antes de invalidar a anterior.

**Cenário 5 — Cancelamento**
- Paciente solicita cancelamento.
- Sistema identifica o compromisso.
- Solicita confirmação explícita.
- Executa a operação.
- Verifica o resultado.
- Atualiza o registro.

**Cenário 6 — Atendimento humano**
- Paciente solicita atendente.
- Sistema cria pendência.
- Preserva o contexto.
- Notifica a equipe.
- Pausa a automação após o aceite humano.

**Cenário 7 — Situação clínica**
- Paciente relata sintomas ou solicita orientação clínica.
- Sistema não diagnostica nem prescreve.
- Aplica o protocolo de segurança.
- Encaminha a situação conforme necessário.

**Cenário 8 — Falha de integração**
- Google Calendar apresenta timeout.
- Sistema não presume sucesso nem falha definitiva.
- Verifica o estado da operação.
- Evita duplicidade.
- Registra a ocorrência.

**Cenário 9 — Isolamento entre clínicas**
- Uma clínica tenta consultar dados de outra.
- O sistema bloqueia o acesso.
- A tentativa é registrada quando aplicável.

**Cenário 10 — Mensagem duplicada**
- O canal envia novamente o mesmo evento.
- O sistema identifica a duplicidade.
- Não repete operações nem respostas indevidamente.

---

# 12. Decisões pendentes para fechamento do PRD

Os itens abaixo precisam ser definidos com a clínica antes da implementação definitiva.

| ID | Decisão | Impacto |
|---|---|---|
| D-001 | A clínica atende apenas particular ou também convênios? | Informações e regras comerciais |
| D-002 | Como será tratada a primeira consulta? | Fluxo de agendamento |
| D-003 | Quais procedimentos serão disponibilizados? | Catálogo de serviços |
| D-004 | Qual a duração de cada procedimento? | Disponibilidade |
| D-005 | Quais profissionais realizam cada procedimento? | Regras da agenda |
| D-006 | A clínica permite escolha livre de profissional? | Fluxo de agendamento |
| D-007 | Qual o intervalo mínimo para agendamento? | Regras da agenda |
| D-008 | Com quanto tempo de antecedência será permitido cancelar? | Política de cancelamento |
| D-009 | Com quanto tempo de antecedência será permitido remarcar? | Política de remarcação |
| D-010 | Quais serão os horários e dias de funcionamento? | Disponibilidade |
| D-011 | Como serão tratados encaixes e urgências? | Exceções de agenda |
| D-012 | Quais serão os intervalos de lembrete? | Relacionamento |
| D-013 | Como será feita a identificação de pacientes? | Segurança |
| D-014 | Qual será o procedimento para menores de idade? | Responsável legal |
| D-015 | Quem receberá os encaminhamentos humanos? | Handoff |
| D-016 | Qual o prazo esperado para atendimento humano? | Operação |
| D-017 | Quais informações poderão ser divulgadas automaticamente? | Base de conhecimento |
| D-018 | Quais situações exigem bloqueio imediato da automação? | Segurança |

---

# 13. Diretrizes para evolução do produto

O desenvolvimento deverá respeitar a seguinte ordem:

**Fase 1 — Fundação**
- Estrutura do banco.
- Identificação de clínicas e pacientes.
- Gateway de mensagens.
- Gerenciamento de conversas.
- Registro de mensagens.
- Configurações básicas.

**Fase 2 — Atendimento**
- Classificação de intenção.
- Base de conhecimento.
- Respostas administrativas.
- Guardrails.
- Handoff humano.

**Fase 3 — Agenda**
- Cadastro de profissionais e serviços.
- Integração com Google Calendar.
- Agendamento.
- Remarcação.
- Cancelamento.
- Controle de conflitos.

**Fase 4 — Relacionamento**
- Confirmações.
- Lembretes.
- Recuperação de conversas.
- Pós-atendimento.

**Fase 5 — Testes e produção**
- Testes de falhas.
- Testes de concorrência.
- Testes de segurança.
- Testes de isolamento.
- Migração para WhatsApp Cloud API.
- Revisão de conformidade.

**Fase 6 — Evolução SaaS**
- Painel administrativo.
- Onboarding de clínicas.
- Configuração por tenant.
- Gestão de planos.
- Monitoramento centralizado.
- Escalabilidade de processamento.

---

# 14. Princípios obrigatórios do produto

1. **Segurança antes da autonomia:** nenhuma facilidade de automação justifica uma operação insegura.
2. **Fonte oficial prevalece:** dados cadastrados e sistemas oficiais prevalecem sobre interpretações da IA.
3. **Nenhuma operação crítica sem validação:** agendamentos, cancelamentos e alterações precisam de confirmação e verificação.
4. **Humano sempre disponível como alternativa operacional:** o sistema deverá permitir intervenção humana.
5. **Não inventar:** na ausência de informação, perguntar ou encaminhar.
6. **Privacidade desde a arquitetura:** isolamento entre clínicas e minimização de dados desde o primeiro dia.
7. **Modularidade:** canais, modelos de IA e integrações deverão ser substituíveis.
8. **Rastreabilidade:** operações importantes deverão deixar registros auditáveis.
9. **Separação clínica e administrativa:** o assistente não substitui profissionais de saúde nem prontuários.
10. **Escalabilidade planejada:** o MVP poderá ser simples, mas não deverá criar dependências desnecessárias que impeçam a evolução para SaaS.

---

**Fim do Documento 01 — PRD Dental Assistant.**
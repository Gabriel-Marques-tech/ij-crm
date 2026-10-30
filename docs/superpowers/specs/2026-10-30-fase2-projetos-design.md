# ij-crm Fase 2 — Projeto no centro (vendas + projetos + gestão)

Data: 2026-10-30. Status: decidido em conversa (grilling Q1–Q37); builder check feito e respondido. Aguardando aprovação final.
Base: `2026-10-24-ij-crm-design.md` (v1). Onde este doc não fala, vale a v1.

## 1. Intenção e porquê

A v1 é um CRM de vendas: o vendedor fala no grupo, o card nasce sozinho. O time de
projetos só fica sabendo de um cliente **depois** do ganho, quando um card novo
aparece no quadro Projetos. Proposta não existe no sistema: cada um monta onde quer,
o escopo chega em projetos já fechado e a análise de viabilidade acontece por fora.

A fase 2 começa a transformar o ij-crm na plataforma da IJ. O **Projeto** vira a
entidade central, desde o primeiro contato. Vendas e projetos olham a mesma coisa,
o time de projetos acompanha em tempo real e participa da proposta antes dela ir ao
cliente. O ganho deixa de ser um "salto" entre quadros e vira um handoff com
checklist.

Segunda ideia central: **a pessoa às vezes nem precisa abrir a plataforma.** Tudo
que se faz na tela se faz pelo Claude da pessoa, via conector MCP, com as mesmas
permissões. Isso é parte do produto, não um extra.

Usuários: vendas, projetos e gestão (≤15 pessoas). Outras áreas da IJ ficam fora por enquanto.

## 2. Objetivos, não-objetivos, anti-objetivos

**Objetivos (fase 2):**
- **Projeto** como entidade única do primeiro contato à finalização (substitui `Oportunidade`).
- **Proposta**: uma por Projeto, numa aba própria, editor rich text, versões, "caneta"
  com dono nomeado, pingue-pongue vendas ↔ projetos até concordarem, comentários ao vivo.
- Upload de arquivos de base (inclusive proposta feita por fora) com OCR/extração e
  preenchimento automático.
- Handoff vendas → projetos com checklist e resumo obrigatório.
- Contrato em PDF gerado do template da IJ.
- Execução: cronograma estruturado vindo da proposta + check-in semanal do GP.
- Avisos no app e no WhatsApp privado.
- Painel de métricas para vendas e projetos.
- Conector MCP (OAuth) que faz tudo que a tela faz.

**Não-objetivos (fica para depois):**
- Prospecção (lista fria, cadência de cold call).
- Eventos do Google Calendar (etapa 2 do calendário).
- Assistente de IA próprio embutido no editor.
- Outras áreas da IJ além de vendas, projetos e gestão.
- Controle de horas.
- Assinatura eletrônica dentro do sistema.
- Coedição simultânea com cursores (estilo Google Docs).
- Modo sugestão / track changes.

**Anti-objetivos (fracasso mesmo funcionando):**
- Proposta chegar ao cliente sem que os dois lados tenham visto a última versão.
- Projetos continuar descobrindo o escopo só depois do ganho.
- MCP atrás da tela: algo que só dá para fazer abrindo o app (exceto as ações
  destrutivas listadas em §4.12).
- Dependências pesadas na máquina AWS (servidor de sincronização, OCR nativo,
  fila externa). Vale a regra da v1: ≤15 usuários, opção mais simples e leve.
- Quebrar o fluxo da v1: WhatsApp continua criando e atualizando cards sem exigir
  campo além de `nome`.

## 3. Restrições

- Stack da v1: Next.js full-stack, Prisma, Postgres, um container, EC2 da IJ via
  docker compose, Evolution API, camada de LLM com `LLM_PROVEDOR` (GPT-6.1 Sol
  reasoning low, fallback Haiku 5.5).
- Disco e memória modestos: build fora da máquina, limites de memória nos containers.
- Erros debugáveis: a UI mostra um `ref`, o log do servidor tem a causa com o mesmo `ref`.
- Retenção de JSON de LLM (90 dias) vale também para os resultados de OCR/extração.

## 4. Decisões

### 4.1 Projeto como entidade única (Q1, Q8)

- `Oportunidade` vira **Projeto**. Todo lead já é um Projeto desde o primeiro contato.
- Um card, uma Timeline e um histórico do contato à finalização (ou perda).
- **Migração**: cada par vendas → projetos ligado por `origem_oportunidade_id` vira
  um único Projeto. A Timeline e as `TransicaoFase` dos dois são unidas, em ordem.
  Cards de projetos sem origem viram Projetos sozinhos. Reaberturas (`reaberta_de_id`)
  e `pipefy_id` são preservados.
- Pipeline de WhatsApp da v1 continua funcionando, agora sobre Projeto. Ele continua
  mexendo só na parte de vendas do ciclo.

### 4.2 Ciclo e quadros (Q28)

- Fases-marco **fixas**, porque as regras dependem delas: Proposta, Montando contrato,
  **Ganho = contrato assinado** (Q33), Handoff, Execução, Finalizado e Perdido (perdido
  em qualquer ponto, com motivo).
- Gestão cria **subfases livres** entre os marcos, como hoje (ex.: primeiro contato,
  reunião diagnóstica, reunião intermediária, reunião de proposta, negociação, coleta
  de dados).
- **Mapeamento da v1**: as fases atuais de vendas continuam; `montando_contrato` vira o
  marco Montando contrato e `contrato_assinado` vira o marco Ganho. As fases de projetos
  (`em_execucao`, `conclusao`, `coleta_dados`, `finalizado`) ficam sob Execução/Finalizado.
- **Quadro Vendas**: do contato até o Ganho (contrato assinado). **Quadro Projetos**:
  do Handoff em diante. **[escolha do agente]** Handoff é a primeira coluna do quadro
  Projetos, porque é o time de projetos que recebe o cliente.
- **Marcos travam** (Q34): não dá para levar um card a Montando contrato sem a proposta
  aceita, nem a Ganho sem passar por Montando contrato, nem a Execução sem o checklist
  de handoff fechado. Nem gestor força. Vale para arraste, WhatsApp e MCP.
- **WhatsApp** (Q34): "fechou"/"assinou" no grupo só move o card se a regra do marco
  permitir; senão marca `revisar` e responde no grupo dizendo o que falta.
- **[escolha do agente]** Cards migrados que já estão além de Proposta ficam livres
  das travas para o que já passou (não exigem proposta retroativa).
- O card mostra o **status da proposta** (badge). A proposta em si fica na aba
  Propostas, não no Kanban.

### 4.3 Proposta: fluxo (Q3, Q13, Q14, Q17, Q20)

- **Uma proposta por Projeto**, com várias versões. Ela é validada antes da reunião de
  proposta com o cliente.
- **Caneta**: só uma pessoa edita por vez, e ela tem nome. O dono da caneta (e o Claude
  dele, via MCP) edita; todo o resto comenta. O dono pode passar a caneta para outra
  pessoa do mesmo lado.
- **Pingue-pongue**: começa com vendas. Quem está com a caneta escolhe:
  - **Devolver**: salva uma versão e manda a caneta para o outro lado avaliar as mudanças.
  - **Concordar**: aceita a versão atual sem editar. Só vale se a última versão veio
    do outro lado.
- **Consenso** = um lado concorda com a última versão do outro. A proposta fica
  **pronta para envio**. Quem envia ao cliente é **sempre vendas** (dono da relação).
- **Envio** (Q36): o sistema gera o **PDF da proposta** no template da IJ (mesmo gerador
  do contrato). O usuário baixa e escolhe como mandar; vendas marca como enviada. O
  sistema não envia e-mail.
- A análise pode ter quantas rodadas forem necessárias.
- Projetos (GP de projetos ou quem está com a caneta) pode marcar como **inviável**, com motivo. Isso encerra o Projeto como perdido.
- Projetos edita direto no texto; quem recebe a caneta vê o **diff** entre a versão que
  entregou e a que voltou. Comentários servem para o que não é reescrita.

Status da proposta (badge no card): Rascunho (vendas) → Em análise (projetos) ⇄ Em
ajuste (vendas) → Pronta para envio → Enviada → Aceita / Recusada / Revisão pedida.
**[escolha do agente]** sobre os nomes.

### 4.4 Proposta: depois do cliente (Q18)

- Cliente pede ajuste → volta para vendas e gera uma nova versão. Só passa de novo por
  projetos se mudar o **escopo, prazo ou valor**. Se vendas mexer nesses pontos, a
  proposta volta automaticamente para projetos.
- **Aceite do cliente** → Montando contrato (§4.9). **Contrato assinado = Ganho** →
  dispara o handoff (§4.8).
- Recusa → Projeto perdido, com motivo.

### 4.5 Editor e versões (Q10, Q19)

- Rich text. **[escolha do agente]** Tiptap; o conteúdo é salvo também em Markdown,
  que é o formato que o Claude lê e escreve pelo MCP.
- **Versão = clique em "Salvar versão"**, com nota opcional. Entre um clique e outro o
  rascunho tem autosave, mas o autosave não é versão. Passar a caneta salva uma versão
  automaticamente.
- Histórico: v1, v2, v3 com autor, data e nota; diff entre quaisquer duas versões.
- Versões são imutáveis.
- Parte **estruturada** da proposta, além do texto: valor, prazo, escopo resumido e
  **cronograma de entregas** (entrega, data, valor ou parcela). É ela que alimenta a
  regra de §4.4, o contrato e a execução.

### 4.6 Comentários (Q16)

- Presos a um trecho selecionado do texto, ou gerais na proposta.
- Qualquer usuário logado comenta, em qualquer etapa.
- Podem ser marcados como resolvidos.
- "Ao vivo" = aparecem sozinhos em poucos segundos. **[escolha do agente]**
  atualização periódica (polling); sem websocket.
- Comentário gera aviso só no app para o dono da caneta.

### 4.7 Upload e preenchimento automático (Q11, Q22)

- Arquivos de base ficam anexados ao **Projeto**: PDF, .docx, .md, .txt, imagens. Inclui
  propostas feitas por fora que a pessoa quer trazer para o sistema.
- PDF digital e .docx: texto extraído direto, sem LLM.
- PDF escaneado e imagens: enviados ao modelo do app (GPT-6.1 Sol com visão), que faz o
  OCR e preenche os campos estruturados (§4.5) numa chamada só. Sem dependência de OCR
  no servidor.
- O resultado entra no editor como rascunho e passa pelo **mesmo fluxo de validação**
  de qualquer proposta.
- **[escolha do agente]** arquivos num volume no EC2, incluídos no backup.

### 4.8 Handoff (Q26)

Disparado pelo Ganho (contrato assinado). Antes da execução:
- **GP nomeado**, que passa a ser o responsável do Projeto na execução.
- **Checklist de handoff**: proposta final congelada, PDF do contrato assinado anexado,
  contatos do cliente, kickoff marcado, acessos/materiais recebidos.
- **Resumo de handoff obrigatório** escrito por vendas: contexto, combinados verbais,
  riscos, o que o cliente valoriza.
- O Projeto só entra em **Execução** quando o checklist fecha.

### 4.9 Contrato (Q21)

- Gerado na fase Montando contrato, depois do aceite da proposta: dados da Empresa (razão social, CNPJ, endereço,
  representante) + parte estruturada da proposta (escopo, prazo, valor, parcelas)
  num **template fixo da IJ**.
- Campos editáveis antes de gerar; não passa pelo pingue-pongue.
- Saída em PDF no formato da IJ.
- Assinatura fora do sistema. Marcar como assinado leva o Projeto a Ganho. O PDF
  assinado é anexado de volta ao Projeto (item do checklist de handoff).

### 4.10 Execução (Q24)

- O cronograma de entregas da proposta vira o **previsto**.
- O GP marca entregas como feitas e faz um **check-in semanal**: verde/amarelo/vermelho
  com uma linha de motivo.
- O painel compara previsto × realizado. Sem controle de horas.

### 4.11 Avisos (Q4, Q27)

- Todo mundo vê tudo, atualizado sozinho.
- **App** (sino com contador): sua vez, comentário na proposta que está com você,
  mudança de status.
- **WhatsApp privado** (Evolution, já no projeto): só "é sua vez" e "aceita/handoff".
  Respeita o safe mode `NOTIFICATIONS_ENABLED` da v1.

### 4.12 Papéis e lados (Q5, Q25, Q35)

- Cada usuário tem um **lado/área**: vendas ou projetos (ou nenhum, para gestão/admin).
- `vendedor` e `projetos`: editam quando estão com a caneta e comentam sempre.
- **GP da área** (GP de vendas, GP de projetos): pode pegar a caneta, devolver e
  concordar em nome do seu lado. É um **cargo** do usuário dentro da área, não um papel
  de permissão separado. A IJ tem outros cargos; eles ficam para depois, então o modelo
  deve permitir acrescentar cargos sem migração dolorosa.
- **GP do projeto** (execução): pessoa de projetos designada no handoff, responsável
  pelo check-in. **[escolha do agente]** designada pelo GP de projetos.
- `gestor`: vê tudo e vê o painel. **[escolha do agente]** não age na caneta; quem
  destrava um lado é o GP daquela área.
- `admin`: técnico, como na v1.
- Sem visão restrita por área: a transparência é o objetivo.

### 4.13 MCP (Q9, Q30, Q31)

- Conector MCP remoto que faz **tudo que a tela faz**, com as **mesmas permissões** do
  papel da pessoa.
- Funciona no Claude Code, no claude.ai e no Claude Desktop: login **OAuth** no CRM
  ("conectar" → login → autorizar).
- Ações pelo MCP gravam Timeline como as da tela, marcadas "via MCP" com o autor.
- **Ficam só na tela**: deleção definitiva, merge de contatos e configuração técnica.
- **Regra de construção**: cada fatia entrega a tela e as ferramentas MCP juntas,
  chamando a mesma camada de serviço. O MCP nunca fica atrás da tela.
- Assistente próprio da IJ fica para o futuro.
- As contas Claude do time geralmente são da IJ. LGPD do conector não é tratada agora (Q37).
- OCR enviado à OpenAI segue os mesmos termos da v1 (`store: false`).

### 4.14 Painel (Q6)

Responde às perguntas da gestão. **[escolha do agente]** sobre as métricas:
- **Estamos convertendo?** Conversão por fase, tempo médio em cada fase, valor em
  proposta e valor fechado no mês, versões até fechar.
- **O time está engajado?** Interações registradas por vendedor (WhatsApp `#crm` e
  tela), próximas ações feitas no prazo.
- **Os leads estão sendo acompanhados?** Projetos sem próxima ação, próximas ações
  vencidas, tempo desde o último contato.
- **Os leads gostaram do contato?** (Q23) Nota de 1 a 5 do vendedor por interação, de
  um clique, mais o sentimento inferido pelo LLM nas mensagens `#crm`.
- **Projetos andando de acordo com a proposta?** Entregas previstas × feitas, status
  do último check-in, projetos vermelhos.
- Tempo com a caneta parada, por pessoa.
- Sem dashboards configuráveis. Tudo também consultável pelo MCP.

## 5. Ordem de construção (Q29, Q32)

1. **Projeto + migração + papéis + base do MCP** (OAuth e ferramentas de Projeto).
2. **Proposta**: editor, versões, caneta, pingue-pongue, comentários, avisos (tela + MCP).
3. **Upload/OCR** (tela + MCP).
4. **Handoff + contrato + execução** (tela + MCP).
5. **Painel** (tela + MCP).

## 6. Deixado para o builder

- Modelo de dados exato (tabelas de proposta, versão, comentário, anexo, handoff,
  check-in), desde que siga as regras acima e o padrão append-only da v1 para
  histórico.
- Formato de armazenamento do rich text, desde que o Markdown fique disponível para o MCP.
- Biblioteca de PDF e de diff.
- Nomes e granularidade das ferramentas MCP.
- Intervalo do polling.

## 7. Pendente com o usuário

- Modelo de contrato atual da IJ e logo em vetor: **trabalhados depois, não bloqueiam**.
  Até lá os PDFs (proposta e contrato) saem num template provisório simples, trocável
  sem mexer no fluxo.
- Da v1, ainda abertos: número de WhatsApp dedicado, ~50 mensagens reais para o benchmark.

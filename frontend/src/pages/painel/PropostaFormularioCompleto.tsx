import { useEffect, useMemo, useRef, useState } from "react";
import { CorrespondenciaCampo, ESTADO_CIVIL_OPCOES, EnderecoCampos, Field } from "../../components/qualificacaoCampos";
import FormaPagamentoEtapa, { ConferenciaPlano } from "../../components/FormaPagamento";
import { api, formatarNumeroProposta, prewarmBackend } from "../../lib/api";
import { problemasPessoa, problemasTelefones } from "../../lib/cadastro";
import { fmtBRL, fmtData, lerPlano, planoParaEnvio, resumoPlano, textoMeio, validarPlano, valorPorExtenso } from "../../lib/pagamento";
import { qualificacaoDadosVazio } from "../../types";
import type { EstadoCivil, LoteComCondominio, PropostaDetalhe, QualificacaoDados, ReservaComLote } from "../../types";

/** 'DD/MM/AAAA' (texto de proposta antiga) -> 'AAAA-MM-DD' (campo de data). */
function dataParaIso(v: string | null | undefined): string | null | undefined {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((v ?? "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
}

/** Dados gravados na proposta -> estado do formulário (correção pelo
 * financeiro, 03/10). Completa o que faltar com o formulário vazio, traz as
 * datas de propostas antigas pro formato do campo de data e DESMARCA as
 * confirmações — quem corrige confere e confirma de novo. */
export function dadosParaEdicao(p: PropostaDetalhe): QualificacaoDados {
  const vazio = qualificacaoDadosVazio();
  const dq = (p.dados_qualificacao ?? {}) as Partial<QualificacaoDados>;
  const fp = { ...(dq.forma_pagamento ?? {}) };
  return {
    ...vazio,
    ...dq,
    proponente: { ...(dq.proponente ?? {}), nome: dq.proponente?.nome ?? p.cliente?.nome ?? null },
    endereco_residencial: { ...(dq.endereco_residencial ?? {}) },
    endereco_comercial: { ...(dq.endereco_comercial ?? {}) },
    forma_pagamento: {
      ...fp,
      valor_proposto: fp.valor_proposto ?? p.valor_proposto,
      primeiro_mes: dataParaIso(fp.primeiro_mes),
      sinal_vencimento: dataParaIso(fp.sinal_vencimento),
      avista_data: dataParaIso(fp.avista_data),
      chave_vencimento: dataParaIso(fp.chave_vencimento),
      confirmado: false,
      confirma_valor_fora_tabela: false,
    },
  };
}

/** Mesmas etapas e campos do formulário de qualificação que o cliente final
 * preenche pelo link público (ver QualificacaoPublica.tsx) — só que aqui é
 * o corretor que preenche direto no painel, na hora de criar a proposta
 * (sem depender de mandar link nenhum pro cliente e esperar ele preencher).
 * Os dois alimentam o mesmo PDF (Proposta de Compra/Venda, ver
 * backend/app/pdf.py), então os campos e a validação são os mesmos — só a
 * etapa de "lote" no início e a ausência da etapa de documentos (que só
 * existe no fluxo de qualificação) mudam. */
const PASSOS = [
  "Lote",
  "Proponente",
  "Estado civil",
  "Endereço residencial",
  "Endereço comercial",
  "Contatos",
  "Forma de pagamento",
  "Revisão",
] as const;

function ProgressBar({ passo, total }: { passo: number; total: number }) {
  const pct = Math.round(((passo + 1) / total) * 100);
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-ink-soft">
          Etapa {passo + 1} de {total}
        </span>
        <span className="text-xs text-ink-soft">{PASSOS[passo]}</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-alt overflow-hidden">
        <div className="h-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function PropostaFormularioCompleto({
  lotes,
  onSalvo,
  reservaOrigem = null,
  edicao = null,
}: {
  lotes: LoteComCondominio[];
  onSalvo: () => void;
  /** Financeiro corrigindo uma proposta que já existe (03/10): mesmo
   * formulário e mesmas conferências, lote fixo, e no fim grava a correção
   * (PUT /crm/propostas/{id}/dados) em vez de criar outra proposta. */
  edicao?: PropostaDetalhe | null;
  /** Quando a proposta nasce do botão "Gerar proposta" na fila de Reservas
   * (ver PainelReservas.tsx) em vez de "+ Nova proposta": o lote já vem
   * fixo (é o da própria reserva, já 'reservado' — não passaria no filtro
   * de disponíveis do passo 0 de qualquer jeito) e nome/CPF/contato já
   * vêm pré-preenchidos do que a reserva já tinha. */
  reservaOrigem?: ReservaComLote | null;
}) {
  const [loteId, setLoteId] = useState(edicao?.lote_id ?? reservaOrigem?.lote_id ?? "");
  const [motivo, setMotivo] = useState("");
  const [condominioSlug, setCondominioSlug] = useState(
    () => lotes.find((l) => l.id === reservaOrigem?.lote_id)?.condominio_slug ?? "",
  );
  const [dados, setDados] = useState<QualificacaoDados>(() => {
    if (edicao) return dadosParaEdicao(edicao);
    const vazio = qualificacaoDadosVazio();
    if (!reservaOrigem) return vazio;
    return {
      ...vazio,
      proponente: { ...vazio.proponente, nome: reservaOrigem.nome ?? null, cpf_cnpj: reservaOrigem.cpf ?? null },
      telefone_celular: reservaOrigem.contato ?? null,
    };
  });
  const [passo, setPasso] = useState(0);
  // "Cadastro rápido": o corretor quer garantir o lote com só nome + lote
  // agora, sem parar pra digitar documentos, estado civil, endereço e
  // telefone — esses campos ficam opcionais enquanto isso estiver marcado.
  // Profissão e a forma de pagamento COMPLETA (valor, entrada, parcelas,
  // conferência) continuam obrigatórias mesmo assim — é o que vai pro
  // contrato (pedido de 02/10), ver validarPasso abaixo.
  const [modoRapido, setModoRapido] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  // Guarda o cliente já criado (se a criação da proposta em si falhar
  // depois, ex.: backend acordando no meio do processo) pra um retry em
  // "Criar proposta" reaproveitar em vez de cadastrar o mesmo proponente de
  // novo a cada tentativa — ver criar() abaixo.
  const clienteIdCriadoRef = useRef<string | null>(null);

  // Formulário de 8 etapas — dá tempo de sobra pro backend (Render, plano
  // free) acordar em paralelo, em vez de só na hora crítica de salvar no
  // fim (ver comentário de RETRY_DELAYS_MS em lib/api.ts).
  useEffect(() => {
    prewarmBackend();
  }, []);

  const empreendimentos = useMemo(() => {
    const vistos = new Map<string, string>();
    for (const l of lotes) vistos.set(l.condominio_slug, l.condominio_nome);
    return [...vistos.entries()].map(([slug, nome]) => ({ slug, nome }));
  }, [lotes]);

  // Só lotes 'disponivel' entram na busca — desde que criar uma proposta já
  // reserva o lote na hora (sem esperar aprovação de admin, ver
  // routers/crm.py::criar_proposta), deixar um lote já reservado/vendido
  // aparecer aqui só levaria o corretor a preencher o formulário inteiro
  // pra descobrir o erro 409 só no fim, ao salvar.
  const lotesDoEmpreendimento = useMemo(() => {
    const disponiveis = lotes.filter(
      (l) => l.status === "disponivel" || l.id === reservaOrigem?.lote_id,
    );
    return condominioSlug ? disponiveis.filter((l) => l.condominio_slug === condominioSlug) : disponiveis;
  }, [lotes, condominioSlug, reservaOrigem]);

  const loteSelecionado: LoteComCondominio | null = edicao
    ? edicao.lote
      ? { ...edicao.lote, condominio_nome: lotes.find((l) => l.id === edicao.lote_id)?.condominio_nome ?? "", condominio_slug: "" }
      : null
    : lotes.find((l) => l.id === loteId) ?? null;

  /** Trocar de lote invalida o plano montado pro lote anterior (outro preço,
   * outro plano de tabela): zera os valores e as confirmações — a etapa de
   * pagamento traz o plano de tabela do lote novo e o corretor confere de
   * novo. Meios e datas já escolhidos ficam. */
  function trocarLote(id: string) {
    if (id !== loteId) {
      setDados((d) => ({
        ...d,
        forma_pagamento: {
          ...d.forma_pagamento,
          valor_proposto: null,
          sinal: null,
          sinal_valor_parcela: null,
          dividido_em_parcelas: null,
          valor_parcela: null,
          chave_valor: null,
          confirmado: false,
          confirma_valor_fora_tabela: false,
        },
      }));
    }
    setLoteId(id);
  }
  const casado = dados.estado_civil === "casado";

  function validarEndereco(e: QualificacaoDados["endereco_residencial"], rotulo: string): string | null {
    if (!e.rua?.trim()) return `Informe a rua/avenida do endereço ${rotulo}.`;
    if (!e.numero?.trim()) return `Informe o número do endereço ${rotulo}.`;
    if (!e.bairro?.trim()) return `Informe o bairro do endereço ${rotulo}.`;
    if (!e.cidade?.trim()) return `Informe a cidade do endereço ${rotulo}.`;
    if (!e.estado?.trim()) return `Informe o estado (UF) do endereço ${rotulo}.`;
    if (!e.cep?.trim()) return `Informe o CEP do endereço ${rotulo}.`;
    return null;
  }

  /** Mesma validação (campo a campo) do formulário público de qualificação
   * — os dois alimentam o mesmo PDF, então nada pode chegar em branco aqui
   * também. Índices deslocados em +1 por causa da etapa extra de "Lote". */
  function validarPasso(p: number): string | null {
    if (p === 0) {
      if (!loteId) return "Selecione o lote.";
    }
    if (p === 1) {
      if (!dados.proponente.nome?.trim()) return "Informe o nome completo do cliente.";
      if (!dados.proponente.profissao?.trim()) return "Informe a profissão.";
      if (!modoRapido) {
        if (!dados.proponente.cpf_cnpj?.trim()) return "Informe o CPF do cliente.";
        if (!dados.proponente.rg?.trim()) return "Informe o RG do cliente.";
        if (!dados.proponente.data_nascimento?.trim()) return "Informe a data de nascimento.";
        if (!dados.proponente.nacionalidade?.trim()) return "Informe a nacionalidade.";
        if (!dados.proponente.email?.trim()) return "Informe o e-mail.";
      }
      const invalidos = problemasPessoa(dados.proponente, "do comprador");
      if (invalidos.length) return invalidos.join("\n");
    }
    if (p === 2 && !modoRapido) {
      if (!dados.estado_civil) return "Selecione o estado civil.";
      if (casado) {
        if (!dados.conjuge?.nome?.trim()) return "Informe o nome do cônjuge.";
        if (!dados.conjuge?.cpf_cnpj?.trim()) return "Informe o CPF do cônjuge.";
        if (!dados.conjuge?.rg?.trim()) return "Informe o RG do cônjuge.";
        if (!dados.conjuge?.data_nascimento?.trim()) return "Informe a data de nascimento do cônjuge.";
        if (!dados.conjuge?.nacionalidade?.trim()) return "Informe a nacionalidade do cônjuge.";
        if (!dados.conjuge?.profissao?.trim()) return "Informe a profissão do cônjuge.";
        if (!dados.conjuge?.email?.trim()) return "Informe o e-mail do cônjuge.";
      }
    }
    if (p === 2 && casado) {
      const invalidos = problemasPessoa(dados.conjuge, "do cônjuge");
      if (invalidos.length) return invalidos.join("\n");
    }
    if (p === 3 && !modoRapido) {
      const msg = validarEndereco(dados.endereco_residencial, "residencial");
      if (msg) return msg;
    }
    if (p === 4 && !modoRapido && !dados.endereco_comercial_nao_possui) {
      const msg = validarEndereco(dados.endereco_comercial, "comercial");
      if (msg) return `${msg} Ou marque "não possui endereço comercial".`;
    }
    if (p === 5 && !modoRapido) {
      if (!dados.telefone_celular?.trim()) return "Informe um telefone celular pra contato.";
    }
    if (p === 5) {
      const invalidos = problemasTelefones(dados);
      if (invalidos.length) return invalidos.join("\n");
    }
    if (p === 6) {
      // Plano de pagamento inteiro (mesmas regras do servidor, ver
      // lib/pagamento.ts): entrada obrigatória com forma/meio/data, datas
      // válidas e entrada + parcelas + chave = valor proposto.
      const problemas = validarPlano(dados.forma_pagamento, loteSelecionado?.valor_total, false);
      if (problemas.length) return problemas.join("\n");
    }
    if (p === 7) {
      // Dupla confirmação (checkboxes da revisão).
      const problemas = validarPlano(dados.forma_pagamento, loteSelecionado?.valor_total, true);
      if (problemas.length) return problemas.join("\n");
    }
    return null;
  }

  function validarTudo(): { passo: number; msg: string } | null {
    for (let p = 0; p <= 7; p++) {
      const msg = validarPasso(p);
      if (msg) return { passo: p, msg };
    }
    return null;
  }

  function avancar() {
    const msg = validarPasso(passo);
    if (msg) {
      setErro(msg);
      return;
    }
    setErro(null);
    setPasso(Math.min(passo + 1, PASSOS.length - 1));
    document.getElementById("proposta-formulario-topo")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function voltar() {
    setErro(null);
    setPasso(Math.max(passo - 1, 0));
    document.getElementById("proposta-formulario-topo")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function criar() {
    setErro(null);
    const problema = validarTudo();
    if (problema) {
      setPasso(problema.passo);
      setErro(problema.msg);
      document.getElementById("proposta-formulario-topo")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setSalvando(true);
    if (edicao) {
      try {
        await api.editarDadosProposta(
          edicao.id,
          { ...dados, forma_pagamento: planoParaEnvio(dados.forma_pagamento) },
          motivo.trim() || null,
        );
        onSalvo();
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
      } finally {
        setSalvando(false);
      }
      return;
    }
    try {
      // Não existe cadastro prévio de cliente no painel — o registro em
      // "clientes" é criado aqui na hora, a partir dos dados do proponente
      // (mesma lógica que a reserva/proposta simples já usava, ver
      // PainelReservas.tsx), só que agora com o formulário completo.
      // clienteIdCriadoRef evita cadastrar o mesmo proponente de novo se a
      // pessoa clicar "Criar proposta" outra vez depois de uma falha bem
      // aqui no meio (ex.: backend acordando) — sem isso, cada tentativa
      // criava um cliente duplicado antes de falhar de novo na proposta.
      let clienteId = clienteIdCriadoRef.current;
      if (!clienteId) {
        const cliente = await api.criarCliente({
          nome: dados.proponente.nome!.trim(),
          telefone: dados.telefone_celular || null,
          cpf: dados.proponente.cpf_cnpj || null,
        });
        clienteId = cliente.id;
        clienteIdCriadoRef.current = clienteId;
      }
      await api.criarProposta({
        lote_id: loteId,
        cliente_id: clienteId,
        valor_proposto: dados.forma_pagamento.valor_proposto!,
        // resumo sempre derivado do plano (o servidor regrava igual)
        condicoes_pagamento: resumoPlano(dados.forma_pagamento),
        observacoes: dados.forma_pagamento.observacoes || null,
        dados_qualificacao: { ...dados, forma_pagamento: planoParaEnvio(dados.forma_pagamento) },
        reserva_id: reservaOrigem?.id,
      });
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="p-5 sm:p-6" id="proposta-formulario-topo">
      <h2 id="proposta-modal-title" className="text-lg font-bold text-ink mb-1">
        {edicao
          ? `Corrigir dados da proposta ${formatarNumeroProposta(edicao.numero, edicao.versao)}`
          : reservaOrigem
            ? "Gerar proposta desta reserva"
            : "Nova proposta"}
      </h2>
      <p className="text-xs text-ink-soft mb-4">
        {edicao
          ? `Mesmas conferências da criação. Ao salvar, a proposta passa para a versão ${edicao.versao + 1} (o contrato também) e o antes/depois de cada campo fica registrado.`
          : reservaOrigem
          ? "O lote já está reservado — falta só completar os dados da Proposta de Compra/Venda pra gerar o PDF."
          : "Mesmos dados da Proposta de Compra/Venda em papel — preencha aqui e o PDF já sai pronto."}
      </p>
      <ProgressBar passo={passo} total={PASSOS.length} />

      <div className="grid gap-4">
        {passo === 0 && (
          <>
            {edicao || reservaOrigem ? (
              <div className="rounded-lg border border-border bg-surface-alt/60 p-3">
                <p className="text-xs text-ink-soft mb-0.5">{edicao ? "Lote desta proposta (não muda na correção)" : "Lote desta reserva"}</p>
                <p className="text-sm font-semibold text-ink">
                  {loteSelecionado?.identificador ?? "—"}
                  {loteSelecionado?.condominio_nome ? ` — ${loteSelecionado.condominio_nome}` : ""}
                </p>
                {loteSelecionado?.valor_total != null && (
                  <p className="text-xs text-ink-soft mt-1">
                    Valor de tabela: {formatMoneySimples(loteSelecionado.valor_total)}
                  </p>
                )}
              </div>
            ) : (
              <>
                {empreendimentos.length > 1 && (
                  <Field label="Empreendimento">
                    <select
                      className="input"
                      value={condominioSlug}
                      onChange={(e) => {
                        setCondominioSlug(e.target.value);
                        trocarLote("");
                      }}
                    >
                      <option value="">Todos os empreendimentos</option>
                      {empreendimentos.map((c) => (
                        <option key={c.slug} value={c.slug}>
                          {c.nome}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label="Lote *">
                  <LoteCombobox key={condominioSlug} lotes={lotesDoEmpreendimento} value={loteId} onChange={trocarLote} />
                </Field>
                {loteSelecionado?.valor_total != null && (
                  <p className="text-xs text-ink-soft -mt-1">
                    Valor de tabela: {formatMoneySimples(loteSelecionado.valor_total)}
                  </p>
                )}
              </>
            )}
          </>
        )}

        {passo === 1 && (
          <>
            <label className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={modoRapido}
                onChange={(e) => setModoRapido(e.target.checked)}
              />
              <span>
                <span className="font-semibold">Cadastro rápido</span> — garantir o lote só com nome e lote agora, sem
                documentos. Estado civil, endereço e telefone também ficam opcionais; profissão e a forma de
                pagamento completa (valor, entrada, parcelas) continuam obrigatórias.
              </span>
            </label>
            <Field label="Nome completo *">
              <input
                className="input"
                value={dados.proponente.nome ?? ""}
                onChange={(e) => setDados({ ...dados, proponente: { ...dados.proponente, nome: e.target.value } })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={modoRapido ? "CPF/CNPJ" : "CPF/CNPJ *"}>
                <input
                  className="input"
                  value={dados.proponente.cpf_cnpj ?? ""}
                  onChange={(e) => setDados({ ...dados, proponente: { ...dados.proponente, cpf_cnpj: e.target.value } })}
                />
              </Field>
              <Field label={modoRapido ? "RG" : "RG *"}>
                <input
                  className="input"
                  value={dados.proponente.rg ?? ""}
                  onChange={(e) => setDados({ ...dados, proponente: { ...dados.proponente, rg: e.target.value } })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Órgão expedidor">
                <input
                  className="input"
                  value={dados.proponente.orgao_expedidor ?? ""}
                  onChange={(e) => setDados({ ...dados, proponente: { ...dados.proponente, orgao_expedidor: e.target.value } })}
                />
              </Field>
              <Field label={modoRapido ? "Data de nascimento" : "Data de nascimento *"}>
                <input
                  className="input"
                  type="date"
                  value={dados.proponente.data_nascimento ?? ""}
                  onChange={(e) => setDados({ ...dados, proponente: { ...dados.proponente, data_nascimento: e.target.value } })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={modoRapido ? "Nacionalidade" : "Nacionalidade *"}>
                <input
                  className="input"
                  value={dados.proponente.nacionalidade ?? ""}
                  onChange={(e) => setDados({ ...dados, proponente: { ...dados.proponente, nacionalidade: e.target.value } })}
                />
              </Field>
              <Field label="Profissão *">
                <input
                  className="input"
                  value={dados.proponente.profissao ?? ""}
                  onChange={(e) => setDados({ ...dados, proponente: { ...dados.proponente, profissao: e.target.value } })}
                />
              </Field>
            </div>
            <Field label={modoRapido ? "E-mail" : "E-mail *"}>
              <input
                className="input"
                type="email"
                value={dados.proponente.email ?? ""}
                onChange={(e) => setDados({ ...dados, proponente: { ...dados.proponente, email: e.target.value } })}
              />
            </Field>
          </>
        )}

        {passo === 2 && (
          <>
            {modoRapido && (
              <p className="text-xs text-ink-soft italic -mt-1 -mb-1">
                Opcional no cadastro rápido — pode preencher depois.
              </p>
            )}
            <Field label={modoRapido ? "Estado civil" : "Estado civil *"}>
              <select
                className="input"
                value={dados.estado_civil ?? ""}
                onChange={(e) =>
                  setDados({
                    ...dados,
                    estado_civil: (e.target.value || null) as EstadoCivil | null,
                    conjuge: e.target.value === "casado" ? (dados.conjuge ?? {}) : null,
                  })
                }
              >
                <option value="">Selecione...</option>
                {ESTADO_CIVIL_OPCOES.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            {casado && (
              <>
                <p className="text-xs text-ink-soft -mb-1">Dados do cônjuge</p>
                <Field label="Nome do cônjuge *">
                  <input
                    className="input"
                    value={dados.conjuge?.nome ?? ""}
                    onChange={(e) => setDados({ ...dados, conjuge: { ...dados.conjuge, nome: e.target.value } })}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="CPF do cônjuge *">
                    <input
                      className="input"
                      value={dados.conjuge?.cpf_cnpj ?? ""}
                      onChange={(e) => setDados({ ...dados, conjuge: { ...dados.conjuge, cpf_cnpj: e.target.value } })}
                    />
                  </Field>
                  <Field label="RG do cônjuge *">
                    <input
                      className="input"
                      value={dados.conjuge?.rg ?? ""}
                      onChange={(e) => setDados({ ...dados, conjuge: { ...dados.conjuge, rg: e.target.value } })}
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Órgão expedidor do cônjuge">
                    <input
                      className="input"
                      value={dados.conjuge?.orgao_expedidor ?? ""}
                      onChange={(e) => setDados({ ...dados, conjuge: { ...dados.conjuge, orgao_expedidor: e.target.value } })}
                    />
                  </Field>
                  <Field label="Data de nascimento do cônjuge *">
                    <input
                      className="input"
                      type="date"
                      value={dados.conjuge?.data_nascimento ?? ""}
                      onChange={(e) => setDados({ ...dados, conjuge: { ...dados.conjuge, data_nascimento: e.target.value } })}
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Nacionalidade do cônjuge *">
                    <input
                      className="input"
                      value={dados.conjuge?.nacionalidade ?? ""}
                      onChange={(e) => setDados({ ...dados, conjuge: { ...dados.conjuge, nacionalidade: e.target.value } })}
                    />
                  </Field>
                  <Field label="Profissão do cônjuge *">
                    <input
                      className="input"
                      value={dados.conjuge?.profissao ?? ""}
                      onChange={(e) => setDados({ ...dados, conjuge: { ...dados.conjuge, profissao: e.target.value } })}
                    />
                  </Field>
                </div>
                <Field label="E-mail do cônjuge *">
                  <input
                    className="input"
                    type="email"
                    value={dados.conjuge?.email ?? ""}
                    onChange={(e) => setDados({ ...dados, conjuge: { ...dados.conjuge, email: e.target.value } })}
                  />
                </Field>
              </>
            )}
          </>
        )}

        {passo === 3 && (
          <>
            {modoRapido && (
              <p className="text-xs text-ink-soft italic -mb-1">
                Opcional no cadastro rápido — pode preencher depois.
              </p>
            )}
            <EnderecoCampos
              endereco={dados.endereco_residencial}
              onChange={(endereco_residencial) => setDados({ ...dados, endereco_residencial })}
            />
          </>
        )}

        {passo === 4 && (
          <>
            {modoRapido && (
              <p className="text-xs text-ink-soft italic -mb-1">
                Opcional no cadastro rápido — pode preencher depois.
              </p>
            )}
            <label className="flex items-center gap-2 text-sm text-ink -mb-1">
              <input
                type="checkbox"
                checked={dados.endereco_comercial_nao_possui ?? false}
                onChange={(e) => setDados({ ...dados, endereco_comercial_nao_possui: e.target.checked })}
              />
              Cliente não possui endereço comercial
            </label>
            {!dados.endereco_comercial_nao_possui && (
              <>
                <EnderecoCampos
                  endereco={dados.endereco_comercial}
                  onChange={(endereco_comercial) => setDados({ ...dados, endereco_comercial })}
                  obrigatorio
                />
                <CorrespondenciaCampo
                  valor={dados.endereco_correspondencia}
                  onChange={(endereco_correspondencia) => setDados({ ...dados, endereco_correspondencia })}
                />
              </>
            )}
          </>
        )}

        {passo === 5 && (
          <>
            {modoRapido && (
              <p className="text-xs text-ink-soft italic -mt-1 -mb-1">
                Opcional no cadastro rápido — pode preencher depois.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Telefone residencial">
                <input
                  className="input"
                  value={dados.telefone_residencial ?? ""}
                  onChange={(e) => setDados({ ...dados, telefone_residencial: e.target.value })}
                />
              </Field>
              <Field label="Telefone comercial">
                <input
                  className="input"
                  value={dados.telefone_comercial ?? ""}
                  onChange={(e) => setDados({ ...dados, telefone_comercial: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={modoRapido ? "Celular" : "Celular *"}>
                <input
                  className="input"
                  value={dados.telefone_celular ?? ""}
                  onChange={(e) => setDados({ ...dados, telefone_celular: e.target.value })}
                />
              </Field>
              <Field label="Telefone para recados">
                <input
                  className="input"
                  value={dados.telefone_recados ?? ""}
                  onChange={(e) => setDados({ ...dados, telefone_recados: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Falar com">
              <input className="input" value={dados.falar_com ?? ""} onChange={(e) => setDados({ ...dados, falar_com: e.target.value })} />
            </Field>
          </>
        )}

        {passo === 6 && (
          <FormaPagamentoEtapa
            fp={dados.forma_pagamento}
            lote={loteSelecionado}
            onChange={(fp) => setDados((d) => ({ ...d, forma_pagamento: fp }))}
          />
        )}

        {passo === 7 && (
          <Revisao
            dados={dados}
            lote={loteSelecionado}
            modoRapido={modoRapido}
            edicao={!!edicao}
            onChangePagamento={(fp) => setDados((d) => ({ ...d, forma_pagamento: fp }))}
          />
        )}

        {passo === 7 && edicao && (
          <Field label="Motivo da correção (vai pro histórico)">
            <textarea
              id="edicao-motivo"
              className="input"
              rows={2}
              maxLength={500}
              placeholder="Ex.: valor proposto digitado errado (R$ 89,99 em vez de R$ 89.990,00)"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </Field>
        )}

        {erro && (
          <p id="proposta-erro" className="text-rust text-sm whitespace-pre-line">
            {erro}
          </p>
        )}

        <div className="flex gap-3 mt-1">
          {passo > 0 && (
            <button className="btn btn-outline flex-1" onClick={voltar} disabled={salvando}>
              Voltar
            </button>
          )}
          {passo < PASSOS.length - 1 ? (
            <button className="btn btn-primary flex-1" onClick={avancar}>
              Próximo
            </button>
          ) : (
            <button
              className="btn btn-primary flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={criar}
              disabled={salvando || !dados.forma_pagamento.confirmado}
              title={!dados.forma_pagamento.confirmado ? "Marque a confirmação dos valores acima" : undefined}
            >
              {edicao
                ? salvando
                  ? "Salvando..."
                  : `Salvar correção (vai para a versão ${edicao.versao + 1})`
                : salvando
                  ? "Criando..."
                  : "Criar proposta"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function formatMoneySimples(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function Revisao({
  dados,
  lote,
  modoRapido,
  edicao = false,
  onChangePagamento,
}: {
  dados: QualificacaoDados;
  lote: LoteComCondominio | null;
  modoRapido: boolean;
  edicao?: boolean;
  onChangePagamento: (fp: QualificacaoDados["forma_pagamento"]) => void;
}) {
  const fp = dados.forma_pagamento;
  const p = lerPlano(fp);
  const vp = p.valorProposto;
  const tabela = lote?.valor_total ?? null;
  const foraTabela = vp != null && tabela != null && Math.abs(vp - tabela) > 1;
  const linhaValor = (rotulo: string, v: number | null | undefined, extra?: string) => (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-1.5 border-b border-border last:border-0">
      <span className="text-ink-soft">{rotulo}</span>
      <span className="text-right font-semibold text-ink tabular-nums">{v != null ? `R$ ${fmtBRL(v)}` : "—"}</span>
      {v != null && v > 0 && <span className="col-span-2 text-[11px] text-ink-soft">{valorPorExtenso(v)}</span>}
      {extra && <span className="col-span-2 text-[11px] text-ink">{extra}</span>}
    </div>
  );
  return (
    <div className="grid gap-3 text-sm">
      <p className="text-ink-soft">{edicao ? "Confira antes de salvar a correção." : "Confira antes de criar a proposta."}</p>
      {modoRapido && !edicao && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Cadastro rápido — documentos, estado civil, endereço e telefone ficaram em branco. Volte nas etapas
          anteriores agora se quiser completar, porque depois de criada a proposta esses dados não dá mais pra
          editar por aqui.
        </p>
      )}
      <div className="grid gap-1">
        <p>
          <span className="text-ink-soft">Lote: </span>
          {lote ? [lote.condominio_nome, lote.identificador].filter(Boolean).join(" — ") : "—"}
        </p>
        <p>
          <span className="text-ink-soft">Proponente: </span>
          {dados.proponente.nome || "—"}
        </p>
        <p>
          <span className="text-ink-soft">CPF/CNPJ: </span>
          {dados.proponente.cpf_cnpj || "—"}
        </p>
        <p>
          <span className="text-ink-soft">Estado civil: </span>
          {ESTADO_CIVIL_OPCOES.find((o) => o.valor === dados.estado_civil)?.label || "—"}
        </p>
      </div>

      <section className="rounded-lg border border-border p-3">
        <h3 className="text-sm font-bold text-ink mb-1">Valores que vão para o contrato</h3>
        {linhaValor("Valor de tabela do lote", tabela)}
        {linhaValor("Valor proposto", vp)}
        {fp.a_vista ? (
          linhaValor("Pagamento à vista", vp, `Via ${textoMeio(fp.avista_meio)} em ${fmtData(fp.avista_data)}`)
        ) : (
          <>
            {linhaValor(
              "Entrada",
              p.entrada,
              p.entradaParcelas > 1
                ? `Parcelada em ${p.entradaParcelas}x de R$ ${fmtBRL(p.entradaValores[0])} via ${textoMeio(fp.sinal_meio)}, 1ª em ${fmtData(fp.sinal_vencimento)}`
                : `De uma vez, via ${textoMeio(fp.sinal_meio)}, em ${fmtData(fp.sinal_vencimento)}`,
            )}
            {linhaValor(
              `Parcelas mensais: ${p.parcelas ?? 0} x`,
              p.parcelaValor,
              `1ª em ${fmtData(fp.primeiro_mes)}, depois todo dia ${fp.vencimento ?? "-"}`,
            )}
            {linhaValor("Chave", p.chave)}
          </>
        )}
      </section>

      <ConferenciaPlano fp={fp} valorTabela={tabela} />

      <div className="grid gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
        {foraTabela && (
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              id="fp-confirma-fora-tabela"
              type="checkbox"
              className="mt-0.5"
              checked={!!fp.confirma_valor_fora_tabela}
              onChange={(e) => onChangePagamento({ ...fp, confirma_valor_fora_tabela: e.target.checked })}
            />
            <span>
              Confirmo que o valor proposto é <strong>R$ {fmtBRL(vp)}</strong>, diferente do valor de tabela (R${" "}
              {fmtBRL(tabela)}).
            </span>
          </label>
        )}
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            id="fp-confirmado"
            type="checkbox"
            className="mt-0.5"
            checked={!!fp.confirmado}
            onChange={(e) => onChangePagamento({ ...fp, confirmado: e.target.checked })}
          />
          <span>
            {edicao
              ? "Conferi a correção: o valor proposto, a entrada (valor, forma, meio e data), as parcelas e a chave acima estão corretos e combinados com o cliente."
              : "Conferi com o cliente o valor proposto, a entrada (valor, forma, meio e data), as parcelas e a chave — os valores acima estão corretos."}
          </span>
        </label>
      </div>
      {!edicao && (
        <p className="text-ink-soft text-xs">
          A proposta nasce como rascunho — um administrador precisa aprová-la antes que o contrato possa ser gerado.
        </p>
      )}
    </div>
  );
}

/** Campo de lote com busca — mesma implementação usada em PainelPropostas.tsx
 * (antes da extração pra este arquivo) e em PainelReservas.tsx: digita e
 * escolhe da lista filtrada, em vez de rolar um <select> gigante. */
function LoteCombobox({
  lotes,
  value,
  onChange,
}: {
  lotes: LoteComCondominio[];
  value: string;
  onChange: (id: string) => void;
}) {
  const selecionado = lotes.find((l) => l.id === value) ?? null;
  const [busca, setBusca] = useState(selecionado ? rotuloLote(selecionado) : "");
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickFora(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener("mousedown", onClickFora);
    return () => document.removeEventListener("mousedown", onClickFora);
  }, []);

  const termo = busca.trim().toLowerCase();
  const termoNumero = termo.replace(/\D/g, "");
  function bate(l: LoteComCondominio): boolean {
    if (rotuloLote(l).toLowerCase().includes(termo)) return true;
    if (!termoNumero) return false;
    const numero = Number(termoNumero);
    return numero === l.lote_numero || (!!l.quadra && numero === Number(l.quadra));
  }

  const encontrados = termo ? lotes.filter(bate) : lotes;
  const semResultadoExato = termo !== "" && encontrados.length === 0;
  const listaExibida = (semResultadoExato ? lotes : encontrados).slice(0, 60);

  return (
    <div className="relative" ref={containerRef}>
      <input
        className="input"
        placeholder="Digite pra buscar o lote (quadra, número...)"
        value={busca}
        onFocus={() => setAberto(true)}
        onChange={(e) => {
          setBusca(e.target.value);
          setAberto(true);
          if (value) onChange("");
        }}
      />
      {aberto && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto card p-1 shadow-lg">
          {semResultadoExato && (
            <p className="px-3 py-2 text-xs text-ink-soft border-b border-border mb-1">
              Nenhum lote bate exatamente com "{busca.trim()}" — veja todos abaixo:
            </p>
          )}
          {listaExibida.length === 0 ? (
            <p className="px-3 py-2 text-xs text-ink-soft">Nenhum lote cadastrado.</p>
          ) : (
            listaExibida.map((l) => (
              <button
                type="button"
                key={l.id}
                className="w-full text-left px-3 py-2 text-sm rounded hover:bg-surface-alt"
                onClick={() => {
                  onChange(l.id);
                  setBusca(rotuloLote(l));
                  setAberto(false);
                }}
              >
                {rotuloLote(l)}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function rotuloLote(l: LoteComCondominio): string {
  return `${l.condominio_nome} — ${l.identificador} (${l.status})`;
}

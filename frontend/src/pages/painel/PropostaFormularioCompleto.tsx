import { useEffect, useMemo, useRef, useState } from "react";
import { CorrespondenciaCampo, ESTADO_CIVIL_OPCOES, EnderecoCampos, Field } from "../../components/qualificacaoCampos";
import { api, prewarmBackend } from "../../lib/api";
import { qualificacaoDadosVazio } from "../../types";
import type { EstadoCivil, LoteComCondominio, QualificacaoDados } from "../../types";

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
}: {
  lotes: LoteComCondominio[];
  onSalvo: () => void;
}) {
  const [loteId, setLoteId] = useState("");
  const [condominioSlug, setCondominioSlug] = useState("");
  const [dados, setDados] = useState<QualificacaoDados>(qualificacaoDadosVazio());
  const [condicoesPagamento, setCondicoesPagamento] = useState("");
  const [passo, setPasso] = useState(0);
  // "Cadastro rápido": o corretor quer garantir o lote com só nome + lote
  // agora, sem parar pra digitar documentos, estado civil, endereço e
  // telefone — esses campos ficam opcionais enquanto isso estiver marcado.
  // Profissão, renda e valor proposto continuam obrigatórios (são os únicos
  // dados que sobram além de nome + lote, ver validarPasso abaixo).
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

  const lotesDoEmpreendimento = useMemo(
    () => (condominioSlug ? lotes.filter((l) => l.condominio_slug === condominioSlug) : lotes),
    [lotes, condominioSlug],
  );

  const loteSelecionado = lotes.find((l) => l.id === loteId) ?? null;
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
    if (p === 6) {
      const fp = dados.forma_pagamento;
      if (fp.a_vista === null || fp.a_vista === undefined) return "Selecione se o pagamento é à vista.";
      if (!fp.renda?.trim()) return "Informe a renda informada.";
      if (!fp.valor_proposto || fp.valor_proposto <= 0) return "Informe o valor proposto.";
      if (fp.a_vista === false) {
        if (!fp.dividido_em_parcelas || fp.dividido_em_parcelas <= 0) return "Informe em quantas parcelas será dividido.";
        if (!fp.valor_parcela?.trim()) return "Informe o valor de cada parcela.";
      }
    }
    return null;
  }

  function validarTudo(): { passo: number; msg: string } | null {
    for (let p = 0; p <= 6; p++) {
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
        condicoes_pagamento: condicoesPagamento.trim() || null,
        observacoes: dados.forma_pagamento.observacoes || null,
        dados_qualificacao: dados,
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
        Nova proposta
      </h2>
      <p className="text-xs text-ink-soft mb-4">
        Mesmos dados da Proposta de Compra/Venda em papel — preencha aqui e o PDF já sai pronto.
      </p>
      <ProgressBar passo={passo} total={PASSOS.length} />

      <div className="grid gap-4">
        {passo === 0 && (
          <>
            {empreendimentos.length > 1 && (
              <Field label="Empreendimento">
                <select
                  className="input"
                  value={condominioSlug}
                  onChange={(e) => {
                    setCondominioSlug(e.target.value);
                    setLoteId("");
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
              <LoteCombobox key={condominioSlug} lotes={lotesDoEmpreendimento} value={loteId} onChange={setLoteId} />
            </Field>
            {loteSelecionado?.valor_total != null && (
              <p className="text-xs text-ink-soft -mt-1">
                Valor de tabela: {formatMoneySimples(loteSelecionado.valor_total)}
              </p>
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
                documentos. Estado civil, endereço e telefone também ficam opcionais; só profissão, renda e valor
                proposto continuam obrigatórios.
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
          <>
            <Field label="Pagamento à vista? *">
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`btn flex-1 !py-2 ${dados.forma_pagamento.a_vista === true ? "btn-primary" : "btn-outline"}`}
                  onClick={() => setDados({ ...dados, forma_pagamento: { ...dados.forma_pagamento, a_vista: true } })}
                >
                  Sim
                </button>
                <button
                  type="button"
                  className={`btn flex-1 !py-2 ${dados.forma_pagamento.a_vista === false ? "btn-primary" : "btn-outline"}`}
                  onClick={() => setDados({ ...dados, forma_pagamento: { ...dados.forma_pagamento, a_vista: false } })}
                >
                  Não
                </button>
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Renda informada *">
                <input
                  className="input"
                  value={dados.forma_pagamento.renda ?? ""}
                  onChange={(e) => setDados({ ...dados, forma_pagamento: { ...dados.forma_pagamento, renda: e.target.value } })}
                />
              </Field>
              <Field label="Valor proposto (R$) *">
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  value={dados.forma_pagamento.valor_proposto ?? ""}
                  onChange={(e) =>
                    setDados({
                      ...dados,
                      forma_pagamento: {
                        ...dados.forma_pagamento,
                        valor_proposto: e.target.value ? Number(e.target.value) : null,
                      },
                    })
                  }
                />
              </Field>
            </div>
            {dados.forma_pagamento.a_vista === false && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Sinal (R$)">
                    <input
                      className="input"
                      value={dados.forma_pagamento.sinal ?? ""}
                      onChange={(e) => setDados({ ...dados, forma_pagamento: { ...dados.forma_pagamento, sinal: e.target.value } })}
                    />
                  </Field>
                  <Field label="Banco/Agência do sinal">
                    <input
                      className="input"
                      value={dados.forma_pagamento.sinal_banco ?? ""}
                      onChange={(e) => setDados({ ...dados, forma_pagamento: { ...dados.forma_pagamento, sinal_banco: e.target.value } })}
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Dividido em quantas parcelas *">
                    <input
                      className="input"
                      type="number"
                      value={dados.forma_pagamento.dividido_em_parcelas ?? ""}
                      onChange={(e) =>
                        setDados({
                          ...dados,
                          forma_pagamento: {
                            ...dados.forma_pagamento,
                            dividido_em_parcelas: e.target.value ? Number(e.target.value) : null,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="Valor de cada parcela *">
                    <input
                      className="input"
                      value={dados.forma_pagamento.valor_parcela ?? ""}
                      onChange={(e) => setDados({ ...dados, forma_pagamento: { ...dados.forma_pagamento, valor_parcela: e.target.value } })}
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Dia de vencimento">
                    <input
                      className="input"
                      value={dados.forma_pagamento.vencimento ?? ""}
                      onChange={(e) => setDados({ ...dados, forma_pagamento: { ...dados.forma_pagamento, vencimento: e.target.value } })}
                    />
                  </Field>
                  <Field label="1ª parcela em">
                    <input
                      className="input"
                      value={dados.forma_pagamento.primeiro_mes ?? ""}
                      onChange={(e) => setDados({ ...dados, forma_pagamento: { ...dados.forma_pagamento, primeiro_mes: e.target.value } })}
                    />
                  </Field>
                </div>
              </>
            )}
            <Field label="Condições de pagamento (resumo)">
              <input
                className="input"
                placeholder="Ex.: 60x de R$ 2.250,00"
                value={condicoesPagamento}
                onChange={(e) => setCondicoesPagamento(e.target.value)}
              />
            </Field>
            <Field label="Observações">
              <textarea
                className="input"
                rows={3}
                value={dados.forma_pagamento.observacoes ?? ""}
                onChange={(e) => setDados({ ...dados, forma_pagamento: { ...dados.forma_pagamento, observacoes: e.target.value } })}
              />
            </Field>
          </>
        )}

        {passo === 7 && (
          <Revisao dados={dados} lote={loteSelecionado} condicoesPagamento={condicoesPagamento} modoRapido={modoRapido} />
        )}

        {erro && <p className="text-rust text-sm">{erro}</p>}

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
            <button className="btn btn-primary flex-1" onClick={criar} disabled={salvando}>
              {salvando ? "Criando..." : "Criar proposta"}
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
  condicoesPagamento,
  modoRapido,
}: {
  dados: QualificacaoDados;
  lote: LoteComCondominio | null;
  condicoesPagamento: string;
  modoRapido: boolean;
}) {
  return (
    <div className="grid gap-3 text-sm">
      <p className="text-ink-soft">Confira antes de criar a proposta.</p>
      {modoRapido && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Cadastro rápido — documentos, estado civil, endereço e telefone ficaram em branco. Volte nas etapas
          anteriores agora se quiser completar, porque depois de criada a proposta esses dados não dá mais pra
          editar por aqui.
        </p>
      )}
      <div className="grid gap-1">
        <p>
          <span className="text-ink-soft">Lote: </span>
          {lote ? `${lote.condominio_nome} — ${lote.identificador}` : "—"}
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
        <p>
          <span className="text-ink-soft">Valor proposto: </span>
          {dados.forma_pagamento.valor_proposto != null ? formatMoneySimples(dados.forma_pagamento.valor_proposto) : "—"}
        </p>
        <p>
          <span className="text-ink-soft">Condições de pagamento: </span>
          {condicoesPagamento || "A combinar"}
        </p>
      </div>
      <p className="text-ink-soft text-xs">
        A proposta nasce como rascunho — um administrador precisa aprová-la antes que o PDF final possa ser gerado e
        enviado ao cliente.
      </p>
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

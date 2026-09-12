import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import {
  DOCUMENTO_LABEL,
  DOCUMENTOS_CONJUGE,
  DOCUMENTOS_OBRIGATORIOS,
  qualificacaoDadosVazio,
} from "../types";
import type {
  DocumentoQualificacao,
  DocumentoTipo,
  EstadoCivil,
  QualificacaoDados,
  QualificacaoPublica as QualificacaoPublicaTipo,
} from "../types";

const ESTADO_CIVIL_OPCOES: { valor: EstadoCivil; label: string }[] = [
  { valor: "solteiro", label: "Solteiro(a)" },
  { valor: "casado", label: "Casado(a)" },
  { valor: "viuvo", label: "Viúvo(a)" },
  { valor: "divorciado", label: "Divorciado(a)" },
  { valor: "outros", label: "Outros" },
];

const PASSOS = [
  "Seus dados",
  "Estado civil",
  "Endereço residencial",
  "Endereço comercial",
  "Contatos",
  "Forma de pagamento",
  "Documentos",
  "Revisão",
] as const;

/** Preenche os campos que faltarem no que veio do servidor (parcial, o
 * cliente pode ter salvado só algumas etapas) com a forma vazia completa —
 * evita checar `?.` em cascata em cada input controlado abaixo. */
function mesclar(parcial: Partial<QualificacaoDados> | undefined): QualificacaoDados {
  const vazio = qualificacaoDadosVazio();
  if (!parcial) return vazio;
  return {
    ...vazio,
    ...parcial,
    proponente: { ...vazio.proponente, ...parcial.proponente },
    conjuge: parcial.conjuge ? { ...vazio.proponente, ...parcial.conjuge } : null,
    endereco_residencial: { ...vazio.endereco_residencial, ...parcial.endereco_residencial },
    endereco_comercial: { ...vazio.endereco_comercial, ...parcial.endereco_comercial },
    forma_pagamento: { ...vazio.forma_pagamento, ...parcial.forma_pagamento },
  };
}

export default function QualificacaoPublica() {
  const { token = "" } = useParams<{ token: string }>();
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [publica, setPublica] = useState<QualificacaoPublicaTipo | null>(null);
  const [dados, setDados] = useState<QualificacaoDados>(qualificacaoDadosVazio());
  const [documentos, setDocumentos] = useState<DocumentoQualificacao[]>([]);
  const [passo, setPasso] = useState(0);

  useEffect(() => {
    api
      .abrirQualificacao(token)
      .then((r) => {
        setPublica(r);
        setDados(mesclar(r.dados));
        setDocumentos(r.documentos);
      })
      .catch((e) => setErroCarga(e instanceof Error ? e.message : String(e)))
      .finally(() => setCarregando(false));
  }, [token]);

  if (carregando) {
    return (
      <TelaCentralizada>
        <p className="text-ink-soft text-sm">Carregando...</p>
      </TelaCentralizada>
    );
  }

  if (erroCarga || !publica) {
    return (
      <TelaCentralizada>
        <h1 className="text-lg font-bold text-ink mb-2">Não foi possível abrir este link</h1>
        <p className="text-sm text-ink-soft">{erroCarga ?? "Link inválido."}</p>
      </TelaCentralizada>
    );
  }

  if (publica.status !== "aguardando_preenchimento") {
    return (
      <TelaCentralizada>
        <StatusFinal publica={publica} />
      </TelaCentralizada>
    );
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="max-w-xl mx-auto px-5 py-4">
          <p className="text-xs text-ink-soft">{publica.condominio_nome}</p>
          <h1 className="text-lg font-bold text-ink">Proposta — lote {publica.lote_identificador}</h1>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-5 py-6">
        <ProgressBar passo={passo} total={PASSOS.length} />
        <Formulario
          token={token}
          dados={dados}
          setDados={setDados}
          documentos={documentos}
          setDocumentos={setDocumentos}
          passo={passo}
          setPasso={setPasso}
          onEnviado={(r) => setPublica(r)}
        />
      </main>
    </div>
  );
}

function TelaCentralizada({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg grid place-items-center px-5">
      <div className="card max-w-md w-full p-6 sm:p-8 text-center">{children}</div>
    </div>
  );
}

function StatusFinal({ publica }: { publica: QualificacaoPublicaTipo }) {
  if (publica.status === "em_analise") {
    return (
      <>
        <div className="text-3xl mb-3">✓</div>
        <h1 className="text-lg font-bold text-ink mb-2">Recebemos seus dados</h1>
        <p className="text-sm text-ink-soft">
          Sua proposta pro lote {publica.lote_identificador} está em análise financeira. Em breve o corretor entra
          em contato com o resultado.
        </p>
      </>
    );
  }
  if (publica.status === "aprovada") {
    return (
      <>
        <div className="text-3xl mb-3">🎉</div>
        <h1 className="text-lg font-bold text-ink mb-2">Proposta aprovada!</h1>
        <p className="text-sm text-ink-soft">
          Sua proposta pro lote {publica.lote_identificador} foi aprovada. O corretor vai entrar em contato com os
          próximos passos.
        </p>
      </>
    );
  }
  return (
    <>
      <h1 className="text-lg font-bold text-ink mb-2">Proposta não aprovada</h1>
      <p className="text-sm text-ink-soft">
        {publica.motivo_reprovacao || "Sua proposta não foi aprovada na análise financeira."} Fale com o corretor
        responsável pra entender as próximas opções.
      </p>
    </>
  );
}

function ProgressBar({ passo, total }: { passo: number; total: number }) {
  const pct = Math.round(((passo + 1) / total) * 100);
  return (
    <div className="mb-6">
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-semibold text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

function Formulario({
  token,
  dados,
  setDados,
  documentos,
  setDocumentos,
  passo,
  setPasso,
  onEnviado,
}: {
  token: string;
  dados: QualificacaoDados;
  setDados: (d: QualificacaoDados) => void;
  documentos: DocumentoQualificacao[];
  setDocumentos: (d: DocumentoQualificacao[]) => void;
  passo: number;
  setPasso: (p: number) => void;
  onEnviado: (r: QualificacaoPublicaTipo) => void;
}) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const casado = dados.estado_civil === "casado";
  const obrigatorios = useMemo<DocumentoTipo[]>(
    () => [...DOCUMENTOS_OBRIGATORIOS, ...(casado ? DOCUMENTOS_CONJUGE : [])],
    [casado],
  );

  /** Valida um endereço completo (usada tanto pro residencial, sempre
   * obrigatório, quanto pro comercial, obrigatório a menos que a pessoa
   * marque "não possuo"). Complemento fica de fora — nem todo endereço tem
   * um, e travar o envio por isso não faz sentido. */
  function validarEndereco(e: QualificacaoDados["endereco_residencial"], rotulo: string): string | null {
    if (!e.rua?.trim()) return `Informe a rua/avenida do endereço ${rotulo}.`;
    if (!e.numero?.trim()) return `Informe o número do endereço ${rotulo}.`;
    if (!e.bairro?.trim()) return `Informe o bairro do endereço ${rotulo}.`;
    if (!e.cidade?.trim()) return `Informe a cidade do endereço ${rotulo}.`;
    if (!e.estado?.trim()) return `Informe o estado (UF) do endereço ${rotulo}.`;
    if (!e.cep?.trim()) return `Informe o CEP do endereço ${rotulo}.`;
    return null;
  }

  /** Todas as validações possíveis antes de gerar a proposta a partir deste
   * formulário — cada campo aqui vira um dado que entra direto no PDF da
   * Proposta de Compra/Venda, então nada pode chegar em branco na análise
   * financeira. Usada tanto por etapa (ao avançar) quanto de uma vez só,
   * como último cinto de segurança antes de enviar (ver `enviar`). */
  function validarPasso(p: number): string | null {
    if (p === 0) {
      if (!dados.proponente.nome?.trim()) return "Informe seu nome completo.";
      if (!dados.proponente.cpf_cnpj?.trim()) return "Informe seu CPF.";
      if (!dados.proponente.rg?.trim()) return "Informe seu RG.";
      if (!dados.proponente.data_nascimento?.trim()) return "Informe sua data de nascimento.";
      if (!dados.proponente.nacionalidade?.trim()) return "Informe sua nacionalidade.";
      if (!dados.proponente.profissao?.trim()) return "Informe sua profissão.";
      if (!dados.proponente.email?.trim()) return "Informe seu e-mail.";
    }
    if (p === 1) {
      if (!dados.estado_civil) return "Selecione seu estado civil.";
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
    if (p === 2) {
      const msg = validarEndereco(dados.endereco_residencial, "residencial");
      if (msg) return msg;
    }
    if (p === 3 && !dados.endereco_comercial_nao_possui) {
      const msg = validarEndereco(dados.endereco_comercial, "comercial");
      if (msg) return `${msg} Ou marque "não possuo endereço comercial".`;
    }
    if (p === 4) {
      if (!dados.telefone_celular?.trim()) return "Informe um telefone celular pra contato.";
    }
    if (p === 5) {
      const fp = dados.forma_pagamento;
      if (fp.a_vista === null || fp.a_vista === undefined) return "Selecione se o pagamento é à vista.";
      if (!fp.renda?.trim()) return "Informe a renda.";
      if (!fp.valor_proposto || fp.valor_proposto <= 0) return "Informe o valor proposto.";
      if (fp.a_vista === false) {
        if (!fp.dividido_em_parcelas || fp.dividido_em_parcelas <= 0) return "Informe em quantas parcelas será dividido.";
        if (!fp.valor_parcela?.trim()) return "Informe o valor de cada parcela.";
      }
    }
    if (p === 6) {
      const tiposEnviados = new Set(documentos.map((d) => d.tipo));
      const faltando = obrigatorios.filter((t) => !tiposEnviados.has(t));
      if (faltando.length) return `Falta anexar: ${faltando.map((t) => DOCUMENTO_LABEL[t]).join(", ")}.`;
    }
    return null;
  }

  /** Revalida todas as etapas de uma vez — cinto de segurança antes de
   * enviar (a navegação sequencial já valida etapa por etapa ao avançar,
   * mas isso cobre qualquer jeito de voltar e mudar algo sem reavançar por
   * todas de novo). Devolve em qual etapa está o problema, se houver. */
  function validarTudo(): { passo: number; msg: string } | null {
    for (let p = 0; p <= 6; p++) {
      const msg = validarPasso(p);
      if (msg) return { passo: p, msg };
    }
    return null;
  }

  async function salvarProgresso(dadosAtualizados: QualificacaoDados) {
    setSalvando(true);
    try {
      await api.salvarQualificacao(token, dadosAtualizados);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  async function avancar() {
    const msg = validarPasso(passo);
    if (msg) {
      setErro(msg);
      return;
    }
    setErro(null);
    await salvarProgresso(dados);
    setPasso(Math.min(passo + 1, PASSOS.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function voltar() {
    setErro(null);
    setPasso(Math.max(passo - 1, 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const [enviando, setEnviando] = useState(false);
  async function enviar() {
    setErro(null);
    const problema = validarTudo();
    if (problema) {
      setPasso(problema.passo);
      setErro(problema.msg);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setEnviando(true);
    try {
      const r = await api.enviarQualificacaoParaAnalise(token);
      onEnviado(r);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="card p-5 sm:p-6 grid gap-4">
      {passo === 0 && (
        <>
          <Field label="Nome completo *">
            <input
              className="input"
              value={dados.proponente.nome ?? ""}
              onChange={(e) => setDados({ ...dados, proponente: { ...dados.proponente, nome: e.target.value } })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="CPF/CNPJ *">
              <input
                className="input"
                value={dados.proponente.cpf_cnpj ?? ""}
                onChange={(e) => setDados({ ...dados, proponente: { ...dados.proponente, cpf_cnpj: e.target.value } })}
              />
            </Field>
            <Field label="RG *">
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
            <Field label="Data de nascimento *">
              <input
                className="input"
                type="date"
                value={dados.proponente.data_nascimento ?? ""}
                onChange={(e) => setDados({ ...dados, proponente: { ...dados.proponente, data_nascimento: e.target.value } })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nacionalidade *">
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
          <Field label="E-mail *">
            <input
              className="input"
              type="email"
              value={dados.proponente.email ?? ""}
              onChange={(e) => setDados({ ...dados, proponente: { ...dados.proponente, email: e.target.value } })}
            />
          </Field>
        </>
      )}

      {passo === 1 && (
        <>
          <Field label="Estado civil *">
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

      {passo === 2 && (
        <EnderecoCampos
          endereco={dados.endereco_residencial}
          onChange={(endereco_residencial) => setDados({ ...dados, endereco_residencial })}
        />
      )}

      {passo === 3 && (
        <>
          <label className="flex items-center gap-2 text-sm text-ink -mb-1">
            <input
              type="checkbox"
              checked={dados.endereco_comercial_nao_possui ?? false}
              onChange={(e) => setDados({ ...dados, endereco_comercial_nao_possui: e.target.checked })}
            />
            Não possuo endereço comercial
          </label>
          {!dados.endereco_comercial_nao_possui && (
            <EnderecoCampos
              endereco={dados.endereco_comercial}
              onChange={(endereco_comercial) => setDados({ ...dados, endereco_comercial })}
              obrigatorio
            />
          )}
        </>
      )}

      {passo === 4 && (
        <>
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
            <Field label="Celular *">
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
            <input
              className="input"
              value={dados.falar_com ?? ""}
              onChange={(e) => setDados({ ...dados, falar_com: e.target.value })}
            />
          </Field>
        </>
      )}

      {passo === 5 && (
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
                    forma_pagamento: { ...dados.forma_pagamento, valor_proposto: e.target.value ? Number(e.target.value) : null },
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

      {passo === 6 && (
        <DocumentosStep token={token} obrigatorios={obrigatorios} documentos={documentos} setDocumentos={setDocumentos} />
      )}

      {passo === 7 && <Revisao dados={dados} documentos={documentos} obrigatorios={obrigatorios} />}

      {erro && <p className="text-rust text-sm">{erro}</p>}

      <div className="flex gap-3 mt-2">
        {passo > 0 && (
          <button className="btn btn-outline flex-1" onClick={voltar} disabled={salvando || enviando}>
            Voltar
          </button>
        )}
        {passo < PASSOS.length - 1 ? (
          <button className="btn btn-primary flex-1" onClick={avancar} disabled={salvando}>
            {salvando ? "Salvando..." : "Próximo"}
          </button>
        ) : (
          <button className="btn btn-primary flex-1" onClick={enviar} disabled={enviando}>
            {enviando ? "Enviando..." : "Enviar para análise"}
          </button>
        )}
      </div>
    </div>
  );
}

function EnderecoCampos({
  endereco,
  onChange,
  obrigatorio = true,
}: {
  endereco: QualificacaoDados["endereco_residencial"];
  onChange: (e: QualificacaoDados["endereco_residencial"]) => void;
  /** Complemento fica de fora mesmo quando obrigatório — nem todo endereço
   * tem um, e travar o envio por isso não faz sentido. */
  obrigatorio?: boolean;
}) {
  const m = obrigatorio ? " *" : "";
  return (
    <>
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <Field label={`Rua/Avenida${m}`}>
          <input className="input" value={endereco.rua ?? ""} onChange={(e) => onChange({ ...endereco, rua: e.target.value })} />
        </Field>
        <Field label={`Nº${m}`}>
          <input
            className="input w-20"
            value={endereco.numero ?? ""}
            onChange={(e) => onChange({ ...endereco, numero: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Complemento">
        <input
          className="input"
          value={endereco.complemento ?? ""}
          onChange={(e) => onChange({ ...endereco, complemento: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Bairro${m}`}>
          <input className="input" value={endereco.bairro ?? ""} onChange={(e) => onChange({ ...endereco, bairro: e.target.value })} />
        </Field>
        <Field label={`CEP${m}`}>
          <input className="input" value={endereco.cep ?? ""} onChange={(e) => onChange({ ...endereco, cep: e.target.value })} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Cidade${m}`}>
          <input className="input" value={endereco.cidade ?? ""} onChange={(e) => onChange({ ...endereco, cidade: e.target.value })} />
        </Field>
        <Field label={`UF${m}`}>
          <input className="input" maxLength={2} value={endereco.estado ?? ""} onChange={(e) => onChange({ ...endereco, estado: e.target.value.toUpperCase() })} />
        </Field>
      </div>
    </>
  );
}

function DocumentosStep({
  token,
  obrigatorios,
  documentos,
  setDocumentos,
}: {
  token: string;
  obrigatorios: DocumentoTipo[];
  documentos: DocumentoQualificacao[];
  setDocumentos: (d: DocumentoQualificacao[]) => void;
}) {
  return (
    <>
      <p className="text-xs text-ink-soft -mb-1">Envie foto ou PDF de cada documento (até 12MB cada).</p>
      <div className="grid gap-3">
        {obrigatorios.map((tipo) => (
          <DocumentoUpload
            key={tipo}
            token={token}
            tipo={tipo}
            existente={[...documentos].reverse().find((d) => d.tipo === tipo) ?? null}
            onEnviado={(doc) => setDocumentos([...documentos.filter((d) => d.id !== doc.id), doc])}
          />
        ))}
      </div>
    </>
  );
}

function DocumentoUpload({
  token,
  tipo,
  existente,
  onEnviado,
}: {
  token: string;
  tipo: DocumentoTipo;
  existente: DocumentoQualificacao | null;
  onEnviado: (d: DocumentoQualificacao) => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setErro(null);
    setEnviando(true);
    try {
      const doc = await api.enviarDocumentoQualificacao(token, tipo, arquivo);
      onEnviado(doc);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 border border-border rounded-lg px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{DOCUMENTO_LABEL[tipo]}</p>
        {existente ? (
          <p className="text-xs text-sage truncate">✓ {existente.nome_arquivo}</p>
        ) : (
          <p className="text-xs text-ink-soft">Nenhum arquivo enviado</p>
        )}
        {erro && <p className="text-xs text-rust">{erro}</p>}
      </div>
      <label className="btn btn-outline !py-2 !px-3 !text-xs shrink-0 cursor-pointer">
        {enviando ? "Enviando..." : existente ? "Reenviar" : "Anexar"}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
          className="hidden"
          disabled={enviando}
          onChange={onArquivo}
        />
      </label>
    </div>
  );
}

function Revisao({
  dados,
  documentos,
  obrigatorios,
}: {
  dados: QualificacaoDados;
  documentos: DocumentoQualificacao[];
  obrigatorios: DocumentoTipo[];
}) {
  const tiposEnviados = new Set(documentos.map((d) => d.tipo));
  const faltando = obrigatorios.filter((t) => !tiposEnviados.has(t));
  return (
    <div className="grid gap-3 text-sm">
      <p className="text-ink-soft">Confira antes de enviar — depois disso não dá mais pra editar.</p>
      <div className="grid gap-1">
        <p>
          <span className="text-ink-soft">Nome: </span>
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
          {dados.forma_pagamento.valor_proposto ?? "—"}
        </p>
      </div>
      {faltando.length > 0 ? (
        <p className="text-rust text-sm">
          Ainda falta anexar: {faltando.map((t) => DOCUMENTO_LABEL[t]).join(", ")}. Volte na etapa "Documentos".
        </p>
      ) : (
        <p className="text-sage text-sm">Todos os documentos exigidos foram anexados.</p>
      )}
    </div>
  );
}

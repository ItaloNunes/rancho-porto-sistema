import { useEffect, useState } from "react";
import {
  abrirAbaComCarregamento,
  api,
  formatarNumeroProposta,
  formatDateTime,
  formatMoney,
  mostrarErroNaAba,
  mostrarPdfNaAba,
  numeroContrato,
} from "../../lib/api";
import type { ConferenciaProposta, HistoricoContratos } from "../../lib/api";
import { fmtBRL, fmtData, lerPlano, lerValor, resumoPlano, textoMeio, valorPorExtenso } from "../../lib/pagamento";
import { ESTADO_CIVIL_OPCOES } from "../../components/qualificacaoCampos";
import PropostaDocumentos from "./PropostaDocumentos";
import PropostaFormularioCompleto from "./PropostaFormularioCompleto";
import type { EnderecoDados, PessoaDados, PropostaDetalhe, PropostaStatus, QualificacaoDados } from "../../types";

/** 'AAAA-MM-DD' ou 'DD/MM/AAAA' -> 'DD/MM/AAAA', qualquer ano (nascimento
 * inclusive — fmtData de pagamento.ts só aceita datas de pagamento). */
function dataBR(v: string | null | undefined): string | null {
  if (!v) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return v.trim() || null;
}

const STATUS_PENDENTES: PropostaStatus[] = ["rascunho", "aguardando_aprovacao"];
const STATUS_APROVADAS: PropostaStatus[] = ["aprovada", "enviada", "aceita"];
const STATUS_ENCERRADAS: PropostaStatus[] = ["recusada", "cancelada"];

/** Tela de conferência da proposta no Financeiro (03/10): tudo o que vai
 * pro contrato num lugar só — dados do comprador, forma de pagamento,
 * documentos anexados, pendências que o servidor encontrou e o histórico de
 * contratos emitidos (número e versão). Dali o financeiro corrige qualquer
 * dado na hora (mesmo formulário e mesmas conferências da criação), aprova
 * e gera recibo/contrato. */
export default function PropostaFinanceiro({
  proposta,
  onAtualizado,
  onAprovar,
  onGerarRecibo,
  onGerarContrato,
  atualizacao = 0,
}: {
  proposta: PropostaDetalhe;
  /** Muda a cada recarga da tela (ex.: depois de emitir um contrato) — refaz
   * a conferência e o histórico de contratos. */
  atualizacao?: number;
  onAtualizado: () => void;
  onAprovar: (p: PropostaDetalhe) => Promise<void>;
  onGerarRecibo: (p: PropostaDetalhe) => void;
  onGerarContrato: (p: PropostaDetalhe) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [conferencia, setConferencia] = useState<ConferenciaProposta | null>(null);
  const [historico, setHistorico] = useState<HistoricoContratos | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [aprovando, setAprovando] = useState(false);
  const [abrindoPdf, setAbrindoPdf] = useState(false);
  const [salvoAgora, setSalvoAgora] = useState(false);

  useEffect(() => {
    setErroCarga(null);
    setConferencia(null);
    api.conferenciaProposta(proposta.id).then(setConferencia).catch((e) => setErroCarga(e.message));
    api.historicoContratos(proposta.id).then(setHistorico).catch(() => setHistorico(null));
  }, [proposta.id, proposta.versao, proposta.status, atualizacao]);

  const encerrada = STATUS_ENCERRADAS.includes(proposta.status);
  const pendente = STATUS_PENDENTES.includes(proposta.status);
  const aprovada = STATUS_APROVADAS.includes(proposta.status);
  const problemasAprovar = conferencia
    ? [...new Set([...conferencia.problemas_pagamento, ...conferencia.problemas_contrato, ...conferencia.problemas_cadastro])]
    : [];
  // Contrato: trava só no que o servidor trava (números que não fecham);
  // dado cadastral inválido numa proposta já aprovada vira aviso.
  const problemasContrato = conferencia ? conferencia.problemas_contrato : [];
  const bloqueios = aprovada ? problemasContrato : problemasAprovar;
  const avisos = aprovada && conferencia ? conferencia.problemas_cadastro : [];

  if (editando) {
    return (
      <div>
        <div className="px-5 sm:px-6 pt-5">
          <button className="btn-row btn-row-neutral" onClick={() => setEditando(false)}>
            ← voltar sem salvar
          </button>
        </div>
        <PropostaFormularioCompleto
          lotes={[]}
          edicao={proposta}
          onSalvo={() => {
            setEditando(false);
            setSalvoAgora(true);
            onAtualizado();
          }}
        />
      </div>
    );
  }

  async function verPdfProposta() {
    const aba = abrirAbaComCarregamento("Gerando PDF da proposta...");
    setAbrindoPdf(true);
    try {
      const blob = await api.gerarPdfProposta(proposta.id);
      const nome = `proposta-${String(proposta.numero).padStart(4, "0")}-v${proposta.versao}.pdf`;
      if (aba) mostrarPdfNaAba(aba, blob, nome, `Proposta ${formatarNumeroProposta(proposta.numero, proposta.versao)}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      mostrarErroNaAba(aba, msg);
      alert(msg);
    } finally {
      setAbrindoPdf(false);
    }
  }

  async function aprovar() {
    setAprovando(true);
    try {
      await onAprovar(proposta);
    } finally {
      setAprovando(false);
    }
  }

  const dados = (proposta.dados_qualificacao ?? {}) as Partial<QualificacaoDados>;
  const ultimaEmissao = historico?.emissoes[0];
  const contratoDesatualizado = ultimaEmissao?.versao != null && ultimaEmissao.versao < proposta.versao;

  return (
    <div className="p-5 sm:p-7 grid gap-5">
      <header className="pr-12">
        <h2 id="financeiro-proposta-title" className="text-lg font-bold text-ink">
          Proposta <span className="font-mono">{formatarNumeroProposta(proposta.numero, proposta.versao)}</span>
        </h2>
        <p className="text-sm text-ink-soft">
          {proposta.lote?.identificador ?? "Lote —"} · {proposta.cliente?.nome ?? "Cliente"} · criada em{" "}
          {dataBR(proposta.created_at)}
        </p>
        <p className="mt-2 text-2xl font-bold text-ink tabular-nums">{formatMoney(proposta.valor_proposto)}</p>
        {proposta.lote?.valor_total != null && (
          <p className="text-xs text-ink-soft">Valor de tabela do lote: R$ {fmtBRL(proposta.lote.valor_total)}</p>
        )}
      </header>

      {salvoAgora && (
        <p className="text-sm text-sage bg-sage/10 border border-sage/30 rounded-lg px-3 py-2">
          Correção salva — a proposta agora está na versão {proposta.versao}.
        </p>
      )}

      {/* Pendências — o que o servidor vai barrar na aprovação/contrato */}
      {erroCarga ? (
        <p className="text-rust text-sm">Não consegui conferir a proposta agora: {erroCarga}</p>
      ) : !conferencia ? (
        <p className="text-ink-soft text-sm">Conferindo a proposta...</p>
      ) : !encerrada && bloqueios.length > 0 ? (
        <section className="rounded-lg border border-rust/40 bg-rust/5 p-3 grid gap-2">
          <h3 className="text-sm font-bold text-rust">Precisa corrigir antes de {aprovada ? "gerar o contrato" : "aprovar"}</h3>
          <ul className="list-disc pl-5 text-sm text-ink grid gap-1">
            {bloqueios.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {!conferencia.plano_estruturado && (
            <p className="text-xs text-ink-soft">
              Esta proposta é do formulário antigo: ao corrigir, informe também a forma, o meio e a data da entrada.
            </p>
          )}
        </section>
      ) : !encerrada && avisos.length > 0 ? (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 grid gap-1">
          <h3 className="text-sm font-bold text-amber-800">Os valores fecham, mas confira estes dados</h3>
          <ul className="list-disc pl-5 text-sm text-ink grid gap-1">
            {avisos.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="text-xs text-ink-soft">Dá pra gerar o contrato; use “Corrigir dados” pra acertar antes, se quiser.</p>
        </section>
      ) : !encerrada ? (
        <p className="text-sm text-sage bg-sage/10 border border-sage/30 rounded-lg px-3 py-2">
          Tudo confere: entrada + parcelas + chave fecham com o valor proposto e os dados do comprador são válidos.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!encerrada && (
          <button id="financeiro-corrigir" className="btn btn-outline !py-2 !px-4 !text-sm" onClick={() => setEditando(true)}>
            Corrigir dados
          </button>
        )}
        <button className="btn btn-outline !py-2 !px-4 !text-sm" onClick={verPdfProposta} disabled={abrindoPdf}>
          {abrindoPdf ? "Abrindo..." : "Ver PDF da proposta"}
        </button>
        {pendente && (
          <button
            id="financeiro-aprovar"
            className="btn btn-primary !py-2 !px-4 !text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={aprovar}
            disabled={aprovando || !conferencia || problemasAprovar.length > 0}
            title={problemasAprovar.length ? "Corrija as pendências acima antes de aprovar" : undefined}
          >
            {aprovando ? "Aprovando..." : "Aprovar proposta"}
          </button>
        )}
        {!encerrada && (
          <button className="btn btn-outline !py-2 !px-4 !text-sm" onClick={() => onGerarRecibo(proposta)}>
            Gerar recibo
          </button>
        )}
        {aprovada && (
          <button
            className="btn btn-primary !py-2 !px-4 !text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => onGerarContrato(proposta)}
            disabled={!conferencia || problemasContrato.length > 0}
          >
            Gerar contrato
          </button>
        )}
      </div>

      <section className="grid gap-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft">Dados que vão para o contrato</h3>
        <div className="grid sm:grid-cols-2 gap-3 items-start">
          <Bloco titulo="Comprador">
            <Pessoa p={dados.proponente} />
            <Linha rotulo="Estado civil" valor={ESTADO_CIVIL_OPCOES.find((o) => o.valor === dados.estado_civil)?.label} />
          </Bloco>
          {dados.estado_civil === "casado" && (
            <Bloco titulo="Cônjuge">
              <Pessoa p={dados.conjuge} />
            </Bloco>
          )}
          <Bloco titulo="Endereço residencial">
            <Endereco e={dados.endereco_residencial} />
          </Bloco>
          <Bloco titulo="Endereço comercial">
            {dados.endereco_comercial_nao_possui ? (
              <p className="text-sm text-ink-soft">Não possui</p>
            ) : (
              <Endereco e={dados.endereco_comercial} />
            )}
            <Linha
              rotulo="Correspondência"
              valor={dados.endereco_correspondencia === "comercial" ? "Comercial" : "Residencial"}
            />
          </Bloco>
          <Bloco titulo="Contatos">
            <Linha rotulo="Celular" valor={dados.telefone_celular} />
            <Linha rotulo="Residencial" valor={dados.telefone_residencial} />
            <Linha rotulo="Comercial" valor={dados.telefone_comercial} />
            <Linha rotulo="Recados" valor={dados.telefone_recados} />
            <Linha rotulo="Falar com" valor={dados.falar_com} />
          </Bloco>
          <Bloco titulo="Forma de pagamento">
            <FormaPagamentoResumo dados={dados} valorProposto={proposta.valor_proposto} lote={proposta.lote ?? null} />
          </Bloco>
        </div>
      </section>

      <section className="rounded-lg border border-border p-3 grid gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft">Contrato</h3>
        <p className="text-sm text-ink">
          Nº <strong className="font-mono">{historico?.numero_contrato ?? numeroContrato(proposta.numero, proposta.created_at)}</strong>{" "}
          · versão atual <strong>{proposta.versao}</strong>
          <span className="text-ink-soft"> (sobe a cada correção de dados)</span>
        </p>
        {contratoDesatualizado && (
          <p className="text-sm text-rust">
            O último contrato emitido é a versão {ultimaEmissao?.versao} — os dados mudaram depois disso. Gere o
            contrato de novo (versão {proposta.versao}) e descarte a via anterior.
          </p>
        )}
        {historico && historico.emissoes.length > 0 ? (
          <ul className="text-sm grid gap-1">
            {historico.emissoes.map((e, i) => (
              <li key={i} className="flex flex-wrap gap-x-2 text-ink">
                <span className="font-mono">
                  {e.numero_contrato} – v{e.versao}
                </span>
                <span className="text-ink-soft">
                  emitido em {formatDateTime(e.emitido_em)} por {e.emitido_por ?? "—"}
                  {e.data_contrato ? ` · data do contrato ${dataBR(e.data_contrato)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-soft">
            {aprovada ? "Nenhum contrato emitido ainda." : "O contrato só pode ser gerado depois da aprovação."}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-border p-3">
        <PropostaDocumentos proposta={proposta} onAtualizado={onAtualizado} />
      </section>
    </div>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-3 grid gap-1 content-start">
      <h4 className="text-sm font-bold text-ink mb-0.5">{titulo}</h4>
      {children}
    </div>
  );
}

function Linha({ rotulo, valor, extra }: { rotulo: string; valor?: string | number | null; extra?: string }) {
  const vazio = valor === null || valor === undefined || valor === "";
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-2 text-sm">
      <span className="text-ink-soft">{rotulo}</span>
      <span className={vazio ? "text-ink-soft" : "text-ink break-words"}>{vazio ? "—" : valor}</span>
      {extra && <span className="col-start-2 text-[11px] text-ink-soft">{extra}</span>}
    </div>
  );
}

function Pessoa({ p }: { p?: PessoaDados | null }) {
  return (
    <>
      <Linha rotulo="Nome" valor={p?.nome} />
      <Linha rotulo="CPF/CNPJ" valor={p?.cpf_cnpj} />
      <Linha rotulo="RG" valor={[p?.rg, p?.orgao_expedidor].filter(Boolean).join(" / ")} />
      <Linha rotulo="Nascimento" valor={dataBR(p?.data_nascimento)} />
      <Linha rotulo="Nacionalidade" valor={p?.nacionalidade} />
      <Linha rotulo="Profissão" valor={p?.profissao} />
      <Linha rotulo="E-mail" valor={p?.email} />
    </>
  );
}

function Endereco({ e }: { e?: EnderecoDados | null }) {
  const linha1 = [e?.rua, e?.numero && `nº ${e.numero}`, e?.complemento].filter(Boolean).join(", ");
  const linha2 = [e?.bairro, [e?.cidade, e?.estado].filter(Boolean).join("/"), e?.cep && `CEP ${e.cep}`]
    .filter(Boolean)
    .join(" · ");
  if (!linha1 && !linha2) return <p className="text-sm text-ink-soft">Não informado</p>;
  return (
    <p className="text-sm text-ink">
      {linha1}
      {linha2 && <span className="block text-ink-soft">{linha2}</span>}
    </p>
  );
}

/** Mesmos números que o contrato imprime (plano_pagamento.valores_contrato):
 * proposta do formulário novo usa só o próprio plano; proposta antiga
 * completa o que faltar com o plano de tabela do lote e usa a "entrega" do
 * lote como chave. */
function FormaPagamentoResumo({
  dados,
  valorProposto,
  lote,
}: {
  dados: Partial<QualificacaoDados>;
  valorProposto: number;
  lote: PropostaDetalhe["lote"];
}) {
  const fp = dados.forma_pagamento ?? {};
  const estruturado = !!(fp.sinal_forma || fp.avista_meio);
  const base = lerPlano({ ...fp, valor_proposto: fp.valor_proposto ?? valorProposto });
  const entrada = base.entrada ?? (estruturado ? null : lote?.entrada ?? null);
  const parcelas = base.parcelas ?? (estruturado ? null : lote?.qtd_parcelas ?? null);
  const parcelaValor = base.parcelaValor ?? (estruturado ? null : lote?.parcela_mensal ?? null);
  const chave = estruturado ? lerValor(fp.chave_valor) ?? 0 : lote?.entrega ?? 0;
  const p = {
    ...base,
    entrada,
    parcelas,
    parcelaValor,
    total: Math.round(((entrada ?? 0) + (parcelas ?? 0) * (parcelaValor ?? 0) + chave) * 100) / 100,
  };
  const brl = (v: number | null | undefined) => (v != null ? `R$ ${fmtBRL(v)}` : null);
  const ext = (v: number | null | undefined) => (v != null && v > 0 ? valorPorExtenso(v) : undefined);
  if (fp.a_vista) {
    return (
      <>
        <Linha rotulo="Modalidade" valor="À vista" />
        <Linha rotulo="Valor" valor={brl(valorProposto)} extra={ext(valorProposto)} />
        <Linha rotulo="Como / quando" valor={`${textoMeio(fp.avista_meio)} em ${fmtData(fp.avista_data)}`} />
        <Linha rotulo="Renda informada" valor={fp.renda ? `R$ ${fp.renda}` : null} />
      </>
    );
  }
  const entradaTxt =
    fp.sinal_forma === "parcelada" && p.entradaParcelas > 1
      ? `${p.entradaParcelas}x de R$ ${fmtBRL(p.entradaValores[0])} via ${textoMeio(fp.sinal_meio)}, 1ª em ${fmtData(fp.sinal_vencimento)}`
      : fp.sinal_forma === "unica"
        ? `De uma vez via ${textoMeio(fp.sinal_meio)} em ${fmtData(fp.sinal_vencimento)}`
        : "Forma, meio e data não informados (proposta antiga)";
  const total = p.total;
  const fecha = Math.abs(total - valorProposto) <= 0.005;
  return (
    <>
      <Linha rotulo="Entrada" valor={brl(p.entrada)} extra={entradaTxt} />
      <Linha
        rotulo="Parcelas mensais"
        valor={p.parcelas && p.parcelaValor ? `${p.parcelas} x R$ ${fmtBRL(p.parcelaValor)}` : null}
        extra={fp.primeiro_mes ? `1ª em ${fmtData(fp.primeiro_mes)}` : undefined}
      />
      <Linha rotulo="Chave" valor={brl(chave)} extra={estruturado ? undefined : "da tabela do lote (proposta antiga)"} />
      <Linha rotulo="Renda informada" valor={fp.renda ? `R$ ${fp.renda}` : null} />
      {estruturado && <Linha rotulo="Resumo" valor={resumoPlano({ ...fp, valor_proposto: valorProposto })} />}
      <p className={`text-xs font-semibold mt-1 ${fecha ? "text-sage" : "text-rust"}`}>
        {fecha
          ? `✓ Soma R$ ${fmtBRL(total)} = valor proposto`
          : `✗ Soma R$ ${fmtBRL(total)} ≠ valor proposto R$ ${fmtBRL(valorProposto)}`}
      </p>
      {fp.observacoes && <Linha rotulo="Observações" valor={fp.observacoes} />}
    </>
  );
}

import { useEffect, useState } from "react";
import Modal from "../../components/Modal";
import { api, formatMoney, formatarNumeroProposta, numeroContrato } from "../../lib/api";
import { PrazoAnaliseBadge } from "./PropostaDocumentos";
import PropostaFinanceiro from "./PropostaFinanceiro";
import type { PropostaDetalhe, PropostaStatus } from "../../types";

// Uma proposta sai da fila do financeiro assim que alguém decide algo sobre
// ela — aprovada/enviada/aceita seguiram em frente, recusada/cancelada não
// vão a lugar nenhum. Só "rascunho" e "aguardando_aprovacao" ainda dependem
// de uma decisão daqui.
const STATUS_DECIDIDOS: PropostaStatus[] = ["aprovada", "enviada", "aceita", "recusada", "cancelada"];
// Já aprovadas (seguiram em frente): continuam aparecendo aqui, numa seção
// própria, porque é daqui que o financeiro gera recibo e contrato — e o
// contrato só sai DEPOIS da aprovação. Antes (até 02/10) elas sumiam da tela
// ao aprovar e não sobrava nenhum lugar no sistema pra gerar o contrato.
const STATUS_APROVADAS: PropostaStatus[] = ["aprovada", "enviada", "aceita"];
// Encerradas sem venda — só pra consulta (histórico), sem ação.
const STATUS_ENCERRADAS: PropostaStatus[] = ["recusada", "cancelada"];

const STATUS_LABEL: Record<PropostaStatus, string> = {
  rascunho: "Rascunho",
  aguardando_aprovacao: "Aguardando aprovação",
  aprovada: "Aprovada",
  enviada: "Enviada",
  aceita: "Aceita",
  recusada: "Recusada",
  cancelada: "Cancelada",
};

function StatusBadge({ status }: { status: PropostaStatus }) {
  const cor = STATUS_APROVADAS.includes(status) ? "bg-sage/10 text-sage" : "bg-rust/10 text-rust";
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-sm inline-block ${cor}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

// Badge de estado do contrato (mesmo padrão dos badges do sistema: fundo
// tintado 10% + texto na cor semântica). Em andamento = primary (navy),
// gerado = sage (verde).
function EstadoBadge({ tipo }: { tipo: "andamento" | "gerado" }) {
  const map = {
    andamento: { txt: "Em andamento", cls: "bg-primary/10 text-primary" },
    gerado: { txt: "Gerado", cls: "bg-sage/10 text-sage" },
  } as const;
  const { txt, cls } = map[tipo];
  // Mesmo visual do .badge do sistema (inline-flex, rounded-sm, uppercase),
  // montado com utilitários para controlar o ponto e não duplicar o ::before.
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] font-semibold tracking-wide uppercase ${cls}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {txt}
    </span>
  );
}

type FiltroEstado = "analise" | "andamento" | "gerados" | "encerradas";

// Filtro segmentado por estado — organiza a tela em vez da lista única.
// Usa só os tokens do sistema (surface-alt, surface, primary, border).
function FiltroContratos({
  filtro,
  setFiltro,
  counts,
}: {
  filtro: FiltroEstado;
  setFiltro: (f: FiltroEstado) => void;
  counts: Record<FiltroEstado, number>;
}) {
  const abas: { key: FiltroEstado; label: string }[] = [
    { key: "analise", label: "Em análise" },
    { key: "andamento", label: "Em andamento" },
    { key: "gerados", label: "Gerados" },
    ...(counts.encerradas > 0 ? [{ key: "encerradas" as const, label: "Encerradas" }] : []),
  ];
  return (
    <div className="flex flex-wrap gap-1 p-1 bg-surface-alt rounded-lg border border-border w-fit max-w-full">
      {abas.map((a) => {
        const ativo = filtro === a.key;
        return (
          <button
            key={a.key}
            type="button"
            onClick={() => setFiltro(a.key)}
            aria-pressed={ativo}
            className={`px-3 py-1.5 rounded text-sm font-semibold inline-flex items-center gap-2 transition-colors ${
              ativo ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink"
            }`}
          >
            {a.label}
            <span
              className={`text-[11px] font-bold min-w-[20px] h-[18px] px-1.5 rounded-full inline-flex items-center justify-center tabular-nums ${
                ativo ? "bg-primary text-white" : "bg-border text-ink-soft"
              }`}
            >
              {counts[a.key]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Aba exclusiva do financeiro (admin/developer — ver RequireAuth adminOnly
 * em main.tsx e temAcessoAdmin em PainelLayout.tsx): só as propostas que já
 * têm todos os documentos obrigatórios anexados (documentos_completos_em
 * preenchido, ver PropostaDocumentos.tsx/migration 0021) e que ainda não
 * foram decididas entram na fila do topo — é a fila real de "pronto pra
 * analisar". Abaixo dela ficam as aprovadas (recibo/contrato) e o histórico
 * das recusadas/canceladas, pra nada sumir da tela do financeiro. */
export default function PainelFinanceiro() {
  const [propostas, setPropostas] = useState<PropostaDetalhe[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aprovandoId, setAprovandoId] = useState<string | null>(null);
  // Proposta aberta na tela de conferência (dados + documentos + contrato).
  const [verDocumentosDe, setVerDocumentosDe] = useState<string | null>(null);
  const [reciboDe, setReciboDe] = useState<PropostaDetalhe | null>(null);
  const [contratoDe, setContratoDe] = useState<PropostaDetalhe | null>(null);
  const [descontoDe, setDescontoDe] = useState<PropostaDetalhe | null>(null);

  const [atualizacao, setAtualizacao] = useState(0);
  const [filtro, setFiltro] = useState<FiltroEstado>("analise");

  function recarregar() {
    setErro(null);
    setAtualizacao((n) => n + 1);
    api.listarPropostas().then(setPropostas).catch((e) => setErro(e.message));
  }

  useEffect(() => {
    recarregar();
  }, []);

  // Mais antiga primeiro — quem está esperando há mais tempo aparece no topo.
  const filaAnalise = (propostas ?? [])
    .filter((p) => p.documentos_completos_em && !STATUS_DECIDIDOS.includes(p.status))
    .sort(
      (a, b) => new Date(a.documentos_completos_em as string).getTime() - new Date(b.documentos_completos_em as string).getTime(),
    );

  // Mais recente primeiro — o que acabou de ser aprovado fica no topo.
  const porMaisRecente = (a: PropostaDetalhe, b: PropostaDetalhe) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  const aprovadas = (propostas ?? []).filter((p) => STATUS_APROVADAS.includes(p.status)).sort(porMaisRecente);
  const encerradas = (propostas ?? []).filter((p) => STATUS_ENCERRADAS.includes(p.status)).sort(porMaisRecente);
  // "Aprovadas" se divide pelo que importa pro financeiro: ainda sem contrato
  // emitido (em andamento) vs. já com contrato gerado (tem numero_contrato).
  const emAndamento = aprovadas.filter((p) => !numeroContrato(p.numero_contrato));
  const gerados = aprovadas.filter((p) => numeroContrato(p.numero_contrato));

  // Ações das propostas aprovadas (em andamento e geradas): recibo, desconto
  // e gerar contrato — iguais às de antes, só reorganizadas por estado.
  const acoesAprovada = (p: PropostaDetalhe) => (
    <>
      <button className="btn-row btn-row-neutral mr-1.5" onClick={() => setReciboDe(p)}>
        gerar recibo
      </button>
      {!p.desconto_especial && (
        <button className="btn-row btn-row-neutral mr-1.5" onClick={() => setDescontoDe(p)}>
          desconto
        </button>
      )}
      {p.desconto_especial ? (
        <span
          className="btn-row mr-1.5 text-amber-700 cursor-default"
          title={`Desconto aplicado: ${formatMoney(p.desconto_especial)}${p.desconto_motivo ? " — " + p.desconto_motivo : ""}`}
        >
          desconto: {formatMoney(p.desconto_especial)}
        </span>
      ) : null}
      <button className="btn-row btn-row-primary" onClick={() => setContratoDe(p)}>
        gerar contrato
      </button>
    </>
  );

  async function aprovar(p: PropostaDetalhe) {
    if (
      !confirm(
        `Aprovar a proposta ${formatarNumeroProposta(p.numero, p.versao)} — ${p.cliente?.nome ?? ""}, ` +
          `${formatMoney(p.valor_proposto)}?\n\nConfira antes: os valores e dados desta versão são os que vão para o contrato.`,
      )
    )
      return;
    setAprovandoId(p.id);
    try {
      await api.atualizarStatusProposta(p.id, "aprovada");
      recarregar();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setAprovandoId(null);
    }
  }

  async function gerarRecibo(p: PropostaDetalhe, valor: number, data: string) {
    const blob = await api.gerarReciboProposta(p.id, valor, data);
    const nomeArquivo = `recibo-${p.lote?.identificador ?? p.id}.pdf`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = nomeArquivo;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function gerarContrato(p: PropostaDetalhe, comissao: number, data: string) {
    const blob = await api.gerarContratoProposta(p.id, comissao, data);
    const n = numeroContrato(p.numero_contrato);
    const nomeArquivo = `contrato-${n ? `${n}-` : ""}v${p.versao}-${p.lote?.identificador ?? p.id}.pdf`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = nomeArquivo;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    recarregar(); // histórico de contratos emitidos (número/versão)
  }

  async function aplicarDesconto(p: PropostaDetalhe, valor: number, motivo: string) {
    await api.aplicarDesconto(p.id, valor, motivo);
    recarregar();
  }

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-xl font-bold text-ink">Financeiro</h1>
        <p className="text-xs text-ink-soft mt-1">
          Use os filtros para separar as propostas por estado: <strong>em análise</strong> (aguardando aprovação),{" "}
          <strong>em andamento</strong> (aprovada, contrato ainda não emitido) e <strong>gerados</strong> (contrato já
          emitido, com número e versão). Clique em “abrir” para conferir a proposta, corrigir dados e aprovar; o recibo
          e o contrato saem a partir de “em andamento”.
        </p>
      </div>

      {erro && <p className="text-rust text-sm">{erro}</p>}

      {!propostas ? (
        <p className="text-ink-soft text-sm">Carregando...</p>
      ) : (
        <>
          <FiltroContratos
            filtro={filtro}
            setFiltro={setFiltro}
            counts={{
              analise: filaAnalise.length,
              andamento: emAndamento.length,
              gerados: gerados.length,
              encerradas: encerradas.length,
            }}
          />

          {filtro === "analise" &&
            (filaAnalise.length === 0 ? (
              <p className="text-ink-soft text-sm">Nenhuma proposta completa aguardando análise no momento.</p>
            ) : (
              <TabelaFinanceiro
                propostas={filaAnalise}
                colunaSituacao={(p) => <PrazoAnaliseBadge completosEm={p.documentos_completos_em} />}
                acoes={(p) => (
                  <>
                    <button
                      className="btn-row btn-row-primary mr-1.5"
                      disabled={aprovandoId === p.id}
                      onClick={() => aprovar(p)}
                    >
                      {aprovandoId === p.id ? "aprovando..." : "aprovar"}
                    </button>
                    <button className="btn-row btn-row-neutral" onClick={() => setReciboDe(p)}>
                      gerar recibo
                    </button>
                  </>
                )}
                onVerDocumentos={setVerDocumentosDe}
              />
            ))}

          {filtro === "andamento" &&
            (emAndamento.length === 0 ? (
              <p className="text-ink-soft text-sm">Nenhuma proposta aprovada aguardando emissão de contrato.</p>
            ) : (
              <TabelaFinanceiro
                propostas={emAndamento}
                colunaSituacao={() => <EstadoBadge tipo="andamento" />}
                acoes={acoesAprovada}
                onVerDocumentos={setVerDocumentosDe}
              />
            ))}

          {filtro === "gerados" &&
            (gerados.length === 0 ? (
              <p className="text-ink-soft text-sm">Nenhum contrato emitido ainda.</p>
            ) : (
              <TabelaFinanceiro
                propostas={gerados}
                colunaSituacao={(p) => (
                  <span className="inline-flex flex-col items-start gap-1">
                    <EstadoBadge tipo="gerado" />
                    <span className="text-[11px] text-ink-soft font-mono">
                      Contrato Nº {numeroContrato(p.numero_contrato)}
                    </span>
                  </span>
                )}
                acoes={acoesAprovada}
                onVerDocumentos={setVerDocumentosDe}
              />
            ))}

          {filtro === "encerradas" &&
            (encerradas.length === 0 ? (
              <p className="text-ink-soft text-sm">Nenhuma proposta encerrada.</p>
            ) : (
              <TabelaFinanceiro
                propostas={encerradas}
                colunaSituacao={(p) => <StatusBadge status={p.status} />}
                acoes={() => null}
                onVerDocumentos={setVerDocumentosDe}
              />
            ))}
        </>
      )}

      {verDocumentosDe &&
        (() => {
          const proposta = propostas?.find((p) => p.id === verDocumentosDe);
          // A proposta pode ter sumido da fila entre um recarregar() e outro
          // (ex.: aprovada em outra aba) — nesse caso só não reabre o modal.
          if (!proposta) return null;
          return (
            <Modal onClose={() => setVerDocumentosDe(null)} labelledBy="financeiro-proposta-title" largo>
              <PropostaFinanceiro
                proposta={proposta}
                onAtualizado={recarregar}
                onAprovar={aprovar}
                onGerarRecibo={setReciboDe}
                onGerarContrato={setContratoDe}
                atualizacao={atualizacao}
              />
            </Modal>
          );
        })()}

      {reciboDe && (
        <Modal onClose={() => setReciboDe(null)} labelledBy="financeiro-recibo-title">
          <FormularioRecibo proposta={reciboDe} onGerar={gerarRecibo} onFechar={() => setReciboDe(null)} />
        </Modal>
      )}

      {contratoDe && (
        <Modal onClose={() => setContratoDe(null)} labelledBy="financeiro-contrato-title">
          <FormularioContrato proposta={contratoDe} onGerar={gerarContrato} onFechar={() => setContratoDe(null)} />
        </Modal>
      )}

      {descontoDe && (
        <Modal onClose={() => setDescontoDe(null)} labelledBy="financeiro-desconto-title">
          <FormularioDesconto
            proposta={descontoDe}
            onAplicar={aplicarDesconto}
            onFechar={() => setDescontoDe(null)}
          />
        </Modal>
      )}
    </div>
  );
}

function TabelaFinanceiro({
  propostas,
  colunaSituacao,
  acoes,
  onVerDocumentos,
}: {
  propostas: PropostaDetalhe[];
  colunaSituacao: (p: PropostaDetalhe) => React.ReactNode;
  acoes: (p: PropostaDetalhe) => React.ReactNode;
  onVerDocumentos: (id: string) => void;
}) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm min-w-[860px]">
        <thead>
          <tr className="border-b border-border text-left text-ink-soft text-xs uppercase tracking-wide">
            <th className="px-4 py-3 font-medium">Nº</th>
            <th className="px-4 py-3 font-medium">Lote</th>
            <th className="px-4 py-3 font-medium">Cliente</th>
            <th className="px-4 py-3 font-medium">Valor proposto</th>
            <th className="px-4 py-3 font-medium">Conferência</th>
            <th className="px-4 py-3 font-medium" />
          </tr>
        </thead>
        <tbody>
          {propostas.map((p) => (
            <tr key={p.id} className="border-b border-border last:border-0 hover:bg-surface-alt/60">
              <td className="px-4 py-3 text-ink-soft whitespace-nowrap font-mono text-xs">
                {formatarNumeroProposta(p.numero, p.versao)}
              </td>
              <td className="px-4 py-3 text-ink">
                    {p.lote ? p.lote.identificador : "—"}
                    {p.condominio_nome && <span className="block text-xs text-ink-soft">{p.condominio_nome}</span>}
                  </td>
              <td className="px-4 py-3 text-ink">{p.cliente?.nome ?? "—"}</td>
              <td className="px-4 py-3 text-ink-soft">{formatMoney(p.valor_proposto)}</td>
              <td className="px-4 py-3 whitespace-nowrap">
                <button className="btn-row btn-row-primary mr-1.5" onClick={() => onVerDocumentos(p.id)}>
                  abrir
                </button>
                {colunaSituacao(p)}
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">{acoes(p)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Pergunta o valor efetivamente recebido (e a data) e gera o recibo desse
 * pagamento — um recibo por pagamento (entrada ou parcela), não por
 * proposta, por isso não tem valor salvo em lugar nenhum pra pré-preencher
 * aqui. Pedido em 28/09. */
function FormularioRecibo({
  proposta,
  onGerar,
  onFechar,
}: {
  proposta: PropostaDetalhe;
  onGerar: (p: PropostaDetalhe, valor: number, data: string) => Promise<void>;
  onFechar: () => void;
}) {
  const [valor, setValor] = useState("");
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const numero = Number(valor.replace(",", "."));
    if (!numero || numero <= 0) {
      setErro("Informe um valor maior que zero.");
      return;
    }
    setErro(null);
    setGerando(true);
    try {
      await onGerar(proposta, numero, data);
      onFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setGerando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="p-6 sm:p-8 grid gap-4">
      <div>
        <h2 id="financeiro-recibo-title" className="text-lg font-bold text-ink">
          Gerar recibo
        </h2>
        <p className="text-xs text-ink-soft mt-1">
          {proposta.cliente?.nome ?? "Cliente"} — lote {proposta.lote?.identificador ?? "—"}. O recibo sai em PDF, já
          preenchido no modelo da imobiliária (Porto Franco ou Rancho Texas, conforme o empreendimento).
        </p>
      </div>
      <label className="grid gap-1 text-sm">
        <span className="text-ink-soft">Valor recebido (R$)</span>
        <input
          className="input"
          type="number"
          step="0.01"
          min="0.01"
          inputMode="decimal"
          autoFocus
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          required
        />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="text-ink-soft">Data do recibo</span>
        <input className="input" type="date" value={data} onChange={(e) => setData(e.target.value)} required />
      </label>
      {erro && <p className="text-rust text-sm">{erro}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-outline" onClick={onFechar} disabled={gerando}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary" disabled={gerando}>
          {gerando ? "Gerando..." : "Gerar recibo"}
        </button>
      </div>
    </form>
  );
}

/** Gera o contrato completo (modelo real, alienação fiduciária) preenchido
 * com os dados já cadastrados da proposta -- comprador, lote, forma de
 * pagamento. Só pede aqui o que não existe em lugar nenhum do sistema: o
 * valor da comissão de corretagem (varia por venda) e a data de celebração
 * do contrato. Por enquanto só funciona pro Porto Franco -- o backend
 * recusa com uma mensagem clara se a proposta for do Rancho Texas. Pedido
 * em 28/09. */
function FormularioContrato({
  proposta,
  onGerar,
  onFechar,
}: {
  proposta: PropostaDetalhe;
  onGerar: (p: PropostaDetalhe, comissao: number, data: string) => Promise<void>;
  onFechar: () => void;
}) {
  const [comissao, setComissao] = useState("");
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    // Máscara de moeda: só dígitos, os 2 últimos são centavos (ver o input).
    const soDigitos = comissao.replace(/\D/g, "");
    const numero = soDigitos === "" ? NaN : parseInt(soDigitos, 10) / 100;
    if (soDigitos === "" || Number.isNaN(numero) || numero < 0) {
      setErro("Informe o valor da comissão (pode ser 0, se não houver).");
      return;
    }
    setErro(null);
    setGerando(true);
    try {
      await onGerar(proposta, numero, data);
      onFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setGerando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="p-6 sm:p-8 grid gap-4">
      <div>
        <h2 id="financeiro-contrato-title" className="text-lg font-bold text-ink">
          Gerar contrato
        </h2>
        <p className="text-xs text-ink-soft mt-1">
          <span className="block font-mono text-ink mb-1">
            {numeroContrato(proposta.numero_contrato)
              ? `Contrato Nº ${numeroContrato(proposta.numero_contrato)} – versão ${proposta.versao}`
              : `Contrato novo — recebe o próximo número da sequência (a partir do 91) ao gerar · versão ${proposta.versao}`}
          </span>
          {proposta.cliente?.nome ?? "Cliente"} — lote {proposta.lote?.identificador ?? "—"}. O contrato sai
          em PDF, preenchido com os dados já cadastrados (comprador, lote, forma de pagamento) no modelo real da
          imobiliária, mantendo o texto jurídico exato. Confira os campos que não existem no sistema (ex.: local de
          nascimento do comprador) antes de assinar.
        </p>
        {/veneza/i.test(proposta.condominio_nome ?? "") && (
          <p className="text-xs text-amber-700 mt-2">
            Veneza: a comissão vai nos itens 3.2.2 e 4, com o percentual calculado sobre o preço total. A fração
            ideal fica em branco para completar à mão.
          </p>
        )}
        {/riviera/i.test(proposta.condominio_nome ?? "") && (
          <p className="text-xs text-amber-700 mt-2">
            Riviera: o modelo não tem cláusula de comissão (o valor informado fica só no histórico). As confrontações
            do lote (item V) ficam em branco para completar à mão.
          </p>
        )}
      </div>
      <label className="grid gap-1 text-sm">
        <span className="text-ink-soft">Comissão de corretagem (R$)</span>
        <input
          className="input"
          type="text"
          inputMode="numeric"
          autoFocus
          placeholder="0,00"
          value={comissao}
          onChange={(e) => {
            const centavos = parseInt(e.target.value.replace(/\D/g, "") || "0", 10);
            setComissao((centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
          }}
          required
        />
        <span className="text-xs text-ink-soft">Digite com os centavos — ex.: 369800 vira R$ 3.698,00.</span>
      </label>
      <label className="grid gap-1 text-sm">
        <span className="text-ink-soft">Data de celebração do contrato</span>
        <input className="input" type="date" value={data} onChange={(e) => setData(e.target.value)} required />
      </label>
      {erro && <p className="text-rust text-sm">{erro}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-outline" onClick={onFechar} disabled={gerando}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary" disabled={gerando}>
          {gerando ? "Gerando..." : "Gerar contrato"}
        </button>
      </div>
    </form>
  );
}

/** Modal de desconto especial com dupla confirmação.
 * Passo 1: financeiro informa valor e motivo.
 * Passo 2: confirmação explícita antes de salvar. */
function FormularioDesconto({
  proposta,
  onAplicar,
  onFechar,
}: {
  proposta: PropostaDetalhe;
  onAplicar: (p: PropostaDetalhe, valor: number, motivo: string) => Promise<void>;
  onFechar: () => void;
}) {
  const [passo, setPasso] = useState<1 | 2>(1);
  const [valorStr, setValorStr] = useState("");
  const [motivo, setMotivo] = useState("");
  const [aplicando, setAplicando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const valorNum = Number(valorStr.replace(/\./g, "").replace(",", "."));
  const valorValido = valorStr.trim() !== "" && !Number.isNaN(valorNum) && valorNum > 0;

  const valorFinal =
    valorValido
      ? (proposta.valor_proposto ?? 0) - valorNum
      : null;

  async function confirmar() {
    if (!valorValido) return;
    setErro(null);
    setAplicando(true);
    try {
      await onAplicar(proposta, valorNum, motivo);
      onFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setPasso(1);
    } finally {
      setAplicando(false);
    }
  }

  return (
    <div className="p-6 sm:p-8 grid gap-4">
      <div>
        <h2 id="financeiro-desconto-title" className="text-lg font-bold text-ink">
          Desconto especial
        </h2>
        <p className="text-xs text-ink-soft mt-1">
          {proposta.cliente?.nome ?? "Cliente"} — lote {proposta.lote?.identificador ?? "—"} ·{" "}
          valor original {formatMoney(proposta.valor_proposto)}.
        </p>
      </div>

      {passo === 1 && (
        <>
          <label className="grid gap-1 text-sm">
            <span className="text-ink-soft">Valor do desconto (R$)</span>
            <input
              className="input"
              type="number"
              step="0.01"
              min="0.01"
              inputMode="decimal"
              autoFocus
              value={valorStr}
              onChange={(e) => setValorStr(e.target.value)}
            />
          </label>
          {valorValido && valorFinal !== null && (
            <p className="text-sm text-ink">
              Novo valor do contrato:{" "}
              <strong>{formatMoney(valorFinal)}</strong>
            </p>
          )}
          <label className="grid gap-1 text-sm">
            <span className="text-ink-soft">Motivo (opcional)</span>
            <input
              className="input"
              type="text"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="ex.: negociação direta com cliente"
            />
          </label>
          {erro && <p className="text-rust text-sm">{erro}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-outline" onClick={onFechar}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!valorValido}
              onClick={() => { setErro(null); setPasso(2); }}
            >
              Continuar
            </button>
          </div>
        </>
      )}

      {passo === 2 && (
        <>
          <div className="rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 p-4 text-sm grid gap-1">
            <p className="font-semibold text-amber-800 dark:text-amber-300">Confirme o desconto especial</p>
            <p>
              Desconto de <strong>{formatMoney(valorNum)}</strong> no contrato de{" "}
              <strong>{proposta.cliente?.nome ?? "—"}</strong> — lote{" "}
              <strong>{proposta.lote?.identificador ?? "—"}</strong>.
            </p>
            <p>
              Novo valor do contrato: <strong>{formatMoney((proposta.valor_proposto ?? 0) - valorNum)}</strong>.
            </p>
            {motivo && <p className="text-ink-soft">Motivo: {motivo}</p>}
            <p className="text-amber-700 dark:text-amber-400 mt-1 text-xs">
              Esta ação fica registrada com seu nome e não pode ser desfeita pelo sistema.
            </p>
          </div>
          {erro && <p className="text-rust text-sm">{erro}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-outline" onClick={() => setPasso(1)} disabled={aplicando}>
              Voltar
            </button>
            <button type="button" className="btn btn-primary" onClick={confirmar} disabled={aplicando}>
              {aplicando ? "Aplicando..." : "Confirmar desconto"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import Modal from "../../components/Modal";
import { api, formatMoney, formatarNumeroProposta } from "../../lib/api";
import PropostaDocumentos, { PrazoAnaliseBadge } from "./PropostaDocumentos";
import type { PropostaDetalhe, PropostaStatus } from "../../types";

// Uma proposta sai da fila do financeiro assim que alguém decide algo sobre
// ela — aprovada/enviada/aceita seguiram em frente, recusada/cancelada não
// vão a lugar nenhum. Só "rascunho" e "aguardando_aprovacao" ainda dependem
// de uma decisão daqui.
const STATUS_DECIDIDOS: PropostaStatus[] = ["aprovada", "enviada", "aceita", "recusada", "cancelada"];

/** Aba exclusiva do financeiro (admin/developer — ver RequireAuth adminOnly
 * em main.tsx e temAcessoAdmin em PainelLayout.tsx): só as propostas que já
 * têm todos os documentos obrigatórios anexados (documentos_completos_em
 * preenchido, ver PropostaDocumentos.tsx/migration 0021) e que ainda não
 * foram decididas entram aqui — é a fila real de "pronto pra analisar",
 * sem misturar com rascunho incompleto ou proposta já resolvida. */
export default function PainelFinanceiro() {
  const [propostas, setPropostas] = useState<PropostaDetalhe[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aprovandoId, setAprovandoId] = useState<string | null>(null);
  const [verDocumentosDe, setVerDocumentosDe] = useState<string | null>(null);
  const [reciboDe, setReciboDe] = useState<PropostaDetalhe | null>(null);

  function recarregar() {
    setErro(null);
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

  async function aprovar(p: PropostaDetalhe) {
    if (!confirm(`Aprovar a proposta ${formatarNumeroProposta(p.numero, p.versao)}?`)) return;
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
    const nomeArquivo = `recibo-${p.lote?.identificador ?? p.id}.docx`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = nomeArquivo;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-xl font-bold text-ink">Financeiro</h1>
        <p className="text-xs text-ink-soft mt-1">
          Propostas com todos os documentos obrigatórios já anexados, aguardando decisão. Assim que aprovada (ou
          recusada na aba Propostas), sai desta fila.
        </p>
      </div>

      {erro && <p className="text-rust text-sm">{erro}</p>}

      {!propostas ? (
        <p className="text-ink-soft text-sm">Carregando...</p>
      ) : filaAnalise.length === 0 ? (
        <p className="text-ink-soft text-sm">Nenhuma proposta completa aguardando análise no momento.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="border-b border-border text-left text-ink-soft text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Nº</th>
                <th className="px-4 py-3 font-medium">Lote</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Valor proposto</th>
                <th className="px-4 py-3 font-medium">Documentos</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {filaAnalise.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-surface-alt/60">
                  <td className="px-4 py-3 text-ink-soft whitespace-nowrap font-mono text-xs">
                    {formatarNumeroProposta(p.numero, p.versao)}
                  </td>
                  <td className="px-4 py-3 text-ink">{p.lote ? p.lote.identificador : "—"}</td>
                  <td className="px-4 py-3 text-ink">{p.cliente?.nome ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-soft">{formatMoney(p.valor_proposto)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <button className="btn-row btn-row-neutral" onClick={() => setVerDocumentosDe(p.id)}>
                      ver documentos
                    </button>
                    <PrazoAnaliseBadge completosEm={p.documentos_completos_em} />
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      className="btn-row btn-row-primary mr-1.5"
                      disabled={aprovandoId === p.id}
                      onClick={() => aprovar(p)}
                    >
                      {aprovandoId === p.id ? "aprovando..." : "aprovar"}
                    </button>
                    <button className="btn-row btn-row-neutral mr-1.5" onClick={() => setReciboDe(p)}>
                      gerar recibo
                    </button>
                    <button
                      className="btn-row btn-row-neutral opacity-60 cursor-not-allowed"
                      disabled
                      title="Em breve — assim que o modelo de contrato for enviado, esse botão gera o contrato já preenchido com os dados da proposta."
                    >
                      gerar contrato
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {verDocumentosDe &&
        (() => {
          const proposta = propostas?.find((p) => p.id === verDocumentosDe);
          // A proposta pode ter sumido da fila entre um recarregar() e outro
          // (ex.: aprovada em outra aba) — nesse caso só não reabre o modal.
          if (!proposta) return null;
          return (
            <Modal onClose={() => setVerDocumentosDe(null)} labelledBy="financeiro-documentos-title">
              <div className="p-6 sm:p-8">
                <PropostaDocumentos proposta={proposta} onAtualizado={recarregar} />
              </div>
            </Modal>
          );
        })()}

      {reciboDe && (
        <Modal onClose={() => setReciboDe(null)} labelledBy="financeiro-recibo-title">
          <FormularioRecibo proposta={reciboDe} onGerar={gerarRecibo} onFechar={() => setReciboDe(null)} />
        </Modal>
      )}
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
          {proposta.cliente?.nome ?? "Cliente"} — lote {proposta.lote?.identificador ?? "—"}. O recibo sai já
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

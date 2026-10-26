import { useEffect, useState } from "react";
import Modal from "../../components/Modal";
import { abrirAbaComCarregamento, api, formatDateTime, formatMoney, formatarNumeroProposta, horasRestantes, mostrarErroNaAba, mostrarPdfNaAba } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import PropostaFormularioCompleto, { chaveRascunhoProposta, dadosParaEdicao } from "./PropostaFormularioCompleto";
import PropostaDadosLeitura from "./PropostaDadosLeitura";
import { lerRascunho, quandoFoiSalvo, salvarRascunho } from "../../lib/rascunho";
import type { RascunhoProposta } from "./PropostaFormularioCompleto";
import PropostaDocumentos, { PrazoAnaliseBadge } from "./PropostaDocumentos";
import { temAcessoAdmin } from "../../types";
import type { PropostaDetalhe as PropostaLista } from "../../types";
import { proximosStatusProposta } from "../../lib/transicoes";
import type { LoteComCondominio, PropostaDetalhe, PropostaStatus } from "../../types";

const STATUS_LABEL: Record<PropostaStatus, string> = {
  rascunho: "Rascunho",
  aguardando_aprovacao: "Aguardando aprovação",
  aprovada: "Aprovada",
  enviada: "Enviada",
  aceita: "Aceita",
  recusada: "Recusada",
  cancelada: "Cancelada",
};

// Corretor gera o PDF assim que preenche a proposta (10/10) -- só não gera
// de proposta cancelada/recusada (ver _montar_pdf_proposta no backend).
const STATUS_LIBERA_PDF: PropostaStatus[] = ["rascunho", "aguardando_aprovacao", "aprovada", "enviada", "aceita"];

export default function PainelPropostas() {
  const { perfil } = useAuth();
  const [propostas, setPropostas] = useState<PropostaDetalhe[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState<false | "nova" | "retomar">(false);
  // Proposta que ficou pela metade (sessão caiu, janela fechou...) — 08/10.
  const rascunho = criando ? null : lerRascunho<RascunhoProposta>(chaveRascunhoProposta());
  const [lotes, setLotes] = useState<LoteComCondominio[]>([]);
  const [verDocumentosDe, setVerDocumentosDe] = useState<string | null>(null);
  const [verDadosDe, setVerDadosDe] = useState<string | null>(null);

  /** Refazer uma proposta cancelada/expirada (26/10): os dados preenchidos
   * voltam num rascunho novo, com o mesmo cliente e o mesmo lote se ele
   * ainda estiver disponível — é só conferir, confirmar e anexar de novo. */
  function refazer(p: PropostaLista) {
    if (rascunho && !confirm("Já existe uma proposta em andamento salva neste navegador. Substituir pelos dados desta proposta?")) return;
    const lote = lotes.find((l) => l.id === p.lote_id);
    const loteLivre = lote && lote.status === "disponivel";
    salvarRascunho<RascunhoProposta>(chaveRascunhoProposta(), {
      dados: dadosParaEdicao(p),
      loteId: loteLivre ? p.lote_id : "",
      condominioSlug: loteLivre ? lote.condominio_slug : "",
      passo: 0,
      clienteIdCriado: p.cliente_id,
    });
    if (!loteLivre) alert("O lote desta proposta não está mais disponível — escolha outro lote na primeira etapa. Os demais dados já vêm preenchidos.");
    setCriando("retomar");
  }

  function recarregar() {
    setErro(null);
    api.listarPropostas().then(setPropostas).catch((e) => setErro(e.message));
  }

  useEffect(() => {
    recarregar();
    api.listarTodosLotes().then(setLotes).catch(() => {});
  }, []);

  async function mudarStatus(p: PropostaDetalhe, status: PropostaStatus) {
    try {
      await api.atualizarStatusProposta(p.id, status);
      recarregar();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  const [gerandoPdf, setGerandoPdf] = useState<string | null>(null);

  async function abrirPdf(p: PropostaDetalhe) {
    // A aba precisa abrir *na hora do clique* (síncrono) — se esperarmos o
    // fetch do PDF terminar pra só então chamar window.open, o navegador não
    // reconhece mais como resultado direto de um gesto do usuário e bloqueia
    // a aba silenciosamente (sem erro nenhum: parecia que o botão "não fazia
    // nada"). Mesmo padrão já usado em PainelVisaoGeral.tsx/PainelDisponibilidade.tsx.
    const aba = abrirAbaComCarregamento("Gerando PDF da proposta...");
    setGerandoPdf(p.id);
    try {
      const blob = await api.gerarPdfProposta(p.id);
      const nomeArquivo = `proposta-${p.lote?.identificador ?? p.id}.pdf`;
      if (aba) {
        mostrarPdfNaAba(aba, blob, nomeArquivo, `Proposta — ${p.lote?.identificador ?? ""}`);
      } else {
        // Mesmo a abertura em branco pode ser bloqueada (config restritiva do
        // navegador) — nesse caso, baixa o arquivo direto em vez de silenciar.
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = nomeArquivo;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : String(e);
      mostrarErroNaAba(aba, mensagem);
      alert(mensagem);
    } finally {
      setGerandoPdf(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3">
        <h1 className="text-xl font-bold text-ink">Propostas de compra e venda</h1>
        <button className="btn btn-primary" onClick={() => setCriando("nova")}>
          + Nova proposta
        </button>
      </div>

      {rascunho && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-ink">
          <span>
            <strong>Proposta em andamento</strong>
            {rascunho.dados.dados?.proponente?.nome ? ` de ${rascunho.dados.dados.proponente.nome}` : ""} — salva em{" "}
            {quandoFoiSalvo(rascunho.salvoEm)}, na etapa {(rascunho.dados.passo ?? 0) + 1} de 8.
          </span>
          <button id="continuar-rascunho-proposta" className="btn btn-primary !py-1.5 !px-4 !text-sm" onClick={() => setCriando("retomar")}>
            Continuar de onde parei
          </button>
        </div>
      )}

      {erro && <p className="text-rust text-sm mb-4">{erro}</p>}

      {!propostas ? (
        <p className="text-ink-soft text-sm">Carregando...</p>
      ) : propostas.length === 0 ? (
        <p className="text-ink-soft text-sm">Nenhuma proposta ainda.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-border text-left text-ink-soft text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Nº</th>
                <th className="px-4 py-3 font-medium">Lote</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Valor proposto</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Documentos</th>
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
                    <AvisoPrazo proposta={p} />
                    <div className="sm:hidden mt-1.5 flex flex-wrap gap-1.5">
                      <button className="btn-row btn-row-neutral" onClick={() => setVerDadosDe(p.id)}>ver dados</button>
                      {(p.status === "cancelada" || p.status === "recusada") && (
                        <button className="btn-row btn-row-primary" onClick={() => refazer(p)}>refazer proposta</button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink">{p.cliente?.nome ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-soft">{formatMoney(p.valor_proposto)}</td>
                  <td className="px-4 py-3">
                    <select
                      className="input !py-1.5 !text-xs w-auto"
                      value={p.status}
                      onChange={(e) => mudarStatus(p, e.target.value as PropostaStatus)}
                    >
                      {[p.status, ...proximosStatusProposta(p.status, temAcessoAdmin(perfil?.papel))].map((v) => (
                        <option key={v} value={v}>
                          {STATUS_LABEL[v]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <button className="btn-row btn-row-neutral" onClick={() => setVerDocumentosDe(p.id)}>
                      {p.documentos.length > 0 ? `${p.documentos.length} anexo(s)` : "anexar"}
                    </button>
                    <PrazoAnaliseBadge completosEm={p.documentos_completos_em} />
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button className="btn-row btn-row-neutral mr-2" onClick={() => setVerDadosDe(p.id)}>
                      ver dados
                    </button>
                    {(p.status === "cancelada" || p.status === "recusada") && (
                      <button className="btn-row btn-row-neutral mr-2" onClick={() => refazer(p)}>
                        refazer proposta
                      </button>
                    )}
                    <button
                      className="btn-row btn-row-primary"
                      disabled={gerandoPdf === p.id || !p.lote || !p.cliente || !STATUS_LIBERA_PDF.includes(p.status)}
                      title={
                        !p.lote || !p.cliente
                          ? "Proposta sem lote ou cliente vinculado"
                          : !STATUS_LIBERA_PDF.includes(p.status)
                            ? "Proposta cancelada ou recusada"
                            : undefined
                      }
                      onClick={() => abrirPdf(p)}
                    >
                      {gerandoPdf === p.id ? "Gerando..." : "gerar PDF"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {criando && (
        <Modal onClose={() => setCriando(false)} labelledBy="proposta-modal-title">
          <PropostaFormularioCompleto
            lotes={lotes}
            retomarRascunho={criando === "retomar"}
            onSalvo={() => {
              setCriando(false);
              recarregar();
            }}
          />
        </Modal>
      )}

      {verDadosDe &&
        (() => {
          const proposta = propostas?.find((p) => p.id === verDadosDe);
          if (!proposta) return null;
          return (
            <Modal onClose={() => setVerDadosDe(null)} labelledBy="proposta-dados-title">
              <div className="p-6 sm:p-8">
                <PropostaDadosLeitura proposta={proposta} />
              </div>
            </Modal>
          );
        })()}

      {verDocumentosDe &&
        (() => {
          const proposta = propostas?.find((p) => p.id === verDocumentosDe);
          // A proposta pode ter sumido da lista entre um recarregar() e
          // outro (ex.: excluída em outra aba) — nesse caso simplesmente
          // não reabre o modal, em vez de quebrar renderizando undefined.
          if (!proposta) return null;
          return (
            <Modal onClose={() => setVerDocumentosDe(null)} labelledBy="proposta-documentos-title">
              <div className="p-6 sm:p-8">
                <PropostaDocumentos proposta={proposta} onAtualizado={recarregar} />
              </div>
            </Modal>
          );
        })()}
    </div>
  );
}

/** Prazo do rascunho e aviso de expiração (26/10). Fica debaixo do lote pra
 * aparecer também no celular, sem precisar rolar a tabela pro lado. */
function AvisoPrazo({ proposta }: { proposta: PropostaLista }) {
  if (proposta.status === "cancelada" && proposta.expirou_em) {
    return (
      <span className="mt-1 block text-[11px] font-semibold text-rust bg-rust/10 rounded-sm px-2 py-0.5 whitespace-normal">
        Expirou em {formatDateTime(proposta.expirou_em)}: a reserva venceu sem os documentos
      </span>
    );
  }
  if (proposta.status === "cancelada" || proposta.status === "recusada") {
    return (
      <span className="mt-1 block text-[11px] font-semibold text-rust">
        {proposta.status === "cancelada" ? "Cancelada" : "Recusada"}
      </span>
    );
  }
  if (proposta.status === "rascunho" && proposta.reserva_expira_em) {
    const h = horasRestantes(proposta.reserva_expira_em);
    if (h === null) return null;
    const critico = h <= 12;
    return (
      <span
        className={`mt-1 block text-[11px] font-semibold rounded-sm px-2 py-0.5 whitespace-normal ${
          critico ? "bg-rust/10 text-rust" : "bg-ochre/10 text-ochre"
        }`}
      >
        {h <= 0 ? "Prazo vencido" : `Expira em ${h < 1 ? `${Math.round(h * 60)}min` : `${Math.round(h)}h`}`}: anexe os documentos
      </span>
    );
  }
  return null;
}

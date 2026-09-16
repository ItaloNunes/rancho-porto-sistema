import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { LoteComCondominio, LoteStatus } from "../../types";
import Modal from "../../components/Modal";

const STATUS_LABEL: Record<LoteStatus, string> = {
  disponivel: "Disponível",
  reservado: "Reservado",
  vendido: "Vendido",
};

// Mesma paleta usada na Disponibilidade — linha inteira tingida pela cor do
// status, pra dar de relance a mesma leitura visual em todo o painel.
// Opacidade mais alta que o normal (15/22 em vez de 10/15): num relance
// rápido de cima pra baixo na tabela, um tingimento muito sutil acaba
// parecendo "sem cor nenhuma" — pedido explícito pra ficar claramente visível.
const LINHA_COR: Record<LoteStatus, string> = {
  disponivel: "bg-sage/15 hover:bg-sage/20",
  reservado: "bg-ochre/15 hover:bg-ochre/20",
  vendido: "bg-rust/15 hover:bg-rust/20",
};

// Pontinho da legenda — precisa ser texto literal em algum lugar do arquivo
// (ver mesmo comentário em PainelDisponibilidade) pro Tailwind gerar a classe.
const PONTO_COR: Record<LoteStatus, string> = {
  disponivel: "bg-sage",
  reservado: "bg-ochre",
  vendido: "bg-rust",
};

// O próprio select de status também carrega a cor do valor atual — assim dá
// pra ver o status sem precisar abrir o menu. Fundo preenchido + borda sólida
// na cor cheia (não só um traço fino a 40% — isso passava despercebido) pra
// funcionar como um "selo" colorido, do mesmo jeito que os badges do resto
// do painel (ver .badge-disponivel/.badge-reservado/.badge-vendido).
const SELECT_COR: Record<LoteStatus, string> = {
  disponivel: "!bg-sage/15 !border-sage !text-sage",
  reservado: "!bg-ochre/15 !border-ochre !text-ochre",
  vendido: "!bg-rust/15 !border-rust !text-rust",
};

// Texto de cada modal de confirmação, por status de destino — toda troca de
// status passa por uma confirmação (pedido explícito: evita mudar o estoque
// sem querer com um clique errado no select). "Vendido" é tratado como a
// mais importante das três (fecha uma venda de verdade), por isso o botão
// vem destacado em vermelho — mas segue sendo confirmação única, não o
// desbloqueio em 3 passos (esse continua só pra *desfazer* uma venda já
// registrada, ver `desbloqueio` abaixo).
const CONFIRMACAO: Record<LoteStatus, { titulo: string; aviso: string | null; botao: string; botaoClasse: string }> = {
  disponivel: {
    titulo: "Confirmar liberação do lote",
    aviso: "Isso libera o lote da reserva atual — ele volta a aparecer como disponível pra qualquer corretor.",
    botao: "Sim, liberar este lote",
    botaoClasse: "btn-primary",
  },
  reservado: {
    titulo: "Confirmar reserva",
    aviso: null,
    botao: "Sim, reservar este lote",
    botaoClasse: "btn-primary",
  },
  vendido: {
    titulo: "Confirmar venda",
    aviso: "Só marque como Vendido depois que a venda estiver de fato concluída (contrato assinado) — isso fecha o lote pro estoque.",
    botao: "Sim, marcar como vendido",
    botaoClasse: "btn-primary !bg-rust hover:!bg-rust/90",
  },
};

export default function PainelLotes() {
  const [lotes, setLotes] = useState<LoteComCondominio[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  // Toda troca de status passa por uma confirmação antes de aplicar.
  // `pendente` guarda a troca esperando confirmação; `salvandoId` é o lote
  // com a troca em andamento (select trava e mostra "Salvando..." até o
  // backend confirmar, pra não parecer que já mudou antes de mudar de
  // verdade no estoque).
  const [pendente, setPendente] = useState<{ lote: LoteComCondominio; novoStatus: LoteStatus } | null>(null);
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  // Lote já VENDIDO é o estado mais "definitivo" da tabela — mudar ele pra
  // qualquer outro status desfaz o registro de uma venda concluída. Por
  // isso passa por uma verificação em 3 passos (não só a confirmação única
  // acima): 1) aviso explícito, 2) digitar o identificador do lote de
  // volta, 3) marcar que está ciente + botão final. `passo` avança só
  // depois de cada etapa realmente cumprida.
  const [desbloqueio, setDesbloqueio] = useState<{
    lote: LoteComCondominio;
    novoStatus: LoteStatus;
    passo: 1 | 2 | 3;
    digitado: string;
    ciente: boolean;
  } | null>(null);

  function recarregar() {
    setErro(null);
    api.listarTodosLotes().then(setLotes).catch((e) => setErro(e.message));
  }

  useEffect(recarregar, []);

  async function mudarStatus(l: LoteComCondominio, status: LoteStatus) {
    setSalvandoId(l.id);
    try {
      await api.atualizarStatusLote(l.id, status);
      recarregar();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvandoId(null);
    }
  }

  function selecionarStatus(l: LoteComCondominio, status: LoteStatus) {
    if (status === l.status) return;
    if (l.status === "vendido") {
      setDesbloqueio({ lote: l, novoStatus: status, passo: 1, digitado: "", ciente: false });
      return;
    }
    setPendente({ lote: l, novoStatus: status });
  }

  const filtrados = (lotes ?? []).filter(
    (l) => !busca.trim() || l.identificador.toLowerCase().includes(busca.trim().toLowerCase()),
  );

  const contagem = useMemo(() => {
    const base = { disponivel: 0, reservado: 0, vendido: 0 };
    for (const l of lotes ?? []) base[l.status]++;
    return base;
  }, [lotes]);

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-ink">Lotes</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {(["disponivel", "reservado", "vendido"] as const).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
                <span className={`h-2.5 w-2.5 rounded-full ${PONTO_COR[s]}`} />
                {STATUS_LABEL[s]} ({contagem[s]})
              </span>
            ))}
          </div>
          <input
            className="input sm:w-64"
            placeholder="Buscar lote..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      {erro && <p className="text-rust text-sm mb-4">{erro}</p>}

      {!lotes ? (
        <p className="text-ink-soft text-sm">Carregando...</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-border text-left text-ink-soft text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Empreendimento</th>
                <th className="px-4 py-3 font-medium">Lote</th>
                <th className="px-4 py-3 font-medium">Tamanho</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((l) => (
                <tr key={l.id} className={`border-b border-border last:border-0 transition-colors ${LINHA_COR[l.status]}`}>
                  <td className="px-4 py-3 text-ink-soft">{l.condominio_nome}</td>
                  <td className="px-4 py-3 font-medium text-ink">{l.identificador}</td>
                  <td className="px-4 py-3 text-ink-soft">{l.tamanho_m2.toLocaleString("pt-BR")} m²</td>
                  <td className="px-4 py-3">
                    {salvandoId === l.id ? (
                      <span className="inline-flex items-center gap-2 text-xs text-ink-soft">
                        <span
                          className="h-3.5 w-3.5 rounded-full border-2 border-border border-t-primary animate-spin"
                          aria-hidden="true"
                        />
                        Salvando...
                      </span>
                    ) : (
                      <select
                        className={`input !py-1.5 !text-xs !font-semibold w-auto bg-surface ${SELECT_COR[l.status]}`}
                        value={l.status}
                        disabled={salvandoId !== null}
                        onChange={(e) => selecionarStatus(l, e.target.value as LoteStatus)}
                      >
                        {Object.entries(STATUS_LABEL).map(([v, label]) => (
                          <option key={v} value={v} className="text-ink font-normal">
                            {label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pendente && (
        <Modal onClose={() => setPendente(null)} labelledBy="confirmar-status-titulo">
          <div className="p-6">
            <h2 id="confirmar-status-titulo" className="text-lg font-bold text-ink mb-2">
              {CONFIRMACAO[pendente.novoStatus].titulo}
            </h2>
            <p className="text-sm text-ink-soft mb-1">
              Você está prestes a marcar o lote abaixo como{" "}
              <span className="font-semibold text-ink">{STATUS_LABEL[pendente.novoStatus]}</span>:
            </p>
            <p className="text-sm text-ink mb-3">
              <span className="font-semibold">{pendente.lote.identificador}</span>{" "}
              <span className="text-ink-soft">— {pendente.lote.condominio_nome}</span>
              <br />
              <span className="text-ink-soft">Status atual: {STATUS_LABEL[pendente.lote.status]}</span>
            </p>
            {CONFIRMACAO[pendente.novoStatus].aviso && (
              <p className="text-sm text-ink-soft mb-5">{CONFIRMACAO[pendente.novoStatus].aviso}</p>
            )}
            <div className="flex justify-end gap-2 mt-2">
              <button className="btn btn-outline !text-xs !py-2" onClick={() => setPendente(null)}>
                Cancelar
              </button>
              <button
                className={`btn !text-xs !py-2 ${CONFIRMACAO[pendente.novoStatus].botaoClasse}`}
                onClick={() => {
                  mudarStatus(pendente.lote, pendente.novoStatus);
                  setPendente(null);
                }}
              >
                {CONFIRMACAO[pendente.novoStatus].botao}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {desbloqueio && (
        <Modal onClose={() => setDesbloqueio(null)} labelledBy="desbloquear-vendido-titulo">
          <div className="p-6">
            <h2 id="desbloquear-vendido-titulo" className="text-lg font-bold text-rust mb-2">
              Esse lote está marcado como Vendido
            </h2>
            <p className="text-sm text-ink mb-4">
              <span className="font-semibold">{desbloqueio.lote.identificador}</span>{" "}
              <span className="text-ink-soft">— {desbloqueio.lote.condominio_nome}</span>
            </p>

            {desbloqueio.passo === 1 && (
              <>
                <p className="text-sm text-ink-soft mb-5">
                  Mudar o status agora desfaz o registro de uma venda concluída. Isso pode afetar contrato,
                  comissão e o que já foi informado ao cliente. Só continue se tiver certeza de que a venda
                  não é mais válida.
                </p>
                <div className="flex justify-end gap-2">
                  <button className="btn btn-outline !text-xs !py-2" onClick={() => setDesbloqueio(null)}>
                    Cancelar
                  </button>
                  <button
                    className="btn btn-outline !text-xs !py-2 !border-rust !text-rust"
                    onClick={() => setDesbloqueio({ ...desbloqueio, passo: 2 })}
                  >
                    Entendi, continuar
                  </button>
                </div>
              </>
            )}

            {desbloqueio.passo === 2 && (
              <>
                <p className="text-sm text-ink-soft mb-2">
                  Pra confirmar, digite o identificador do lote exatamente como aparece na lista:
                </p>
                <p className="text-sm font-semibold text-ink mb-3">{desbloqueio.lote.identificador}</p>
                <input
                  autoFocus
                  className="input mb-5"
                  placeholder="Digite o identificador do lote"
                  value={desbloqueio.digitado}
                  onChange={(e) => setDesbloqueio({ ...desbloqueio, digitado: e.target.value })}
                />
                <div className="flex justify-end gap-2">
                  <button className="btn btn-outline !text-xs !py-2" onClick={() => setDesbloqueio(null)}>
                    Cancelar
                  </button>
                  <button
                    className="btn btn-outline !text-xs !py-2 !border-rust !text-rust disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={desbloqueio.digitado.trim().toLowerCase() !== desbloqueio.lote.identificador.trim().toLowerCase()}
                    onClick={() => setDesbloqueio({ ...desbloqueio, passo: 3 })}
                  >
                    Continuar
                  </button>
                </div>
              </>
            )}

            {desbloqueio.passo === 3 && (
              <>
                <p className="text-sm text-ink-soft mb-4">
                  Última confirmação: o status vai mudar de <span className="font-semibold text-ink">Vendido</span>{" "}
                  para <span className="font-semibold text-ink">{STATUS_LABEL[desbloqueio.novoStatus]}</span>.
                </p>
                <label className="flex items-start gap-2 text-sm text-ink mb-5 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={desbloqueio.ciente}
                    onChange={(e) => setDesbloqueio({ ...desbloqueio, ciente: e.target.checked })}
                  />
                  Estou ciente e quero desfazer essa venda mesmo assim.
                </label>
                <div className="flex justify-end gap-2">
                  <button className="btn btn-outline !text-xs !py-2" onClick={() => setDesbloqueio(null)}>
                    Cancelar
                  </button>
                  <button
                    className="btn btn-primary !text-xs !py-2 !bg-rust disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={!desbloqueio.ciente}
                    onClick={() => {
                      mudarStatus(desbloqueio.lote, desbloqueio.novoStatus);
                      setDesbloqueio(null);
                    }}
                  >
                    Sim, mudar mesmo assim
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

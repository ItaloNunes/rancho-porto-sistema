import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Modal from "../../components/Modal";
import { api, horasRestantes } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { LoteComCondominio, Reserva, ReservaComLote, ReservaStatus } from "../../types";

const STATUS_LABEL: Record<ReservaStatus, string> = {
  pendente: "Pendente",
  em_atendimento: "Em atendimento",
  aguardando_qualificacao: "Aguardando cliente",
  em_analise_financeira: "Análise financeira",
  confirmada: "Confirmada",
  cancelada: "Cancelada",
};

// Trocar o status de um pedido mexe de verdade no estoque (ver
// atualizar_status_reserva no backend): confirmar trava o lote com este
// cliente, cancelar libera ele na hora pra qualquer corretor reservar de
// novo. As trocas "de passagem" (pendente/em atendimento/aguardando
// cliente/análise financeira) só pedem uma confirmação simples; as duas
// consequentes — confirmar, cancelar, ou desfazer uma reserva que já
// estava confirmada — pedem uma segunda camada: digitar uma palavra antes
// de valer, no mesmo espírito da trava de "Vendido" na tela de Lotes.
type TrocaCritica = "confirmar" | "cancelar" | "desfazer_confirmacao";

const CRITICO_INFO: Record<
  TrocaCritica,
  { titulo: string; aviso: string; palavra: string; botao: string; botaoClasse: string }
> = {
  confirmar: {
    titulo: "Confirmar esta reserva",
    aviso:
      "Confirmar trava o lote de vez com este cliente — tem o mesmo peso de fechar a venda. Só confirme depois que o negócio estiver realmente certo.",
    palavra: "CONFIRMAR",
    botao: "Sim, confirmar esta reserva",
    botaoClasse: "btn-primary",
  },
  cancelar: {
    titulo: "Cancelar este pedido",
    aviso:
      "Cancelar libera o lote imediatamente de volta pra disponibilidade — qualquer corretor pode reservá-lo de novo a partir de agora.",
    palavra: "CANCELAR",
    botao: "Sim, cancelar este pedido",
    botaoClasse: "btn-primary !bg-rust hover:!bg-rust/90",
  },
  desfazer_confirmacao: {
    titulo: "Desfazer uma reserva já confirmada",
    aviso:
      "Este pedido já está confirmado. Mudar o status agora desfaz essa confirmação — pode afetar um contrato ou comissão já combinados com o cliente.",
    palavra: "DESFAZER",
    botao: "Sim, desfazer mesmo assim",
    botaoClasse: "btn-primary !bg-rust hover:!bg-rust/90",
  },
};

export default function PainelReservas() {
  const { perfil } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [reservas, setReservas] = useState<ReservaComLote[] | null>(null);
  const [lotes, setLotes] = useState<LoteComCondominio[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<ReservaComLote | "novo" | null>(null);
  // Quando a tela de Lotes manda reservar um lote específico, ela navega pra
  // cá já passando o id dele — abre o "Novo pedido" sozinho, sem a pessoa
  // precisar procurar o lote de novo no combobox.
  const [loteIdPreSelecionado, setLoteIdPreSelecionado] = useState<string | null>(null);
  // Guarda o id vindo da navegação até a lista de lotes terminar de carregar
  // (ela é buscada à parte, de novo, nesta tela) — só aí abre o formulário,
  // senão o combobox monta antes do lote existir na lista e fica em branco.
  const loteAlvoRef = useRef((location.state as { novoPedidoLoteId?: string } | null)?.novoPedidoLoteId ?? null);
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  // Troca "de passagem" entre os 4 status intermediários — confirmação única.
  const [simples, setSimples] = useState<{ reserva: ReservaComLote; novoStatus: ReservaStatus } | null>(null);
  // Confirmar, cancelar, ou desfazer uma confirmação — trava em 3 passos
  // (aviso → digitar a palavra → checkbox + botão final), igual ao
  // desbloqueio de "Vendido" em PainelLotes.tsx.
  const [critico, setCritico] = useState<{
    reserva: ReservaComLote;
    novoStatus: ReservaStatus;
    tipo: TrocaCritica;
    passo: 1 | 2 | 3;
    digitado: string;
    ciente: boolean;
  } | null>(null);

  function recarregar() {
    setErro(null);
    api.listarReservas().then(setReservas).catch((e) => setErro(e.message));
  }

  useEffect(() => {
    recarregar();
    api.listarTodosLotes().then(setLotes).catch(() => {});
    // Limpa o state da navegação já de cara pra não reabrir o modal sozinho
    // se a pessoa recarregar a página ou voltar/avançar pelo histórico.
    if (loteAlvoRef.current) navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loteAlvoRef.current && lotes.length > 0) {
      setLoteIdPreSelecionado(loteAlvoRef.current);
      setEditando("novo");
      loteAlvoRef.current = null;
    }
  }, [lotes]);

  async function mudarStatus(r: ReservaComLote, status: ReservaStatus) {
    setSalvandoId(r.id);
    try {
      await api.atualizarStatusReserva(r.id, status);
      recarregar();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvandoId(null);
    }
  }

  function selecionarStatus(r: ReservaComLote, status: ReservaStatus) {
    if (status === r.status) return;
    if (r.status === "confirmada") {
      setCritico({ reserva: r, novoStatus: status, tipo: "desfazer_confirmacao", passo: 1, digitado: "", ciente: false });
      return;
    }
    if (status === "confirmada") {
      setCritico({ reserva: r, novoStatus: status, tipo: "confirmar", passo: 1, digitado: "", ciente: false });
      return;
    }
    if (status === "cancelada") {
      setCritico({ reserva: r, novoStatus: status, tipo: "cancelar", passo: 1, digitado: "", ciente: false });
      return;
    }
    setSimples({ reserva: r, novoStatus: status });
  }

  async function excluir(r: ReservaComLote) {
    if (!confirm(`Excluir o pedido do lote "${r.lote?.identificador ?? "—"}"? Isso não pode ser desfeito.`)) return;
    try {
      await api.excluirReserva(r.id);
      recarregar();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Pedidos de reserva</h1>
          <p className="text-xs text-ink-soft mt-1">
            Informe o lote, o nome completo do cliente e (se tiver) o CPF. A reserva já tira o lote da
            disponibilidade pros outros corretores; só um admin confirma se a venda foi mesmo concluída.
          </p>
        </div>
        <button className="btn btn-primary shrink-0" onClick={() => setEditando("novo")}>
          + Novo pedido
        </button>
      </div>

      {erro && <p className="text-rust text-sm mb-4">{erro}</p>}

      {!reservas ? (
        <p className="text-ink-soft text-sm">Carregando...</p>
      ) : reservas.length === 0 ? (
        <p className="text-ink-soft text-sm">Nenhum pedido de reserva no momento.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="border-b border-border text-left text-ink-soft text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Lote</th>
                <th className="px-4 py-3 font-medium">Interessado</th>
                <th className="px-4 py-3 font-medium">Contato</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {reservas.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface-alt/60">
                  <td className="px-4 py-3 text-ink">{r.lote ? r.lote.identificador : "—"}</td>
                  <td className="px-4 py-3 text-ink">{r.nome || "—"}</td>
                  <td className="px-4 py-3 text-ink-soft">{r.contato || "—"}</td>
                  <td className="px-4 py-3">
                    {salvandoId === r.id ? (
                      <span className="inline-flex items-center gap-2 text-xs text-ink-soft">
                        <span
                          className="h-3.5 w-3.5 rounded-full border-2 border-border border-t-primary animate-spin"
                          aria-hidden="true"
                        />
                        Salvando...
                      </span>
                    ) : (
                      <select
                        className="input !py-1.5 !text-xs w-auto"
                        value={r.status}
                        disabled={salvandoId !== null}
                        onChange={(e) => selecionarStatus(r, e.target.value as ReservaStatus)}
                      >
                        {Object.entries(STATUS_LABEL).map(([v, label]) => (
                          <option key={v} value={v} disabled={v === "confirmada" && perfil?.papel !== "admin"}>
                            {label}
                          </option>
                        ))}
                      </select>
                    )}
                    {r.status !== "confirmada" && r.status !== "cancelada" && (
                      <PrazoBadge prazoIso={r.expira_em} rotulo="pra expirar" />
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button className="btn-row btn-row-primary mr-1.5" onClick={() => setEditando(r)}>
                      editar
                    </button>
                    <button className="btn-row btn-row-danger" onClick={() => excluir(r)}>
                      excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <Modal
          onClose={() => {
            setEditando(null);
            setLoteIdPreSelecionado(null);
          }}
          labelledBy="reserva-modal-title"
        >
          <ReservaForm
            reserva={editando === "novo" ? null : editando}
            lotes={lotes}
            loteIdInicial={editando === "novo" ? loteIdPreSelecionado : null}
            onSalvo={() => {
              setEditando(null);
              setLoteIdPreSelecionado(null);
              recarregar();
            }}
          />
        </Modal>
      )}

      {simples && (
        <Modal onClose={() => setSimples(null)} labelledBy="confirmar-status-reserva-titulo">
          <div className="p-6">
            <h2 id="confirmar-status-reserva-titulo" className="text-lg font-bold text-ink mb-2">
              Confirmar mudança de status
            </h2>
            <p className="text-sm text-ink-soft mb-1">
              Você está prestes a mudar o status do pedido abaixo para{" "}
              <span className="font-semibold text-ink">{STATUS_LABEL[simples.novoStatus]}</span>:
            </p>
            <p className="text-sm text-ink mb-5">
              <span className="font-semibold">{simples.reserva.lote ? simples.reserva.lote.identificador : "—"}</span>{" "}
              <span className="text-ink-soft">— {simples.reserva.nome || "sem nome informado"}</span>
              <br />
              <span className="text-ink-soft">Status atual: {STATUS_LABEL[simples.reserva.status]}</span>
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn btn-outline !text-xs !py-2" onClick={() => setSimples(null)}>
                Cancelar
              </button>
              <button
                className="btn btn-primary !text-xs !py-2"
                onClick={() => {
                  mudarStatus(simples.reserva, simples.novoStatus);
                  setSimples(null);
                }}
              >
                Sim, mudar o status
              </button>
            </div>
          </div>
        </Modal>
      )}

      {critico && (
        <Modal onClose={() => setCritico(null)} labelledBy="critico-status-reserva-titulo">
          <div className="p-6">
            <h2 id="critico-status-reserva-titulo" className="text-lg font-bold text-rust mb-2">
              {CRITICO_INFO[critico.tipo].titulo}
            </h2>
            <p className="text-sm text-ink mb-4">
              <span className="font-semibold">{critico.reserva.lote ? critico.reserva.lote.identificador : "—"}</span>{" "}
              <span className="text-ink-soft">— {critico.reserva.nome || "sem nome informado"}</span>
            </p>

            {critico.passo === 1 && (
              <>
                <p className="text-sm text-ink-soft mb-5">{CRITICO_INFO[critico.tipo].aviso}</p>
                <div className="flex justify-end gap-2">
                  <button className="btn btn-outline !text-xs !py-2" onClick={() => setCritico(null)}>
                    Cancelar
                  </button>
                  <button
                    className="btn btn-outline !text-xs !py-2 !border-rust !text-rust"
                    onClick={() => setCritico({ ...critico, passo: 2 })}
                  >
                    Entendi, continuar
                  </button>
                </div>
              </>
            )}

            {critico.passo === 2 && (
              <>
                <p className="text-sm text-ink-soft mb-2">
                  Pra confirmar, digite <span className="font-semibold text-ink">{CRITICO_INFO[critico.tipo].palavra}</span>{" "}
                  abaixo:
                </p>
                <input
                  autoFocus
                  className="input mb-5"
                  placeholder={`Digite ${CRITICO_INFO[critico.tipo].palavra}`}
                  value={critico.digitado}
                  onChange={(e) => setCritico({ ...critico, digitado: e.target.value })}
                />
                <div className="flex justify-end gap-2">
                  <button className="btn btn-outline !text-xs !py-2" onClick={() => setCritico(null)}>
                    Cancelar
                  </button>
                  <button
                    className="btn btn-outline !text-xs !py-2 !border-rust !text-rust disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={critico.digitado.trim().toUpperCase() !== CRITICO_INFO[critico.tipo].palavra}
                    onClick={() => setCritico({ ...critico, passo: 3 })}
                  >
                    Continuar
                  </button>
                </div>
              </>
            )}

            {critico.passo === 3 && (
              <>
                <p className="text-sm text-ink-soft mb-4">
                  Última confirmação: o status vai mudar de{" "}
                  <span className="font-semibold text-ink">{STATUS_LABEL[critico.reserva.status]}</span> para{" "}
                  <span className="font-semibold text-ink">{STATUS_LABEL[critico.novoStatus]}</span>.
                </p>
                <label className="flex items-start gap-2 text-sm text-ink mb-5 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={critico.ciente}
                    onChange={(e) => setCritico({ ...critico, ciente: e.target.checked })}
                  />
                  Estou ciente e quero fazer essa mudança mesmo assim.
                </label>
                <div className="flex justify-end gap-2">
                  <button className="btn btn-outline !text-xs !py-2" onClick={() => setCritico(null)}>
                    Cancelar
                  </button>
                  <button
                    className={`btn !text-xs !py-2 ${CRITICO_INFO[critico.tipo].botaoClasse} disabled:opacity-40 disabled:cursor-not-allowed`}
                    disabled={!critico.ciente}
                    onClick={() => {
                      mudarStatus(critico.reserva, critico.novoStatus);
                      setCritico(null);
                    }}
                  >
                    {CRITICO_INFO[critico.tipo].botao}
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

/** Contador/alerta das 48h de retenção do lote durante a análise financeira —
 * não expira nada sozinho, é só pra o corretor/financeiro perceber e decidir. */
function PrazoBadge({ prazoIso, rotulo = "restantes" }: { prazoIso?: string | null; rotulo?: string }) {
  const horas = horasRestantes(prazoIso);
  if (horas === null) return null;
  const vencido = horas <= 0;
  const critico = horas > 0 && horas <= 3;
  const texto = vencido
    ? "prazo vencido"
    : horas < 1
      ? `${Math.round(horas * 60)}min ${rotulo}`
      : `${Math.round(horas)}h ${rotulo}`;
  return (
    <div
      className={`mt-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-sm inline-block ${
        vencido ? "bg-rust/10 text-rust" : critico ? "bg-ochre/10 text-ochre" : "bg-sage/10 text-sage"
      }`}
    >
      {texto}
    </div>
  );
}

function ReservaForm({
  reserva,
  lotes,
  loteIdInicial,
  onSalvo,
}: {
  reserva: ReservaComLote | null;
  lotes: LoteComCondominio[];
  loteIdInicial?: string | null;
  onSalvo: () => void;
}) {
  const [loteId, setLoteId] = useState(reserva?.lote_id ?? loteIdInicial ?? "");
  const [condominioSlug, setCondominioSlug] = useState(
    () => lotes.find((l) => l.id === loteIdInicial)?.condominio_slug ?? "",
  );
  const [nome, setNome] = useState(reserva?.nome ?? "");
  const [contato, setContato] = useState(reserva?.contato ?? "");
  const [cpf, setCpf] = useState(reserva?.cpf ?? "");
  const [observacao, setObservacao] = useState(reserva?.observacao ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const empreendimentos = useMemo(() => {
    const vistos = new Map<string, string>();
    for (const l of lotes) vistos.set(l.condominio_slug, l.condominio_nome);
    return [...vistos.entries()].map(([slug, nome]) => ({ slug, nome }));
  }, [lotes]);

  const lotesDoEmpreendimento = useMemo(
    () => (condominioSlug ? lotes.filter((l) => l.condominio_slug === condominioSlug) : lotes),
    [lotes, condominioSlug],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reserva && !loteId) {
      setErro("Selecione o lote.");
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const payload = { nome: nome || null, contato: contato || null, cpf: cpf || null, observacao: observacao || null };
      if (reserva) {
        await api.atualizarReserva(reserva.id, payload);
      } else {
        await (api.criarReserva as (p: typeof payload & { lote_id: string }) => Promise<Reserva>)({
          ...payload,
          lote_id: loteId,
        });
      }
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="p-6 sm:p-8 grid gap-3">
      <h2 id="reserva-modal-title" className="text-lg font-bold text-ink mb-1">
        {reserva ? "Editar pedido" : "Novo pedido de reserva"}
      </h2>
      {!reserva && (
        <>
          {empreendimentos.length > 1 && (
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
          )}
          <LoteCombobox key={condominioSlug} lotes={lotesDoEmpreendimento} value={loteId} onChange={setLoteId} />
        </>
      )}
      <input className="input" placeholder="Nome completo do cliente" value={nome ?? ""} onChange={(e) => setNome(e.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <input
          className="input"
          placeholder="Contato (telefone/e-mail)"
          value={contato ?? ""}
          onChange={(e) => setContato(e.target.value)}
        />
        <input className="input" placeholder="CPF (opcional)" value={cpf ?? ""} onChange={(e) => setCpf(e.target.value)} />
      </div>
      <textarea
        className="input"
        placeholder="Observações"
        rows={3}
        value={observacao ?? ""}
        onChange={(e) => setObservacao(e.target.value)}
      />
      {erro && <p className="text-rust text-sm">{erro}</p>}
      <button className="btn btn-primary mt-2" disabled={salvando}>
        {salvando ? "Salvando..." : "Salvar"}
      </button>
    </form>
  );
}

function rotuloLote(l: LoteComCondominio): string {
  return `${l.condominio_nome} — ${l.identificador} (${l.status})`;
}

/** Campo de lote com busca — em vez de rolar um <select> gigante, a pessoa
 * digita (quadra, número, o que aparecer no rótulo) e escolhe da lista
 * filtrada. `key={condominioSlug}` no ponto de uso (ReservaForm) remonta
 * este componente do zero sempre que o filtro de empreendimento muda, então
 * não precisa sincronizar busca/lista aqui. */
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
  // Números soltos (ex.: "4", "04", "004") — compara ignorando zeros à esquerda, já
  // que cada empreendimento numera os lotes com uma quantidade diferente de dígitos
  // (Rancho Texas usa 3, Porto Franco usa 2), então a busca só por texto literal
  // perdia combinações válidas só por causa da formatação do número.
  const termoNumero = termo.replace(/\D/g, "");
  function bate(l: LoteComCondominio): boolean {
    if (rotuloLote(l).toLowerCase().includes(termo)) return true;
    if (!termoNumero) return false;
    const numero = Number(termoNumero);
    return numero === l.lote_numero || (!!l.quadra && numero === Number(l.quadra));
  }

  const encontrados = termo ? lotes.filter(bate) : lotes;
  // Nunca deixa a lista vazia só por causa de uma busca sem match exato — melhor
  // mostrar todos os lotes pra pessoa escolher na mão do que travar numa tela
  // "nenhum lote encontrado" sem saída.
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

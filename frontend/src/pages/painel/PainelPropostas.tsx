import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "../../components/Modal";
import { api, formatMoney } from "../../lib/api";
import { useAuth } from "../../lib/auth";
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

/** Só a partir daqui o PDF em papel timbrado pode ser gerado — ver mesma
 * regra no backend (routers/crm.py: gerar_pdf_proposta). */
const STATUS_LIBERA_PDF: PropostaStatus[] = ["aprovada", "enviada", "aceita"];

export default function PainelPropostas() {
  const { perfil } = useAuth();
  const [propostas, setPropostas] = useState<PropostaDetalhe[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [lotes, setLotes] = useState<LoteComCondominio[]>([]);

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
    setGerandoPdf(p.id);
    try {
      const blob = await api.gerarPdfProposta(p.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setGerandoPdf(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3">
        <h1 className="text-xl font-bold text-ink">Propostas de compra e venda</h1>
        <button className="btn btn-primary" onClick={() => setCriando(true)}>
          + Nova proposta
        </button>
      </div>

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
                <th className="px-4 py-3 font-medium">Lote</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Valor proposto</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {propostas.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-surface-alt/60">
                  <td className="px-4 py-3 text-ink">{p.lote ? p.lote.identificador : "—"}</td>
                  <td className="px-4 py-3 text-ink">{p.cliente?.nome ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-soft">{formatMoney(p.valor_proposto)}</td>
                  <td className="px-4 py-3">
                    <select
                      className="input !py-1.5 !text-xs w-auto"
                      value={p.status}
                      onChange={(e) => mudarStatus(p, e.target.value as PropostaStatus)}
                    >
                      {Object.entries(STATUS_LABEL).map(([v, label]) => (
                        <option key={v} value={v} disabled={v === "aprovada" && perfil?.papel !== "admin"}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      className="text-primary text-xs font-medium hover:underline disabled:opacity-50"
                      disabled={gerandoPdf === p.id || !p.lote || !p.cliente || !STATUS_LIBERA_PDF.includes(p.status)}
                      title={
                        !p.lote || !p.cliente
                          ? "Proposta sem lote ou cliente vinculado"
                          : !STATUS_LIBERA_PDF.includes(p.status)
                            ? "Aguardando aprovação de um administrador"
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
          <PropostaForm
            lotes={lotes}
            onSalvo={() => {
              setCriando(false);
              recarregar();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function PropostaForm({ lotes, onSalvo }: { lotes: LoteComCondominio[]; onSalvo: () => void }) {
  const [loteId, setLoteId] = useState("");
  const [condominioSlug, setCondominioSlug] = useState("");
  const [nomeCliente, setNomeCliente] = useState("");
  const [contatoCliente, setContatoCliente] = useState("");
  const [cpfCliente, setCpfCliente] = useState("");
  const [valor, setValor] = useState("");
  const [condicoes, setCondicoes] = useState("");
  const [observacoes, setObservacoes] = useState("");
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
    if (!loteId || !nomeCliente.trim() || !valor) {
      setErro("Selecione o lote, informe o nome do cliente e o valor proposto.");
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      // Não existe mais um cadastro prévio de cliente no painel — o registro
      // em "clientes" é criado aqui na hora, só pra satisfazer o vínculo que
      // a proposta precisa (mesma lógica de captar nome/CPF direto que a
      // reserva usa, ver PainelReservas.tsx).
      const cliente = await api.criarCliente({
        nome: nomeCliente.trim(),
        telefone: contatoCliente || null,
        cpf: cpfCliente || null,
      });
      await api.criarProposta({
        lote_id: loteId,
        cliente_id: cliente.id,
        valor_proposto: Number(valor),
        condicoes_pagamento: condicoes || null,
        observacoes: observacoes || null,
      });
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="p-6 sm:p-8 grid gap-3">
      <h2 id="proposta-modal-title" className="text-lg font-bold text-ink mb-1">
        Nova proposta
      </h2>
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
      <input
        className="input"
        placeholder="Nome completo do cliente"
        value={nomeCliente}
        onChange={(e) => setNomeCliente(e.target.value)}
        required
      />
      <div className="grid grid-cols-2 gap-3">
        <input
          className="input"
          placeholder="Contato (telefone/e-mail)"
          value={contatoCliente}
          onChange={(e) => setContatoCliente(e.target.value)}
        />
        <input
          className="input"
          placeholder="CPF (opcional)"
          value={cpfCliente}
          onChange={(e) => setCpfCliente(e.target.value)}
        />
      </div>
      <input
        className="input"
        type="number"
        step="0.01"
        placeholder="Valor proposto (R$) *"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        required
      />
      <input
        className="input"
        placeholder="Condições de pagamento"
        value={condicoes}
        onChange={(e) => setCondicoes(e.target.value)}
      />
      <textarea
        className="input"
        placeholder="Observações"
        rows={3}
        value={observacoes}
        onChange={(e) => setObservacoes(e.target.value)}
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

/** Campo de lote com busca — mesma implementação usada em PainelReservas.tsx
 * (ver comentário lá): digita e escolhe da lista filtrada, em vez de rolar um
 * <select> gigante. `key={condominioSlug}` no ponto de uso remonta este
 * componente sempre que o filtro de empreendimento muda. */
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
  const filtrados = (termo ? lotes.filter((l) => rotuloLote(l).toLowerCase().includes(termo)) : lotes).slice(0, 60);

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
          {filtrados.length === 0 ? (
            <p className="px-3 py-2 text-xs text-ink-soft">Nenhum lote encontrado.</p>
          ) : (
            filtrados.map((l) => (
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

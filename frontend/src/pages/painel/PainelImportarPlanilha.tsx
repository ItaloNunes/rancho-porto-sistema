import { useEffect, useMemo, useRef, useState } from "react";
import { api, formatDateTime } from "../../lib/api";
import type { CondominioResumo, ImportacaoPreview, LoteStatus } from "../../types";

const STATUS_LABEL: Record<LoteStatus, string> = {
  disponivel: "Disponível",
  reservado: "Reservado",
  vendido: "Vendido",
};

const STATUS_COR: Record<LoteStatus, string> = {
  disponivel: "text-sage",
  reservado: "text-ochre",
  vendido: "text-rust",
};

/** Aceita a própria tabela oficial em PDF (o status é lido pela cor de
 * fundo da linha, sem precisar reformatar nada) ou uma planilha .xlsx/.csv
 * com colunas Quadra/Lote/Status — a validação séria (conteúdo reconhecível)
 * é toda no backend; aqui é só um filtro grosseiro contra extensão errada. */
function pareceArquivoValido(arquivo: File): boolean {
  const nome = arquivo.name.toLowerCase();
  return (
    nome.endsWith(".xlsx") || nome.endsWith(".xlsm") || nome.endsWith(".csv") || nome.endsWith(".pdf")
  );
}

export default function PainelImportarPlanilha() {
  const [condominios, setCondominios] = useState<CondominioResumo[] | null>(null);
  const [condominioId, setCondominioId] = useState<string>("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [analisando, setAnalisando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [preview, setPreview] = useState<ImportacaoPreview | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  // Cobre os dois avisos que pedem uma segunda confirmação antes de aplicar:
  // desfazer uma venda concluída, ou sobrescrever um lote com reserva/proposta
  // ativa no sistema (ver `desfazVenda`/`temPendenciaAtiva` abaixo).
  const [cienteAlerta, setCienteAlerta] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .listarCondominios()
      .then((lista) => {
        setCondominios(lista);
        if (lista.length > 0) setCondominioId((atual) => atual || lista[0].id);
      })
      .catch((e) => setErro(e instanceof Error ? e.message : String(e)));
  }, []);

  const desfazVenda = useMemo(
    () => (preview?.linhas ?? []).some((l) => l.status_atual === "vendido" && selecionados.has(l.lote_id)),
    [preview, selecionados],
  );
  // Lote com reserva ou proposta ATIVA no sistema (ver preview_importacao_lotes
  // no backend) que está marcado pra ter o status sobrescrito pela planilha —
  // sem esse aviso, dava pra apagar o rastro de uma negociação em andamento
  // sem perceber.
  const temPendenciaAtiva = useMemo(
    () => (preview?.linhas ?? []).some((l) => l.pendencia_tipo && selecionados.has(l.lote_id)),
    [preview, selecionados],
  );

  function limparResultadoDaAnalise() {
    setPreview(null);
    setSelecionados(new Set());
    setCienteAlerta(false);
    setResultado(null);
    setErro(null);
  }

  async function analisar() {
    if (!arquivo || !condominioId) return;
    setErro(null);
    setResultado(null);
    setAnalisando(true);
    try {
      const p = await api.importarLotesPreview(condominioId, arquivo);
      setPreview(p);
      setSelecionados(new Set(p.linhas.map((l) => l.lote_id)));
      setCienteAlerta(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalisando(false);
    }
  }

  async function confirmar() {
    if (!preview) return;
    const itens = preview.linhas
      .filter((l) => selecionados.has(l.lote_id))
      .map((l) => ({ lote_id: l.lote_id, status: l.status_planilha, status_atual: l.status_atual }));
    if (itens.length === 0) return;
    setConfirmando(true);
    setErro(null);
    try {
      const r = await api.importarLotesConfirmar(itens);
      let msg = `${r.atualizados.length} lote(s) atualizado(s) com sucesso.`;
      if (r.ignorados > 0) {
        msg +=
          ` ${r.ignorados} item(ns) NÃO foram aplicados porque o status desses lotes mudou depois da análise` +
          ` (alguém reservou/vendeu pelo painel nesse meio tempo) — suba a planilha de novo pra revisar.`;
      }
      setResultado(msg);
      setPreview(null);
      setSelecionados(new Set());
      setArquivo(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setConfirmando(false);
    }
  }

  function alternarSelecao(loteId: string) {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(loteId)) novo.delete(loteId);
      else novo.add(loteId);
      return novo;
    });
  }

  function alternarTodos(marcar: boolean) {
    setSelecionados(marcar ? new Set((preview?.linhas ?? []).map((l) => l.lote_id)) : new Set());
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-ink">Importar planilha</h1>
        <p className="text-sm text-ink-soft mt-1 max-w-2xl">
          Suba a própria tabela oficial em PDF (o status é lido pela cor da linha, sem precisar reformatar nada) ou
          uma planilha .xlsx/.csv com colunas Quadra, Lote e Status, pra atualizar o estoque quando uma venda ou
          reserva acontecer fora do sistema. Só o <span className="font-medium text-ink">status</span> é atualizado —
          valores, tamanho e outros dados do lote não mudam por aqui.
        </p>
      </div>

      {erro && <p className="text-rust text-sm mb-4">{erro}</p>}
      {resultado && (
        <p className="text-sm mb-4 px-4 py-3 rounded bg-sage/15 text-ink border border-sage/30">{resultado}</p>
      )}

      <div className="card p-5 mb-6">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label className="block text-xs font-medium text-ink-soft mb-1.5" htmlFor="import-condominio">
              Empreendimento
            </label>
            <select
              id="import-condominio"
              className="input"
              value={condominioId}
              disabled={!condominios || analisando}
              onChange={(e) => {
                setCondominioId(e.target.value);
                limparResultadoDaAnalise();
              }}
            >
              {!condominios && <option>Carregando...</option>}
              {condominios?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-soft mb-1.5" htmlFor="import-arquivo">
              Tabela (PDF, .xlsx ou .csv)
            </label>
            <input
              ref={inputRef}
              id="import-arquivo"
              type="file"
              accept=".xlsx,.xlsm,.csv,.pdf"
              className="input !py-1.5"
              disabled={analisando}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                limparResultadoDaAnalise();
                if (f && !pareceArquivoValido(f)) {
                  setErro("Esse arquivo não parece ser uma tabela (.pdf, .xlsx ou .csv).");
                  setArquivo(null);
                  return;
                }
                setArquivo(f);
              }}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button className="btn btn-primary" disabled={!arquivo || !condominioId || analisando} onClick={analisar}>
            {analisando ? "Analisando..." : "Analisar planilha"}
          </button>
        </div>
      </div>

      {preview && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="font-semibold text-ink">{preview.condominio_nome}</h2>
              <p className="text-xs text-ink-soft mt-0.5">
                {preview.total_linhas_planilha} linha(s) na planilha · {preview.total_casadas} lote(s) encontrados ·{" "}
                <span className="font-medium text-ink">{preview.total_alteracoes} mudança(s) de status</span>
              </p>
            </div>
            {preview.linhas.length > 0 && (
              <div className="flex items-center gap-3 text-xs">
                <button className="text-primary hover:underline" onClick={() => alternarTodos(true)}>
                  Marcar todos
                </button>
                <button className="text-ink-soft hover:underline" onClick={() => alternarTodos(false)}>
                  Desmarcar todos
                </button>
              </div>
            )}
          </div>

          {preview.nao_encontrados.length > 0 && (
            <div className="px-5 py-3 bg-ochre/10 border-b border-border text-xs text-ink-soft">
              <span className="font-medium text-ink">
                {preview.nao_encontrados.length} linha(s) da planilha não bateram com nenhum lote
              </span>{" "}
              (confira quadra/lote na planilha): {preview.nao_encontrados.slice(0, 12).join(", ")}
              {preview.nao_encontrados.length > 12 && "…"}
            </div>
          )}

          {preview.linhas.length === 0 ? (
            <p className="text-sm text-ink-soft px-5 py-6">
              Nenhuma mudança — o status de todos os lotes reconhecidos na planilha já bate com o que está no painel.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="border-b border-border text-left text-ink-soft text-xs uppercase tracking-wide">
                      <th className="px-4 py-3 font-medium w-10"></th>
                      <th className="px-4 py-3 font-medium">Lote</th>
                      <th className="px-4 py-3 font-medium">Status atual</th>
                      <th className="px-4 py-3 font-medium">Status na planilha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.linhas.map((l) => {
                      const marcado = selecionados.has(l.lote_id);
                      const desfazendoVenda = l.status_atual === "vendido";
                      const temPendencia = !!l.pendencia_tipo;
                      return (
                        <tr
                          key={l.lote_id}
                          className={`border-b border-border last:border-0 ${
                            desfazendoVenda || temPendencia ? "bg-rust/10" : marcado ? "bg-sage/10" : ""
                          }`}
                        >
                          <td className="px-4 py-2.5">
                            <input
                              type="checkbox"
                              checked={marcado}
                              onChange={() => alternarSelecao(l.lote_id)}
                            />
                          </td>
                          <td className="px-4 py-2.5 font-medium text-ink">{l.identificador}</td>
                          <td className={`px-4 py-2.5 font-medium ${STATUS_COR[l.status_atual]}`}>
                            {STATUS_LABEL[l.status_atual]}
                            {desfazendoVenda && <span className="ml-1.5 text-[11px] text-rust">(desfaz venda)</span>}
                            {temPendencia && (
                              <div className="text-[11px] font-normal text-rust mt-0.5">
                                ⚠️ {l.pendencia_tipo === "reserva" ? "Reserva" : "Proposta"} ativa com{" "}
                                {l.pendencia_corretor} desde {formatDateTime(l.pendencia_desde)}
                              </div>
                            )}
                          </td>
                          <td className={`px-4 py-2.5 font-medium ${STATUS_COR[l.status_planilha]}`}>
                            {STATUS_LABEL[l.status_planilha]}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="px-5 py-4 border-t border-border">
                {(desfazVenda || temPendenciaAtiva) && (
                  <label className="flex items-start gap-2 text-sm text-ink mb-4 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={cienteAlerta}
                      onChange={(e) => setCienteAlerta(e.target.checked)}
                    />
                    <span>
                      {desfazVenda && (
                        <>
                          Pelo menos um lote marcado está saindo de <span className="font-semibold">Vendido</span> —
                          isso desfaz o registro de uma venda concluída.{" "}
                        </>
                      )}
                      {temPendenciaAtiva && (
                        <>
                          Pelo menos um lote marcado tem uma reserva/proposta ativa de um corretor no sistema — a
                          importação vai sobrescrever o status por cima dessa negociação em andamento.{" "}
                        </>
                      )}
                      Estou ciente e quero continuar mesmo assim.
                    </span>
                  </label>
                )}
                <div className="flex justify-end gap-2">
                  <button className="btn btn-outline" onClick={limparResultadoDaAnalise}>
                    Cancelar
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={
                      selecionados.size === 0 || confirmando || ((desfazVenda || temPendenciaAtiva) && !cienteAlerta)
                    }
                    onClick={confirmar}
                  >
                    {confirmando
                      ? "Aplicando..."
                      : `Confirmar ${selecionados.size} atualização${selecionados.size === 1 ? "" : "ões"}`}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

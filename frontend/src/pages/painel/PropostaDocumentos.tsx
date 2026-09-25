import { useRef, useState } from "react";
import { abrirAbaComCarregamento, api, formatarNumeroProposta, horasRestantes, mostrarErroNaAba, mostrarPdfNaAba } from "../../lib/api";
import { DOCUMENTO_LABEL, DOCUMENTOS_CONJUGE, DOCUMENTOS_OBRIGATORIOS } from "../../types";
import type { DocumentoProposta, DocumentoTipo, PropostaDetalhe } from "../../types";

const TIPOS: DocumentoTipo[] = [
  "rg",
  "cpf",
  "comprovante_residencia",
  "certidao_nascimento_casamento",
  "conjuge_rg",
  "conjuge_cpf",
  "comprovante_renda",
  "outro",
];

// Mesma lista aceita pelo backend (ver app/documentos.py) — o accept do
// input é só uma dica pro seletor de arquivo do sistema operacional; quem
// realmente barra um formato ou um arquivo disfarçado (extensão trocada) é
// a validação no servidor, então o erro que vier de lá sempre é mostrado.
const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic";

// Mesmo prazo de 72h da análise financeira da qualificação (ver
// PainelReservas.tsx/PainelQualificacoes.tsx e migration 0021) — aqui contado
// a partir de documentos_completos_em, que o backend só preenche quando os
// documentos obrigatórios abaixo estão todos anexados.
const PRAZO_ANALISE_HORAS = 72;

/** Deixa explícito, pro corretor, que a proposta está em análise e quanto
 * falta — pra não precisar perguntar ao administrador se já saiu o
 * resultado. */
export function PrazoAnaliseBadge({ completosEm }: { completosEm?: string | null }) {
  if (!completosEm) return null;
  const prazo = new Date(new Date(completosEm).getTime() + PRAZO_ANALISE_HORAS * 3_600_000).toISOString();
  const horas = horasRestantes(prazo);
  if (horas === null) return null;
  const vencido = horas <= 0;
  const critico = horas > 0 && horas <= 3;
  const texto = vencido
    ? "prazo da análise vencido"
    : horas < 1
      ? `${Math.round(horas * 60)}min de análise financeira`
      : `${Math.round(horas)}h de análise financeira`;
  return (
    <div
      className={`mt-1 text-[11px] font-semibold px-2 py-0.5 rounded-sm inline-block ${
        vencido ? "bg-rust/10 text-rust" : critico ? "bg-ochre/10 text-ochre" : "bg-sage/10 text-sage"
      }`}
    >
      {texto}
    </div>
  );
}

function formatBytes(n?: number | null): string {
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Painel de anexos de uma proposta já existente — o corretor pode voltar
 * aqui a qualquer momento (proposta em rascunho, aguardando aprovação, já
 * aprovada etc.) pra completar ou corrigir os documentos, sem precisar
 * refazer a proposta inteira. Ver api.enviarDocumentoProposta/
 * excluirDocumentoProposta e routers/crm.py. */
export default function PropostaDocumentos({
  proposta,
  onAtualizado,
}: {
  proposta: PropostaDetalhe;
  onAtualizado: () => void;
}) {
  const [tipo, setTipo] = useState<DocumentoTipo>("rg");
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<string | null>(null);
  const [gerandoRelatorio, setGerandoRelatorio] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const documentos = [...proposta.documentos].sort(
    (a, b) => new Date(b.enviado_em).getTime() - new Date(a.enviado_em).getTime(),
  );

  // Mesma lista de obrigatórios da qualificação pública (ver
  // PainelQualificacoes.tsx e QualificacaoPublica.tsx) — aqui reaproveitada
  // pra mostrar o que ainda falta anexar nesta proposta, já que as duas
  // alimentam o mesmo PDF/contrato e têm as mesmas exigências. Casado só é
  // conhecido quando a proposta nasceu do formulário completo ou de uma
  // qualificação aprovada (dados_qualificacao preenchido) — sem esse dado,
  // assume-se solteiro (não pede documento do cônjuge à toa).
  const casado = proposta.dados_qualificacao?.estado_civil === "casado";
  const obrigatorios: DocumentoTipo[] = [...DOCUMENTOS_OBRIGATORIOS, ...(casado ? DOCUMENTOS_CONJUGE : [])];
  const faltando = obrigatorios.filter((tipo) => !documentos.some((d) => d.tipo === tipo));

  async function onArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setErroEnvio(null);
    setEnviando(true);
    try {
      await api.enviarDocumentoProposta(proposta.id, tipo, arquivo);
      onAtualizado();
    } catch (err) {
      // Erros de validação do backend (tamanho, formato, arquivo vazio ou
      // corrompido — ver app/documentos.py::validar_e_ler) chegam prontos
      // pra mostrar direto pro corretor, sem precisar traduzir nada aqui.
      setErroEnvio(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function baixar(doc: DocumentoProposta) {
    const aba = abrirAbaComCarregamento("Abrindo documento...");
    setBaixando(doc.id);
    try {
      const { url } = await api.baixarDocumentoProposta(proposta.id, doc.id);
      if (aba) aba.location.href = url;
      else window.open(url, "_blank");
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : String(err);
      mostrarErroNaAba(aba, mensagem);
      alert(mensagem);
    } finally {
      setBaixando(null);
    }
  }

  async function gerarRelatorioCompleto() {
    // Mesmo padrão de PainelPropostas.tsx::abrirPdf — a aba precisa abrir na
    // hora do clique (síncrono), antes do fetch, senão o navegador bloqueia
    // por não reconhecer como resultado direto de um gesto do usuário.
    const aba = abrirAbaComCarregamento("Gerando relatório completo...");
    setGerandoRelatorio(true);
    try {
      const blob = await api.gerarRelatorioCompletoProposta(proposta.id);
      const nomeArquivo = `proposta-completa-${proposta.lote?.identificador ?? proposta.id}.pdf`;
      if (aba) {
        mostrarPdfNaAba(aba, blob, nomeArquivo, `Proposta completa — ${proposta.lote?.identificador ?? ""}`);
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = nomeArquivo;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : String(err);
      mostrarErroNaAba(aba, mensagem);
      alert(mensagem);
    } finally {
      setGerandoRelatorio(false);
    }
  }

  async function excluir(doc: DocumentoProposta) {
    if (!confirm(`Remover "${doc.nome_arquivo}"? Não tem como desfazer.`)) return;
    setExcluindo(doc.id);
    try {
      await api.excluirDocumentoProposta(proposta.id, doc.id);
      onAtualizado();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setExcluindo(null);
    }
  }

  return (
    <div className="grid gap-4">
      <div>
        <h3 className="text-lg font-bold text-ink">
          Documentos da proposta{" "}
          <span className="text-sm font-mono font-normal text-ink-soft">
            {formatarNumeroProposta(proposta.numero, proposta.versao)}
          </span>
        </h3>
        <p className="text-sm text-ink-soft">
          {proposta.lote?.identificador ?? "Lote"} — {proposta.cliente?.nome ?? "Cliente"}
        </p>
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-2">
          Documentos obrigatórios {faltando.length > 0 && <span className="text-rust normal-case font-medium">({faltando.length} faltando)</span>}
        </h3>
        <div className="grid gap-1.5">
        {obrigatorios.map((tipo) => {
          const doc = documentos.find((d) => d.tipo === tipo);
          return (
            <div key={tipo} className="flex items-center justify-between gap-3 text-sm">
              <span className={doc ? "text-ink" : "text-rust font-medium"}>
                {DOCUMENTO_LABEL[tipo]} {!doc && "— faltando"}
              </span>
              {doc ? (
                <span className="text-sage text-xs font-semibold shrink-0">✓ anexado</span>
              ) : (
                <button
                  className="btn-row btn-row-primary shrink-0"
                  onClick={() => {
                    setTipo(tipo);
                    inputRef.current?.click();
                  }}
                >
                  anexar
                </button>
              )}
            </div>
          );
        })}
        {faltando.length === 0 && (
          <div className="grid gap-1">
            <p className="text-xs text-sage font-medium">
              Todos os documentos obrigatórios já foram anexados — proposta em análise financeira, aguardando
              aprovação do administrador. Você não precisa perguntar: assim que houver uma decisão, o status
              da proposta muda sozinho.
            </p>
            <PrazoAnaliseBadge completosEm={proposta.documentos_completos_em} />
          </div>
        )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border border-border rounded-lg p-3 bg-surface-alt/60">
        <select
          className="input !py-2 !text-sm w-auto"
          value={tipo}
          onChange={(e) => setTipo(e.target.value as DocumentoTipo)}
          disabled={enviando}
        >
          {TIPOS.map((t) => (
            <option key={t} value={t}>
              {DOCUMENTO_LABEL[t]}
            </option>
          ))}
        </select>
        <label className="btn btn-primary !py-2 !px-4 !text-sm cursor-pointer">
          {enviando ? "Enviando..." : "+ Anexar arquivo"}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            disabled={enviando}
            onChange={onArquivo}
          />
        </label>
        <span className="text-xs text-ink-soft">PDF, JPG, PNG, WEBP ou HEIC — até 12MB.</span>
      </div>
      {erroEnvio && <p className="text-rust text-sm">{erroEnvio}</p>}

      {documentos.length === 0 ? (
        <p className="text-ink-soft text-sm">Nenhum documento anexado ainda.</p>
      ) : (
        <div className="grid gap-2">
          {documentos.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center justify-between gap-3 border border-border rounded-lg px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink truncate">{DOCUMENTO_LABEL[doc.tipo]}</p>
                <p className="text-xs text-ink-soft truncate">
                  {doc.nome_arquivo}
                  {doc.tamanho_bytes ? ` · ${formatBytes(doc.tamanho_bytes)}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  className="btn-row btn-row-primary"
                  disabled={baixando === doc.id}
                  onClick={() => baixar(doc)}
                >
                  {baixando === doc.id ? "abrindo..." : "baixar"}
                </button>
                <button
                  className="btn-row btn-row-danger"
                  disabled={excluindo === doc.id}
                  onClick={() => excluir(doc)}
                >
                  {excluindo === doc.id ? "removendo..." : "remover"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-border pt-3">
        <button
          className="btn btn-primary w-full !py-2.5"
          disabled={gerandoRelatorio}
          onClick={gerarRelatorioCompleto}
        >
          {gerandoRelatorio ? "Gerando relatório..." : "Gerar PDF completo (proposta + documentos)"}
        </button>
        <p className="text-xs text-ink-soft mt-1.5">
          Junta a proposta e todos os documentos anexados acima num único PDF, pronto pra enviar ou arquivar.
          {proposta.status === "rascunho" || proposta.status === "aguardando_aprovacao" ? (
            <> Só funciona depois que a proposta for aprovada por um administrador.</>
          ) : null}
        </p>
      </div>
    </div>
  );
}

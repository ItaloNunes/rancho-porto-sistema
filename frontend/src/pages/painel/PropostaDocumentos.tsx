import { useRef, useState } from "react";
import { abrirAbaComCarregamento, api, mostrarErroNaAba } from "../../lib/api";
import { DOCUMENTO_LABEL } from "../../types";
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
      const url = URL.createObjectURL(blob);
      if (aba) {
        aba.location.href = url;
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = `proposta-completa-${proposta.lote?.identificador ?? proposta.id}.pdf`;
        link.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
        <h3 className="text-lg font-bold text-ink">Documentos da proposta</h3>
        <p className="text-sm text-ink-soft">
          {proposta.lote?.identificador ?? "Lote"} — {proposta.cliente?.nome ?? "Cliente"}
        </p>
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

import { useRef, useState } from "react";
import { api } from "../lib/api";
import Modal from "./Modal";

const MAX_ANEXOS = 5;
const MAX_TAMANHO_MB = 40;

/** Botão flutuante discreto (corretor e admin, ver PainelLayout.tsx) que
 * abre um chamado de suporte — vira um e-mail direto pro desenvolvedor
 * (backend/app/routers/suporte.py), com print/vídeo do problema anexados.
 * Fica fora do fluxo normal do painel de propósito (canto da tela, ícone
 * pequeno e neutro) — é uma via de escape pra quando algo dá errado, não
 * uma função do dia a dia. */
export default function BotaoSuporte() {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        className="fixed bottom-4 right-4 z-40 grid h-11 w-11 place-items-center rounded-full
                   bg-surface text-ink-soft/70 shadow-card border border-border
                   hover:text-primary hover:shadow-card-hover active:scale-[0.96] transition-all"
        title="Suporte / relatar um problema"
        aria-label="Suporte / relatar um problema"
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" strokeLinecap="round" />
          <path d="M9.5 9.2a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2-2.4 3.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="16.7" r="0.15" fill="currentColor" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>

      {aberto && <ModalChamado onClose={() => setAberto(false)} />}
    </>
  );
}

function ModalChamado({ onClose }: { onClose: () => void }) {
  const [assunto, setAssunto] = useState("");
  const [descricao, setDescricao] = useState("");
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function adicionarArquivos(novos: FileList | null) {
    if (!novos) return;
    setErro(null);
    const grandeDemais = Array.from(novos).find((f) => f.size > MAX_TAMANHO_MB * 1024 * 1024);
    if (grandeDemais) {
      setErro(`"${grandeDemais.name}" passa de ${MAX_TAMANHO_MB}MB — escolha um arquivo menor.`);
      return;
    }
    setArquivos((atual) => {
      const combinado = [...atual, ...Array.from(novos)];
      return combinado.slice(0, MAX_ANEXOS);
    });
    if (inputRef.current) inputRef.current.value = "";
  }

  function removerArquivo(i: number) {
    setArquivos((atual) => atual.filter((_, idx) => idx !== i));
  }

  async function enviar() {
    if (!assunto.trim() || !descricao.trim()) {
      setErro("Preencha o assunto e a descrição do problema.");
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      await api.abrirChamadoSuporte(assunto.trim(), descricao.trim(), arquivos);
      setEnviado(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy="suporte-modal-title">
      <div className="p-6 sm:p-7">
        {enviado ? (
          <div className="py-6 text-center">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-sage/15 text-sage">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-ink">Chamado enviado</h2>
            <p className="text-sm text-ink-soft mt-1.5">Recebemos seu chamado e vamos olhar em breve.</p>
            <button onClick={onClose} className="btn btn-primary mt-6">
              Fechar
            </button>
          </div>
        ) : (
          <>
            <h2 id="suporte-modal-title" className="text-lg font-bold text-ink">
              Abrir chamado de suporte
            </h2>
            <p className="text-sm text-ink-soft mt-1 mb-5">
              Achou um problema no sistema? Descreva abaixo — se puder, anexe um print ou um vídeo curto da tela.
            </p>

            {erro && <p className="text-rust text-sm mb-4">{erro}</p>}

            <div className="grid gap-4">
              <div>
                <label className="block text-xs font-medium text-ink-soft mb-1.5" htmlFor="chamado-assunto">
                  Assunto
                </label>
                <input
                  id="chamado-assunto"
                  className="input"
                  placeholder="Ex.: lote errado abrindo na lista"
                  value={assunto}
                  onChange={(e) => setAssunto(e.target.value)}
                  disabled={enviando}
                  maxLength={140}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-soft mb-1.5" htmlFor="chamado-descricao">
                  Descrição
                </label>
                <textarea
                  id="chamado-descricao"
                  className="input min-h-[110px] resize-y"
                  placeholder="O que aconteceu, em qual tela, o que você esperava que acontecesse..."
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  disabled={enviando}
                  maxLength={4000}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-soft mb-1.5">
                  Print ou vídeo (opcional)
                </label>
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  className="input !py-1.5"
                  disabled={enviando || arquivos.length >= MAX_ANEXOS}
                  onChange={(e) => adicionarArquivos(e.target.files)}
                />
                <p className="text-[11px] text-ink-soft mt-1">
                  Até {MAX_ANEXOS} arquivos, {MAX_TAMANHO_MB}MB cada.
                </p>
                {arquivos.length > 0 && (
                  <ul className="mt-2 grid gap-1.5">
                    {arquivos.map((a, i) => (
                      <li
                        key={`${a.name}-${i}`}
                        className="flex items-center justify-between gap-2 text-xs bg-surface-alt rounded px-3 py-2"
                      >
                        <span className="truncate text-ink">{a.name}</span>
                        <button
                          onClick={() => removerArquivo(i)}
                          disabled={enviando}
                          className="text-ink-soft hover:text-rust shrink-0"
                          aria-label={`Remover ${a.name}`}
                        >
                          remover
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={onClose} className="btn btn-outline" disabled={enviando}>
                Cancelar
              </button>
              <button onClick={enviar} className="btn btn-primary" disabled={enviando}>
                {enviando ? "Enviando..." : "Enviar chamado"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

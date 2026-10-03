import { useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { forcaSenha, regrasSenha } from "../lib/senha";
import CampoSenha from "./CampoSenha";

const ROTULO_FORCA = ["Muito fraca", "Fraca", "Razoável", "Boa", "Forte"];
const COR_FORCA = ["bg-rust", "bg-rust", "bg-amber-500", "bg-sage", "bg-sage"];

/** Troca de senha (tela "Trocar senha" e troca obrigatória do 1º acesso).
 * Mostra as regras ao vivo — as mesmas que o servidor confere. */
export default function FormTrocaSenha({ onConcluido }: { onConcluido: () => void }) {
  const { perfil, aplicarSessao } = useAuth();
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const regras = regrasSenha(nova, { telefone: perfil?.telefone, usuario: perfil?.usuario });
  const confere = confirmar.length > 0 && confirmar === nova;
  const tudoOk = regras.every((r) => r.ok) && confere && atual.length > 0 && nova !== atual;
  const forca = forcaSenha(nova);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!tudoOk) {
      setErro(nova === atual ? "A senha nova tem que ser diferente da atual." : "Confira os itens marcados em vermelho.");
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      aplicarSessao(await api.trocarMinhaSenha(atual, nova));
      onConcluido();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="grid gap-4" noValidate>
      <CampoSenha id="senha-atual" label="Senha atual" valor={atual} onChange={setAtual} autoComplete="current-password" autoFocus />
      <div className="grid gap-2">
        <CampoSenha id="senha-nova" label="Nova senha" valor={nova} onChange={setNova} autoComplete="new-password" />
        {nova && (
          <div className="grid gap-1" aria-live="polite">
            <div className="grid grid-cols-4 gap-1">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={`h-1.5 rounded-full ${i < forca ? COR_FORCA[forca] : "bg-surface-alt"}`} />
              ))}
            </div>
            <span className="text-[11px] text-ink-soft">Força: {ROTULO_FORCA[forca]}</span>
          </div>
        )}
        <ul className="grid gap-1 text-xs">
          {regras.map((r) => (
            <li key={r.id} className={nova ? (r.ok ? "text-sage" : "text-rust") : "text-ink-soft"}>
              {nova ? (r.ok ? "✓ " : "✗ ") : "• "}
              {r.texto}
            </li>
          ))}
        </ul>
      </div>
      <div className="grid gap-1">
        <CampoSenha id="senha-confirmar" label="Repita a nova senha" valor={confirmar} onChange={setConfirmar} autoComplete="new-password" />
        {confirmar && !confere && <p className="text-xs text-rust">As duas senhas não estão iguais.</p>}
      </div>
      {erro && (
        <p id="troca-senha-erro" className="text-sm text-rust bg-rust/10 border border-rust/30 rounded px-3 py-2">
          {erro}
        </p>
      )}
      <button className="btn btn-primary disabled:opacity-40" disabled={enviando || !tudoOk}>
        {enviando ? "Salvando..." : "Salvar nova senha"}
      </button>
      <p className="text-[11px] text-ink-soft">
        Ao salvar, você continua logado aqui e qualquer outro aparelho onde sua conta estava aberta é desconectado.
      </p>
    </form>
  );
}

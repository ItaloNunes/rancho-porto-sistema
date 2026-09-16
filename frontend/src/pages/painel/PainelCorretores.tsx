import { useEffect, useState } from "react";
import Modal from "../../components/Modal";
import { api } from "../../lib/api";
import type { Corretor, Papel } from "../../types";

/** Essa tela (e toda a API de /crm/corretores por trás dela) já é travada
 * pro admin nos dois lados: RequireAuth adminOnly (main.tsx) bloqueia a
 * rota /painel/corretores pro corretor comum mesmo digitando a URL na mão
 * (cai numa tela de "sem permissão"), e cada endpoint do backend exige
 * require_admin — o corretor comum nunca vê nem essa aba (TABS_BASE, em
 * PainelLayout.tsx, só lista Reservas/Propostas/Disponibilidade pra ele) nem
 * consegue chamar a API direto. A "trava anti-burro" pedida aqui é sobre as
 * ações dentro do CRUD (ver ConfirmarDesativacao/confirmação de promoção a
 * admin abaixo), não sobre quem chega até a tela. */
export default function PainelCorretores() {
  const [corretores, setCorretores] = useState<Corretor[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Corretor | "novo" | null>(null);
  const [criado, setCriado] = useState<{ usuario: string; senha: string; motivo: "criado" | "resetado" } | null>(
    null,
  );
  // Reativar é reversível na hora (basta desativar de novo) — confirmação
  // simples basta. Desativar corta o acesso de alguém, por isso passa pelo
  // fluxo de dois passos com nome digitado (ver ConfirmarDesativacao).
  const [desativando, setDesativando] = useState<{ corretor: Corretor; passo: 1 | 2; digitado: string } | null>(
    null,
  );

  function recarregar() {
    setErro(null);
    api.listarCorretores().then(setCorretores).catch((e) => setErro(e.message));
  }

  useEffect(recarregar, []);

  async function aplicarAtivo(c: Corretor, ativo: boolean) {
    try {
      await api.atualizarCorretor(c.id, { ativo });
      recarregar();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function reativar(c: Corretor) {
    if (!confirm(`Confirma reativar o login de "${c.nome}"?`)) return;
    aplicarAtivo(c, true);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-ink">Corretores</h1>
        <button className="btn btn-primary" onClick={() => setEditando("novo")}>
          + Novo login
        </button>
      </div>

      {erro && <p className="text-rust text-sm mb-4">{erro}</p>}

      {!corretores ? (
        <p className="text-ink-soft text-sm">Carregando...</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-border text-left text-ink-soft text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Usuário</th>
                <th className="px-4 py-3 font-medium">Papel</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {corretores.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface-alt/60">
                  <td className="px-4 py-3 font-medium text-ink">{c.nome}</td>
                  <td className="px-4 py-3 text-ink-soft font-mono text-xs">{c.usuario || "—"}</td>
                  <td className="px-4 py-3 text-ink-soft uppercase text-xs">{c.papel}</td>
                  <td className="px-4 py-3">
                    <span className={`badge ${c.ativo ? "badge-disponivel" : "badge-vendido"}`}>
                      {c.ativo ? "Ativo" : "Desativado"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button className="btn-row btn-row-primary mr-1.5" onClick={() => setEditando(c)}>
                      editar
                    </button>
                    <button
                      className={`btn-row ${c.ativo ? "btn-row-danger" : "btn-row-success"}`}
                      onClick={() =>
                        c.ativo ? setDesativando({ corretor: c, passo: 1, digitado: "" }) : reativar(c)
                      }
                    >
                      {c.ativo ? "desativar" : "reativar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <Modal onClose={() => setEditando(null)} labelledBy="corretor-modal-title">
          <CorretorForm
            corretor={editando === "novo" ? null : editando}
            onSalvo={(loginCriado) => {
              setEditando(null);
              if (loginCriado) setCriado(loginCriado);
              recarregar();
            }}
          />
        </Modal>
      )}

      {criado && (
        <Modal onClose={() => setCriado(null)} labelledBy="login-criado-title">
          <div className="p-6 sm:p-8 grid gap-3">
            <h2 id="login-criado-title" className="text-lg font-bold text-ink mb-1">
              {criado.motivo === "resetado" ? "Senha atualizada" : "Login criado"}
            </h2>
            <p className="text-sm text-ink-soft">
              Repasse esses dados pro corretor — a senha não aparece de novo depois que essa janela fechar.
            </p>
            <div className="card p-4 grid gap-1 font-mono text-sm">
              <span>
                usuário: <strong>{criado.usuario}</strong>
              </span>
              <span>
                senha: <strong>{criado.senha}</strong>
              </span>
            </div>
            <button className="btn btn-primary mt-2" onClick={() => setCriado(null)}>
              Entendi
            </button>
          </div>
        </Modal>
      )}

      {desativando && (
        <Modal onClose={() => setDesativando(null)} labelledBy="desativar-corretor-titulo">
          <div className="p-6">
            <h2 id="desativar-corretor-titulo" className="text-lg font-bold text-rust mb-2">
              Desativar login de corretor
            </h2>
            <p className="text-sm text-ink mb-4">
              <span className="font-semibold">{desativando.corretor.nome}</span>{" "}
              <span className="text-ink-soft">({desativando.corretor.usuario || "sem usuário"})</span>
            </p>

            {desativando.passo === 1 && (
              <>
                <p className="text-sm text-ink-soft mb-5">
                  Isso bloqueia o login imediatamente — a pessoa não consegue mais entrar no painel até alguém
                  reativar. O histórico dela (clientes, propostas, reservas) continua intacto.
                </p>
                <div className="flex justify-end gap-2">
                  <button className="btn btn-outline !text-xs !py-2" onClick={() => setDesativando(null)}>
                    Cancelar
                  </button>
                  <button
                    className="btn btn-outline !text-xs !py-2 !border-rust !text-rust"
                    onClick={() => setDesativando({ ...desativando, passo: 2 })}
                  >
                    Entendi, continuar
                  </button>
                </div>
              </>
            )}

            {desativando.passo === 2 && (
              <>
                <p className="text-sm text-ink-soft mb-2">Pra confirmar, digite o nome exatamente como aparece na lista:</p>
                <p className="text-sm font-semibold text-ink mb-3">{desativando.corretor.nome}</p>
                <input
                  autoFocus
                  className="input mb-5"
                  placeholder="Digite o nome do corretor"
                  value={desativando.digitado}
                  onChange={(e) => setDesativando({ ...desativando, digitado: e.target.value })}
                />
                <div className="flex justify-end gap-2">
                  <button className="btn btn-outline !text-xs !py-2" onClick={() => setDesativando(null)}>
                    Cancelar
                  </button>
                  <button
                    className="btn btn-primary !text-xs !py-2 !bg-rust disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={
                      desativando.digitado.trim().toLowerCase() !== desativando.corretor.nome.trim().toLowerCase()
                    }
                    onClick={() => {
                      aplicarAtivo(desativando.corretor, false);
                      setDesativando(null);
                    }}
                  >
                    Sim, desativar este login
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

function CorretorForm({
  corretor,
  onSalvo,
}: {
  corretor: Corretor | null;
  onSalvo: (loginCriado?: { usuario: string; senha: string; motivo: "criado" | "resetado" }) => void;
}) {
  const [nome, setNome] = useState(corretor?.nome ?? "");
  const [usuario, setUsuario] = useState(corretor?.usuario ?? "");
  const [telefone, setTelefone] = useState(corretor?.telefone ?? "");
  const [papel, setPapel] = useState<Papel>(corretor?.papel ?? "corretor");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [resetando, setResetando] = useState(false);
  // Dar papel de admin (criando um login novo já como admin, ou promovendo
  // um corretor existente) é a ação mais sensível deste CRUD — dá acesso
  // total ao painel, inclusive pra gerenciar outros logins. Por isso passa
  // por uma segunda confirmação (digitar "ADMIN") antes de salvar de
  // verdade, do mesmo jeito que desativar um login (ver ConfirmarDesativacao
  // acima) ou desfazer uma venda (PainelLotes.tsx) também pedem.
  const precisaConfirmarAdmin = papel === "admin" && corretor?.papel !== "admin";
  const [confirmarAdmin, setConfirmarAdmin] = useState(false);
  const [digitadoAdmin, setDigitadoAdmin] = useState("");

  function mudarPapel(novoPapel: Papel) {
    setPapel(novoPapel);
    setConfirmarAdmin(false);
    setDigitadoAdmin("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (precisaConfirmarAdmin && !confirmarAdmin) {
      setConfirmarAdmin(true);
      return;
    }
    if (precisaConfirmarAdmin && digitadoAdmin.trim().toUpperCase() !== "ADMIN") {
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      if (corretor) {
        const atualizado = await api.atualizarCorretor(corretor.id, { nome, telefone: telefone || null, papel });
        // Backend só devolve `senha` quando ela acabou de ser (re)sincronizada
        // com o telefone (ex.: telefone mudou e a senha ainda era a padrão) —
        // se o corretor já tinha customizado a própria senha, nada muda aqui.
        onSalvo(atualizado.senha ? { usuario: corretor.usuario ?? "", senha: atualizado.senha, motivo: "resetado" } : undefined);
      } else {
        const criado = await api.criarCorretor({ nome, telefone, usuario: usuario || null, papel });
        onSalvo({ usuario: criado.usuario ?? "", senha: criado.senha, motivo: "criado" });
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  async function resetarSenha() {
    if (!corretor) return;
    if (
      !confirm(
        `Voltar a senha de "${corretor.nome}" pro telefone atual (${corretor.telefone || "—"}, só números)? A senha customizada por ele, se houver, deixa de valer.`,
      )
    )
      return;
    setErro(null);
    setResetando(true);
    try {
      const atualizado = await api.atualizarCorretor(corretor.id, { resetar_senha: true });
      if (atualizado.senha) {
        onSalvo({ usuario: corretor.usuario ?? "", senha: atualizado.senha, motivo: "resetado" });
      } else {
        onSalvo();
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setResetando(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="p-6 sm:p-8 grid gap-3">
      <h2 id="corretor-modal-title" className="text-lg font-bold text-ink mb-1">
        {corretor ? "Editar corretor" : "Novo login de corretor"}
      </h2>
      {!corretor && (
        <p className="text-xs text-ink-soft -mt-1 mb-1">
          A senha inicial é o telefone (só números). Deixe "usuário" em branco pra gerar automático a partir do nome.
        </p>
      )}
      {corretor && (
        <p className="text-xs text-ink-soft -mt-1 mb-1">
          {corretor.senha_customizada
            ? "Esse corretor já trocou a própria senha — mudar o telefone aqui não altera o login dele."
            : "Mudar o telefone também troca a senha de login pra ele (só números) — avise o corretor."}
        </p>
      )}
      <input className="input" placeholder="Nome *" value={nome} onChange={(e) => setNome(e.target.value)} required />
      {!corretor && (
        <input
          className="input"
          placeholder="Usuário (opcional — ex.: italo.nunes)"
          value={usuario}
          onChange={(e) => setUsuario(e.target.value)}
        />
      )}
      <input
        className="input"
        placeholder={corretor ? "Telefone" : "Telefone * (vira a senha)"}
        value={telefone ?? ""}
        onChange={(e) => setTelefone(e.target.value)}
        required={!corretor}
      />
      <select className="input" value={papel} onChange={(e) => mudarPapel(e.target.value as Papel)}>
        <option value="corretor">Corretor</option>
        <option value="admin">Admin</option>
      </select>
      {corretor && !confirmarAdmin && (
        <button
          type="button"
          className="btn btn-outline text-xs justify-self-start"
          onClick={resetarSenha}
          disabled={resetando || salvando}
        >
          {resetando ? "Resetando..." : "Resetar senha (usar o telefone atual)"}
        </button>
      )}

      {precisaConfirmarAdmin && confirmarAdmin && (
        <div className="border-t border-border pt-4 grid gap-3">
          <p className="text-sm font-semibold text-rust">Confirmar acesso de administrador</p>
          <p className="text-sm text-ink-soft">
            Isso dá a {nome.trim() || "esta pessoa"} acesso total ao painel — gerenciar (e desativar) outros logins,
            aprovar propostas e ver os números de todos os empreendimentos. Digite <strong>ADMIN</strong> pra
            confirmar.
          </p>
          <input
            autoFocus
            className="input"
            placeholder='Digite "ADMIN"'
            value={digitadoAdmin}
            onChange={(e) => setDigitadoAdmin(e.target.value)}
          />
        </div>
      )}

      {erro && <p className="text-rust text-sm">{erro}</p>}

      {precisaConfirmarAdmin && confirmarAdmin ? (
        <div className="flex gap-3 mt-2">
          <button
            type="button"
            className="btn btn-outline flex-1"
            onClick={() => {
              setConfirmarAdmin(false);
              setDigitadoAdmin("");
            }}
          >
            Voltar
          </button>
          <button
            className="btn btn-primary flex-1 !bg-rust hover:!bg-rust/90 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={salvando || digitadoAdmin.trim().toUpperCase() !== "ADMIN"}
          >
            {salvando ? "Salvando..." : "Confirmar e salvar"}
          </button>
        </div>
      ) : (
        <button className="btn btn-primary mt-2" disabled={salvando}>
          {salvando ? "Salvando..." : "Salvar"}
        </button>
      )}
    </form>
  );
}

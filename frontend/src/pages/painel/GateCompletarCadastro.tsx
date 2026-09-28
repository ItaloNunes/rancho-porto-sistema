import { useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";

// Tela obrigatoria de "complete seu cadastro" -- aparece no lugar do painel
// inteiro (PainelLayout.tsx renderiza isso em vez do <Outlet/>) quando
// `perfil.perfil_completo` vem false do backend (schemas.Corretor, so
// acontece com papel="corretor" faltando nome/CRECI/CPF-CNPJ/dados
// bancarios). Sem isso, a clausula de comissao do contrato do Porto Franco
// sai sem qualificar o corretor -- so o nome, sem CPF/CRECI/banco. Pedido
// em 28/09.
export default function GateCompletarCadastro() {
  const { perfil, sair, recarregarPerfil } = useAuth();
  const [nome, setNome] = useState(perfil?.nome ?? "");
  const [cpfCnpj, setCpfCnpj] = useState(perfil?.cpf_cnpj ?? "");
  const [creci, setCreci] = useState(perfil?.creci ?? "");
  const [banco, setBanco] = useState(perfil?.banco ?? "");
  const [agencia, setAgencia] = useState(perfil?.agencia ?? "");
  const [conta, setConta] = useState(perfil?.conta ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      await api.atualizarMeuPerfil({
        nome: nome.trim(),
        cpf_cnpj: cpfCnpj.trim(),
        creci: creci.trim(),
        banco: banco.trim(),
        agencia: agencia.trim(),
        conta: conta.trim(),
      });
      // perfil_completo agora vem true do backend -- recarrega pra
      // PainelLayout liberar o painel de verdade sem precisar de F5.
      await recarregarPerfil();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-bg px-6 py-10">
      <div className="card w-full max-w-md p-8">
        <img
          src="/brand/castel-logo.png"
          alt="Castel Construções e Incorporações"
          className="h-9 w-auto object-contain mb-6"
        />
        <h1 className="text-xl font-bold text-ink mb-1">Complete seu cadastro</h1>
        <p className="text-sm text-ink-soft mb-6">
          Antes de continuar, precisamos desses dados — eles preenchem sozinhos a cláusula de comissão sempre que um
          contrato é gerado pra uma venda sua. Só precisa fazer isso uma vez.
        </p>
        <form onSubmit={onSubmit} className="grid gap-3">
          <input
            className="input"
            placeholder="Nome completo"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            autoFocus
          />
          <input
            className="input"
            placeholder="CPF ou CNPJ"
            value={cpfCnpj}
            onChange={(e) => setCpfCnpj(e.target.value)}
            required
          />
          <input className="input" placeholder="CRECI" value={creci} onChange={(e) => setCreci(e.target.value)} required />
          <div className="grid grid-cols-3 gap-2">
            <input
              className="input"
              placeholder="Banco"
              value={banco}
              onChange={(e) => setBanco(e.target.value)}
              required
            />
            <input
              className="input"
              placeholder="Agência"
              value={agencia}
              onChange={(e) => setAgencia(e.target.value)}
              required
            />
            <input
              className="input"
              placeholder="Conta"
              value={conta}
              onChange={(e) => setConta(e.target.value)}
              required
            />
          </div>
          {erro && <p className="text-rust text-sm">{erro}</p>}
          <button className="btn btn-primary mt-2" disabled={salvando}>
            {salvando ? "Salvando..." : "Salvar e continuar"}
          </button>
        </form>
        <button onClick={() => sair()} className="btn btn-ghost w-full mt-3 text-sm">
          Sair
        </button>
      </div>
    </div>
  );
}

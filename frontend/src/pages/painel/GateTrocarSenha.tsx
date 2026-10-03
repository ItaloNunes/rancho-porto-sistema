import FormTrocaSenha from "../../components/FormTrocaSenha";
import { useAuth } from "../../lib/auth";

/** Troca obrigatória da senha inicial (o telefone) — aparece no lugar do
 * painel inteiro até a pessoa escolher uma senha própria (03/10). O
 * servidor também bloqueia todas as outras rotas enquanto isso. */
export default function GateTrocarSenha() {
  const { perfil, sair } = useAuth();
  return (
    <div data-clarity-mask="True" className="min-h-screen grid place-items-center bg-bg px-4 py-10">
      <div className="card w-full max-w-md p-6 sm:p-8">
        <img src="/brand/castel-logo.png" alt="Castel" className="h-8 w-auto object-contain mb-6" />
        <h1 className="text-xl font-bold text-ink mb-1">Crie a sua senha</h1>
        <p className="text-sm text-ink-soft mb-1">
          Olá{perfil?.nome ? `, ${perfil.nome.split(" ")[0]}` : ""}! Por segurança, a senha inicial (o seu telefone)
          não vale mais.
        </p>
        <p className="text-sm text-ink-soft mb-6">
          Escolha uma senha só sua para continuar. Em “Senha atual”, digite a senha que você usou para entrar agora.
        </p>
        <FormTrocaSenha onConcluido={() => {}} />
        <button className="btn btn-ghost w-full mt-3" onClick={() => sair()}>
          Sair
        </button>
      </div>
    </div>
  );
}

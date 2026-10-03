/** Regras da senha escolhida pela pessoa — espelho de
 * backend/app/usuarios.py::problemas_senha (o servidor confere de novo).
 * A senha inicial (o telefone) não serve mais: desde 03/10 a troca é
 * obrigatória no primeiro acesso. */

const SENHAS_COMUNS = new Set([
  "12345678", "123456789", "1234567890", "senha123", "senha1234", "password", "password1", "abc12345",
  "castel123", "castel2026", "rancho123", "porto123", "qwerty123", "mudar123", "teste123", "admin123",
]);

export interface RegraSenha {
  id: string;
  texto: string;
  ok: boolean;
}

/** Checklist mostrado ao vivo embaixo do campo. */
export function regrasSenha(nova: string, quem: { telefone?: string | null; usuario?: string | null }): RegraSenha[] {
  const digitos = nova.replace(/\D/g, "");
  const telefone = (quem.telefone ?? "").replace(/\D/g, "");
  const temTelefone =
    telefone.length >= 6 && (digitos.includes(telefone) || (digitos.length >= 6 && telefone.includes(digitos)));
  const baixa = nova.toLowerCase();
  const partes = (quem.usuario ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 4);
  return [
    { id: "tamanho", texto: "Pelo menos 8 caracteres", ok: nova.length >= 8 },
    { id: "mistura", texto: "Letras e números", ok: /[A-Za-z]/.test(nova) && /\d/.test(nova) },
    { id: "telefone", texto: "Sem o seu telefone", ok: nova.length > 0 && !temTelefone },
    { id: "usuario", texto: "Sem o seu nome de usuário", ok: nova.length > 0 && !partes.some((p) => baixa.includes(p)) },
    { id: "comum", texto: "Não é uma senha óbvia (12345678, senha123...)", ok: nova.length > 0 && !SENHAS_COMUNS.has(baixa) },
  ];
}

/** 0 (fraca) a 4 (forte) — só pra barrinha de força. */
export function forcaSenha(nova: string): number {
  if (!nova) return 0;
  let p = 0;
  if (nova.length >= 8) p++;
  if (nova.length >= 12) p++;
  if (/[a-z]/.test(nova) && /[A-Z]/.test(nova)) p++;
  if (/\d/.test(nova) && /[^A-Za-z0-9]/.test(nova)) p++;
  return Math.min(p, 4);
}

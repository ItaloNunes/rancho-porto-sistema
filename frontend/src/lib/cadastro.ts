/** Conferência dos dados cadastrais da proposta (CPF, e-mail, telefones,
 * nascimento). Espelho de backend/app/cadastro_proposta.py: o navegador
 * avisa na hora, o servidor confere de novo antes de gravar. Só confere o
 * que estiver PREENCHIDO — o que é obrigatório continua sendo decidido por
 * cada etapa do formulário.
 *
 * Por que existe (03/10): a proposta 0003 chegou com o e-mail do cliente no
 * campo de celular. */

import type { PessoaDados, QualificacaoDados } from "../types";

export const soDigitos = (t: string | null | undefined) => (t ?? "").replace(/\D/g, "");

export function cpfValido(t: string | null | undefined): boolean {
  const d = soDigitos(t);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    if (((soma * 10) % 11) % 10 !== Number(d[n])) return false;
  }
  return true;
}

export function cnpjValido(t: string | null | undefined): boolean {
  const d = soDigitos(t);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  for (const n of [12, 13]) {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * pesos[i];
    const dv = soma % 11 < 2 ? 0 : 11 - (soma % 11);
    if (dv !== Number(d[n])) return false;
  }
  return true;
}

export const cpfCnpjValido = (t: string | null | undefined) =>
  soDigitos(t).length <= 11 ? cpfValido(t) : cnpjValido(t);

/** DDD + número: 10 (fixo) ou 11 (celular) dígitos, sem letras/@. */
export function telefoneValido(t: string | null | undefined): boolean {
  if (!t || t.includes("@") || /[A-Za-z]/.test(t)) return false;
  const n = soDigitos(t).length;
  return n === 10 || n === 11;
}

export const emailValido = (t: string | null | undefined) => !!t && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t.trim());

export function dataNascimentoValida(t: string | null | undefined): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((t ?? "").trim());
  if (!m) return false;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(a, mes - 1, d);
  if (dt.getFullYear() !== a || dt.getMonth() !== mes - 1 || dt.getDate() !== d) return false;
  return a >= 1900 && dt <= new Date();
}

const preenchido = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

export function problemasPessoa(p: PessoaDados | null | undefined, quem: string): string[] {
  const erros: string[] = [];
  if (!p) return erros;
  if (preenchido(p.cpf_cnpj) && !cpfCnpjValido(p.cpf_cnpj))
    erros.push(`CPF/CNPJ ${quem} inválido (${p.cpf_cnpj}) -- confira os dígitos.`);
  if (preenchido(p.email) && !emailValido(p.email)) erros.push(`E-mail ${quem} inválido (${p.email}).`);
  if (preenchido(p.data_nascimento) && !dataNascimentoValida(p.data_nascimento))
    erros.push(`Data de nascimento ${quem} inválida.`);
  return erros;
}

const TELEFONES: [keyof QualificacaoDados, string][] = [
  ["telefone_celular", "Celular"],
  ["telefone_residencial", "Telefone residencial"],
  ["telefone_comercial", "Telefone comercial"],
  ["telefone_recados", "Telefone para recados"],
];

export function problemasTelefones(dados: QualificacaoDados): string[] {
  const erros: string[] = [];
  for (const [campo, rotulo] of TELEFONES) {
    const v = dados[campo];
    if (preenchido(v) && !telefoneValido(v)) erros.push(`${rotulo} inválido (${v}) -- informe DDD + número (10 ou 11 dígitos).`);
  }
  return erros;
}

/** Tudo junto (mesma lista de cadastro_proposta.problemas_cadastro). */
export function problemasCadastro(dados: QualificacaoDados): string[] {
  const erros: string[] = [];
  if (!preenchido(dados.proponente?.nome)) erros.push("Informe o nome completo do comprador.");
  erros.push(...problemasPessoa(dados.proponente, "do comprador"));
  if (dados.estado_civil === "casado") erros.push(...problemasPessoa(dados.conjuge, "do cônjuge"));
  erros.push(...problemasTelefones(dados));
  return erros;
}

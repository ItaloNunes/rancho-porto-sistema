/** Plano de pagamento da proposta — leitura de valores, conferência e
 * resumo. Espelho EXATO de backend/app/plano_pagamento.py: o navegador
 * avisa na hora (não deixa avançar), o servidor confere de novo antes de
 * gravar. Se mudar uma regra aqui, mude lá também (e vice-versa).
 *
 * Por que existe (02/10): a forma de pagamento era texto livre e chegou ao
 * contrato "Entrada: R$ 9,00" (digitado "8.999"), 1ª parcela "20/10/206" e
 * uma proposta de R$ 89,99 no lugar de R$ 89.990,00. Agora o plano só
 * fecha se entrada + parcelas + chave = valor proposto. */

import type { FormaPagamentoDados, MeioPagamento } from "../types";

export const MEIOS_PAGAMENTO: { valor: MeioPagamento; label: string; texto: string }[] = [
  { valor: "pix", label: "PIX", texto: "PIX" },
  { valor: "transferencia", label: "Transferência (TED)", texto: "transferência bancária (TED)" },
  { valor: "boleto", label: "Boleto bancário", texto: "boleto bancário" },
  { valor: "cheque", label: "Cheque", texto: "cheque" },
  { valor: "dinheiro", label: "Dinheiro", texto: "dinheiro" },
];

export const LIMITE_INFERIOR_TABELA = 0.5;
export const LIMITE_SUPERIOR_TABELA = 1.5;
export const MAX_PARCELAS_ENTRADA = 24;
export const MAX_PARCELAS = 480;

/** "R$ 8.999,00" / "8.999" / "8999,50" / "8999.50" -> número. Ponto seguido
 * de exatamente 3 dígitos é milhar (padrão brasileiro). Formatos aceitos —
 * os MESMOS de backend/app/plano_pagamento.py::normalizar_valor_br:
 *   8.999 / 8.999,00 / 1.234.567,8 | 8999 / 8999,5 | 8999.5 / 8999.50
 * Qualquer outra coisa ("8,999.00", "333,333", "1e3", "8999.", ",5",
 * negativo) é inválida: melhor pedir pra digitar de novo do que adivinhar. */
export function lerValor(texto: string | number | null | undefined): number | null {
  if (texto === null || texto === undefined || texto === "") return null;
  if (typeof texto === "number") return Number.isFinite(texto) ? texto : null;
  const s = String(texto).trim().replace(/R\$/g, "").replace(/\s/g, "");
  if (!s) return null;
  let canon: string | null = null;
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(s)) canon = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d+(?:,\d{1,2})?$/.test(s)) canon = s.replace(",", ".");
  else if (/^\d+\.\d{1,2}$/.test(s)) canon = s;
  if (canon === null) return null;
  const n = Number(canon);
  return Number.isFinite(n) ? n : null;
}

/** 8999.5 -> "8.999,50" */
export function fmtBRL(v: number | null | undefined): string {
  if (v === null || v === undefined) return "-";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 'AAAA-MM-DD' (input date) ou 'DD/MM/AAAA' -> Date local, só se for data
 * real com ano entre 2020 e 2100. Mesma regra de plano_pagamento.py::data. */
export function lerData(texto: string | null | undefined): Date | null {
  if (!texto || typeof texto !== "string") return null;
  const s = texto.trim();
  let a: number, mes: number, d: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (iso) [a, mes, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (br) [d, mes, a] = [Number(br[1]), Number(br[2]), Number(br[3])];
  else return null;
  if (a < 2020 || a > 2100) return null;
  const dt = new Date(a, mes - 1, d);
  if (dt.getFullYear() !== a || dt.getMonth() !== mes - 1 || dt.getDate() !== d) return null;
  return dt;
}

export function fmtData(iso: string | null | undefined): string {
  const d = lerData(iso);
  if (!d) return "-";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** Divide em n parcelas de centavos iguais; o resto vai nas primeiras. */
export function dividirEmParcelas(total: number, n: number): number[] {
  const centavos = Math.round(total * 100);
  const base = Math.floor(centavos / n);
  const valores = Array(n).fill(base);
  const resto = centavos - base * n;
  for (let i = 0; i < resto; i++) valores[i] += 1;
  return valores.map((v) => v / 100);
}

// ---------------------------------------------------------------- extenso
const UNID = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
const DEZ_19 = ["dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

function grupo(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (resto) {
    if (resto < 10) partes.push(UNID[resto]);
    else if (resto < 20) partes.push(DEZ_19[resto - 10]);
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u ? `${DEZENAS[d]} e ${UNID[u]}` : DEZENAS[d]);
    }
  }
  return partes.join(" e ");
}

/** Mesma convenção do contrato (backend/app/documentos_gerados.py ::
 * _numero_extenso): grupos de milhar só separados por espaço — "oito mil
 * novecentos e noventa e nove". Assim o extenso que o corretor vê na tela é
 * exatamente o que sai no contrato. */
export function numeroPorExtenso(n: number): string {
  if (n === 0) return "zero";
  const escalas: [number, string, string][] = [
    [1e9, "bilhão", "bilhões"],
    [1e6, "milhão", "milhões"],
    [1e3, "mil", "mil"],
  ];
  const partes: string[] = [];
  let resto = n;
  for (const [valor, singular, plural] of escalas) {
    const g = Math.floor(resto / valor);
    resto = resto % valor;
    if (!g) continue;
    if (valor === 1e3 && g === 1) partes.push("mil");
    else partes.push(`${grupo(g)} ${g === 1 ? singular : plural}`);
  }
  if (resto) partes.push(grupo(resto));
  return partes.filter(Boolean).join(" ");
}

/** 8999 -> "oito mil novecentos e noventa e nove reais" (só pra mostrar ao
 * corretor; o texto oficial do contrato é montado no servidor). */
export function valorPorExtenso(v: number): string {
  const centavosTotais = Math.round(v * 100);
  const reais = Math.floor(centavosTotais / 100);
  const centavos = centavosTotais % 100;
  const partes: string[] = [];
  if (reais) {
    const ext = numeroPorExtenso(reais);
    const de = reais % 1_000_000 === 0 ? " de" : "";
    partes.push(`${ext}${de} ${reais === 1 ? "real" : "reais"}`);
  }
  if (centavos) partes.push(`${numeroPorExtenso(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  return partes.join(" e ") || "zero reais";
}

// ------------------------------------------------------------------ plano
export interface Plano {
  aVista: boolean | null | undefined;
  valorProposto: number | null;
  renda: number | null;
  entrada: number | null;
  entradaParcelas: number;
  entradaValores: number[];
  parcelas: number | null;
  parcelaValor: number | null;
  chave: number;
  total: number;
}

export function lerPlano(fp: FormaPagamentoDados): Plano {
  const entrada = lerValor(fp.sinal);
  const nEnt = fp.sinal_forma === "parcelada" ? Math.max(1, Number(fp.sinal_parcelas) || 1) : 1;
  const parcelas = fp.dividido_em_parcelas ?? null;
  const parcelaValor = lerValor(fp.valor_parcela);
  const chave = lerValor(fp.chave_valor) ?? 0;
  const valorProposto = fp.valor_proposto ?? null;
  const total = fp.a_vista
    ? valorProposto ?? 0
    : (entrada ?? 0) + (parcelas ?? 0) * (parcelaValor ?? 0) + chave;
  return {
    aVista: fp.a_vista,
    valorProposto,
    renda: lerValor(fp.renda),
    entrada,
    entradaParcelas: nEnt,
    entradaValores: entrada ? dividirEmParcelas(entrada, nEnt) : [],
    parcelas,
    parcelaValor,
    chave,
    total: Math.round(total * 100) / 100,
  };
}

/** Tem que bater no centavo (contrato lista as partes E o total). */
export function tolerancia(_p: Plano): number {
  return 0.005;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** '2026-10-05' -> "5 de outubro de 2026" (confirmação visual da data). */
export function fmtDataExtenso(iso: string | null | undefined): string {
  const d = lerData(iso);
  return d ? `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}` : "-";
}

export const FORMATO_VALOR = "digite só o número em reais, no formato 8.999,00.";

/** Preenchido, mas não é um valor em reais reconhecível (≠ vazio). */
function invalido(bruto: string | null | undefined): boolean {
  return bruto !== null && bruto !== undefined && bruto !== "" && lerValor(bruto) === null;
}

const MEIOS_OK = new Set(MEIOS_PAGAMENTO.map((m) => m.valor));

/** Problemas do plano (vazio = ok). `incluirConfirmacao` = false enquanto o
 * corretor ainda está na etapa de pagamento (as confirmações ficam na
 * revisão). Mesmas regras de plano_pagamento.validar no servidor. */
export function validarPlano(
  fp: FormaPagamentoDados,
  valorTabela: number | null | undefined,
  incluirConfirmacao: boolean,
): string[] {
  const p = lerPlano(fp);
  const erros: string[] = [];
  const vp = p.valorProposto;
  if (!vp || vp <= 0) return ["Informe o valor proposto."];
  if (!p.renda || p.renda <= 0) erros.push("Informe a renda mensal do cliente em reais (ex.: 7.000,00).");

  if (valorTabela) {
    const razao = vp / valorTabela;
    if (razao < LIMITE_INFERIOR_TABELA || razao > LIMITE_SUPERIOR_TABELA) {
      erros.push(
        `O valor proposto (R$ ${fmtBRL(vp)}) está muito diferente do valor de tabela do lote (R$ ${fmtBRL(valorTabela)}). Confira se não faltou ou sobrou algum dígito.`,
      );
    } else if (incluirConfirmacao && Math.abs(vp - valorTabela) > 1 && !fp.confirma_valor_fora_tabela) {
      erros.push(
        `O valor proposto (R$ ${fmtBRL(vp)}) é diferente do valor de tabela (R$ ${fmtBRL(valorTabela)}). Marque a confirmação de valor diferente da tabela.`,
      );
    }
  }

  if (fp.a_vista === null || fp.a_vista === undefined) {
    erros.push("Escolha se o pagamento é à vista ou parcelado.");
  } else if (fp.a_vista) {
    if (!fp.avista_meio || !MEIOS_OK.has(fp.avista_meio))
      erros.push("Informe como o pagamento à vista será feito (PIX, transferência, boleto, cheque ou dinheiro).");
    if (!lerData(fp.avista_data)) erros.push("Informe a data do pagamento à vista (dia/mês/ano).");
  } else {
    if (invalido(fp.sinal)) erros.push(`Valor da entrada inválido: ${FORMATO_VALOR}`);
    else if (!p.entrada || p.entrada <= 0) erros.push("A entrada é obrigatória: informe o valor da entrada.");
    else if (p.entrada >= vp)
      erros.push('A entrada não pode ser igual ou maior que o valor proposto — se for tudo de uma vez, escolha "À vista".');
    if (fp.sinal_forma !== "unica" && fp.sinal_forma !== "parcelada")
      erros.push("Informe se a entrada será paga de uma vez ou parcelada.");
    else if (fp.sinal_forma === "parcelada") {
      const n = Number(fp.sinal_parcelas);
      if (!Number.isInteger(n) || n < 2 || n > MAX_PARCELAS_ENTRADA)
        erros.push(`Entrada parcelada: informe em quantas vezes (de 2 a ${MAX_PARCELAS_ENTRADA}).`);
    }
    if (!fp.sinal_meio || !MEIOS_OK.has(fp.sinal_meio))
      erros.push("Informe como a entrada será paga (PIX, transferência, boleto, cheque ou dinheiro).");
    const dEntrada = lerData(fp.sinal_vencimento);
    if (!dEntrada)
      erros.push(
        fp.sinal_forma === "parcelada"
          ? "Informe a data da 1ª parcela da entrada (dia/mês/ano)."
          : "Informe a data de pagamento da entrada (dia/mês/ano).",
      );
    if (!p.parcelas || !Number.isInteger(p.parcelas) || p.parcelas < 1 || p.parcelas > MAX_PARCELAS)
      erros.push(`Informe a quantidade de parcelas mensais (de 1 a ${MAX_PARCELAS}).`);
    if (invalido(fp.valor_parcela)) erros.push(`Valor da parcela mensal inválido: ${FORMATO_VALOR}`);
    else if (!p.parcelaValor || p.parcelaValor <= 0) erros.push("Informe o valor de cada parcela mensal.");
    const dPrimeira = lerData(fp.primeiro_mes);
    if (!dPrimeira) erros.push("Informe a data da 1ª parcela mensal (dia/mês/ano).");
    else if (dEntrada && dPrimeira < dEntrada) erros.push("A 1ª parcela mensal não pode vencer antes do pagamento da entrada.");
    if (invalido(fp.chave_valor)) erros.push(`Valor da chave inválido: ${FORMATO_VALOR}`);
    if (fp.chave_vencimento && !lerData(fp.chave_vencimento)) erros.push("Data da chave inválida (use dia/mês/ano).");
    if (erros.length === 0 && Math.abs(p.total - vp) > tolerancia(p)) {
      erros.push(
        `A soma não fecha: entrada R$ ${fmtBRL(p.entrada)} + ${p.parcelas} x R$ ${fmtBRL(p.parcelaValor)} + chave R$ ${fmtBRL(p.chave)} = R$ ${fmtBRL(p.total)}, mas o valor proposto é R$ ${fmtBRL(vp)} (diferença de R$ ${fmtBRL(Math.abs(p.total - vp))}).`,
      );
    }
  }
  if (incluirConfirmacao && !fp.confirmado)
    erros.push("Falta a confirmação final: marque que conferiu todos os valores com o cliente.");
  return erros;
}

export function textoMeio(m: string | null | undefined): string {
  return MEIOS_PAGAMENTO.find((x) => x.valor === m)?.texto ?? "-";
}

/** Mesmo resumo que o servidor grava em condicoes_pagamento. */
export function resumoPlano(fp: FormaPagamentoDados): string {
  const p = lerPlano(fp);
  if (fp.a_vista) {
    let s = `À vista: R$ ${fmtBRL(p.valorProposto)}`;
    if (fp.avista_meio) s += ` via ${textoMeio(fp.avista_meio)}`;
    if (lerData(fp.avista_data)) s += ` em ${fmtData(fp.avista_data)}`;
    return s;
  }
  const partes: string[] = [];
  if (p.entrada) partes.push(p.entradaParcelas > 1 ? `Entrada R$ ${fmtBRL(p.entrada)} em ${p.entradaParcelas}x` : `Entrada R$ ${fmtBRL(p.entrada)}`);
  if (p.parcelas && p.parcelaValor) partes.push(`${p.parcelas}x de R$ ${fmtBRL(p.parcelaValor)}`);
  if (p.chave) partes.push(`chave R$ ${fmtBRL(p.chave)}`);
  return partes.join(" + ") || "A combinar";
}

/** O que vai pro servidor: só os campos da modalidade escolhida. Restos de
 * digitação da outra modalidade (ex.: escolheu parcelado, digitou parcelas
 * e depois trocou pra à vista) não viajam — senão um resto inválido
 * barraria a proposta à toa. Mesma limpeza de plano_pagamento.normalizar. */
export function planoParaEnvio(fp: FormaPagamentoDados): FormaPagamentoDados {
  if (fp.a_vista) {
    return {
      ...fp,
      sinal: null,
      sinal_forma: null,
      sinal_parcelas: null,
      sinal_meio: null,
      sinal_vencimento: null,
      sinal_valor_parcela: null,
      dividido_em_parcelas: null,
      valor_parcela: null,
      vencimento: null,
      primeiro_mes: null,
      chave_valor: null,
      chave_vencimento: null,
      intercaladas_valor: null,
    };
  }
  return { ...fp, avista_meio: null, avista_data: null };
}

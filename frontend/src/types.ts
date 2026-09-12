export type LoteStatus = "disponivel" | "reservado" | "vendido";

export interface CondominioResumo {
  id: string;
  slug: string;
  nome: string;
  incorporadora?: string | null;
  cidade?: string | null;
  segmento?: string | null;
  descricao?: string | null;
  logo_url?: string | null;
  hero_image_url?: string | null;
  total_lotes: number;
  total_disponiveis: number;
}

export interface PlanoDecoracao {
  river?: number[][];
  lagoon?: { cx: number; cy: number; rx: number; ry: number };
  entranceRoad?: { x: number; y: number; w: number; h: number };
  roundabout1?: { cx: number; cy: number; r: number };
  roundabout2?: { cx: number; cy: number; r: number };
}

export interface Lote {
  id: string;
  condominio_id: string;
  quadra: string;
  lote_numero: number;
  identificador: string;
  tamanho_m2: number;
  valor_total?: number | null;
  entrada?: number | null;
  entrega?: number | null;
  parcela_mensal?: number | null;
  qtd_parcelas?: number | null;
  prazo_entrega_meses?: number | null;
  status: LoteStatus;
  poligono: number[][];
  /** Só true depois que um admin marcou os cantos do lote na ferramenta do
   * painel — até lá `poligono` é só um placeholder de grade (não representa
   * a forma real do lote na planta em imagem). */
  poligono_definido?: boolean;
  foto_url?: string | null;
}

export interface QuadraZona {
  /** Presente quando o empreendimento tem quadras reais (ex.: Porto Franco): casa por igualdade com Lote.quadra. */
  quadra?: string | null;
  /** Presentes quando a zona representa uma faixa de números de lote (ex.: Rancho Texas). */
  lote_min?: number | null;
  lote_max?: number | null;
  /** Texto exibido no chip de filtro; se ausente, cai para "Quadra {quadra}". */
  label?: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// Painel gerencial (CRM): corretores (logins), clientes/leads, propostas e
// reservas. Só usado dentro de /painel (autenticado) — nunca no catálogo público.
// ---------------------------------------------------------------------------

export type Papel = "admin" | "corretor";

export interface Corretor {
  id: string;
  nome: string;
  email?: string | null;
  telefone?: string | null;
  papel: Papel;
  ativo: boolean;
}

export interface Cliente {
  id: string;
  nome: string;
  telefone?: string | null;
  email?: string | null;
  cpf?: string | null;
  observacoes?: string | null;
  origem?: string | null;
  corretor_id?: string | null;
  created_at: string;
}

export type PropostaStatus =
  | "rascunho"
  | "aguardando_aprovacao"
  | "aprovada"
  | "enviada"
  | "aceita"
  | "recusada"
  | "cancelada";

export interface Proposta {
  id: string;
  lote_id: string;
  cliente_id: string;
  corretor_id?: string | null;
  valor_proposto: number;
  condicoes_pagamento?: string | null;
  status: PropostaStatus;
  documento_url?: string | null;
  observacoes?: string | null;
  created_at: string;
}

export interface PropostaDetalhe extends Proposta {
  lote?: Lote | null;
  cliente?: Cliente | null;
}

export type ReservaStatus =
  | "pendente"
  | "em_atendimento"
  | "aguardando_qualificacao"
  | "em_analise_financeira"
  | "confirmada"
  | "cancelada";

export interface Reserva {
  id: string;
  lote_id: string;
  nome?: string | null;
  contato?: string | null;
  observacao?: string | null;
  status: ReservaStatus;
  cliente_id?: string | null;
  corretor_id?: string | null;
  /** Preenchido quando a reserva entra em "em_analise_financeira" (now + 48h) —
   * só um alerta/contador no painel, ninguém libera o lote sozinho por causa disso. */
  analise_prazo_em?: string | null;
  created_at: string;
}

export interface ReservaComLote extends Reserva {
  lote?: Lote | null;
}

export interface LoteComCondominio extends Lote {
  condominio_nome: string;
  condominio_slug: string;
}

export interface VisaoGeralCondominio {
  condominio_id: string;
  nome: string;
  slug: string;
  total_lotes: number;
  disponiveis: number;
  reservados: number;
  vendidos: number;
  valor_total_vendido: number;
  propostas_abertas: number;
  valor_em_propostas_abertas: number;
}

// ---------------------------------------------------------------------------
// Qualificação do cliente final: reserva -> link público -> formulário em
// etapas + documentos -> análise financeira manual -> aprova (gera proposta)
// ou reprova. Ver backend/app/routers/qualificacao.py.
// ---------------------------------------------------------------------------

export type QualificacaoStatus = "aguardando_preenchimento" | "em_analise" | "aprovada" | "reprovada";
export type EstadoCivil = "solteiro" | "casado" | "viuvo" | "divorciado" | "outros";
export type DocumentoTipo =
  | "rg"
  | "cpf"
  | "comprovante_residencia"
  | "certidao_nascimento_casamento"
  | "conjuge_rg"
  | "conjuge_cpf"
  | "comprovante_renda"
  | "outro";

export const DOCUMENTOS_OBRIGATORIOS: DocumentoTipo[] = [
  "rg",
  "cpf",
  "comprovante_residencia",
  "certidao_nascimento_casamento",
  "comprovante_renda",
];
export const DOCUMENTOS_CONJUGE: DocumentoTipo[] = ["conjuge_rg", "conjuge_cpf"];

export const DOCUMENTO_LABEL: Record<DocumentoTipo, string> = {
  rg: "RG",
  cpf: "CPF",
  comprovante_residencia: "Comprovante de residência",
  certidao_nascimento_casamento: "Certidão de nascimento ou casamento",
  conjuge_rg: "RG do cônjuge",
  conjuge_cpf: "CPF do cônjuge",
  comprovante_renda: "Comprovante de renda",
  outro: "Outro documento",
};

export interface EnderecoDados {
  rua?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
}

export interface PessoaDados {
  nome?: string | null;
  rg?: string | null;
  orgao_expedidor?: string | null;
  cpf_cnpj?: string | null;
  data_nascimento?: string | null;
  nacionalidade?: string | null;
  email?: string | null;
  profissao?: string | null;
}

export interface FormaPagamentoDados {
  a_vista?: boolean | null;
  renda?: string | null;
  valor_proposto?: number | null;
  sinal?: string | null;
  sinal_cheque_numero?: string | null;
  sinal_banco?: string | null;
  sinal_agencia?: string | null;
  dividido_em_parcelas?: number | null;
  valor_parcela?: string | null;
  vencimento?: string | null;
  primeiro_mes?: string | null;
  intercaladas_valor?: string | null;
  intercaladas_vencimento_dia?: string | null;
  observacoes?: string | null;
}

export interface QualificacaoDados {
  proponente: PessoaDados;
  estado_civil?: EstadoCivil | null;
  conjuge?: PessoaDados | null;
  endereco_residencial: EnderecoDados;
  endereco_comercial: EnderecoDados;
  // Nem todo proponente tem endereço comercial próprio (autônomo, aposentado
  // etc.) — sem essa flag não dá pra distinguir "não preencheu ainda" de
  // "não se aplica" na validação do envio final.
  endereco_comercial_nao_possui?: boolean | null;
  telefone_residencial?: string | null;
  telefone_comercial?: string | null;
  telefone_celular?: string | null;
  telefone_recados?: string | null;
  falar_com?: string | null;
  forma_pagamento: FormaPagamentoDados;
}

export function qualificacaoDadosVazio(): QualificacaoDados {
  return {
    proponente: {},
    estado_civil: null,
    conjuge: null,
    endereco_residencial: {},
    endereco_comercial: {},
    endereco_comercial_nao_possui: false,
    forma_pagamento: {},
  };
}

export interface DocumentoQualificacao {
  id: string;
  formulario_id: string;
  tipo: DocumentoTipo;
  nome_arquivo: string;
  tamanho_bytes?: number | null;
  enviado_em: string;
}

export interface Qualificacao {
  id: string;
  reserva_id: string;
  lote_id: string;
  cliente_id: string;
  corretor_id?: string | null;
  token: string;
  status: QualificacaoStatus;
  dados: Partial<QualificacaoDados>;
  enviado_em?: string | null;
  analisado_em?: string | null;
  analisado_por?: string | null;
  motivo_reprovacao?: string | null;
  created_at: string;
}

export interface QualificacaoComRelacoes extends Qualificacao {
  lote?: Lote | null;
  cliente?: Cliente | null;
  corretor?: Corretor | null;
  documentos: DocumentoQualificacao[];
}

export interface QualificacaoPublica {
  status: QualificacaoStatus;
  dados: Partial<QualificacaoDados>;
  documentos: DocumentoQualificacao[];
  lote_identificador: string;
  condominio_nome: string;
  motivo_reprovacao?: string | null;
}

export interface CondominioDetalhe extends CondominioResumo {
  plan_w?: number | null;
  plan_h?: number | null;
  plan_minx?: number | null;
  plan_miny?: number | null;
  plan_decor?: PlanoDecoracao | null;
  /** Quando preenchido, a planta é a imagem real (ver plan_quadras) em vez do modo polígono-por-lote. */
  plan_image_url?: string | null;
  /** Zonas clicáveis aproximadas por quadra — só usado quando plan_image_url está preenchido. */
  plan_quadras?: QuadraZona[] | null;
  base_precos_em?: string | null;
  lotes: Lote[];
}

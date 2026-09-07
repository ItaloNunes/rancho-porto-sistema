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

export type PropostaStatus = "rascunho" | "enviada" | "aceita" | "recusada" | "cancelada";

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

export type ReservaStatus = "pendente" | "confirmada" | "cancelada";

export interface Reserva {
  id: string;
  lote_id: string;
  nome?: string | null;
  contato?: string | null;
  observacao?: string | null;
  status: ReservaStatus;
  cliente_id?: string | null;
  corretor_id?: string | null;
  created_at: string;
}

export interface ReservaComLote extends Reserva {
  lote?: Lote | null;
}

export interface LoteComCondominio extends Lote {
  condominio_nome: string;
  condominio_slug: string;
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

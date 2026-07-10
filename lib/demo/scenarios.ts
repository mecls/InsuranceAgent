import type { CustomerChannel, Vertical } from '@/lib/procurement/case-file'

/**
 * Scripted vendor scenarios for the demo. A customer asks the business for a
 * price; the `customerAnswer` is the reply that resolves the clarifying questions
 * so the whole flow — receber → esclarecer → aguardar cliente → orçamentar →
 * enviar — plays end to end without any real messaging.
 */

export interface Scenario {
  id: string
  vertical: Vertical
  label: string
  customer: { name: string; channel: CustomerChannel; contact: string }
  request: { summary: string; rawText: string; category: string }
  /** The customer's reply to the agent's clarifying questions. */
  customerAnswer: string
}

export const SCENARIOS: Record<string, Scenario> = {
  fachada: {
    id: 'fachada',
    vertical: 'obra',
    label: 'Pintura de fachada — cliente por WhatsApp',
    customer: { name: 'Sr. Almeida', channel: 'whatsapp', contact: '+351910000001' },
    request: {
      summary: 'Pintura e impermeabilização da fachada de um prédio',
      rawText: 'Boa tarde, precisava de um orçamento para pintar a fachada do meu prédio. Também há umas infiltrações. Quanto fica?',
      category: 'Pintura de fachada',
    },
    customerAnswer:
      'A fachada tem cerca de 200 m2. Sim, é preciso andaimes. E sim, incluir a impermeabilização das zonas com infiltrações. Queria começar no próximo mês.',
  },

  escritorio: {
    id: 'escritorio',
    vertical: 'remodelacao',
    label: 'Remodelação de escritório — cliente por email',
    customer: { name: 'Rita Fonseca', channel: 'email', contact: 'rita.fonseca@exemplo.pt' },
    request: {
      summary: 'Remodelação de um open space de escritório',
      rawText: 'Bom dia, gostaríamos de um orçamento para remodelar o nosso open space. Podem ajudar?',
      category: 'Remodelação de interiores',
    },
    customerAnswer:
      'O espaço tem 120 m2. Precisamos de divisórias em pladur (cerca de 40 m2), instalação elétrica com 15 pontos novos, pavimento vinílico em todo o espaço e pintura no fim.',
  },

  canalizacao: {
    id: 'canalizacao',
    vertical: 'canalizacao',
    label: 'Reparação de canalização — cliente por formulário',
    customer: { name: 'João Martins', channel: 'form', contact: 'joao.martins@exemplo.pt' },
    request: {
      summary: 'Reparação de fuga de água e substituição de torneira',
      rawText: 'Tenho uma fuga de água na cozinha e a torneira também está a pingar. Quanto custa arranjar?',
      category: 'Canalização',
    },
    customerAnswer:
      'A fuga é numa junção visível debaixo do lava-loiça. E queria também trocar a misturadora da cozinha por uma nova. Podem vir esta semana.',
  },
}

export const SCENARIO_KEYS = Object.keys(SCENARIOS)

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS[id]
}

export function isDemoScenario(id: string): boolean {
  return id in SCENARIOS
}

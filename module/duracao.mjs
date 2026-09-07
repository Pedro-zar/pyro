/**
 * Prazo de um efeito, numa unidade só: quem escreve escolhe turno, segundo ou
 * rodada, e o sistema guarda os três lados da mesma coisa.
 *
 * Turno e segundo são a mesma régua (um turno são seis segundos, SRD §1), e é
 * o relógio de tempo.mjs que os desconta. A rodada é outra régua — ela estica
 * conforme a quantidade de gente em cena — e por isso tem contador próprio,
 * descontado só quando a rodada vira.
 *
 * O que fica gravado no efeito:
 *   flags.<sys>.prazo   { valor, unidade }  o que foi escrito, para a edição
 *   flags.<sys>.turnos  turnos que faltam   (unidades turnos e segundos)
 *   flags.<sys>.rodadas rodadas que faltam  (unidade rodadas)
 *   duration            a duração nativa, para a ficha e para o efeito parar
 *                       de valer quando não há combate contando nada
 */
import { PYRO } from "./config.mjs";
import { SYSTEM_ID, flagsDe } from "./sistema.mjs";

const loc = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/** Sem prazo: o efeito fica até algo consumi-lo. */
export const SEM_PRAZO = null;
export const UNIDADE_PADRAO = "turnos";

/** A unidade é contada pelo relógio de turnos? Rodada tem contador próprio. */
export const contaEmTurnos = unidade => unidade !== "rodadas";

/** Quantos turnos vale um prazo escrito nesta unidade. */
export function turnosDe(valor, unidade = UNIDADE_PADRAO) {
  const n = Math.max(0, Number(valor) || 0);
  if (!n || !contaEmTurnos(unidade)) return 0;
  return unidade === "segundos" ? PYRO.turnosDeSegundos(n) : Math.round(n);
}

/** O contrário: turnos de volta para a unidade em que o prazo foi escrito. */
export function daUnidade(turnos, unidade = UNIDADE_PADRAO) {
  const n = Math.max(0, Number(turnos) || 0);
  return unidade === "segundos" ? n * PYRO.SEGUNDOS_POR_TURNO : n;
}

/**
 * Duração nativa equivalente, para a ficha mostrar a contagem e para o efeito
 * parar de valer fora de combate, onde ninguém passa turno (ver
 * PyroActiveEffect#prazoVencido). Quem apaga o efeito é o relógio.
 */
function duracaoNativa(valor, unidade) {
  const n = Math.max(0, Number(valor) || 0);
  const emRodadas = !contaEmTurnos(unidade);
  /*
   * Todos os campos vão escritos, inclusive os nulos: um update do Foundry
   * funde o que recebe, então mandar só o campo novo deixaria o antigo vivo —
   * um prazo trocado de turnos para rodadas ficaria com os dois contando, e
   * uma edição que tira a duração não tiraria nada.
   */
  return {
    seconds: n && !emRodadas ? daUnidade(turnosDe(n, unidade), "segundos") : null,
    rounds: n && emRodadas ? n : null,
    turns: null,
    startTime: n && !emRodadas ? (game.time?.worldTime ?? 0) : null
  };
}

/**
 * Dados de criação do prazo: as flags e a duração nativa, prontos para entrar
 * num ActiveEffect. Sem valor, devolve o que limpa o prazo que houver.
 */
export function dadosDePrazo(valor, unidade = UNIDADE_PADRAO, extras = {}) {
  const emTurnos = contaEmTurnos(unidade);
  /*
   * O total guardado é o que o relógio de fato vai contar: em segundos, um
   * prazo de 10s cabe em 2 turnos, então ele vale 12s. Guardar os 10 escritos
   * faria a ficha mostrar "12 / 10 s" no instante em que o efeito nasce.
   */
  const escrito = Math.max(0, Number(valor) || 0);
  const n = emTurnos ? daUnidade(turnosDe(escrito, unidade), unidade) : escrito;
  return {
    duration: duracaoNativa(n, unidade),
    flags: {
      [SYSTEM_ID]: {
        prazo: n ? { valor: n, unidade } : null,
        turnos: n && emTurnos ? turnosDe(n, unidade) : SEM_PRAZO,
        rodadas: n && !emTurnos ? n : null,
        ...extras
      }
    }
  };
}

/** O mesmo, achatado para um update de efeito já existente. */
export function updateDePrazo(valor, unidade = UNIDADE_PADRAO) {
  const { duration, flags } = dadosDePrazo(valor, unidade);
  const dados = { duration };
  for (const [chave, v] of Object.entries(flags[SYSTEM_ID])) {
    dados[`flags.${SYSTEM_ID}.${chave}`] = v;
  }
  return dados;
}

/** O prazo escrito no efeito, com o que ainda falta. Null quando não há. */
export function prazoDoEfeito(efeito) {
  const flags = flagsDe(efeito);
  const prazo = flags?.prazo;
  if (!prazo?.valor) return null;
  const unidade = prazo.unidade ?? UNIDADE_PADRAO;
  const restante = contaEmTurnos(unidade)
    ? daUnidade(flags.turnos ?? 0, unidade)
    : Math.max(0, Number(flags.rodadas) || 0);
  return { valor: prazo.valor, unidade, restante };
}

/**
 * Etiqueta do prazo na lista de efeitos: o total e o que falta, na mesma
 * medida em que o prazo foi escrito. Efeito sem prazo nosso cai na etiqueta do
 * próprio Foundry, que é o que a ficha mostrava antes.
 */
export function rotuloDePrazo(efeito) {
  const prazo = prazoDoEfeito(efeito);
  if (!prazo) {
    // Condição sem prazo (o Molhado espera o frio) não tem contagem nenhuma:
    // a etiqueta do Foundry diria "Nenhum", que é o oposto do que ela faz.
    const d = efeito?.duration;
    return d?.seconds || d?.rounds || d?.turns ? d.label ?? "" : "";
  }
  const unidade = loc(PYRO.unidadesDeDuracao[prazo.unidade]?.curto ?? prazo.unidade);
  return loc("PYRO.Duracao.Restam", {
    restante: prazo.restante, total: prazo.valor, unidade
  });
}

/** Unidades no formato que o selectOptions do Foundry espera. */
export function opcoesDeUnidade() {
  return Object.fromEntries(
    Object.entries(PYRO.unidadesDeDuracao).map(([valor, cfg]) => [valor, loc(cfg.label)])
  );
}

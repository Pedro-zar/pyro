/**
 * Relógio do combate: cada turno que passa vale 6 segundos para todo mundo em
 * cena (SRD §1), então é o turno — e não a rodada — que faz as condições
 * queimarem e expirarem.
 *
 * A rodada não serve de unidade porque ela estica: dois lutando fazem rodadas
 * de 12 segundos, dez fazem de 60. Um minuto são sempre dez turnos, e é assim
 * que a Friagem dura o que a regra diz, com dois ou com dez em cena.
 *
 * Tudo que acontece num turno sai num card só. Um aviso por condição encheria
 * o chat de linhas soltas justamente no momento em que a mesa quer ler rápido
 * o que mudou.
 */
import { PYRO } from "./config.mjs";
import { esc } from "./ui.mjs";
import { SYSTEM_ID, flagsDe, flagsDoSistema, naFila } from "./sistema.mjs";
import { pilhasDe } from "./condicoes.mjs";

const loc = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/**
 * Atores em cena no combate, sem repetir quem tem mais de um token.
 *
 * A conta é por uuid, e não por id: três goblins não vinculados saem do mesmo
 * ator base e compartilham o id, mas cada um tem o seu próprio corpo — pelo id
 * só o primeiro da lista queimaria.
 */
function atoresDoCombate(combate) {
  const vistos = new Set();
  const lista = [];
  for (const combatente of combate?.combatants ?? []) {
    const actor = combatente.actor;
    if (!actor || vistos.has(actor.uuid)) continue;
    vistos.add(actor.uuid);
    lista.push(actor);
  }
  return lista;
}

/**
 * Queima quem está Queimando: 1d6 de calor por pilha, num rolamento só.
 * Queimando 7 rola 7d6 de uma vez, que é a mesma conta e uma linha só no card.
 */
async function queimar(actor, relatos, rolagens) {
  const pilhas = pilhasDe(actor, "queimando");
  if (!pilhas) return;
  const roll = await new Roll(`${pilhas}d6`).evaluate();
  rolagens.push(roll);
  await actor.aplicarDano([{ tipo: "calor", total: roll.total }]);
  relatos.push(loc("PYRO.Tempo.Queimou", {
    nome: esc(actor.name), pilhas, dano: roll.total
  }));
}

/**
 * Passa um turno para um ator: as condições com prazo perdem um turno, e as
 * que chegam a zero saem.
 *
 * Fora da fila de propósito. Queimar aplica dano, e aplicar dano pode consumir
 * o Molhado, que entra na fila deste mesmo ator — enfileirar aqui faria a
 * chamada de dentro esperar a de fora e o turno travaria sem erro nenhum.
 */
async function passarTurnoDoAtor(actor, relatos, rolagens, ehSeuTurno) {
  await queimar(actor, relatos, rolagens);
  return naFila(actor, () => vencerPrazos(actor, relatos, ehSeuTurno));
}

/** Desconta um turno dos efeitos com prazo e remove os que acabaram. */
async function vencerPrazos(actor, relatos, ehSeuTurno) {
  for (const efeito of [...(actor.effects ?? [])]) {
    const flags = flagsDe(efeito);
    // Sem prazo (Molhado) ou sem prazo nosso: o tempo não o alcança.
    if (!flags || flags.turnos === null || flags.turnos === undefined) continue;
    // Efeito que dura "até o fim do próximo turno" só conta os turnos de quem
    // o carrega — nos turnos dos outros ele não anda.
    if (flags.porTurnoProprio && !ehSeuTurno) continue;

    const restam = (Number(flags.turnos) || 0) - 1;
    if (restam > 0) {
      await efeito.update({ [`flags.${SYSTEM_ID}.turnos`]: restam });
      continue;
    }
    await efeito.delete();
    const chave = flags.condicao;
    relatos.push(loc("PYRO.Tempo.Expirou", {
      nome: esc(actor.name),
      condicao: esc(chave ? loc(PYRO.condicoes[chave]?.label ?? chave)
                          : (flags.rotulo ?? efeito.name))
    }));
  }
}

/**
 * Um turno passou: 6 segundos correm para todos os que estão em cena.
 * Publica um card só com tudo que aconteceu, e nada quando nada aconteceu.
 */
export async function passarTurno(combate, atorDoTurno = null) {
  const relatos = [];
  const rolagens = [];
  for (const actor of atoresDoCombate(combate)) {
    if (!actor.isOwner) continue;
    await passarTurnoDoAtor(actor, relatos, rolagens, actor.uuid === atorDoTurno);
  }
  return publicarTurno(relatos, rolagens);
}

/** Card único do que o tempo fez; nada quando nada aconteceu. */
function publicarTurno(relatos, rolagens) {
  if (!relatos.length) return null;

  return ChatMessage.create({
    content: `<div class="pyro-chat pyro-turno">
      <header class="pyro-turno-topo">
        <h3>${loc("PYRO.Tempo.Titulo")}</h3>
        <span class="pyro-item-meta">${loc("PYRO.Tempo.Passaram", {
          s: PYRO.SEGUNDOS_POR_TURNO
        })}</span>
      </header>
      <ul class="pyro-turno-lista">${relatos.map(r => `<li>${r}</li>`).join("")}</ul>
    </div>`,
    rolls: rolagens,
    flags: flagsDoSistema({ relogio: true }),
    sound: rolagens.length ? CONFIG.sounds.dice : undefined
  });
}

/*
 * Onde cada combate estava antes desta atualização.
 *
 * Vários updates escrevem round e turn sem que tempo nenhum tenha passado:
 * começar o combate, voltar um turno, e rolar iniciativa no meio da luta, que
 * reordena a lista e mexe no índice do turno para manter o mesmo combatente em
 * cena. Sem comparar com o estado anterior, um clique no botão de voltar
 * aplicaria mais um turno de Queimando.
 */
const posicoes = new Map();

const posicaoDe = combate => ({
  round: Number(combate.round) || 0,
  turn: Number(combate.turn) || 0,
  iniciado: !!combate.started,
  // O combatente identifica o turno melhor que o índice: reordenar a lista
  // muda o índice sem trocar de quem é a vez.
  combatenteId: combate.combatant?.id ?? null,
  atorUuid: combate.combatant?.actor?.uuid ?? null
});

/**
 * Este update foi um turno passando? Devolve também de quem era o turno que
 * acabou, que é o que os efeitos "até o fim do próximo turno" precisam saber.
 */
export function avancouUmTurno(combate, mudanca, opcoes) {
  const agora = posicaoDe(combate);
  const antes = posicoes.get(combate.id);
  posicoes.set(combate.id, agora);

  const parado = { passou: false, atorUuid: null };
  if (mudanca.turn === undefined && mudanca.round === undefined) return parado;
  if (!combate.started) return parado;
  // Sem estado anterior (recarga de página) ou combate que acabou de começar:
  // este update é o retrato inicial, e não um turno gasto.
  if (!antes?.iniciado) return parado;

  const deQuem = { passou: true, atorUuid: antes.atorUuid };
  // Os botões de próximo e de voltar turno declaram a direção.
  if (opcoes?.direction !== undefined) {
    return opcoes.direction > 0 ? deQuem : parado;
  }
  // Sem direção declarada, a vez precisa ter mudado de dono: só reordenar a
  // iniciativa não gasta tempo, mesmo mexendo no índice do turno.
  if (agora.combatenteId === antes.combatenteId) return parado;
  const avancou = agora.round > antes.round
    || (agora.round === antes.round && agora.turn > antes.turn);
  return avancou ? deQuem : parado;
}

/** O efeito conta o relógio do sistema? */
const temPrazo = efeito => {
  const f = flagsDe(efeito);
  return !!f && f.turnos !== null && f.turnos !== undefined;
};

/** Tira do ator todo efeito que dependia do relógio. */
function limparPrazosDoAtor(actor) {
  return naFila(actor, async () => {
    const vencidos = [...(actor.effects ?? [])].filter(temPrazo).map(e => e.id);
    if (vencidos.length) await actor.deleteEmbeddedDocuments("ActiveEffect", vencidos);
  });
}

/**
 * O combate acabou: os prazos que ele contava não têm mais quem os conte.
 * Sem isso a Defesa de Pedra e o Queimando ficariam presos no ator até alguém
 * apagar o efeito na mão.
 */
async function limparPrazos(combate) {
  // Encontro montado e apagado sem começar não gastou tempo de ninguém.
  if (!combate.started) return;
  for (const actor of atoresDoCombate(combate)) {
    if (!actor.isOwner) continue;
    // Quem ainda está em outro combate em andamento continua com relógio.
    const noutro = (game.combats ?? []).some(c => c.id !== combate.id && c.started
      && atoresDoCombate(c).some(a => a.uuid === actor.uuid));
    if (noutro) continue;
    await limparPrazosDoAtor(actor);
  }
}

/**
 * Liga o relógio ao rastreador de combate.
 *
 * Um cliente só faz a conta, senão cada jogador na mesa aplicaria o mesmo
 * dano de Queimando. O escolhido é o mestre ativo, que é quem enxerga todos
 * os atores da cena.
 */
export function registrarRelogio() {
  // Retrato inicial dos combates em andamento: sem ele, o primeiro avanço de
  // turno depois de uma recarga de página não teria com o que ser comparado e
  // seria descartado, deixando de queimar quem estava queimando.
  Hooks.once("ready", () => {
    for (const combate of game.combats ?? []) posicoes.set(combate.id, posicaoDe(combate));
  });

  Hooks.on("updateCombat", async (combate, mudanca, opcoes) => {
    const { passou, atorUuid } = avancouUmTurno(combate, mudanca, opcoes);
    if (!passou) return;
    if (!(game.users.activeGM?.isSelf ?? game.user.isGM)) return;
    await passarTurno(combate, atorUuid);
  });

  Hooks.on("deleteCombat", async combate => {
    posicoes.delete(combate.id);
    if (game.users.activeGM?.isSelf ?? game.user.isGM) await limparPrazos(combate);
  });
}

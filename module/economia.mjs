/**
 * Contador de ações e reações do turno (SRD §5).
 *
 * No próprio turno o personagem tem ações, e no turno de cada outro
 * combatente tem reações. O contador não é zerado por ninguém: o ator guarda
 * quanto gastou e em qual turno (a marca), e um gasto com a marca de outro
 * turno é de um turno que já passou. Assim o contador enche sozinho quando o
 * turno anda, e não depende de haver um mestre conectado para refazer a
 * conta.
 *
 * A marca é a do combatente da vez, e não a posição dele na fila: rolar
 * iniciativa no meio da rodada reordena a fila sem passar o turno, e uma
 * marca por posição encheria o contador de todo mundo nessa hora.
 *
 * Fora de combate nada é contado: não há turno para encher o contador de
 * novo, e cobrar ali só deixaria o personagem sem ações para sempre.
 */
import { PYRO } from "./config.mjs";
import { esc } from "./ui.mjs";

const loc = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/** Quantos pontos de reação uma ação custa fora do próprio turno (SRD §5). */
export const REACOES_POR_ACAO = 2;

/** Marca do turno em andamento. Vazia quando o combate não começou. */
export function marcaDoTurno(combate) {
  if (!combate?.started) return "";
  return `${combate.id}:${combate.round}:${combate.combatant?.id ?? combate.turn}`;
}

/**
 * O ator é um dos combatentes? O de token não vinculado é aquele token, e
 * só ele. O ator do diretório com tokens não vinculados em cena não luta:
 * quem luta são as cópias, e um gasto na ficha do diretório passaria para
 * todas elas.
 */
function participa(combate, actor) {
  if (actor.isToken) {
    const token = actor.token;
    return combate.combatants.some(c => c.tokenId === token?.id && c.sceneId === token?.parent?.id);
  }
  return combate.combatants.some(c => c.actorId === actor.id && c.token?.actorLink !== false);
}

/**
 * O combate em andamento em que o ator luta, ou null. O que a tela mostra
 * vem primeiro. Os outros entram porque o jogador pode estar olhando outra
 * cena enquanto o personagem luta, e ali tudo sairia de graça.
 */
export function combateDoAtor(actor) {
  if (!actor) return null;
  const candidatos = [game.combat, ...(game.combats ?? [])].filter(c => c?.started);
  return candidatos.find(c => participa(c, actor)) ?? null;
}

/** Inteiro não negativo, para máximos que um efeito pode ter multiplicado. */
const inteiro = valor => Math.max(0, Math.floor(Number(valor) || 0));

/**
 * Reações a mais do Atrasar ação que ainda valem: da rodada em que foram
 * ganhas até o próximo turno do personagem.
 * @param {object} guardado o system.economia do ator.
 * @param {object} agora { combateId, rodada, turno, meuTurno } do combate.
 */
export function extraValido(guardado, { combateId, rodada, turno, meuTurno }) {
  const extra = inteiro(guardado?.extra);
  if (!extra) return 0;
  const [id, r] = String(guardado?.extraDe ?? "").split(":");
  if (id !== combateId) return 0;
  const ganha = Number(r);
  if (rodada === ganha) return extra;
  if (rodada === ganha + 1 && meuTurno >= 0 && turno < meuTurno) return extra;
  return 0;
}

/**
 * O contador do ator agora: em que modo está (ações no próprio turno,
 * reações no dos outros), quanto cabe e quanto sobra.
 *
 * @returns {{rastreia: boolean, modo: string|null, max: number, gastas: number,
 *   extra: number, disponivel: number, marca: string, acoesMax: number,
 *   reacoesMax: number, combate: Combat|null}}
 */
export function economiaDoAtor(actor) {
  const sys = actor?.system ?? {};
  const acoesMax = inteiro(sys.acoesMax);
  const reacoesMax = inteiro(sys.reacoesMax);
  const combate = combateDoAtor(actor);
  if (!combate) {
    return { rastreia: false, modo: null, max: acoesMax, gastas: 0, extra: 0,
      disponivel: acoesMax, marca: "", acoesMax, reacoesMax, combate: null };
  }
  const modo = combate.combatant?.actor?.uuid === actor.uuid ? "acoes" : "reacoes";
  const extra = modo === "reacoes" ? extraValido(sys.economia, {
    combateId: combate.id, rodada: combate.round, turno: combate.turn,
    meuTurno: combate.turns.findIndex(c => c.actor?.uuid === actor.uuid)
  }) : 0;
  return {
    ...estadoDoContador({
      modo, acoesMax, reacoesMax, marca: marcaDoTurno(combate), guardado: sys.economia, extra
    }),
    combate
  };
}

/**
 * A conta do contador, separada do combate para ser testável: o gasto
 * guardado só vale se a marca for a do turno em andamento. As reações do
 * Atrasar ação ficam por cima do máximo.
 */
export function estadoDoContador({ modo, acoesMax, reacoesMax, marca, guardado, extra = 0 }) {
  const max = modo === "acoes" ? acoesMax : reacoesMax;
  const gastas = guardado?.marca === marca ? inteiro(guardado?.gastas) : 0;
  return {
    rastreia: true, modo, max, gastas, extra,
    disponivel: Math.max(0, max - gastas) + extra,
    marca, acoesMax, reacoesMax
  };
}

/**
 * Como um gasto de `pontos` se divide: primeiro o que o turno ainda tem,
 * depois as reações a mais do Atrasar ação.
 */
export function dividirGasto(eco, pontos) {
  const doTurno = Math.min(pontos, Math.max(0, eco.max - eco.gastas));
  return { doTurno, doExtra: Math.min(eco.extra ?? 0, pontos - doTurno) };
}

/**
 * Pontos que um custo tira do contador. Fora do turno uma ação vale duas
 * reações. No próprio turno uma reação vale uma ação.
 * @param {number} n o custo escrito.
 * @param {string} tipo "acao" ou "reacao".
 * @param {string} modo o modo do contador.
 */
export function pontosDoCusto(n, tipo, modo) {
  const q = inteiro(Math.round(Number(n) || 0));
  return modo === "reacoes" && tipo !== "reacao" ? q * REACOES_POR_ACAO : q;
}

/** "1 ação", "3 ações", "1 reação", "4 reações". */
export function textoDeAcoes(n, tipo) {
  const q = inteiro(n);
  const chave = tipo === "reacao" ? "reacao" : "acao";
  return `${q} ${loc(q === 1 ? `PYRO.Custos.${chave}` : `PYRO.Custos.${chave}Plural`)}`;
}

/**
 * O que o card diz que foi pago. Quando a ação saiu em reações, o card
 * mostra as duas coisas: sem isso "4 reações" num ataque de 2 ações parece
 * conta errada.
 */
export function textoDoPagamento(n, tipo, modo) {
  const pontos = pontosDoCusto(n, tipo, modo);
  const pago = textoDeAcoes(pontos, modo === "reacoes" ? "reacao" : "acao");
  if (modo === "reacoes" && tipo !== "reacao") {
    return loc("PYRO.Economia.Convertido", { pago, custo: textoDeAcoes(n, "acao") });
  }
  return pago;
}

/**
 * Faz o que a linha do Guia descreve: cobra e anuncia. Os caminhos próprios
 * cuidam do gasto e do card deles.
 */
export async function fazerAcaoDoGuia(actor, chave) {
  const cfg = PYRO.acoesDoGuia[chave];
  if (!actor || !cfg) return;
  if (cfg.metodo) return actor[cfg.metodo]?.();
  if (!actor.podeAgir()) return;

  const tipo = cfg.tipo ?? "acao";
  // Confere as duas coisas antes de cobrar qualquer uma: salto sem estamina
  // não pode levar as ações e parar no meio.
  if (!actor.podeGastarAcoes(cfg.acoes, { tipo })) return;
  let pagoEstamina = null;
  if (cfg.estamina) {
    pagoEstamina = await actor.pagarCustos({ estamina: cfg.estamina });
    if (!pagoEstamina) return;
  }
  const gasto = await actor.gastarAcoes(cfg.acoes, { tipo });
  if (!gasto.ok) return;

  const custos = [
    gasto.texto,
    pagoEstamina?.daEstamina ? loc("PYRO.Economia.Estamina", { valor: pagoEstamina.daEstamina }) : null,
    pagoEstamina?.dosPv ? loc("PYRO.Economia.Pv", { valor: pagoEstamina.dosPv }) : null
  ].filter(Boolean).join(" · ");
  return anunciarAcao(actor, loc(`PYRO.Guia.${chave}.Feito`), custos);
}

/**
 * "Fulano moveu-se · 1 ação": o aviso das ações que não têm card próprio.
 * Sem ele a mesa não teria como saber por que o contador de alguém desceu.
 */
export function anunciarAcao(actor, feito, custo) {
  const nome = esc(actor.name);
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p class="pyro-acao-feita">${loc("PYRO.Economia.Fez", { nome, acao: feito })}${
      custo ? ` <span class="pyro-acao-custo">${custo}</span>` : ""}</p>`
  });
}

/**
 * Re-desenha as fichas de quem está no combate quando o turno anda: o
 * contador é calculado na hora, e sem isso a ficha aberta mostraria as
 * reações do turno anterior até alguém encostar nela.
 */
export function registrarEconomia() {
  // Só o que já está aberto: pedir actor.sheet criaria uma ficha para cada
  // combatente em cada cliente a cada turno.
  const redesenharAtor = actor => {
    for (const app of Object.values(actor?.apps ?? {})) if (app.rendered) app.render();
  };
  const redesenhar = combate => {
    for (const combatente of combate?.combatants ?? []) redesenharAtor(combatente.actor);
    for (const app of foundry.applications.instances?.values?.() ?? []) {
      if (app.options?.classes?.includes("guia-acoes") && app.rendered) app.render();
    }
  };
  Hooks.on("updateCombat", (combate, mudanca) => {
    if ("turn" in mudanca || "round" in mudanca || "active" in mudanca) redesenhar(combate);
  });
  Hooks.on("combatStart", redesenhar);
  Hooks.on("deleteCombat", redesenhar);
  for (const gancho of ["createCombatant", "deleteCombatant"]) {
    Hooks.on(gancho, combatente => redesenharAtor(combatente.actor));
  }
}

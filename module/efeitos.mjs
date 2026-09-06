/**
 * Efeitos de uso: o que um item entrega ao alvo, e não a quem carrega.
 *
 * Vive fora de item.mjs e magia.mjs porque os dois montam cards de chat com
 * os mesmos botões — arma, consumível, habilidade, feitiço e conjuração de
 * magia. Aqui também mora a resolução das @variáveis publicadas pelo card,
 * que é o que permite um efeito dizer "alcance = @alcance" em vez de um
 * número fixo escolhido quando o efeito foi criado.
 */

import { PYRO } from "./config.mjs";
import { esc } from "./ui.mjs";
import { SYSTEM_ID, flagsDe, flagsDoSistema } from "./sistema.mjs";


/* -------------------------------------------------------------------------- */
/*  Efeitos restritos a itens                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Itens a que um efeito está preso. Lista vazia significa "vale sempre".
 * Cada entrada guarda id e nome: o id resolve na ficha em que o efeito nasceu,
 * o nome salva a referência quando o efeito viaja para outro personagem ou o
 * item é recriado.
 */
export function restricaoDoEfeito(efeito) {
  return flagsDe(efeito)?.alvosItem ?? [];
}

/**
 * Este efeito vale para este item? Sem restrição, vale para qualquer um.
 * Uma entrada pode prender o efeito a um tipo inteiro ("todas as magias") ou a
 * um item específico. No item específico o id resolve primeiro e o nome é a
 * rede de segurança; num alvo de tipo o nome é só rótulo, e não entra na
 * comparação, senão um item chamado "Magia" casaria por acidente.
 */
export function efeitoValeParaItem(efeito, item) {
  const alvos = restricaoDoEfeito(efeito);
  if (!alvos.length) return true;
  if (!item) return false;
  const nome = PYRO.normalizarTexto(item.name);
  return alvos.some(a => a.tipo
    ? a.tipo === item.type
    : (a.id === item.id || (!!a.nome && PYRO.normalizarTexto(a.nome) === nome)));
}

/** Efeitos ativos do ator, incluindo os que estão presos a algum item. */
function efeitosAtivos(actor) {
  const lista = [];
  for (const efeito of actor?.allApplicableEffects?.() ?? []) {
    // `disabled` é escolha do jogador. Efeito preso a item aparece aqui de
    // propósito: ele está suprimido na ficha, mas vale na rolagem certa.
    if (!efeito.disabled) lista.push(efeito);
  }
  return lista;
}

/**
 * Rolagens de dano que os efeitos somam a este item. A fórmula aceita dado,
 * número plano ou os dois ("2d6", "2", "2d6+2", "2d6+1d4").
 */
export function bonusDeDano(actor, item) {
  const saida = [];
  for (const efeito of efeitosAtivos(actor)) {
    if (!efeitoValeParaItem(efeito, item)) continue;
    for (const dano of flagsDe(efeito)?.danos ?? []) {
      if (dano.formula?.trim()) saida.push({ ...dano, nome: efeito.name });
    }
  }
  return saida;
}

/**
 * Quanto os efeitos somam ou tiram do custo de usar este item. Chaves são as
 * de PYRO.alvosEfeito.custo: acoes, mana, estamina, energia.
 *
 * Diferente do bônus de dano, aqui não há fórmula: é um número com sinal, e a
 * conta é sempre soma. "Metade do custo" pediria uma regra de ordem entre
 * efeitos que não vale a complexidade enquanto ninguém precisar.
 */
export function ajustesDeCusto(actor, item) {
  const ajustes = {};
  for (const efeito of efeitosAtivos(actor)) {
    if (!efeitoValeParaItem(efeito, item)) continue;
    for (const custo of flagsDe(efeito)?.custos ?? []) {
      const valor = Number(custo.valor);
      if (custo.chave && Number.isFinite(valor)) {
        ajustes[custo.chave] = (ajustes[custo.chave] ?? 0) + valor;
      }
    }
  }

  /*
   * Item arcano equipado abate mana de tudo que gasta mana. Entra por aqui,
   * e não como efeito, para o jogador só precisar equipar o item — e como o
   * desconto vale para qualquer conjuração, ele não olha o item em uso.
   */
  for (const equip of actor?.items ?? []) {
    const s = equip.system;
    if (equip.type !== "equipamento" || !s.equipado || s.categoria !== "arcano") continue;
    if (s.reducaoMana) ajustes.mana = (ajustes.mana ?? 0) - s.reducaoMana;
  }
  return ajustes;
}

/**
 * Custo já ajustado. Reduções diferentes acumulam (os deltas chegam aqui já
 * somados), mas nunca zeram um custo que existia: o piso é 1. Um custo que
 * já era zero segue zero — não há o que reduzir — e ajuste que encarece
 * continua livre.
 */
export function custoAjustado(base, delta) {
  const b = Math.round(base ?? 0);
  const total = Math.max(0, Math.round(b + (delta ?? 0)));
  return (delta ?? 0) < 0 && b > 0 ? Math.max(1, total) : total;
}

/**
 * Aumentos de atributo que valem só quando este item é usado.
 *
 * Efeito preso a item fica suprimido na ficha, senão um "+2 FOR com a katana"
 * valeria também de mãos vazias. O que ele altera entra aqui, na hora da
 * rolagem daquele item. Só atributos, e só no modo Somar: é o que faz sentido
 * numa rolagem isolada.
 */
export function ajustesDeAtributo(actor, item) {
  const ALVO = /^system\.atributos\.(\w+)\.(?:valor|bonus)$/;
  const ajustes = {};
  for (const efeito of efeitosAtivos(actor)) {
    if (!restricaoDoEfeito(efeito).length) continue; // já aplicado na ficha
    if (!efeitoValeParaItem(efeito, item)) continue;
    for (const mudanca of efeito.system?.changes ?? []) {
      if (mudanca.type !== "add") continue;
      const chave = ALVO.exec(mudanca.key)?.[1];
      const valor = Number(mudanca.value);
      if (chave && Number.isFinite(valor)) ajustes[chave] = (ajustes[chave] ?? 0) + valor;
    }
  }
  return ajustes;
}

/** Efeitos de uso ativos de um ou mais itens, sem repetir o mesmo efeito. */
export function efeitosDeUso(...itens) {
  const vistos = new Set();
  const saida = [];
  for (const item of itens.flat().filter(Boolean)) {
    for (const efeito of item.effects ?? []) {
      if (!flagsDe(efeito)?.deUso || efeito.disabled) continue;
      if (vistos.has(efeito.uuid)) continue;
      vistos.add(efeito.uuid);
      saida.push(efeito);
    }
  }
  return saida;
}

/**
 * Bloco de botões do card do chat, um por efeito de uso. Quem clica decide o
 * alvo: os tokens selecionados, ou o próprio personagem do usuário.
 */
export function htmlEfeitosDeUso(...itens) {
  const lista = efeitosDeUso(...itens);
  if (!lista.length) return "";

  const botoes = lista.map(efeito => `
    <button type="button" class="pyro-aplicar-efeito" data-efeito-uuid="${efeito.uuid}">
      <img src="${efeito.img}" alt="" />
      <span>${esc(efeito.name)}</span>
    </button>`).join("");

  return `<div class="pyro-efeitos-uso">
    <span class="pyro-efeitos-rotulo">${game.i18n.localize("PYRO.Efeitos.AplicarEm")}</span>
    ${botoes}
  </div>`;
}

/* -------------------------------------------------------------------------- */
/*  Variáveis do card                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Variáveis que um card do sistema publicou. Conjurações gravam a lista
 * completa (alcance, raio, intenção...); os demais cards oferecem ao menos o
 * dano somado e a cura, que já vêm nas flags para o menu de aplicar.
 */
export function variaveisDaMensagem(message) {
  const flags = flagsDe(message) ?? {};
  const vars = { ...(flags.variaveis ?? {}) };
  if (vars.danoTotal === undefined) {
    vars.danoTotal = (flags.danos ?? []).reduce((t, d) => t + (d.total ?? 0), 0);
  }
  if (vars.cura === undefined) vars.cura = flags.cura ?? 0;
  return vars;
}

/**
 * Troca as @variáveis pelo valor daquela conjuração e resolve a conta quando
 * o que sobra é aritmética ("@alcance / 2" vira "3"). Referências que não
 * estão no mapa ficam intactas, então "@det" continua valendo o DET de quem
 * recebe o efeito, resolvido pelo Foundry na aplicação.
 */
export function resolverValorEfeito(valor, vars) {
  const bruto = String(valor ?? "");
  if (!bruto.includes("@")) return bruto;
  const resolvido = Roll.replaceFormulaData(bruto, vars);
  if (resolvido.includes("@")) return resolvido;
  if (!/^[\d\s+\-*/().]+$/.test(resolvido)) return resolvido;
  try {
    return String(Roll.safeEval(resolvido));
  } catch (erro) {
    console.warn("PYRO | Valor de efeito não pôde ser calculado", bruto, erro);
    return resolvido;
  }
}

/**
 * Cópia do efeito pronta para o alvo: valores e duração já resolvidos com as
 * variáveis do card. É cópia independente de propósito — editar o item depois
 * não mexe em quem já recebeu.
 */
export function dadosDoEfeitoAplicado(efeito, vars) {
  const dados = efeito.toObject();
  delete dados._id;
  dados.origin = efeito.uuid;
  dados.transfer = false;
  dados.disabled = false;
  // v14: as mudanças vivem em system.changes.
  dados.system = {
    ...(dados.system ?? {}),
    changes: (dados.system?.changes ?? []).map(m => ({
      ...m,
      value: resolverValorEfeito(m.value, vars)
    }))
  };

  // Duração escrita como fórmula ("@rodadas") só vira número aqui, porque só
  // agora se sabe com que Intenção a magia foi conjurada.
  const formula = flagsDe(efeito)?.rodadasFormula;
  if (formula) {
    const rodadas = Number(resolverValorEfeito(formula, vars));
    if (Number.isFinite(rodadas) && rodadas > 0) {
      dados.duration = { ...(dados.duration ?? {}), rounds: rodadas };
    }
  }
  return dados;
}

/* -------------------------------------------------------------------------- */
/*  Exaustão                                                                  */
/* -------------------------------------------------------------------------- */

/** O efeito carrega a condição "exausto"? statuses é Set no documento vivo. */
export function ehExaustao(efeito) {
  const st = efeito.statuses;
  return st?.has ? st.has("exausto") : (st ?? []).includes("exausto");
}

/**
 * Níveis que um efeito de exaustão carrega. O número mora na flag; um efeito
 * com o status mas sem a flag (posto pelo HUD do token, por exemplo) conta
 * como 1.
 */
export function niveisDoEfeito(efeito) {
  const n = Number(flagsDe(efeito)?.exaustao);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

/**
 * Quantos níveis de exaustão valem agora: a soma dos efeitos ativos com a
 * condição. Cada nível tira 1 de todos os testes (atributo, mira,
 * sobrecarga). O sobrepeso não entra por fora: ele soma +1 no próprio efeito
 * (ver sincronizarSobrepeso), então o que a ficha mostra é o que desconta.
 */
export function nivelExaustao(actor) {
  let total = 0;
  for (const efeito of efeitosAtivos(actor)) {
    if (ehExaustao(efeito)) total += niveisDoEfeito(efeito);
  }
  return total;
}

/**
 * O que a exaustão tira de um teste: -1 fixo por nível e, a cada 5 níveis,
 * uma desvantagem (um dado a menos na pool). Exaustão 7 = -7 e 1 desvantagem.
 * Vale para todo teste que não seja dano: atributo, esquiva, bloqueio, mira
 * e sobrecarga passam por aqui.
 */
export function penalidadeExaustao(actor) {
  const niveis = nivelExaustao(actor);
  return { niveis, bonus: -niveis, desvantagem: Math.floor(niveis / 5) };
}

/** Linha de aviso dos diálogos de teste; vazia sem exaustão. */
export function dicaExaustao(actor) {
  const pen = penalidadeExaustao(actor);
  if (pen.niveis <= 0) return "";
  return pen.desvantagem > 0
    ? game.i18n.format("PYRO.Teste.ExaustaoDesvantagem", { n: pen.niveis, d: pen.desvantagem })
    : game.i18n.format("PYRO.Teste.ExaustaoDica", { n: pen.niveis });
}

/**
 * Soma (ou tira, com delta negativo) níveis de exaustão e devolve o total.
 *
 * A exaustão acumula num efeito só, chamado "Exaustão", com o número na
 * flag: quem tem 2 e sofre sobrecarga 2 fica com 4, e não com dois efeitos
 * separados. Chegando a zero o efeito some — nível zero não é exaustão.
 */
export async function aplicarExaustao(actor, delta) {
  delta = Number(delta) || 0;
  if (!actor || delta === 0) return nivelExaustao(actor);
  const loc = k => game.i18n.localize(k);

  const existente = actor.effects?.find?.(e => ehExaustao(e) && !e.disabled);
  if (existente) {
    const novo = Math.max(0, niveisDoEfeito(existente) + delta);
    if (novo === 0) await existente.delete();
    else await existente.update({ name: loc("PYRO.Exaustao.Nome"), [`flags.${SYSTEM_ID}.exaustao`]: novo });
    return nivelExaustao(actor);
  }
  if (delta < 0) return nivelExaustao(actor);

  await ActiveEffect.implementation.create({
    name: loc("PYRO.Exaustao.Nome"),
    img: PYRO.condicoes.exausto?.img ?? "icons/svg/sleep.svg",
    origin: actor.uuid,
    statuses: ["exausto"],
    description: loc("PYRO.Exaustao.Dica"),
    flags: flagsDoSistema({ exaustao: delta })
  }, { parent: actor });
  return nivelExaustao(actor);
}

/**
 * Sobrepeso vale +1 de exaustão de verdade, no efeito, e não por baixo dos
 * panos: entrar em sobrepeso soma 1, sair tira 1. A flag no ator lembra se
 * o +1 já foi dado, então a conta nunca repete — e é gravada antes de mexer
 * no efeito, porque mexer no efeito dispara esta função de novo.
 */
export async function sincronizarSobrepeso(actor) {
  if (!actor) return;
  const agora = !!actor.system?.sobrepeso;
  const marcado = !!actor.getFlag(SYSTEM_ID, "sobrepesoExausto");
  if (agora === marcado) return;
  await actor.setFlag(SYSTEM_ID, "sobrepesoExausto", agora);
  await aplicarExaustao(actor, agora ? 1 : -1);
}

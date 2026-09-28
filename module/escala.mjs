/**
 * Habilidades escaláveis: o sistema de pontos das magias (Intenção) e das
 * técnicas (Esforço), aberto para a mesa montar à mão.
 *
 * A habilidade diz o que escala (os escalamentos, como os traços de uma
 * técnica ou os escalonamentos de uma runa) e quanto cada recurso custa por
 * ponto. Na hora de usar, cada escalamento recebe os seus pontos numa janela
 * igual à do Executor, e o custo é a soma de todos.
 *
 * Serve para o que o sistema ainda não tem regra própria, como os feitiços,
 * e para habilidades de caminho que crescem com o quanto se põe nelas.
 */
import { PYRO } from "./config.mjs";
import { calcularFormula, prepararFormula } from "./dados.mjs";
import {
  htmlEfeitosDeUso, ajustesDeAtributo, ajustesDeCusto, custoAjustado
} from "./efeitos.mjs";
import { esc, enriquecer } from "./ui.mjs";
import { htmlBotaoSobrecarga } from "./teste.mjs";
import { flagsDoSistema } from "./sistema.mjs";

const loc = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/** Um escalamento nunca sai com menos de um ponto, como a Intenção e o Esforço. */
export const PONTOS_MINIMOS = 1;

/** Tipo de dano que desliga a rolagem mesmo com faces: o escalamento só conta. */
const SEM_TIPO = "";

/** Número que vem de um campo da ficha: fração vira número, lixo vira zero. */
const numero = valor => Number(valor) || 0;

/**
 * Custo de uma linha de recurso num escalamento com N pontos: cada ponto
 * custa a base vezes o número dele, somado aos anteriores. É a curva da
 * mana (base 1: 1, 3, 6, 10, 15) e do Esforço (base 2: 2, 6, 12, 20, 30).
 */
export function custoDaLinha(linha, pontos) {
  const n = Math.round(numero(pontos));
  if (n < 1) return 0;
  return Math.max(0, Math.round(numero(linha?.base) * (n * (n + 1)) / 2));
}

/**
 * O tipo de dano do escalamento. Só o escalamento chamado Dano tem um: nos
 * outros o campo nem aparece, e um tipo que ficou guardado de quando o
 * nome era outro não vale.
 */
export function tipoDoEscalamento(cfg) {
  return PYRO.normalizarTexto(cfg?.nome ?? "") === "dano" ? (cfg?.tipoDano ?? "") : "";
}

/** O que um escalamento rende com N pontos, antes de rolar qualquer dado. */
export function valorDoEscalamento(cfg, pontos) {
  const n = Math.max(PONTOS_MINIMOS, Math.round(numero(pontos)));
  return Math.max(0, Math.floor(numero(cfg?.base) + numero(cfg?.porPonto) * (n - 1)));
}

/** "3d6 cortante", "4": o escalamento como a janela e o card escrevem. */
export function textoDoEscalamento(cfg, valor) {
  const faces = Math.round(numero(cfg?.faces));
  if (faces <= 0) return String(valor);
  const chave = tipoDoEscalamento(cfg);
  const tipo = chave ? loc(PYRO.tiposDano[chave]?.label ?? chave) : "";
  return `${valor}d${faces}${tipo ? ` ${tipo}` : ""}`;
}

/**
 * Limite seguro de pontos por escalamento, resolvido na ficha de quem usa.
 * Campo vazio é habilidade sem limite, e aí nunca há teste de sobrecarga.
 */
export function limiteDaEscala(item) {
  const escrito = String(item?.system?.escala?.limite ?? "").trim();
  if (!escrito) return null;
  return Math.max(0, Math.floor(calcularFormula(escrito, item.getRollData?.() ?? {})));
}

/**
 * A contabilidade de um uso: o que cada escalamento rende, o custo por
 * recurso já com os efeitos de custo, o excesso além do limite e o ND do
 * teste que o excesso obriga.
 *
 * @param {Item} item a habilidade.
 * @param {Record<number, number>} pontos pontos por índice de escalamento.
 * @param {object} [opcoes.ajustes] ajustes de custo por recurso; o padrão
 *   lê os efeitos do dono da habilidade.
 */
export function calcularEscala(item, pontos = {}, { ajustes = null } = {}) {
  const escala = item?.system?.escala ?? {};
  const limite = limiteDaEscala(item);
  const custosLinhas = escala.custos ?? [];
  const brutos = {};
  let excesso = 0;
  let soma = 0;

  const linhas = (escala.escalamentos ?? []).map((cfg, indice) => {
    const n = Math.max(PONTOS_MINIMOS, Math.round(numero(pontos[indice] ?? PONTOS_MINIMOS)));
    const alem = limite === null ? 0 : Math.max(0, n - limite);
    excesso += alem;
    soma += n;
    // O custo de cada recurso por escalamento: a janela mostra linha a linha.
    const custos = {};
    for (const linha of custosLinhas) {
      if (!PYRO.recursosDeGasto().includes(linha.recurso)) continue;
      const custo = custoDaLinha(linha, n);
      if (!custo) continue;
      custos[linha.recurso] = (custos[linha.recurso] ?? 0) + custo;
      brutos[linha.recurso] = (brutos[linha.recurso] ?? 0) + custo;
    }
    const valor = valorDoEscalamento(cfg, n);
    return {
      indice, cfg, nome: cfg.nome || loc("PYRO.Escala.SemNome", { n: indice + 1 }),
      pontos: n, alem, valor, texto: textoDoEscalamento(cfg, valor), custos
    };
  });

  /*
   * Os efeitos de custo valem sobre o total de cada recurso, como na técnica:
   * "metade da mana" aplicado escalamento a escalamento arredondaria várias
   * vezes e daria mais desconto que a metade.
   */
  const ajustesDoAtor = ajustes ?? ajustesDeCusto(item?.actor ?? null, item);
  const custos = Object.fromEntries(Object.entries(brutos)
    .map(([recurso, total]) => [recurso, custoAjustado(total, ajustesDoAtor?.[recurso])]));

  return { linhas, custos, custosBrutos: brutos, limite, excesso, soma, nd: 10 + soma };
}

/**
 * As @variáveis que o card publica para os efeitos de uso e para a fórmula
 * da habilidade: a soma dos pontos e o valor de cada escalamento pelo nome
 * ("Dano" vira @dano, "Alcance (m)" vira @alcance).
 */
export function variaveisDaEscala(calc, chaveVariavel, reservadas = null) {
  const variaveis = { intencao: calc.soma, esforco: calc.soma };
  for (const l of calc.linhas) {
    const chave = chaveVariavel(l.cfg.nome);
    // Nome que coincide com um dado do ator (Det, For, Nvl) não o apaga.
    if (!chave || variaveis[chave] !== undefined || reservadas?.has(chave)) continue;
    variaveis[chave] = l.valor;
  }
  return variaveis;
}

/** Rótulo dos pontos desta habilidade: o que a mesa escreveu, ou Intenção. */
export const rotuloDosPontos = item =>
  String(item?.system?.escala?.rotulo ?? "").trim() || loc("PYRO.Escala.RotuloPadrao");

/**
 * O custo de uma habilidade escalável em frases curtas, para a ficha e o
 * subtítulo: "mana 1, 3, 6…", o custo de um escalamento com 1, 2 e 3 pontos.
 */
export function textosDoCustoDaEscala(sys) {
  return (sys?.escala?.custos ?? [])
    .filter(l => PYRO.recursosDeGasto().includes(l.recurso))
    .map(l => loc("PYRO.Escala.CustoLinha", {
      recurso: nomeDoRecurso(l.recurso).toLocaleLowerCase(),
      sequencia: [1, 2, 3].map(n => custoDaLinha(l, n)).join(", ")
    }));
}

/** Nome do recurso como a janela e o card escrevem. */
export const nomeDoRecurso = chave =>
  loc(PYRO.recursosCustom?.[chave]?.label ?? `PYRO.Recursos.${chave}`);

/**
 * Usa a habilidade: confere e cobra ações e recursos, rola os escalamentos
 * que têm dados e publica o card.
 *
 * @returns {Promise<ChatMessage|false|undefined>} false quando nada saiu
 *   por falta de ação ou de recurso, para a janela continuar aberta.
 */
export async function usarEscala(actor, item, pontos = {}) {
  if (!actor || !actor.podeAgir()) return false;
  const sys = item.system;
  const calc = calcularEscala(item, pontos);
  if (!calc.linhas.length) {
    ui.notifications.warn(loc("PYRO.Escala.SemEscalamentos"));
    return false;
  }

  const tipo = sys.tipoCusto === "reacao" ? "reacao" : "acao";
  const acoes = custoAjustado(sys.custoAcoes, ajustesDeCusto(actor, item).acoes);
  // O contador é conferido antes e cobrado depois dos recursos: faltando
  // mana, as ações ficam onde estavam.
  if (!actor.podeGastarAcoes(acoes, { tipo })) return false;
  const pago = await actor.pagarCustos(calc.custos);
  if (!pago) return false;
  const gasto = await actor.gastarAcoes(acoes, { tipo });

  const { textosDoPagamento } = await import("./documents/actor.mjs");
  const { chaveVariavel } = await import("./magia.mjs");
  const rotulo = rotuloDosPontos(item);
  const dadosDoItem = item.getRollData();
  const variaveis = variaveisDaEscala(calc, chaveVariavel, new Set(Object.keys(dadosDoItem)));

  const meta = [gasto.texto || null, ...textosDoPagamento(pago)].filter(Boolean).join(" · ");
  const partes = [`<header class="pyro-item-topo">
    <img src="${item.img}" alt="" />
    <div><h3>${esc(item.name)}</h3><span class="pyro-item-meta">${meta}</span></div>
  </header>`];

  partes.push(`<ul class="pyro-tracos">${calc.linhas.map(l => `<li${l.alem ? ` class="alem-limite"` : ""}>
    <strong>${esc(l.nome)}</strong>
    <span class="pyro-traco-meta">${esc(rotulo)} ${l.pontos}</span>
    <span class="pyro-traco-valor">${esc(l.texto)}</span>
  </li>`).join("")}</ul>`);

  /* --- Dados: cada escalamento com faces rola o que rendeu ---------------- */
  const rolls = [];
  const danos = [];
  const dados = { ...dadosDoItem, ...variaveis };
  for (const l of calc.linhas) {
    const faces = Math.round(numero(l.cfg.faces));
    if (faces <= 0 || l.valor <= 0) continue;
    const roll = await new Roll(`${l.valor}d${faces}`).evaluate();
    rolls.push(roll);
    const tipoDano = tipoDoEscalamento(l.cfg);
    if (tipoDano !== SEM_TIPO) {
      danos.push({ tipo: tipoDano, total: roll.total, formula: roll.formula });
    }
    const tipoTexto = tipoDano ? loc(PYRO.tiposDano[tipoDano]?.label ?? tipoDano) : "";
    partes.push(`<p class="pyro-linha-dano dano-${tipoDano}">${esc(l.nome)}${
      tipoTexto ? ` — ${tipoTexto}` : ""}</p>`, await roll.render());
  }

  // A fórmula da habilidade enxerga os escalamentos: "@dano * 2" funciona.
  if (sys.formula) {
    const roll = await new Roll(prepararFormula(sys.formula, dados), dados).evaluate();
    rolls.push(roll);
    partes.push(`<p class="pyro-total-unidade" title="${esc(`${roll.formula} = ${roll.total}`)}">
      ${esc(`${roll.total}${sys.unidadeFormula ?? ""}`)}</p>`);
  }

  // Ponto além do limite cobra o teste de sobrecarga, rolado no botão.
  if (calc.excesso > 0) {
    const atributo = sys.escala?.atributo || "sab";
    partes.push(htmlBotaoSobrecarga({
      atorUuid: actor.uuid,
      itemUuid: item.uuid,
      atributo,
      nd: calc.nd,
      exaustao: calc.excesso,
      bonusAtributo: ajustesDeAtributo(actor, item)[atributo] ?? 0,
      motivo: loc("PYRO.Escala.LimitePendente", { excesso: calc.excesso, nd: calc.nd })
    }));
  }

  const descricao = await enriquecer(sys.descricao, item);
  if (descricao) partes.push(descricao);
  partes.push(htmlEfeitosDeUso(item));

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="pyro-chat pyro-item-card">${partes.join("")}</div>`,
    rolls,
    // Sem dano rolado o card não ganha os botões de aplicar: não há o que aplicar.
    flags: flagsDoSistema({ variaveis, ...(danos.length ? { danos } : {}) }),
    ...(rolls.length ? { sound: CONFIG.sounds.dice } : {})
  });
}

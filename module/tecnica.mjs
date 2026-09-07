/**
 * Regras de técnica (SRD Técnicas): pontos de criação, o que cada traço rende
 * no Esforço escolhido, o limite seguro e a execução em si, com o card de chat.
 *
 * As contas são puras e ficam separadas da execução de propósito: o Executor
 * mostra estamina, limite e efeito antes de gastar, e é a mesma função que
 * cobra depois — a prévia nunca diverge do que aconteceu.
 */
import { PYRO } from "./config.mjs";
import { esc } from "./ui.mjs";
import { formulaTeste, poolDoAtributo, multiplicarDados, expandirAtributos } from "./dados.mjs";
import {
  htmlEfeitosDeUso, bonusDeDano, ajustesDeCusto, custoAjustado,
  aplicarExaustao, penalidadeExaustao
} from "./efeitos.mjs";
import { flagsDoSistema } from "./sistema.mjs";
import { classificarRolagem, poolDoTeste, htmlClasseDaRolagem, flagsDaClasse } from "./progressao.mjs";

const loc = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/* -------------------------------------------------------------------------- */
/*  Pontos de criação                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Ações que a técnica cobra a mais (positivo) ou a menos (negativo) que a ação
 * base. Cada uma vale um ponto, para os dois lados (SRD Técnicas).
 */
export function ajusteDeAcoes(sys) {
  const base = PYRO.acoesBaseTecnica[sys?.acaoBase]?.acoes ?? 1;
  return Math.max(1, Number(sys?.acoes) || 1) - base;
}

/**
 * Pontos de criação: (2 + especificidade + ajuste de ações) x (tier + 1), mais
 * o que os pontos fracos devolvem. Os ônus entram fora do produto: são um
 * abatimento fixo, e não uma condição que o tier amplifica.
 */
export function pontosDaTecnica(sys) {
  const espec = PYRO.especificidades[sys?.especificidade]?.pontos ?? 0;
  const tier = Math.max(1, Number(sys?.tier) || 1);
  const doTier = Math.max(0, 2 + espec + ajusteDeAcoes(sys)) * (tier + 1);
  const dosOnus = (sys?.onus ?? [])
    .reduce((total, chave) => total + (PYRO.onusTecnica[chave]?.pontos ?? 0), 0);

  const disponiveis = doTier + dosOnus;
  const gastos = (sys?.tracos ?? [])
    .reduce((total, t) => total + PYRO.custoDoGrau(t.grau), 0);
  return { disponiveis, doTier, dosOnus, gastos, restantes: disponiveis - gastos };
}

/** Traços que cabem nesta ação base; sem `bases` o traço cabe em qualquer uma. */
export function tracosCompativeis(acaoBase) {
  return Object.entries(PYRO.tracosTecnica)
    .filter(([, cfg]) => !cfg.bases?.length || cfg.bases.includes(acaoBase))
    .map(([chave, cfg]) => ({ chave, ...cfg }));
}

/**
 * O que um traço rende: (base + porGrau x (grau - 1)) x Esforço.
 *
 * O grau move os dois lados da conta — a base e o quanto cada Esforço
 * acrescenta —, que é o que separa um traço caro de um barato levado no braço.
 * Esforço 0 é o traço não usado nesta execução.
 */
export function valorDoTraco(cfg, grau, esforco) {
  if (!cfg || esforco <= 0) return 0;
  const porGrau = Number(cfg.porGrau) || 0;
  const noGrau = (Number(cfg.base) || 0) + porGrau * (Math.max(1, grau) - 1);
  return noGrau * esforco;
}

/** Limite seguro de Esforço por traço (SRD Técnicas): DET x 2. */
export function limiteSeguro(actor) {
  return (actor?.system?.det ?? 1) * 2;
}

/**
 * Contabilidade de uma execução: estamina por traço, excesso além do limite
 * seguro e o ND do teste de VIG que o excesso obriga.
 * @param {object[]} usados [{ chave, cfg, grau, esforco }]
 */
export function calcularEsforco(actor, usados) {
  const limite = limiteSeguro(actor);
  let estamina = 0;
  let excesso = 0;
  let somaEsforcos = 0;

  const linhas = usados.map(u => {
    const custo = PYRO.custoDoEsforco(u.esforco);
    const alem = Math.max(0, u.esforco - limite);
    estamina += custo;
    excesso += alem;
    somaEsforcos += u.esforco;
    return { ...u, custo, alem, valor: valorDoTraco(u.cfg, u.grau, u.esforco) };
  });

  return {
    linhas, limite, estamina, excesso, somaEsforcos,
    // Só o excesso obriga o teste; sem ele a execução é rotineira por regra.
    nd: 10 + somaEsforcos
  };
}

/* -------------------------------------------------------------------------- */
/*  Ataques disponíveis                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Ataques que a ficha oferece. São as armas do inventário, incluindo as
 * marcadas como ataque desarmado — soco e chute são itens como qualquer
 * outro aqui, montados por quem joga.
 */
export function ataquesDoAtor(actor) {
  return actor.items
    .filter(i => i.type === "arma")
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map(item => ({
      id: item.id,
      nome: item.name,
      item,
      danos: (item.system.danos ?? []).filter(d => d.formula?.trim()),
      acoes: item.system.acoes ?? 2,
      alcanceMenor: item.system.alcanceMenor ?? 0,
      alcanceMaximo: item.system.alcanceMaximo ?? 0,
      desarmado: !!item.system.desarmado
    }));
}

/** Família de uma arma pelo custo em ações (SRD Técnicas: leve, média, pesada). */
export function familiaDoAtaque(ataque) {
  if (ataque.acoes <= 1) return "leve";
  return ataque.acoes === 2 ? "media" : "pesada";
}

/**
 * O ataque atende a condição imposta pela técnica? Alcance e família saem de
 * números que a arma já tem; tipo casa com o tipo de dano da primeira parcela
 * (ou com o desarmado); específica aponta um ataque nomeado.
 */
export function ataqueAtende(ataque, sys) {
  const filtro = PYRO.especificidades[sys?.especificidade]?.filtro ?? "";
  if (!filtro) return true;
  switch (filtro) {
    case "alcance":
      return sys.filtro === "distante" ? ataque.alcanceMaximo > 0 : ataque.alcanceMaximo === 0;
    case "familia":
      return familiaDoAtaque(ataque) === sys.filtro;
    case "tipo":
      return sys.filtro === PYRO.FILTRO_DESARMADO
        ? ataque.desarmado
        : ataque.danos.some(d => d.tipo === sys.filtro);
    case "ataque":
      return ataque.id === sys.ataque?.id;
    default:
      return true;
  }
}

/** Ataques que esta técnica aceita. Vazio significa que ela não pode ser usada. */
export function ataquesDaTecnica(actor, sys) {
  return ataquesDoAtor(actor).filter(a => ataqueAtende(a, sys));
}

/**
 * Opções do filtro de uma especificidade, ou null quando ela não filtra.
 * O filtro de tipo é montado na hora porque inclui os tipos de dano, que o
 * mestre configura.
 */
export function opcoesDoFiltro(especificidade) {
  const filtro = PYRO.especificidades[especificidade]?.filtro ?? "";
  if (!filtro || filtro === "ataque") return null;
  return filtro === "tipo" ? PYRO.opcoesFiltroTipo() : PYRO.filtrosEspecificidade[filtro] ?? null;
}

/** A condição imposta pela especificidade, em uma linha ("armas cortantes"). */
export function textoDaCondicao(sys) {
  const espec = PYRO.especificidades[sys?.especificidade];
  if (!espec?.filtro) return "";
  if (espec.filtro === "ataque") return sys.ataque?.nome ?? "";
  return loc(opcoesDoFiltro(sys.especificidade)?.[sys.filtro] ?? "");
}

/* -------------------------------------------------------------------------- */
/*  Posturas                                                                  */
/* -------------------------------------------------------------------------- */

/** Habilidades marcadas como postura, na ordem da ficha. */
export function posturasDoAtor(actor) {
  return actor?.items
    .filter(i => i.type === "habilidade" && i.system.ehPostura)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)) ?? [];
}

/* -------------------------------------------------------------------------- */
/*  Execução                                                                  */
/* -------------------------------------------------------------------------- */

/** Traços comprados desta técnica, já com a configuração e o rótulo de cada um. */
export function tracosDaTecnica(sys) {
  return (sys?.tracos ?? [])
    .map(t => {
      const cfg = PYRO.tracosTecnica[t.chave];
      return cfg ? { chave: t.chave, cfg, grau: Math.max(1, t.grau) } : null;
    })
    .filter(Boolean);
}

/** Texto do que um traço rende ("+3 m", "3x dados de dano"). */
export function textoDoTraco(linha) {
  return `${linha.valor} ${loc(linha.cfg.unidade)}`;
}

/**
 * Executa a técnica: cobra a estamina, testa o excesso de Esforço, rola o
 * ataque quando a ação base tem um, e publica o card.
 *
 * @param {object} escolhas
 * @param {Record<string, number>} escolhas.esforcos Esforço por chave de traço.
 * @param {string} [escolhas.ataqueId] ataque escolhido, quando a base ataca.
 */
export async function usarTecnica(actor, item, { esforcos = {}, ataqueId = null } = {}) {
  const sys = item.system;
  const base = PYRO.acoesBaseTecnica[sys.acaoBase];
  const usados = tracosDaTecnica(sys)
    // Esforço mínimo 1, como a Intenção das magias: um traço só entra na
    // execução fazendo alguma coisa.
    .map(t => ({ ...t, esforco: Math.max(1, Math.round(Number(esforcos[t.chave]) || 0)) }));

  const calc = calcularEsforco(actor, usados);
  const ataque = base?.ataca && ataqueId
    ? ataquesDaTecnica(actor, sys).find(a => a.id === ataqueId) ?? null
    : null;

  /* --- Custos: estamina do Esforço, e os PV do ônus que os pede ----------- */
  const custaPv = (sys.onus ?? []).some(o => PYRO.onusTecnica[o]?.regra === "custaPv");
  // O ônus cobra vida além da estamina, no valor do Esforço em si: Esforço 2
  // num traço custa 6 de estamina (a tabela do Esforço) e 2 de vida.
  const cobraPv = custaPv && calc.somaEsforcos > 0;
  const pago = await actor.pagarCustos({ estamina: calc.estamina });
  if (!pago) return;
  if (cobraPv) {
    const pv = actor.system.recursos.pv;
    await actor.update({ "system.recursos.pv.value": Math.max(0, pv.value - calc.somaEsforcos) });
  }

  /* --- Teste de VIG pelo Esforço além do limite --------------------------- */
  let testeRoll = null;
  let falhou = false;
  // Sem excesso não há teste, e sem teste a execução é rotineira (SRD 3b).
  let classe = "rotineira";
  if (calc.excesso > 0) {
    const pen = penalidadeExaustao(actor);
    const vig = actor.system.atributos.vig.efetivo;
    const ajustes = { bonus: pen.bonus, desvantagem: pen.desvantagem };
    const formula = formulaTeste(vig, ajustes);
    classe = classificarRolagem({ ...poolDoTeste(poolDoAtributo(vig), ajustes), nd: calc.nd });
    if (formula === null) falhou = true;
    else {
      testeRoll = await new Roll(formula).evaluate();
      falhou = testeRoll.total < calc.nd;
    }
  }

  let exaustaoTotal = 0;
  if (calc.excesso > 0 && falhou) exaustaoTotal = await aplicarExaustao(actor, calc.excesso);

  /* --- Card ---------------------------------------------------------------- */
  const rolls = testeRoll ? [testeRoll] : [];
  const partes = [];
  const danos = [];

  const acoes = custoAjustado(sys.acoes, ajustesDeCusto(actor, item).acoes);
  const chaveCusto = base?.reacao ? "PYRO.Chat.CustoReacoes" : "PYRO.Chat.CustoAcoes";
  const meta = [
    loc(chaveCusto, { acoes }),
    loc(base?.label ?? ""),
    /*
     * Estamina e vida saem na mesma linha: o ônus "custa PV" cobra os dois
     * pelo mesmo Esforço, e uma segunda linha dizendo "pagou X de PV pelo
     * ponto fraco" repetia o número que já está aqui.
     */
    calc.estamina || cobraPv
      ? loc(cobraPv ? "PYRO.Chat.CustoEstaminaEVida" : "PYRO.Chat.CustoEstamina",
            // Os dois números são diferentes: a estamina sai da tabela de
            // custo do Esforço e a vida é o Esforço em si.
            { valor: calc.estamina, pv: calc.somaEsforcos })
      : null,
    ataque ? esc(ataque.nome) : null
  ].filter(Boolean).join(" · ");

  partes.push(`<header class="pyro-item-topo">
    <img src="${item.img}" alt="" />
    <div><h3>${esc(item.name)}</h3><span class="pyro-item-meta">${meta}</span></div>
  </header>`);

  // Variação da postura ativa: a mesma técnica muda de forma conforme a guarda.
  const postura = actor.posturaAtiva;
  const variacao = postura
    ? (sys.variacoes ?? []).find(v => v.posturaId === postura.id && v.texto?.trim())
    : null;
  if (variacao) {
    partes.push(`<p class="pyro-postura-variacao"><strong>${esc(postura.name)}:</strong> ${esc(variacao.texto)}</p>`);
  }

  if (calc.linhas.length) {
    partes.push(`<ul class="pyro-tracos">${calc.linhas.map(l => `<li${l.alem ? ` class="alem-limite"` : ""}>
      <strong>${loc(l.cfg.label ?? l.chave)}</strong>
      <span class="pyro-traco-meta">${loc("PYRO.Tecnica.Grau")} ${l.grau} ·
        ${loc("PYRO.Tecnica.Esforco")} ${l.esforco} ·
        ${loc("PYRO.Tecnica.CustoEmEstamina", { valor: l.custo })}</span>
      <span class="pyro-traco-valor">${textoDoTraco(l)}</span>
    </li>`).join("")}</ul>`);
  }

  if (calc.excesso > 0) {
    partes.push(`<div class="pyro-sobrecarga ${falhou ? "falha" : "sucesso"}">
      <p>${loc("PYRO.Tecnica.TesteLimite", { excesso: calc.excesso, nd: calc.nd, total: testeRoll?.total ?? 0 })}
        — <strong>${loc(falhou ? "PYRO.Chat.Falha" : "PYRO.Chat.Sucesso")}</strong></p>
      ${falhou
        ? `<p>${loc("PYRO.Tecnica.ExaustaoAlem", { niveis: calc.excesso, total: exaustaoTotal })}</p>`
        : `<p>${loc("PYRO.Tecnica.Aguentou")}</p>`}
    </div>`);
  }

  /* --- Dano do ataque, com o multiplicador da Potência --------------------- */
  const multPotencia = calc.linhas
    .filter(l => l.cfg.regra === "danoMult")
    .reduce((total, l) => total + l.valor, 0);

  if (ataque) {
    for (const dano of ataque.danos) {
      // "+1x dados de dano" soma uma cópia dos dados, não substitui a original.
      const formula = multiplicarDados(dano.formula, 1 + multPotencia);
      const roll = await new Roll(expandirAtributos(formula), item.getRollData()).evaluate();
      rolls.push(roll);
      danos.push({ tipo: dano.tipo, total: roll.total, formula });
      const rotulo = loc(PYRO.tiposDano[dano.tipo]?.label ?? dano.tipo ?? "");
      partes.push(`<p class="pyro-linha-dano dano-${dano.tipo}">${rotulo}</p>`, await roll.render());
    }
    for (const bonus of bonusDeDano(actor, item)) {
      const roll = await new Roll(expandirAtributos(bonus.formula), item.getRollData()).evaluate();
      rolls.push(roll);
      danos.push({
        tipo: bonus.tipo || ataque.danos[0]?.tipo || "",
        total: roll.total,
        formula: bonus.formula
      });
      partes.push(`<p class="pyro-linha-dano">${esc(bonus.nome)}</p>`, await roll.render());
    }
  }

  // Alcance transforma o golpe em ataque à distância, e aí ele pede mira.
  if (calc.linhas.some(l => l.cfg.regra === "mira")) {
    partes.push(`<p class="pyro-nota">${loc("PYRO.Tecnica.PedeMira")}</p>`);
  }

  // Sem estamina bastante, parte do custo saiu do PV — isso é outra coisa, e
  // continua avisado à parte do ônus que cobra vida de propósito.
  if (pago.dosPv) partes.push(`<p class="pyro-nota">${loc("PYRO.Chat.CustoPv", { valor: pago.dosPv })}</p>`);

  partes.push(htmlEfeitosDeUso(item));
  partes.push(htmlClasseDaRolagem(classe, item));

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="pyro-chat pyro-tecnica">${partes.join("")}</div>`,
    rolls,
    flags: flagsDoSistema({
      danos, cura: 0,
      variaveis: {
        esforco: calc.somaEsforcos,
        estamina: calc.estamina,
        acoes,
        danoTotal: danos.reduce((t, d) => t + d.total, 0),
        ...Object.fromEntries(calc.linhas.map(l => [l.chave, l.valor]))
      },
      ...flagsDaClasse(classe, item)
    }),
    sound: rolls.length ? CONFIG.sounds.dice : undefined
  });
}

/**
 * Abre o Executor da técnica. Fica aqui, e não na ficha, porque o "usar" do
 * item precisa chegar ao mesmo lugar que o botão da lista.
 */
export async function executarTecnica(actor, item) {
  const { ExecutorApp } = await import("./apps/executor.mjs");
  return new ExecutorApp({ actor, item }).render(true);
}
